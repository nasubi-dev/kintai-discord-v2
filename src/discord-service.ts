import {
  DiscordInteraction,
  InteractionResponse,
  InteractionResponseType,
  InteractionResponseData,
  Bindings,
  KVAttendanceRecord,
} from "./types";
import { GASService } from "./gas-service";
import { DiscordApiService } from "./discord-api-service";
import { isChannelAllowed } from "./utils";

/**
 * Discord コマンドの処理を行うサービスクラス
 */
export class DiscordCommandService {
  private gasService: GASService;
  private discordApiService: DiscordApiService;
  private allowedChannels: string[];
  private kv: KVNamespace;

  constructor(
    gasUrl: string,
    allowedChannelIds: string,
    discordToken: string,
    kv: KVNamespace,
    gasTimeout: number = 10000 // デフォルト10秒
  ) {
    console.log("DiscordCommandService constructor - GAS URL:", gasUrl);
    console.log(
      "DiscordCommandService constructor - Allowed Channels:",
      allowedChannelIds
    );
    this.gasService = new GASService(gasUrl, gasTimeout); // タイムアウト設定を追加
    this.discordApiService = new DiscordApiService(discordToken);
    this.allowedChannels = allowedChannelIds.split(",").map((id) => id.trim());
    this.kv = kv;
  }

  /**
   * Discord インタラクションを処理
   * @param interaction Discord インタラクション
   * @returns インタラクション レスポンス
   */
  async handleInteraction(
    interaction: DiscordInteraction
  ): Promise<InteractionResponse> {
    console.log("handleInteraction called");
    console.log("Channel ID:", interaction.channel_id);
    console.log(
      "User ID:",
      interaction.member?.user?.id || interaction.user?.id
    );

    // チャンネル制限チェック（"*" の場合はスキップ）
    if (
      interaction.channel_id &&
      !isChannelAllowed(interaction.channel_id, this.allowedChannels)
    ) {
      console.log("Channel not allowed");
      return this.createEphemeralResponse(
        "❌ このコマンドは指定された勤怠管理チャンネルでのみ使用できます。"
      );
    }

    // コマンドによって処理を分岐
    const commandName = interaction.data?.name;
    const userId = interaction.member?.user?.id || interaction.user?.id;
    const username =
      interaction.member?.user?.username || interaction.user?.username;
    const channelId = interaction.channel_id;

    console.log("Command name:", commandName);
    console.log("User ID:", userId);
    console.log("Username:", username);
    console.log("Channel ID:", channelId);

    if (!userId || !channelId || !username) {
      console.log("Missing user ID, username, or channel ID");
      return this.createEphemeralResponse(
        "❌ ユーザー情報またはチャンネル情報が取得できませんでした。"
      );
    }

    // Discord APIからチャンネル名を取得
    console.log("Getting channel name from Discord API...");
    const channelName = await this.discordApiService.getChannelName(channelId);
    console.log("Channel name retrieved:", channelName);

    switch (commandName) {
      case "start":
        return await this.handleStartCommand(
          userId,
          username,
          channelId,
          channelName
        );
      case "end":
        return await this.handleEndCommand(
          userId,
          username,
          channelId,
          channelName
        );
      default:
        return this.createEphemeralResponse("❌ 不明なコマンドです。");
    }
  }

