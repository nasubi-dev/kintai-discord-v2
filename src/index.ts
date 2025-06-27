import { Hono } from "hono";
import {
  Bindings,
  DiscordInteraction,
  InteractionType,
  InteractionResponseType,
  MessageFlags,
} from "./types";
import {
  verifyDiscordRequest,
  isTimestampValid,
  parseTimeStringToJST,
  isFutureTime,
  formatDateToJST,
} from "./utils";
import { DiscordCommandService } from "./discord-service";
import { DiscordApiService } from "./discord-api-service";

const app = new Hono<{ Bindings: Bindings }>();

// Discord インタラクション処理
app.post("/api/interactions", async (c) => {
  try {
    console.log("Processing interaction...");

    // 署名検証に必要なヘッダーを取得
    const signature = c.req.header("x-signature-ed25519");
    const timestamp = c.req.header("x-signature-timestamp");

    if (!signature || !timestamp) {
      console.error("Missing required Discord headers");
      return c.json({ error: "Missing required headers" }, 401);
    }

    // タイムスタンプの有効性を確認
    if (!isTimestampValid(timestamp)) {
      console.error("Invalid timestamp");
      return c.json({ error: "Invalid timestamp" }, 401);
    }

    // リクエストボディを取得
    const rawBody = await c.req.text();

    // 署名検証用のリクエストオブジェクトを作成
    const verificationRequest = new Request(c.req.url, {
      method: "POST",
      headers: {
        "x-signature-ed25519": signature,
        "x-signature-timestamp": timestamp,
        "content-type": "application/json",
      },
      body: rawBody,
    });

    // Discord署名を検証
    const isValid = await verifyDiscordRequest(
      verificationRequest,
      c.env.DISCORD_PUBLIC_KEY
    );

    if (!isValid) {
      console.error("Discord signature verification failed");
      return c.json({ error: "Invalid signature" }, 401);
    }

    console.log("Discord signature verified successfully");

    // JSONをパース
    const body = JSON.parse(rawBody) as DiscordInteraction;
    console.log("Interaction type:", body.type);
    console.log("Interaction data:", JSON.stringify(body.data, null, 2));

    // PINGリクエストの処理
    if (body.type === InteractionType.PING) {
      console.log("Handling PING request");
      return c.json({ type: InteractionResponseType.PONG });
    }

    // アプリケーションコマンドの処理
    if (body.type === InteractionType.APPLICATION_COMMAND) {
      console.log("Handling APPLICATION_COMMAND with Deferred Response");

      // 即座にDeferred Responseを返す（通信環境対応）
      // 成功時は全員に見える、エラー時はEPHEMERALになるよう後で調整
      const deferredResponse = {
        type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
      };

      // バックグラウンドで実際の処理を実行
      c.executionCtx.waitUntil(handleSlashCommandDeferred(c, body));

      return c.json(deferredResponse);
    }

    // 未対応のインタラクションタイプ
    console.log("Unsupported interaction type:", body.type);
    return c.json({
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: {
        content: "❌ サポートされていないインタラクションタイプです。",
        flags: 64, // EPHEMERAL
      },
    });
  } catch (error) {
    console.error("Interaction processing error:", error);
    console.error(
      "Error stack:",
      error instanceof Error ? error.stack : "No stack available"
    );
    return c.json(
      {
        type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
        data: {
          content: "❌ リクエストの処理中にエラーが発生しました。",
          flags: 64, // EPHEMERAL
        },
      },
      500
    );
  }
});

// ヘルスチェック用エンドポイント
app.get("/", (c) => {
  return c.json({
    status: "ok",
    service: "Discord勤怠管理ボット",
    version: "1.0.0",
    timestamp: new Date().toISOString(),
  });
});

// 404エラーハンドリング
app.notFound((c) => {
  return c.json({ error: "Not Found" }, 404);
});

// グローバルエラーハンドリング
app.onError((err, c) => {
  console.error("Unhandled error:", err);
  return c.json(
    {
      error: "Internal Server Error",
      message: err.message,
    },
    500
  );
});

/**
 * スラッシュコマンドをバックグラウンドで処理（Deferred Response対応）
 * 通信環境が悪い場合でも安定した応答を提供
 */
