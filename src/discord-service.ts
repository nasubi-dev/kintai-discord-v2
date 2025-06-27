import {
  DiscordInteraction,
  InteractionResponse,
  InteractionResponseType,
  InteractionResponseData,
  Bindings,
  KVAttendanceRecord,
  EncryptedServerConfig,
} from "./types";
import { GASService } from "./gas-service";
import { DiscordApiService } from "./discord-api-service";
import { OAuthService } from "./oauth-service";
import { CryptoService } from "./crypto-service";
import { isChannelAllowed } from "./utils";

/**
 * Discord コマンドの処理を行うサービスクラス
 */
export class DiscordCommandService {
  private gasService: GASService;
  private discordApiService: DiscordApiService;
  private oauthService: OAuthService;
  private cryptoService: CryptoService;
  private allowedChannels: string[];
  private kv: KVNamespace;
  private env: Bindings;

  constructor(
    gasUrl: string,
    allowedChannelIds: string,
    discordToken: string,
    kv: KVNamespace,
    env: Bindings,
    gasTimeout: number = 10000 // デフォルト10秒
  ) {
    console.log("DiscordCommandService constructor - GAS URL:", gasUrl);
    console.log(
      "DiscordCommandService constructor - Allowed Channels:",
      allowedChannelIds
    );
    this.gasService = new GASService(gasUrl, gasTimeout); // タイムアウト設定を追加
    this.discordApiService = new DiscordApiService(discordToken);
    this.oauthService = new OAuthService(env);
    this.cryptoService = new CryptoService(env.ENCRYPTION_KEY);
    this.allowedChannels = allowedChannelIds.split(",").map((id) => id.trim());
    this.kv = kv;
    this.env = env;
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
      case "setup":
        return await this.handleSetupCommand(interaction);
      case "reset":
        return await this.handleResetCommand(interaction);
      case "status":
        return await this.handleStatusCommand(interaction);
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
   * /setup コマンドの処理
   */
  private async handleSetupCommand(
    interaction: DiscordInteraction
  ): Promise<InteractionResponse> {
    const guildId = interaction.guild_id;
    const userId = interaction.member?.user?.id;

    if (!guildId || !userId) {
      return this.createEphemeralResponse(
        "❌ サーバー情報またはユーザー情報が取得できませんでした。"
      );
    }

    // 管理者権限チェック
    if (!this.hasAdminPermission(interaction.member)) {
      return this.createEphemeralResponse(
        "❌ このコマンドを実行するには管理者権限が必要です。"
      );
    }

    // 既存設定チェック
    const existingConfig = await this.kv.get(`server:${guildId}`);
    if (existingConfig) {
      return this.createEphemeralResponse(
        "⚠️ このサーバーは既に設定されています。設定をリセットする場合は `/reset` コマンドを使用してください。"
      );
    }

    try {
      // OAuth URL 生成
      const authUrl = await this.oauthService.generateAuthUrl(guildId, userId);

      return this.createEphemeralResponse(
        `📋 **勤怠管理システムのセットアップ**\n\n` +
          `以下のリンクをクリックして Google アカウントで認証を行ってください：\n\n` +
          `🔗 [Google 認証を開始](${authUrl})\n\n` +
          `✅ 認証完了後、自動でスプレッドシートが作成されます\n` +
          `⏰ この認証リンクは10分間有効です`
      );
    } catch (error) {
      console.error("Setup command error:", error);
      return this.createEphemeralResponse(
        "❌ セットアップ処理中にエラーが発生しました。"
      );
    }
  }

  /**
   * /reset コマンドの処理
   */
  private async handleResetCommand(
    interaction: DiscordInteraction
  ): Promise<InteractionResponse> {
    const guildId = interaction.guild_id;

    if (!guildId) {
      return this.createEphemeralResponse(
        "❌ サーバー情報が取得できませんでした。"
      );
    }

    // 管理者権限チェック
    if (!this.hasAdminPermission(interaction.member)) {
      return this.createEphemeralResponse(
        "❌ このコマンドを実行するには管理者権限が必要です。"
      );
    }

    try {
      // 既存設定の取得
      const existingConfigString = await this.kv.get(`server:${guildId}`);
      if (!existingConfigString) {
        return this.createEphemeralResponse(
          "ℹ️ このサーバーに設定された勤怠管理システムはありません。"
        );
      }

      // トークンの取り消し（可能であれば）
      try {
        const config: EncryptedServerConfig = JSON.parse(existingConfigString);
        const tokens = await this.cryptoService.decrypt(config.encrypted_tokens);
        if (tokens.access_token) {
          await this.oauthService.revokeToken(tokens.access_token);
        }
      } catch (error) {
        console.warn("Failed to revoke tokens during reset:", error);
        // トークン取り消しに失敗しても設定削除は続行
      }

      // 設定を削除
      await this.kv.delete(`server:${guildId}`);

      return this.createEphemeralResponse(
        "✅ 勤怠管理システムの設定をリセットしました。\n\n" +
          "新しく設定する場合は `/setup` コマンドを実行してください。"
      );
    } catch (error) {
      console.error("Reset command error:", error);
      return this.createEphemeralResponse(
        "❌ 設定リセット中にエラーが発生しました。"
      );
    }
  }

  /**
   * /status コマンドの処理
   */
  private async handleStatusCommand(
    interaction: DiscordInteraction
  ): Promise<InteractionResponse> {
    const guildId = interaction.guild_id;

    if (!guildId) {
      return this.createEphemeralResponse(
        "❌ サーバー情報が取得できませんでした。"
      );
    }

    try {
      // 設定の確認
      const configString = await this.kv.get(`server:${guildId}`);
      if (!configString) {
        return this.createEphemeralResponse(
          "ℹ️ このサーバーに勤怠管理システムは設定されていません。\n\n" +
            "設定するには `/setup` コマンドを実行してください。"
        );
      }

      const config: EncryptedServerConfig = JSON.parse(configString);

      // 接続テストを実行
      let connectionStatus = "❌ 接続エラー";
      let details = "";

      try {
        const tokens = await this.cryptoService.decrypt(config.encrypted_tokens);
        // 簡単な接続テスト（スプレッドシート情報の取得）
        const response = await fetch(
          `https://sheets.googleapis.com/v4/spreadsheets/${config.spreadsheet_id}`,
          {
            headers: {
              Authorization: `Bearer ${tokens.access_token}`,
            },
          }
        );

        if (response.ok) {
          connectionStatus = "✅ 接続正常";
          const sheetData = await response.json() as any;
          details = `📊 **スプレッドシート詳細**\n• タイトル: ${sheetData.properties?.title || '不明'}\n• 権限: 読み書き可能`;
        } else if (response.status === 401) {
          connectionStatus = "⚠️ 認証期限切れ";
          details = "認証の更新が必要です。管理者にお問い合わせください。";
        } else {
          connectionStatus = "❌ 接続エラー";
          details = `エラーコード: ${response.status}`;
        }
      } catch (error) {
        console.error("Connection test error:", error);
        details = "接続テスト中にエラーが発生しました。";
      }

      return this.createEphemeralResponse(
        `📋 **勤怠管理システム ステータス**\n\n` +
          `**設定日時:** ${new Date(config.created_at).toLocaleString('ja-JP')}\n` +
          `**設定者:** <@${config.owner_id}>\n` +
          `**接続状態:** ${connectionStatus}\n\n` +
          `**スプレッドシート:** [開く](${config.sheet_url})\n\n` +
          `${details}\n\n` +
          `💡 設定をリセットするには \`/reset\` コマンドを使用してください。`
      );
    } catch (error) {
      console.error("Status command error:", error);
      return this.createEphemeralResponse(
        "❌ ステータス確認中にエラーが発生しました。"
      );
    }
  }

  /**
   * 管理者権限をチェック
   */
  private hasAdminPermission(member: any): boolean {
    if (!member) return false;

    // Discord の権限チェック（簡易版）
    // 本来は member.permissions を正しく解析すべきですが、
    // 現在は roles での簡易チェックを実装
    const hasAdminRole = member.roles?.some((role: string) =>
      role.includes('admin') || role.includes('管理者') || role.includes('Admin')
    );

    return hasAdminRole || false;
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