  /**
   * /start コマンドの処理
   * @param userId ユーザーID
   * @param username ユーザー名
   * @param channelId チャンネルID
   * @param channelName チャンネル名
   * @returns インタラクション レスポンス
   */
  private async handleStartCommand(
    userId: string,
    username: string,
    channelId: string,
    channelName: string
  ): Promise<InteractionResponse> {
    console.log("handleStartCommand called");
    console.log("User ID:", userId);
    console.log("Username:", username);
    console.log("Channel ID:", channelId);
    console.log("Channel Name:", channelName);

    // KVで既存の勤怠記録をチェック
    const kvKey = `${userId}:${channelId}`;
    console.log("Checking KV for existing record with key:", kvKey);

    try {
      const existingRecord = await this.kv.get<KVAttendanceRecord>(
        kvKey,
        "json"
      );

      if (existingRecord) {
        console.log("Found existing record in KV:", existingRecord);
        return this.createEphemeralResponse(
          "❌ 前回の勤務が終了されていません。先に /end コマンドを実行してください。"
        );
      }

      console.log("No existing record found, proceeding with start...");
      console.log("Calling GAS startWork...");
      const result = await this.gasService.startWork(
        userId,
        username,
        channelId,
        channelName
      );
      console.log("GAS startWork result:", JSON.stringify(result, null, 2));

      if (result.success) {
        // KVに勤怠記録を保存（24時間のTTL設定）
        const startTime = new Date().toISOString();
        const uuid = crypto.randomUUID();

        const kvRecord: KVAttendanceRecord = {
          startTime,
          uuid,
          username,
          channelName,
          projectName: channelName,
        };

        await this.kv.put(kvKey, JSON.stringify(kvRecord), {
          expirationTtl: 86400, // 24時間後に自動削除
        });

        console.log("Saved record to KV:", kvRecord);
        return this.createPublicResponse("✅ 勤務を開始しました。");
      } else {
        return this.createEphemeralResponse(`❌ ${result.message}`);
      }
    } catch (error) {
      console.error("Start command error:", error);
      return this.createEphemeralResponse(
        "❌ 勤務開始の処理中にエラーが発生しました。"
      );
    }
  }

  /**
   * /end コマンドの処理
   * @param userId ユーザーID
   * @param username ユーザー名
   * @param channelId チャンネルID
   * @param channelName チャンネル名
   * @returns インタラクション レスポンス
   */
  private async handleEndCommand(
    userId: string,
    username: string,
    channelId: string,
    channelName: string
  ): Promise<InteractionResponse> {
    console.log("handleEndCommand called");
    console.log("User ID:", userId);
    console.log("Username:", username);
    console.log("Channel ID:", channelId);
    console.log("Channel Name:", channelName);

    // KVから既存記録を取得
    const kvKey = `${userId}:${channelId}`;
    console.log("Checking KV for existing record with key:", kvKey);

    try {
      const existingRecord = await this.kv.get<KVAttendanceRecord>(
        kvKey,
        "json"
      );

      if (!existingRecord) {
        console.log("No existing record found in KV");
        return this.createEphemeralResponse(
          "❌ 開始されていない勤務を終了することはできません。先に /start コマンドを実行してください。"
        );
      }

      console.log("Found existing record in KV:", existingRecord);
      console.log("Calling GAS endWork...");
      const result = await this.gasService.endWork(
        userId,
        username,
        channelId,
        channelName
      );

      if (result.success) {
        // KVから記録を削除
        await this.kv.delete(kvKey);
        console.log("Deleted record from KV with key:", kvKey);

        const message = result.workHours
          ? `✅ 勤務を終了しました。お疲れ様でした。**労働時間:** ${result.workHours}`
          : "✅ 勤務を終了しました。お疲れ様でした。";

        return this.createPublicResponse(message);
      } else {
        return this.createEphemeralResponse(`❌ ${result.message}`);
      }
    } catch (error) {
      console.error("End command error:", error);
      return this.createEphemeralResponse(
        "❌ 勤務終了の処理中にエラーが発生しました。"
      );
    }
  }

  /**
   * 公開メッセージのレスポンスを作成
   * @param content メッセージ内容
   * @returns インタラクション レスポンス
   */
  private createPublicResponse(content: string): InteractionResponse {
    return {
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: {
        content,
      },
    };
  }

  /**
   * エフェメラル（個人にのみ表示される）メッセージのレスポンスを作成
   * @param content メッセージ内容
   * @returns インタラクション レスポンス
   */
  private createEphemeralResponse(content: string): InteractionResponse {
    return {
      type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
      data: {
        content,
        flags: 64, // EPHEMERAL フラグ
      },
    };
  }
}