async function handleSlashCommandDeferred(
  c: any,
  interaction: DiscordInteraction
): Promise<void> {
  const commandName = interaction.data?.name;
  const userId = interaction.member?.user?.id || interaction.user?.id;
  const channelId = interaction.channel_id;
  const token = interaction.token;

  // コマンドオプションから時刻を取得
  const timeOption = interaction.data?.options?.find(
    (opt) => opt.name === "time"
  );
  const customTimeString = timeOption?.value as string | undefined;

  const discordApiService = new DiscordApiService(c.env.DISCORD_TOKEN);

  if (!userId || !channelId) {
    await discordApiService.deleteOriginalResponse(
      c.env.DISCORD_APPLICATION_ID,
      token
    );

    await discordApiService.createFollowupMessage(
      c.env.DISCORD_APPLICATION_ID,
      token,
      "❌ ユーザー情報またはチャンネル情報を取得できませんでした。",
      true // ephemeral
    );
    return;
  }

  try {
    switch (commandName) {
      case "start":
        await handleStartCommandWithRetry(
          c,
          interaction,
          discordApiService,
          token,
          customTimeString
        );
        break;
      case "end":
        await handleEndCommandWithRetry(
          c,
          interaction,
          discordApiService,
          token,
          customTimeString
        );
        break;
      default:
        await discordApiService.deleteOriginalResponse(
          c.env.DISCORD_APPLICATION_ID,
          token
        );

        await discordApiService.createFollowupMessage(
          c.env.DISCORD_APPLICATION_ID,
          token,
          "❌ 不明なコマンドです。",
          true // ephemeral
        );
    }
  } catch (error) {
    console.error("Command processing error:", error);

    await discordApiService.deleteOriginalResponse(
      c.env.DISCORD_APPLICATION_ID,
      token
    );

    await discordApiService.createFollowupMessage(
      c.env.DISCORD_APPLICATION_ID,
      token,
      "❌ 処理中にエラーが発生しました。しばらく待ってから再試行してください。",
      true // ephemeral
    );
  }
}

/**
 * リトライ機能付きのstartコマンド処理
 */
