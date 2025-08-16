import { SetupResult, Bindings, GoogleOAuthTokens } from "./types";
import { SheetsService } from "./sheets-service";
import { ServerConfigService } from "./server-config-service";
import { CryptoService } from "./crypto-service";

export class OAuthService {
  private kv: KVNamespace;
  private env: Bindings;
  private cryptoService: CryptoService;

  constructor(env: Bindings) {
    this.kv = env.KINTAI_DISCORD_KV;
    this.env = env;
    this.cryptoService = new CryptoService(env.ENCRYPTION_KEY);
  }

  async generateAuthUrl(guildId: string, userId: string): Promise<string> {
    const state = crypto.randomUUID();
    const authData = { guildId, userId, timestamp: Date.now() };

    await this.kv.put(`oauth_state:${state}`, JSON.stringify(authData), {
      expirationTtl: 600,
    });
    return this.generateSetupGuideUrl(guildId, state);
  }

  private generateSetupGuideUrl(guildId: string, state: string): string {
    const params = new URLSearchParams({
      guild: guildId,
      state: state,
      type: "oauth_init",
    });
    return `https://kintai-discord-v2.nasubi.dev/init-guide?${params.toString()}`;
  }

  async registerOAuthCredentials(
    guildId: string,
    userId: string,
    clientId: string,
    clientSecret: string,
    state: string
  ): Promise<{ success: boolean; authUrl?: string; error?: string }> {
    try {
      const authDataStr = await this.kv.get(`oauth_state:${state}`);
      if (!authDataStr) {
        return {
          success: false,
          error: "認証セッションが無効または期限切れです",
        };
      }

      const credentialsData = { clientId, clientSecret, guildId, userId };
      const credentialsJson = JSON.stringify(credentialsData);
      const encryptedCredentials = await this.cryptoService.encrypt(
        credentialsJson
      );

      // 一時的な認証情報
      await this.kv.put(`temp_oauth:${state}`, encryptedCredentials, {
        expirationTtl: 3600,
      });

      // 永続的なOAuth認証情報（リフレッシュ時に使用）
      await this.kv.put(`oauth_credentials:${guildId}`, encryptedCredentials);

      const redirectUri = `https://kintai-discord-v2.nasubi.dev/oauth/callback`;
      const params = new URLSearchParams({
        response_type: "code",
        client_id: clientId,
        redirect_uri: redirectUri,
        scope: "https://www.googleapis.com/auth/spreadsheets",
        state: state,
        access_type: "offline",
        prompt: "consent",
      });

      return {
        success: true,
        authUrl: `https://accounts.google.com/o/oauth2/auth?${params.toString()}`,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : typeof error === "object"
          ? JSON.stringify(error, null, 2)
          : String(error);

      return {
        success: false,
        error: `OAuth認証情報の登録に失敗しました: ${errorMessage}`,
      };
    }
  }

  async handleCallback(code: string, state: string): Promise<SetupResult> {
    try {
      const tempKey = `temp_oauth:${state}`;
      const encryptedCredentials = await this.kv.get(tempKey);

      if (!encryptedCredentials) {
        return {
          success: false,
          error:
            "認証セッションが見つかりません。セッションが期限切れの可能性があります。",
        };
      }

      const credentialsStr = await this.cryptoService.decrypt(
        encryptedCredentials
      );
      const credentials = JSON.parse(credentialsStr);

      const tokenData = await this.exchangeCodeForTokens(
        code,
        credentials.clientId,
        credentials.clientSecret
      );
      if (!tokenData.success) {
        return {
          success: false,
          error: tokenData.error || "トークン取得に失敗しました",
        };
      }

      const sheetsService = new SheetsService(
        this.env,
        tokenData.tokens!.access_token
      );
      const spreadsheetResult = await sheetsService.createKintaiSpreadsheet(
        credentials.guildId
      );

      if (!spreadsheetResult.success) {
        const errorDetails =
          spreadsheetResult.error || "スプレッドシート作成に失敗";
        return {
          success: false,
          error: `スプレッドシートの作成に失敗しました: ${errorDetails}`,
        };
      }

      const serverConfigService = new ServerConfigService(this.env);
      await serverConfigService.saveServerConfig(
        credentials.guildId,
        credentials.userId,
        tokenData.tokens!,
        spreadsheetResult.spreadsheetId!,
        spreadsheetResult.spreadsheetUrl!
      );

      await this.kv.delete(`oauth_state:${state}`);
      await this.kv.delete(tempKey);

      return {
        success: true,
        guildId: credentials.guildId,
        spreadsheetUrl: spreadsheetResult.spreadsheetUrl,
        message:
          "設定が完了しました！管理者のGoogleアカウントにスプレッドシートが作成されました。",
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : typeof error === "object"
          ? JSON.stringify(error, null, 2)
          : String(error);

      return {
        success: false,
        error: `OAuth認証処理中にエラーが発生しました: ${errorMessage}`,
      };
    }
  }

  /**
   * Step 5: 認証コードをアクセストークンに交換
   */
  private async exchangeCodeForTokens(
    code: string,
    clientId: string,
    clientSecret: string
  ): Promise<{ success: boolean; tokens?: GoogleOAuthTokens; error?: string }> {
    try {
      const response = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          code: code,
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: `https://kintai-discord-v2.nasubi.dev/oauth/callback`,
          grant_type: "authorization_code",
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        let errorDetails = "";
        try {
          const errorData = JSON.parse(errorText);
          errorDetails = `エラーコード: ${
            errorData.error || "unknown"
          }, 詳細: ${errorData.error_description || "no description"}`;
        } catch {
          errorDetails = `HTTPステータス: ${response.status}, レスポンス: ${errorText}`;
        }

        console.error("Token exchange failed:", {
          status: response.status,
          body: errorText,
        });
        return {
          success: false,
          error: `Google認証エラー - ${errorDetails}`,
        };
      }

      const tokens = (await response.json()) as GoogleOAuthTokens;
      return {
        success: true,
        tokens: tokens,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : typeof error === "object"
          ? JSON.stringify(error, null, 2)
          : String(error);

      console.error("Token exchange error:", error);
      return {
        success: false,
        error: `トークン取得処理中にエラーが発生しました: ${errorMessage}`,
      };
    }
  }

  /**
   * Step 6: トークンリフレッシュ機能
   * アクセストークンが期限切れの場合、リフレッシュトークンで更新
   */
  async refreshTokens(
    guildId: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const serverConfigService = new ServerConfigService(this.env);
      const config = await serverConfigService.getServerConfig(guildId);

      if (!config || !config.refresh_token) {
        return {
          success: false,
          error:
            "リフレッシュトークンが見つかりません。再度セットアップが必要です。",
        };
      }

      // OAuth認証情報を取得（setupで保存されている必要がある）
      const tempOAuthData = await this.kv.get(`oauth_credentials:${guildId}`);
      if (!tempOAuthData) {
        return {
          success: false,
          error: "OAuth認証情報が見つかりません。再度セットアップが必要です。",
        };
      }

      const oauthCredentials = JSON.parse(await this.cryptoService.decrypt(tempOAuthData));

      // リフレッシュトークンを使用して新しいアクセストークンを取得
      const response = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          client_id: oauthCredentials.clientId,
          client_secret: oauthCredentials.clientSecret,
          refresh_token: config.refresh_token,
          grant_type: "refresh_token",
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error("Token refresh failed:", {
          status: response.status,
          body: errorText,
        });
        return {
          success: false,
          error: `トークンの更新に失敗しました: ${response.status}`,
        };
      }

      const tokens = (await response.json()) as GoogleOAuthTokens;

      // 新しいアクセストークンで設定を更新
      const updatedTokens = {
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token || config.refresh_token, // 新しいリフレッシュトークンがない場合は既存のものを使用
        expires_in: tokens.expires_in,
        token_type: tokens.token_type,
      };

      await serverConfigService.saveServerConfig(
        guildId,
        config.owner_id,
        updatedTokens,
        config.spreadsheet_id,
        config.sheet_url
      );

      return { success: true };
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : typeof error === "object"
          ? JSON.stringify(error, null, 2)
          : String(error);

      console.error("Token refresh error:", error);
      return {
        success: false,
        error: `トークン更新に失敗しました: ${errorMessage}`,
      };
    }
  }

  /**
   * アクセストークンを無効化
   */
  async revokeToken(
    accessToken: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const response = await fetch("https://oauth2.googleapis.com/revoke", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          token: accessToken,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.warn("Token revocation failed:", {
          status: response.status,
          body: errorText,
        });
        // トークン無効化の失敗は致命的ではないので、成功として扱う
      }

      return { success: true };
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : typeof error === "object"
          ? JSON.stringify(error, null, 2)
          : String(error);

      console.error("Token revocation error:", error);
      return {
        success: false,
        error: `トークン無効化に失敗しました: ${errorMessage}`,
      };
    }
  }
}
