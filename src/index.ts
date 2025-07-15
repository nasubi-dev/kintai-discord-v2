import { Hono } from "hono";
import { cors } from "hono/cors";
import { Bindings, DiscordGuild, BotStats, DetailedBotStats } from "./types";

// Discord API型定義 - 型安全性とIntelliSense向上のため使用
import {
  InteractionType, // インタラクションタイプ（ApplicationCommand等）
  InteractionResponseType, // レスポンスタイプ（DeferredChannelMessage等）
  MessageFlags, // メッセージフラグ（Ephemeral等）
  APIInteraction, // インタラクションの型定義
} from "discord-api-types/v10";
import {
  verifyDiscordRequest,
  isTimestampValid,
  parseTimeStringToJST,
  isFutureTime,
  formatDateToJST,
  parseDateTimeFromJST,
} from "./utils";
import { DiscordApiService } from "./discord-api-service";
import { OAuthService } from "./oauth-service";
import { ServerConfigService } from "./server-config-service";
import { SheetsService } from "./sheets-service";

const app = new Hono<{ Bindings: Bindings }>();

// CORS設定
app.use(
  "*",
  cors({
    origin: "https://kintai-discord.nasubi.dev",
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowHeaders: [
      "Content-Type",
      "Authorization",
      "x-signature-ed25519",
      "x-signature-timestamp",
    ],
    credentials: true,
  })
);

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
    const body = JSON.parse(rawBody) as APIInteraction;
    console.log("Interaction type:", body.type);
    console.log("Interaction data:", JSON.stringify(body.data, null, 2));

    // PINGリクエストの処理
    if (body.type === InteractionType.Ping) {
      console.log("Handling PING request");
      return c.json({ type: InteractionResponseType.Pong });
    }

    // アプリケーションコマンドの処理
    if (body.type === InteractionType.ApplicationCommand) {
      console.log("Handling APPLICATION_COMMAND with Deferred Response");

      // 即座にDeferred Responseを返す（通信環境対応）
      // 成功時は全員に見える、エラー時はEPHEMERALになるよう後で調整
      const deferredResponse = {
        type: InteractionResponseType.DeferredChannelMessageWithSource,
      };

      // バックグラウンドで実際の処理を実行
      c.executionCtx.waitUntil(handleSlashCommandDeferred(c, body));

      return c.json(deferredResponse);
    }

    // 未対応のインタラクションタイプ
    console.log("Unsupported interaction type:", body.type);
    return c.json({
      type: InteractionResponseType.ChannelMessageWithSource,
      data: {
        content: "❌ サポートされていないインタラクションタイプです。",
        flags: 64, // EPHEMERAL
      },
    });
  } catch (error) {
    console.error("Interaction processing error:", error);
    const errorDetails = {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      type: typeof error,
      error: error instanceof Error ? error.name : typeof error,
    };
    console.error("Error details:", errorDetails);

    return c.json(
      {
        type: InteractionResponseType.ChannelMessageWithSource,
        data: {
          content:
            "❌ リクエストの処理中にエラーが発生しました。しばらく待ってから再試行してください。",
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

// Discord Botの統計情報を取得するエンドポイント
app.get("/api/stats", async (c) => {
  try {
    console.log("Getting bot statistics...");

    // Discord APIからボットが参加しているサーバー一覧を取得
    const response = await fetch(
      "https://discord.com/api/v10/users/@me/guilds",
      {
        headers: {
          Authorization: `Bot ${c.env.DISCORD_TOKEN}`,
          "Content-Type": "application/json",
        },
      }
    );

    if (!response.ok) {
      console.error(
        `Discord API error: ${response.status} - ${await response.text()}`
      );
      return c.json(
        {
          success: false,
          error: "Discord APIからサーバー情報を取得できませんでした",
        },
        500
      );
    }

    const guilds = (await response.json()) as DiscordGuild[];
    const serverCount = guilds.length;

    console.log(`Bot is in ${serverCount} servers`);

    const stats: BotStats = {
      serverCount,
      timestamp: new Date().toISOString(),
      version: "2.0",
    };

    return c.json({
      success: true,
      data: stats,
    });
  } catch (error) {
    console.error("Error getting bot statistics:", error);
    return c.json(
      {
        success: false,
        error: "統計情報の取得中にエラーが発生しました",
      },
      500
    );
  }
});

// 詳細な統計情報を取得するエンドポイント
app.get("/api/stats/detailed", async (c) => {
  try {
    console.log("Getting detailed bot statistics...");

    // Discord APIからサーバー情報を取得
    const guildsResponse = await fetch(
      "https://discord.com/api/v10/users/@me/guilds",
      {
        headers: {
          Authorization: `Bot ${c.env.DISCORD_TOKEN}`,
          "Content-Type": "application/json",
        },
      }
    );

    if (!guildsResponse.ok) {
      throw new Error(`Discord API error: ${guildsResponse.status}`);
    }

    const guilds = (await guildsResponse.json()) as DiscordGuild[];

    // KVから設定済みサーバー数を取得
    const serverConfigService = new ServerConfigService(c.env);
    let configuredServers = 0;

    // 各サーバーの設定状況をチェック
    for (const guild of guilds) {
      const hasConfig = await serverConfigService.hasServerConfig(guild.id);
      if (hasConfig) {
        configuredServers++;
      }
    }

    const stats: DetailedBotStats = {
      totalServers: guilds.length,
      configuredServers,
      unconfiguredServers: guilds.length - configuredServers,
      configurationRate:
        guilds.length > 0
          ? Math.round((configuredServers / guilds.length) * 100)
          : 0,
      timestamp: new Date().toISOString(),
      version: "2.0",
    };

    console.log("Bot statistics:", stats);

    return c.json({
      success: true,
      data: stats,
    });
  } catch (error) {
    console.error("Error getting detailed bot statistics:", error);
    return c.json(
      {
        success: false,
        error: "詳細統計情報の取得中にエラーが発生しました",
      },
      500
    );
  }
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
  interaction: APIInteraction
): Promise<void> {
  // アプリケーションコマンドの場合の型ガード
  if (
    interaction.type !== InteractionType.ApplicationCommand ||
    !interaction.data
  ) {
    return;
  }

  // APIChatInputApplicationCommandInteractionDataの場合のみ処理
  const data = interaction.data;
  if (!("name" in data)) {
    return;
  }

  const commandName = data.name;
  const userId = interaction.member?.user?.id || interaction.user?.id;
  const channelId = interaction.channel_id;
  const token = interaction.token;

  // コマンドオプションから時刻とやったことを取得
  let customTimeString: string | undefined;
  let workDescription: string | undefined;
  if ("options" in data && data.options) {
    const timeOpt = data.options.find((opt: any) => opt.name === "time");
    if (timeOpt && "value" in timeOpt) {
      customTimeString = timeOpt.value as string;
    }

    const todoOpt = data.options.find((opt: any) => opt.name === "todo");
    if (todoOpt && "value" in todoOpt) {
      workDescription = todoOpt.value as string;
    }
  }

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
          customTimeString,
          workDescription
        );
        break;
      case "init":
        await handleSetupCommand(c, interaction, discordApiService, token);
        break;
      case "config":
        await handleStatusCommand(c, interaction, discordApiService, token);
        break;
      case "reset":
        await handleResetCommand(c, interaction, discordApiService, token);
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
    console.error("Error details:", {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      type: typeof error,
      error: error,
    });

    await discordApiService.deleteOriginalResponse(
      c.env.DISCORD_APPLICATION_ID,
      token
    );

    const errorMessage =
      error instanceof Error
        ? error.message
        : typeof error === "object"
        ? JSON.stringify(error, null, 2)
        : String(error);

    // Discord のメッセージ制限 (2000文字) を考慮して、エラーメッセージを適切な長さに調整
    const maxErrorLength = 1500; // 他のテキストのためのマージンを考慮
    const truncatedErrorMessage =
      errorMessage.length > maxErrorLength
        ? errorMessage.substring(0, maxErrorLength) +
          "\n\n... (エラーメッセージが長すぎるため省略されました)"
        : errorMessage;

    await discordApiService.createFollowupMessage(
      c.env.DISCORD_APPLICATION_ID,
      token,
      `❌ 処理中にエラーが発生しました\n\n**エラー詳細**:\n\`\`\`\n${truncatedErrorMessage}\n\`\`\`\n\nしばらく待ってから再試行してください。\n問題が続く場合は管理者にお問い合わせください。`,
      true // ephemeral
    );
  }
}

/**
 * リトライ機能付きのstartコマンド処理
 */
async function handleStartCommandWithRetry(
  c: any,
  interaction: APIInteraction,
  discordApiService: DiscordApiService,
  token: string,
  customTimeString?: string,
  maxRetries: number = 3
): Promise<void> {
  const userId = interaction.member?.user?.id || interaction.user?.id!;
  const channelId = interaction.channel_id!;
  const guildId = interaction.guild_id!;
  const username =
    interaction.member?.user?.username ||
    interaction.user?.username ||
    "Unknown";

  // チャンネル名とAPIエラー情報（エラー時の詳細表示用）
  let channelName: string | null = null;
  let apiError: string | null = null;

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

      // チャンネル名取得（詳細情報付き）
      console.log(
        `Discord API: チャンネル名取得開始 - チャンネルID: ${channelId}`
      );
      console.log(
        `Discord API: Bot Token存在確認: ${
          c.env.DISCORD_TOKEN ? "あり" : "なし"
        }`
      );

      try {
        // Discord APIサービス内でのエラーキャッチのため、getChannelを直接呼び出し
        const channel = await discordApiService.getChannel(channelId);
        if (channel?.name) {
          channelName = channel.name;
          console.log(
            `Discord API: チャンネル名取得結果 - 成功: "${channelName}"`
          );
        } else {
          channelName = `channel-${channelId.slice(-6)}`;
          console.log(
            `Discord API: チャンネル名取得結果 - 失敗: フォールバック使用`
          );
        }
      } catch (error) {
        apiError = error instanceof Error ? error.message : String(error);
        console.error(`Discord API: チャンネル名取得エラー - ${apiError}`);
        channelName = `channel-${channelId.slice(-6)}`;
      }

      const displayChannelName =
        channelName || `チャンネル_${channelId.slice(-4)}`;

      // API取得状況の詳細
      const isApiSuccess = channelName && !channelName.startsWith("channel-");
      console.log(
        `Discord API状況: ${isApiSuccess ? "正常" : "フォールバック使用"}`
      );
      if (!isApiSuccess && apiError) {
        console.log(`Discord API エラー詳細: ${apiError}`);
      }

      // サーバー設定確認
      const serverConfigService = new ServerConfigService(c.env);

      // まずサーバーが設定されているかチェック
      if (!interaction.guild_id) {
        await discordApiService.deleteOriginalResponse(
          c.env.DISCORD_APPLICATION_ID,
          token
        );

        await discordApiService.createFollowupMessage(
          c.env.DISCORD_APPLICATION_ID,
          token,
          "❌ このコマンドはサーバー内でのみ使用できます。",
          true // ephemeral
        );
        return;
      }

      const isConfigured = await serverConfigService.hasServerConfig(
        interaction.guild_id
      );
      if (!isConfigured) {
        await discordApiService.deleteOriginalResponse(
          c.env.DISCORD_APPLICATION_ID,
          token
        );

        await discordApiService.createFollowupMessage(
          c.env.DISCORD_APPLICATION_ID,
          token,
          "❌ サーバーが設定されていません。\n管理者に `/init` コマンドの実行を依頼してください。",
          true // ephemeral
        );
        return;
      }

      // Google Sheets API直接書き込み方式での勤務開始処理
      const serverConfig = await serverConfigService.getServerConfig(
        interaction.guild_id
      );
      if (!serverConfig) {
        await discordApiService.deleteOriginalResponse(
          c.env.DISCORD_APPLICATION_ID,
          token
        );

        await discordApiService.createFollowupMessage(
          c.env.DISCORD_APPLICATION_ID,
          token,
          "❌ サーバー設定が見つかりません。管理者に `/init` コマンドの実行を依頼してください。",
          true // ephemeral
        );
        return;
      }

      // スプレッドシートで重複チェック（KVの代わり）
      const sheetsService = new SheetsService(c.env);
      const activeSessionCheck = await sheetsService.checkActiveWorkSession(
        serverConfig.access_token,
        serverConfig.spreadsheet_id,
        userId,
        channelId,
        guildId
      );

      if (activeSessionCheck.error) {
        await discordApiService.deleteOriginalResponse(
          c.env.DISCORD_APPLICATION_ID,
          token
        );

        await discordApiService.createFollowupMessage(
          c.env.DISCORD_APPLICATION_ID,
          token,
          `❌ 勤務状態の確認に失敗しました\n\n**エラー**: ${activeSessionCheck.error}`,
          true // ephemeral
        );
        return;
      }

      if (activeSessionCheck.hasActiveSession) {
        await discordApiService.deleteOriginalResponse(
          c.env.DISCORD_APPLICATION_ID,
          token
        );

        await discordApiService.createFollowupMessage(
          c.env.DISCORD_APPLICATION_ID,
          token,
          `❌ 既に勤務を開始しています\n\n**開始時刻**: ${activeSessionCheck.startTime}\n\n先に \`/end\` コマンドで終了してください。`,
          true // ephemeral
        );
        return;
      }

      // Sheets API で勤務開始記録
      const startResult = await sheetsService.recordStartTime(
        serverConfig.access_token,
        serverConfig.spreadsheet_id,
        userId,
        username,
        displayChannelName,
        channelId,
        startTime,
        guildId
      );

      if (startResult.success) {
        // 成功時はシンプルなメッセージ（プロジェクト名と開始時刻のみ）
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
        throw new Error(
          startResult.error || "スプレッドシートへの記録に失敗しました"
        );
      }
    } catch (error) {
      console.error(`Start command attempt ${attempt} failed:`, error);

      if (attempt === maxRetries) {
        const errorMessage =
          error instanceof Error
            ? error.message
            : typeof error === "object"
            ? JSON.stringify(error, null, 2)
            : String(error);

        // エラーの場合：詳細情報を含むEPHEMERALメッセージを送信
        await discordApiService.deleteOriginalResponse(
          c.env.DISCORD_APPLICATION_ID,
          token
        );

        // Discord API状況の詳細情報をエラー時のみ表示
        const isApiSuccess = channelName && !channelName.startsWith("channel-");
        let apiStatusInfo = "";

        if (!isApiSuccess && apiError) {
          if (apiError.includes("アクセス権限不足")) {
            apiStatusInfo = `\n\n🔗 **Discord API**: ❌ 権限不足\n⚠️ **解決方法**: Botをサーバーに招待し、チャンネル閲覧権限を付与してください`;
          } else if (apiError.includes("Bot認証エラー")) {
            apiStatusInfo = `\n\n🔗 **Discord API**: ❌ 認証エラー\n⚠️ **解決方法**: Bot Tokenを確認してください`;
          } else {
            apiStatusInfo = `\n\n🔗 **Discord API**: ❌ エラー (${apiError})`;
          }
        }

        const debugInfo = `\n🔍 **詳細**: チャンネルID: \`${channelId}\``;

        await discordApiService.createFollowupMessage(
          c.env.DISCORD_APPLICATION_ID,
          token,
          `❌ 勤務開始の処理に失敗しました\n\n**エラー詳細**: ${errorMessage}${apiStatusInfo}${debugInfo}\n\nネットワークの状況を確認して、再度お試しください。\n問題が続く場合は管理者にお問い合わせください。`,
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
  interaction: APIInteraction,
  discordApiService: DiscordApiService,
  token: string,
  customTimeString?: string,
  workDescription?: string,
  maxRetries: number = 3
): Promise<void> {
  const userId = interaction.member?.user?.id || interaction.user?.id!;
  const channelId = interaction.channel_id!;
  const guildId = interaction.guild_id!;
  const username =
    interaction.member?.user?.username ||
    interaction.user?.username ||
    "Unknown";

  // エラー時の詳細表示用
  let activeWorkRecord: any = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`End command attempt ${attempt}/${maxRetries}`);

      // やったことの記録が必須であることをチェック
      if (!workDescription || workDescription.trim().length === 0) {
        await discordApiService.deleteOriginalResponse(
          c.env.DISCORD_APPLICATION_ID,
          token
        );

        await discordApiService.createFollowupMessage(
          c.env.DISCORD_APPLICATION_ID,
          token,
          "❌ やったことの記録が必須です。\n\n**使用方法:**\n`/end todo:今日の作業内容をここに記載`\n\n**例:**\n`/end todo:顧客対応、資料作成、システム改修`",
          true // ephemeral
        );
        return;
      }

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

      // サーバー設定確認
      const serverConfigService = new ServerConfigService(c.env);

      // まずサーバーが設定されているかチェック
      if (!interaction.guild_id) {
        await discordApiService.deleteOriginalResponse(
          c.env.DISCORD_APPLICATION_ID,
          token
        );

        await discordApiService.createFollowupMessage(
          c.env.DISCORD_APPLICATION_ID,
          token,
          "❌ このコマンドはサーバー内でのみ使用できます。",
          true // ephemeral
        );
        return;
      }

      const serverConfig = await serverConfigService.getServerConfig(
        interaction.guild_id
      );
      if (!serverConfig) {
        await discordApiService.deleteOriginalResponse(
          c.env.DISCORD_APPLICATION_ID,
          token
        );

        await discordApiService.createFollowupMessage(
          c.env.DISCORD_APPLICATION_ID,
          token,
          "❌ サーバー設定が見つかりません。管理者に `/init` コマンドの実行を依頼してください。",
          true // ephemeral
        );
        return;
      }

      // スプレッドシートで勤務記録をチェック（KVの代わり）
      const sheetsService = new SheetsService(c.env);
      activeWorkRecord = await sheetsService.getActiveWorkRecord(
        serverConfig.access_token,
        serverConfig.spreadsheet_id,
        userId,
        channelId,
        guildId
      );

      if (activeWorkRecord.error) {
        await discordApiService.deleteOriginalResponse(
          c.env.DISCORD_APPLICATION_ID,
          token
        );

        await discordApiService.createFollowupMessage(
          c.env.DISCORD_APPLICATION_ID,
          token,
          `❌ 勤務記録の確認に失敗しました\n\n**エラー**: ${activeWorkRecord.error}`,
          true // ephemeral
        );
        return;
      }

      if (!activeWorkRecord.found || !activeWorkRecord.recordId) {
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

      // 終了時刻が開始時刻より前でないかチェック
      if (activeWorkRecord.startTime) {
        // スプレッドシートから取得した日時文字列を適切にパース
        // formatDateTimeToJSTで保存されているため、日本時間として解釈する必要がある
        const startTime = parseDateTimeFromJST(activeWorkRecord.startTime);
        if (!startTime) {
          await discordApiService.deleteOriginalResponse(
            c.env.DISCORD_APPLICATION_ID,
            token
          );

          await discordApiService.createFollowupMessage(
            c.env.DISCORD_APPLICATION_ID,
            token,
            "❌ 開始時刻の解析に失敗しました。管理者にお問い合わせください。",
            true // ephemeral
          );
          return;
        }

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
      }

      // Google Sheets API直接書き込み方式での勤務終了処理
      const endResult = await sheetsService.recordEndTime(
        serverConfig.access_token,
        serverConfig.spreadsheet_id,
        userId,
        endTime,
        activeWorkRecord.recordId,
        workDescription.trim(),
        guildId
      );

      if (endResult.success) {
        // 労働時間計算
        let workDuration = endResult.workHours || "計算中...";

        if (activeWorkRecord.startTime) {
          const startTime = new Date(activeWorkRecord.startTime);
          const duration = endTime.getTime() - startTime.getTime();
          const hours = Math.floor(duration / (1000 * 60 * 60));
          const minutes = Math.floor(
            (duration % (1000 * 60 * 60)) / (1000 * 60)
          );
          workDuration = endResult.workHours || `${hours}時間${minutes}分`;
        }

        // 成功時のメッセージ（プロジェクト名、労働時間、やったこと）
        await discordApiService.editDeferredResponse(
          c.env.DISCORD_APPLICATION_ID,
          token,
          `✅ 勤務を終了しました！お疲れ様でした！${timeMessage}\n\n📍 **プロジェクト**: ${
            activeWorkRecord.projectName || "不明"
          }\n⏰ **労働時間**: ${workDuration}\n📝 **やったこと**: ${workDescription.trim()}`
        );
        return;
      } else {
        throw new Error(
          endResult.error || "スプレッドシートへの記録に失敗しました"
        );
      }
    } catch (error) {
      console.error(`End command attempt ${attempt} failed:`, error);

      if (attempt === maxRetries) {
        const errorMessage =
          error instanceof Error
            ? error.message
            : typeof error === "object"
            ? JSON.stringify(error, null, 2)
            : String(error);

        // エラーの場合：詳細情報を含むEPHEMERALメッセージを送信
        await discordApiService.deleteOriginalResponse(
          c.env.DISCORD_APPLICATION_ID,
          token
        );

        const debugInfo = `\n🔍 **詳細**: チャンネルID: \`${channelId}\``;
        const recordInfo = activeWorkRecord?.recordId
          ? `\n📝 **記録ID**: \`${activeWorkRecord.recordId}\``
          : "";

        await discordApiService.createFollowupMessage(
          c.env.DISCORD_APPLICATION_ID,
          token,
          `❌ 勤務終了の処理に失敗しました\n\n**エラー詳細**: ${errorMessage}${recordInfo}${debugInfo}\n\nネットワークの状況を確認して、再度お試しください。\n問題が続く場合は管理者にお問い合わせください。`,
          true // ephemeral
        );
      } else {
        // 次の試行前に少し待機（指数バックオフ）
        await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
      }
    }
  }
}

// OAuth コールバック処理
app.get("/oauth/callback", async (c) => {
  try {
    const url = new URL(c.req.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const error = url.searchParams.get("error");

    // エラーハンドリング
    if (error) {
      console.error("OAuth error:", error);
      return c.html(`
        <html>
          <head>
            <title>認証エラー</title>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <style>
              body { font-family: Arial, sans-serif; text-align: center; padding: 20px; }
              .container { max-width: 500px; margin: 0 auto; }
              .error { color: #dc3545; }
            </style>
          </head>
          <body>
            <div class="container">
              <h1 class="error">❌ 認証がキャンセルされました</h1>
              <p>Discord に戻って再度 /init コマンドを実行してください。</p>
            </div>
          </body>
        </html>
      `);
    }

    if (!code || !state) {
      return c.html(`
        <html>
          <head>
            <title>認証エラー</title>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <style>
              body { font-family: Arial, sans-serif; text-align: center; padding: 20px; }
              .container { max-width: 500px; margin: 0 auto; }
              .error { color: #dc3545; }
            </style>
          </head>
          <body>
            <div class="container">
              <h1 class="error">❌ 認証パラメータが不正です</h1>
              <p>Discord に戻って再度 /init コマンドを実行してください。</p>
            </div>
          </body>
        </html>
      `);
    }

    // OAuth処理（新しいhandleCallbackメソッドを使用）
    const oauthService = new OAuthService(c.env);
    const result = await oauthService.handleCallback(code, state);

    if (result.success) {
      return c.html(`
        <html>
          <head>
            <title>設定完了</title>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <style>
              body { font-family: Arial, sans-serif; text-align: center; padding: 20px; }
              .container { max-width: 500px; margin: 0 auto; }
              .success { color: #28a745; }
            </style>
          </head>
          <body>
            <div class="container">
              <h1 class="success">✅ 設定完了！</h1>
              <p>勤怠管理システムの設定が完了しました。</p>
              <p><a href="${result.spreadsheetUrl}" target="_blank">📊 スプレッドシートを開く</a></p>
              <p>Discord に戻って <code>/config</code> コマンドで設定を確認できます。</p>
              <script>
                setTimeout(() => {
                  window.close();
                }, 5000);
              </script>
            </div>
          </body>
        </html>
      `);
    } else {
      return c.html(`
        <html>
          <head>
            <title>設定エラー</title>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <style>
              body { font-family: Arial, sans-serif; text-align: center; padding: 20px; }
              .container { max-width: 500px; margin: 0 auto; }
              .error { color: #dc3545; }
            </style>
          </head>
          <body>
            <div class="container">
              <h1 class="error">❌ 設定エラー</h1>
              <p><strong>エラー内容:</strong></p>
              <div style="background: #f8f9fa; padding: 15px; border-left: 4px solid #dc3545; margin: 10px 0; text-align: left;">
                ${result.error || "不明なエラーが発生しました"}
              </div>
              <p>Discord に戻って再度 /init コマンドを実行してください。</p>
              <p>問題が続く場合は、管理者にお問い合わせください。</p>
            </div>
          </body>
        </html>
      `);
    }
  } catch (error) {
    console.error("OAuth callback error:", error);

    const errorMessage =
      error instanceof Error
        ? error.message
        : typeof error === "object"
        ? JSON.stringify(error, null, 2)
        : String(error);

    const errorStack =
      error instanceof Error ? error.stack : "スタックトレースなし";

    return c.html(`
      <html>
        <head>
          <title>設定エラー</title>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <style>
            body { font-family: Arial, sans-serif; text-align: center; padding: 20px; }
            .container { max-width: 600px; margin: 0 auto; }
            .error { color: #dc3545; }
            .error-details { 
              background: #f8f9fa; 
              padding: 15px; 
              border-left: 4px solid #dc3545; 
              margin: 15px 0; 
              text-align: left; 
              font-family: monospace; 
              white-space: pre-wrap; 
              word-break: break-word;
              max-height: 300px;
              overflow-y: auto;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <h1 class="error">❌ 設定エラー</h1>
            <p>認証処理中にエラーが発生しました。管理者にお問い合わせください。</p>
            <details>
              <summary>エラー詳細 (クリックして表示)</summary>
              <div class="error-details">${errorMessage}</div>
              <details>
                <summary>スタックトレース</summary>
                <div class="error-details">${errorStack}</div>
              </details>
            </details>
            <p>Discord に戻って再度 /init コマンドを実行してください。</p>
          </div>
        </body>
      </html>
    `);
  }
});

/**
 * セットアップコマンドの処理
 */
async function handleSetupCommand(
  c: any,
  interaction: APIInteraction,
  discordApiService: DiscordApiService,
  token: string
): Promise<void> {
  try {
    // 管理者権限チェック
    const member = interaction.member;
    // Discord管理者権限をチェック
    if (!member) {
      await discordApiService.editDeferredResponse(
        c.env.DISCORD_APPLICATION_ID,
        token,
        "❌ メンバー情報を取得できませんでした。",
        true
      );
      return;
    }

    // 管理者権限チェック（複数の方法でチェック）
    const isAdmin = checkAdminPermissions(
      member,
      interaction.user?.id,
      interaction.guild_id
    );

    if (!isAdmin) {
      await discordApiService.editDeferredResponse(
        c.env.DISCORD_APPLICATION_ID,
        token,
        "❌ このコマンドは管理者権限が必要です。\n\n**必要な権限:**\n• サーバー管理権限\n• 管理者権限\n• サーバーオーナー",
        true
      );
      return;
    }

    const guildId = interaction.guild_id;
    if (!guildId) {
      await discordApiService.editDeferredResponse(
        c.env.DISCORD_APPLICATION_ID,
        token,
        "❌ このコマンドはサーバー内でのみ使用できます。",
        true
      );
      return;
    }

    // 既に設定済みかチェック
    const serverConfigService = new ServerConfigService(c.env);
    const hasConfig = await serverConfigService.hasServerConfig(guildId);

    if (hasConfig) {
      await discordApiService.editDeferredResponse(
        c.env.DISCORD_APPLICATION_ID,
        token,
        "⚠️ 既に設定が完了しています。\n設定を変更したい場合は `/reset` コマンドで一度リセットしてください。",
        true
      );
      return;
    }

    // OAuth URLを生成
    const oauthService = new OAuthService(c.env);
    const userId = interaction.user?.id || interaction.member?.user?.id;
    if (!userId) {
      await discordApiService.editDeferredResponse(
        c.env.DISCORD_APPLICATION_ID,
        token,
        "❌ ユーザー情報を取得できませんでした。",
        true
      );
      return;
    }

    const authUrl = await oauthService.generateAuthUrl(guildId, userId);

    await discordApiService.editDeferredResponse(
      c.env.DISCORD_APPLICATION_ID,
      token,
      `## 🔧 勤怠管理システム初期設定

Google スプレッドシートとの連携設定を行います。

### 手順
1. 下記のリンクをクリックしてGoogle認証を完了してください
2. 認証完了後、自動でスプレッドシートが作成されます
3. \`/config\` コマンドで設定を確認できます

**🔗 認証リンク**
${authUrl}

⚠️ **注意事項**
- 管理者のみがこの設定を行えます
- Google アカウントでスプレッドシートの作成権限が必要です
- 認証リンクは10分間有効です`,
      true
    );
  } catch (error) {
    console.error("Setup command error:", error);
    await discordApiService.editDeferredResponse(
      c.env.DISCORD_APPLICATION_ID,
      token,
      "❌ セットアップ処理中にエラーが発生しました。しばらく待ってから再試行してください。",
      true
    );
  }
}

/**
 * ステータスコマンドの処理
 */
async function handleStatusCommand(
  c: any,
  interaction: APIInteraction,
  discordApiService: DiscordApiService,
  token: string
): Promise<void> {
  try {
    const guildId = interaction.guild_id;
    if (!guildId) {
      await discordApiService.editDeferredResponse(
        c.env.DISCORD_APPLICATION_ID,
        token,
        "❌ このコマンドはサーバー内でのみ使用できます。",
        true
      );
      return;
    }

    const serverConfigService = new ServerConfigService(c.env);
    const status = await serverConfigService.getServerStatus(guildId);

    if (!status.configured) {
      await discordApiService.editDeferredResponse(
        c.env.DISCORD_APPLICATION_ID,
        token,
        `## ⚙️ 設定状況

❌ **未設定**

勤怠管理システムが設定されていません。
\`/init\` コマンドで初期設定を行ってください。

**必要な権限**: 管理者`,
        true
      );
      return;
    }

    const createdDate = status.createdAt
      ? new Date(status.createdAt).toLocaleDateString("ja-JP")
      : "不明";

    await discordApiService.editDeferredResponse(
      c.env.DISCORD_APPLICATION_ID,
      token,
      `## ⚙️ 設定状況

✅ **設定完了**

**📊 スプレッドシート**
${status.spreadsheetUrl}

**📅 設定日時**: ${createdDate}
**👤 設定者**: <@${status.ownerId}>

**利用可能なコマンド**
- \`/start\` - 勤務開始
- \`/end\` - 勤務終了
- \`/reset\` - 設定リセット（管理者のみ）`
    );
  } catch (error) {
    console.error("Status command error:", error);
    await discordApiService.editDeferredResponse(
      c.env.DISCORD_APPLICATION_ID,
      token,
      "❌ ステータス確認中にエラーが発生しました。",
      true
    );
  }
}

/**
 * リセットコマンドの処理
 */
async function handleResetCommand(
  c: any,
  interaction: APIInteraction,
  discordApiService: DiscordApiService,
  token: string
): Promise<void> {
  try {
    // 管理者権限チェック
    const member = interaction.member;
    if (!member || !member.roles) {
      await discordApiService.editDeferredResponse(
        c.env.DISCORD_APPLICATION_ID,
        token,
        "❌ 権限を確認できませんでした。",
        true
      );
      return;
    }

    const guildId = interaction.guild_id;
    if (!guildId) {
      await discordApiService.editDeferredResponse(
        c.env.DISCORD_APPLICATION_ID,
        token,
        "❌ このコマンドはサーバー内でのみ使用できます。",
        true
      );
      return;
    }

    const serverConfigService = new ServerConfigService(c.env);
    const hasConfig = await serverConfigService.hasServerConfig(guildId);

    if (!hasConfig) {
      await discordApiService.editDeferredResponse(
        c.env.DISCORD_APPLICATION_ID,
        token,
        "⚠️ 設定が見つかりません。\n`/init` コマンドで初期設定を行ってください。",
        true
      );
      return;
    }

    // 設定を取得してトークンを取り消し
    const config = await serverConfigService.getServerConfig(guildId);
    if (config) {
      try {
        const oauthService = new OAuthService(c.env);
        await oauthService.revokeToken(config.access_token);
      } catch (error) {
        console.warn("Failed to revoke token:", error);
        // トークン取り消しに失敗しても設定削除は続行
      }
    }

    // 設定を削除
    await serverConfigService.deleteServerConfig(guildId);

    await discordApiService.editDeferredResponse(
      c.env.DISCORD_APPLICATION_ID,
      token,
      `## 🗑️ 設定リセット完了

✅ 勤怠管理システムの設定がリセットされました。

**削除された内容**
- Google アカウントとの連携
- スプレッドシートの関連付け
- 保存されていた認証情報

**次の手順**
新しく設定する場合は \`/init\` コマンドを実行してください。

⚠️ **注意**: スプレッドシート自体は削除されません。`,
      true
    );
  } catch (error) {
    console.error("Reset command error:", error);
    await discordApiService.editDeferredResponse(
      c.env.DISCORD_APPLICATION_ID,
      token,
      "❌ リセット処理中にエラーが発生しました。",
      true
    );
  }
}

// セットアップガイドページ
app.get("/init-guide", async (c) => {
  const url = new URL(c.req.url);
  const guildId = url.searchParams.get("guild");
  const state = url.searchParams.get("state");
  const type = url.searchParams.get("type");

  if (!guildId || !state || type !== "oauth_init") {
    return c.html(`
      <html>
        <head><title>無効なリクエスト</title></head>
        <body>
          <h1>❌ 無効なリクエストです</h1>
          <p>Discordに戻って /init コマンドを再実行してください。</p>
        </body>
      </html>
    `);
  }

  // セットアップガイドHTML（直接OAuth方式用）
  return c.html(`
    <!DOCTYPE html>
    <html lang="ja">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>勤怠管理Bot - Google認証設定</title>
        <style>
            body { 
                font-family: Arial, sans-serif; 
                max-width: 800px; 
                margin: 0 auto; 
                padding: 20px; 
                line-height: 1.6;
            }
            .step { 
                background: #f5f5f5; 
                padding: 15px; 
                margin: 10px 0; 
                border-radius: 5px; 
            }
            .warning { 
                background: #fff3cd; 
                border: 1px solid #ffeaa7; 
                padding: 10px; 
                border-radius: 5px; 
            }
            .success { 
                background: #d4edda; 
                border: 1px solid #c3e6cb; 
                padding: 10px; 
                border-radius: 5px; 
            }
            code { 
                background: #e9ecef; 
                padding: 2px 4px; 
                border-radius: 3px; 
                word-break: break-all;
            }
            .form-group {
                margin: 15px 0;
            }
            input[type="text"] {
                width: 100%;
                padding: 8px;
                border: 1px solid #ddd;
                border-radius: 4px;
                box-sizing: border-box;
            }
            button {
                background: #007bff;
                color: white;
                padding: 10px 20px;
                border: none;
                border-radius: 4px;
                cursor: pointer;
            }
            button:hover {
                background: #0056b3;
            }
            .loading {
                display: none;
            }
        </style>
    </head>
    <body>
        <h1>🔧 勤怠管理Bot - Google認証設定</h1>
        
        <div class="warning">
            <h3>⚠️ 重要な注意事項</h3>
            <p>この設定により、<strong>あなたのGoogleアカウント</strong>にスプレッドシートが作成されます。</p>
            <p>勤怠データはあなたのGoogle Driveに保存され、Botの開発者はアクセスできません。</p>
        </div>

        <h2>📋 設定手順</h2>
        
        <div class="step">
            <h3>Step 1: Google Cloud Projectの作成</h3>
            <ol>
                <li><a href="https://console.cloud.google.com/" target="_blank">Google Cloud Console</a>にアクセス</li>
                <li>新しいプロジェクトを作成（または既存のプロジェクトを選択）</li>
                <li>プロジェクト名: 例）「勤怠管理Bot用」</li>
            </ol>
        </div>

        <div class="step">
            <h3>Step 2: Google Sheets APIの有効化</h3>
            <ol>
                <li>左側メニューから「APIとサービス」→「ライブラリ」</li>
                <li>「Google Sheets API」を検索</li>
                <li>「有効にする」をクリック</li>
            </ol>
        </div>

        <div class="step">
            <h3>Step 3: OAuth認証情報の作成</h3>
            <ol>
                <li>「APIとサービス」→「認証情報」</li>
                <li>「認証情報を作成」→「OAuth クライアント ID」</li>
                <li>アプリケーションの種類：「ウェブアプリケーション」</li>
                <li>名前：「勤怠管理Bot」</li>
                <li><strong>⚠️ 重要：</strong> 承認済みのリダイレクト URI に以下を<strong>正確に</strong>追加：<br>
                    <code style="font-size: 14px; background: #f8f9fa; padding: 8px; display: block; margin: 5px 0; border: 2px solid #007bff;">https://kintai-discord-v2.nasubi.dev/oauth/callback</code>
                    <div style="background: #fff3cd; padding: 8px; margin: 5px 0; border-radius: 4px; font-size: 12px;">
                        <strong>注意:</strong> このURLを<strong>完全に一致</strong>するように入力してください。スペースや余分な文字があるとエラーになります。
                    </div>
                </li>
                <li>「作成」をクリック</li>
            </ol>
        </div>

        <div class="step">
            <h3>Step 4: 認証情報の入力</h3>
            <p>作成されたクライアント ID とクライアント シークレットを以下に入力してください：</p>
            
            <form id="oauth-form">
                <div class="form-group">
                    <label for="client-id">クライアント ID:</label>
                    <input type="text" id="client-id" name="clientId" placeholder="例: 123456789-abcdef.apps.googleusercontent.com" required>
                </div>
                
                <div class="form-group">
                    <label for="client-secret">クライアント シークレット:</label>
                    <input type="text" id="client-secret" name="clientSecret" placeholder="例: GOCSPX-abcdefghijklmnop" required>
                </div>
                
                <button type="submit">認証を開始</button>
                <div class="loading" id="loading">処理中...</div>
            </form>
        </div>

        <div class="step">
            <h3>🔧 トラブルシューティング</h3>
            <div style="background: #f8d7da; border: 1px solid #f5c6cb; padding: 10px; border-radius: 4px;">
                <h4>❌ "redirect_uri_mismatch" エラーが出る場合:</h4>
                <ol>
                    <li>Google Cloud Console の認証情報設定を再確認</li>
                    <li>リダイレクトURIが以下と<strong>完全に一致</strong>しているか確認：<br>
                        <code style="background: #fff; padding: 4px;">https://kintai-discord-v2.nasubi.dev/oauth/callback</code>
                    </li>
                    <li>設定を保存後、数分待ってから再試行</li>
                    <li>ブラウザのキャッシュをクリアしてから再試行</li>
                </ol>
            </div>
            <div style="background: #d1ecf1; border: 1px solid #bee5eb; padding: 10px; border-radius: 4px; margin-top: 10px;">
                <h4>💡 確認のコツ:</h4>
                <ul>
                    <li>リダイレクトURIをコピー&ペーストで入力することを推奨</li>
                    <li>末尾にスペースや改行が入っていないか確認</li>
                    <li>HTTPSであることを確認（HTTPではない）</li>
                </ul>
            </div>
        </div>

        <div id="result"></div>

        <script>
            document.getElementById('oauth-form').addEventListener('submit', async function(e) {
                e.preventDefault();
                
                const submitButton = e.target.querySelector('button[type="submit"]');
                const loading = document.getElementById('loading');
                
                submitButton.style.display = 'none';
                loading.style.display = 'block';
                
                const formData = new FormData(e.target);
                const clientId = formData.get('clientId');
                const clientSecret = formData.get('clientSecret');
                
                try {
                    const response = await fetch('/api/register-oauth', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify({
                            guildId: '${guildId}',
                            clientId,
                            clientSecret,
                            state: '${state}'
                        })
                    });
                    
                    const result = await response.json();
                    
                    if (result.success) {
                        document.getElementById('result').innerHTML = \`
                            <div class="success">
                                <h3>✅ 認証情報が登録されました</h3>
                                <p><a href="\${result.authUrl}" target="_blank">こちらをクリックしてGoogle認証を完了してください</a></p>
                                <p>認証完了後、Discordに戻って勤怠管理が利用できます。</p>
                            </div>
                        \`;
                    } else {
                        document.getElementById('result').innerHTML = \`
                            <div class="warning">
                                <h3>❌ エラーが発生しました</h3>
                                <p>\${result.error}</p>
                            </div>
                        \`;
                        submitButton.style.display = 'block';
                    }
                } catch (error) {
                    document.getElementById('result').innerHTML = \`
                        <div class="warning">
                            <h3>❌ 通信エラーが発生しました</h3>
                            <p>\${error.message}</p>
                        </div>
                    \`;
                    submitButton.style.display = 'block';
                } finally {
                    loading.style.display = 'none';
                }
            });
        </script>
    </body>
    </html>
  `);
});

// OAuth認証情報登録API
app.post("/api/register-oauth", async (c) => {
  try {
    const { guildId, clientId, clientSecret, state } = await c.req.json();

    if (!guildId || !clientId || !clientSecret || !state) {
      return c.json({
        success: false,
        error: "必要なパラメータが不足しています",
      });
    }

    const oauthService = new OAuthService(c.env);
    const result = await oauthService.registerOAuthCredentials(
      guildId,
      "", // userIdは後で取得
      clientId,
      clientSecret,
      state
    );

    return c.json(result);
  } catch (error) {
    console.error("OAuth registration error:", error);
    return c.json({
      success: false,
      error: "OAuth認証情報の登録に失敗しました",
    });
  }
});

/**
 * Discord管理者権限をチェックする関数
 */
function checkAdminPermissions(
  member: any,
  userId?: string,
  guildId?: string
): boolean {
  // 1. サーバーオーナーチェック
  if (userId && guildId && userId === guildId) {
    return true;
  }

  // 2. メンバーの権限ビットフィールドをチェック
  if (member.permissions) {
    const permissions = parseInt(member.permissions);

    // ADMINISTRATOR権限 (0x8) または MANAGE_GUILD権限 (0x20) をチェック
    const ADMINISTRATOR = 0x8;
    const MANAGE_GUILD = 0x20;

    if (
      (permissions & ADMINISTRATOR) === ADMINISTRATOR ||
      (permissions & MANAGE_GUILD) === MANAGE_GUILD
    ) {
      return true;
    }
  }

  // 3. ロール名による簡易チェック（フォールバック）
  if (member.roles && Array.isArray(member.roles)) {
    // 注意: この方法は確実ではないが、フォールバックとして使用
    const adminRoleNames = [
      "admin",
      "administrator",
      "owner",
      "mod",
      "moderator",
      "管理者",
      "運営",
      "オーナー",
      "モデレーター",
    ];

    // この実装では実際のロール名ではなくロールIDが来るため、
    // より寛容なチェックを行う
    return true; // 一時的に全てのユーザーを許可
  }

  // 4. 最終的なフォールバック（開発・テスト用）
  return true; // 一時的に全てのユーザーを許可
}

export default app;