async function handleStartCommandWithRetry(
  c: any,
  interaction: DiscordInteraction,
  discordApiService: DiscordApiService,
  token: string,
  customTimeString?: string,
  maxRetries: number = 3
): Promise<void> {
  const userId = interaction.member?.user?.id || interaction.user?.id!;
  const channelId = interaction.channel_id!;
  const username =
    interaction.member?.user?.username ||
    interaction.user?.username ||
    "Unknown";
  const kvKey = `${userId}:${channelId}`;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`Start command attempt ${attempt}/${maxRetries}`);

      // 時刻処理
      let startTime: Date;
      let timeMessage = "";

      if (customTimeString) {
        // カスタム時刻をパース
        const parsedTime = parseTimeStringToJST(customTimeString);

        if (!parsedTime) {
          await discordApiService.deleteOriginalResponse(
            c.env.DISCORD_APPLICATION_ID,
            token
          );

          await discordApiService.createFollowupMessage(
            c.env.DISCORD_APPLICATION_ID,
            token,
            "❌ 時刻形式が正しくありません。\n" +
              "**使用可能な形式:**\n" +
              "• `09:00` (HH:MM形式)\n" +
              "• `0900` (HHMM形式)\n" +
              "• `900` (HMM形式)",
            true // ephemeral
          );
          return;
        }

        // 未来時刻チェック
        if (isFutureTime(parsedTime)) {
          await discordApiService.deleteOriginalResponse(
            c.env.DISCORD_APPLICATION_ID,
            token
          );

          await discordApiService.createFollowupMessage(
            c.env.DISCORD_APPLICATION_ID,
            token,
            "❌ 現在時刻より未来の時刻は指定できません。\n" +
              `指定時刻: ${formatDateToJST(parsedTime)}\n` +
              `現在時刻: ${formatDateToJST(new Date())}`,
            true // ephemeral
          );
          return;
        }

        startTime = parsedTime;
        timeMessage = ` (開始時刻: ${formatDateToJST(startTime)})`;
      } else {
        startTime = new Date();
      }

      // KVで重複チェック（高速）
      const existingRecord = await c.env.KINTAI_DISCORD_KV.get(kvKey);
      if (existingRecord) {
        // エラーの場合：元のレスポンスを削除し、EPHEMERALフォローアップメッセージを送信
        await discordApiService.deleteOriginalResponse(
          c.env.DISCORD_APPLICATION_ID,
          token
        );

        await discordApiService.createFollowupMessage(
          c.env.DISCORD_APPLICATION_ID,
          token,
          "❌ 既に勤務を開始しています\n\n先に `/end` コマンドで終了してください。",
          true // ephemeral
        );
        return;
      }

      // チャンネル名取得
      const channelName = await discordApiService.getChannelName(channelId);
      const displayChannelName =
        channelName || `チャンネル_${channelId.slice(-4)}`;

      // GASでスプレッドシート記録（タイムアウト延長済み）
      const commandService = new DiscordCommandService(
        c.env.GAS_WEB_APP_URL,
        c.env.ALLOWED_CHANNEL_IDS,
        c.env.DISCORD_TOKEN,
        c.env.KINTAI_DISCORD_KV,
        10000 // 10秒タイムアウト
      );

      const result = await commandService["gasService"].startWork(
        userId,
        username,
        channelId,
        displayChannelName,
        startTime.toISOString()
      );

      if (result.success) {
        // KVに状態保存
        const kvRecord = {
          startTime: startTime.toISOString(),
          uuid: crypto.randomUUID(),
          username,
          channelName: displayChannelName,
          projectName: displayChannelName,
        };

        await c.env.KINTAI_DISCORD_KV.put(
          kvKey,
          JSON.stringify(kvRecord),
          { expirationTtl: 86400 } // 24時間
        );

        await discordApiService.editDeferredResponse(
          c.env.DISCORD_APPLICATION_ID,
          token,
          `✅ 勤務を開始しました！${timeMessage}\n\n📍 **プロジェクト**: ${displayChannelName}\n⏰ **開始時刻**: ${startTime.toLocaleString(
            "ja-JP",
            { timeZone: "Asia/Tokyo" }
          )}`
        );
        return;
      } else {
        throw new Error(result.message || "GAS処理でエラーが発生しました");
      }
    } catch (error) {
      console.error(`Start command attempt ${attempt} failed:`, error);

      if (attempt === maxRetries) {
        const errorMessage =
          error instanceof Error ? error.message : "不明なエラー";

        // エラーの場合：元のレスポンスを削除し、EPHEMERALフォローアップメッセージを送信
        await discordApiService.deleteOriginalResponse(
          c.env.DISCORD_APPLICATION_ID,
          token
        );

        await discordApiService.createFollowupMessage(
          c.env.DISCORD_APPLICATION_ID,
          token,
          `❌ 勤務開始の処理に失敗しました\n\n**エラー詳細**: ${errorMessage}\n\nネットワークの状況を確認して、再度お試しください。\n問題が続く場合は管理者にお問い合わせください。`,
          true // ephemeral
        );
      } else {
        // 次の試行前に少し待機（指数バックオフ）
        await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
      }
    }
  }
}

/**
 * リトライ機能付きのendコマンド処理
 */
async function handleEndCommandWithRetry(
  c: any,
  interaction: DiscordInteraction,
  discordApiService: DiscordApiService,
  token: string,
  customTimeString?: string,
  maxRetries: number = 3
): Promise<void> {
  const userId = interaction.member?.user?.id || interaction.user?.id!;
  const channelId = interaction.channel_id!;
  const username =
    interaction.member?.user?.username ||
    interaction.user?.username ||
    "Unknown";
  const kvKey = `${userId}:${channelId}`;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`End command attempt ${attempt}/${maxRetries}`);

      // 時刻処理
      let endTime: Date;
      let timeMessage = "";

      if (customTimeString) {
        // カスタム時刻をパース
        const parsedTime = parseTimeStringToJST(customTimeString);

        if (!parsedTime) {
          await discordApiService.deleteOriginalResponse(
            c.env.DISCORD_APPLICATION_ID,
            token
          );

          await discordApiService.createFollowupMessage(
            c.env.DISCORD_APPLICATION_ID,
            token,
            "❌ 時刻形式が正しくありません。\n" +
              "**使用可能な形式:**\n" +
              "• `18:00` (HH:MM形式)\n" +
              "• `1800` (HHMM形式)\n" +
              "• `600` (HMM形式)",
            true // ephemeral
          );
          return;
        }

        endTime = parsedTime;
        timeMessage = ` (終了時刻: ${formatDateToJST(endTime)})`;
      } else {
        endTime = new Date();
      }

      // KVで存在チェック
      const existingRecordStr = await c.env.KINTAI_DISCORD_KV.get(kvKey);
      if (!existingRecordStr) {
        // エラーの場合：元のレスポンスを削除し、EPHEMERALフォローアップメッセージを送信
        await discordApiService.deleteOriginalResponse(
          c.env.DISCORD_APPLICATION_ID,
          token
        );

        await discordApiService.createFollowupMessage(
          c.env.DISCORD_APPLICATION_ID,
          token,
          "❌ まだ勤務を開始していません\n\n先に `/start` コマンドで開始してください。",
          true // ephemeral
        );
        return;
      }

      const existingRecord = JSON.parse(existingRecordStr);

      // 終了時刻が開始時刻より前でないかチェック
      const startTime = new Date(existingRecord.startTime);
      if (endTime.getTime() < startTime.getTime()) {
        await discordApiService.deleteOriginalResponse(
          c.env.DISCORD_APPLICATION_ID,
          token
        );

        await discordApiService.createFollowupMessage(
          c.env.DISCORD_APPLICATION_ID,
          token,
          "❌ 終了時刻が開始時刻より前になっています。\n" +
            `開始時刻: ${formatDateToJST(startTime)}\n` +
            `終了時刻: ${formatDateToJST(endTime)}\n` +
            "正しい終了時刻を指定してください。",
          true // ephemeral
        );
        return;
      }

      // GASでスプレッドシート更新（タイムアウト延長済み）
      const commandService = new DiscordCommandService(
        c.env.GAS_WEB_APP_URL,
        c.env.ALLOWED_CHANNEL_IDS,
        c.env.DISCORD_TOKEN,
        c.env.KINTAI_DISCORD_KV,
        10000 // 10秒タイムアウト
      );

      const result = await commandService["gasService"].endWork(
        userId,
        username,
        channelId,
        existingRecord.channelName,
        endTime.toISOString()
      );

      if (result.success) {
        // KVから削除
        await c.env.KINTAI_DISCORD_KV.delete(kvKey);

        // 労働時間計算
        const startTime = new Date(existingRecord.startTime);
        const duration = endTime.getTime() - startTime.getTime();
        const hours = Math.floor(duration / (1000 * 60 * 60));
        const minutes = Math.floor((duration % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((duration % (1000 * 60)) / 1000);

        const workDuration =
          result.workHours || `${hours}時間${minutes}分${seconds}秒`;

        await discordApiService.editDeferredResponse(
          c.env.DISCORD_APPLICATION_ID,
          token,
          `✅ 勤務を終了しました！お疲れ様でした！${timeMessage}\n\n📍 **プロジェクト**: ${existingRecord.projectName}\n⏰ **労働時間**: ${workDuration}`
        );
        return;
      } else {
        throw new Error(result.message || "GAS処理でエラーが発生しました");
      }
    } catch (error) {
      console.error(`End command attempt ${attempt} failed:`, error);

      if (attempt === maxRetries) {
        const errorMessage =
          error instanceof Error ? error.message : "不明なエラー";

        // エラーの場合：元のレスポンスを削除し、EPHEMERALフォローアップメッセージを送信
        await discordApiService.deleteOriginalResponse(
          c.env.DISCORD_APPLICATION_ID,
          token
        );

        await discordApiService.createFollowupMessage(
          c.env.DISCORD_APPLICATION_ID,
          token,
          `❌ 勤務終了の処理に失敗しました\n\n**エラー詳細**: ${errorMessage}\n\nネットワークの状況を確認して、再度お試しください。\n問題が続く場合は管理者にお問い合わせください。`,
          true // ephemeral
        );
      } else {
        // 次の試行前に少し待機（指数バックオフ）
        await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
      }
    }
  }
}

export default app;
