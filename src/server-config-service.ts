import { ServerConfig, Bindings, GoogleOAuthTokens } from "./types";
import { CryptoService } from "./crypto-service";

export class ServerConfigService {
  private kv: KVNamespace;
  private cryptoService: CryptoService;

  constructor(env: Bindings) {
    this.kv = env.KINTAI_DISCORD_KV;
    this.cryptoService = new CryptoService(env.ENCRYPTION_KEY);

    if (!env.ENCRYPTION_KEY) {
      throw new Error("ENCRYPTION_KEY not configured");
    }
  }

  /**
   * サーバー設定を保存
   */
  async saveServerConfig(
    guildId: string,
    ownerId: string,
    tokens: GoogleOAuthTokens,
    spreadsheetId: string,
    sheetUrl: string
  ): Promise<void> {
    try {
      // トークンを暗号化
      const encryptedAccessToken = await this.cryptoService.encrypt(tokens.access_token);
      const encryptedRefreshToken = tokens.refresh_token 
        ? await this.cryptoService.encrypt(tokens.refresh_token)
        : "";

      const config: ServerConfig = {
        spreadsheet_id: spreadsheetId,
        access_token: encryptedAccessToken,
        refresh_token: encryptedRefreshToken,
        sheet_url: sheetUrl,
        owner_id: ownerId,
        created_at: new Date().toISOString(),
      };

      await this.kv.put(`server:${guildId}`, JSON.stringify(config));
      console.log(`Server config saved for guild: ${guildId}`);
    } catch (error) {
      console.error("Failed to save server config:", error);
      throw new Error("Failed to save server configuration");
    }
  }

  /**
   * サーバー設定を取得
   */
  async getServerConfig(guildId: string): Promise<ServerConfig | null> {
    try {
      const configStr = await this.kv.get(`server:${guildId}`);
      if (!configStr) {
        return null;
      }

      const encryptedConfig = JSON.parse(configStr) as ServerConfig;

      // トークンを復号化
      const decryptedAccessToken = await this.cryptoService.decrypt(encryptedConfig.access_token);
      const decryptedRefreshToken = encryptedConfig.refresh_token 
        ? await this.cryptoService.decrypt(encryptedConfig.refresh_token)
        : "";

      return {
        ...encryptedConfig,
        access_token: decryptedAccessToken,
        refresh_token: decryptedRefreshToken,
      };
    } catch (error) {
      console.error("Failed to get server config:", error);
      return null;
    }
  }

  /**
   * アクセストークンを更新
   */
  async updateAccessToken(
    guildId: string,
    newTokens: GoogleOAuthTokens
  ): Promise<void> {
    try {
      const config = await this.getServerConfig(guildId);
      if (!config) {
        throw new Error("Server config not found");
      }

      // 新しいトークンを暗号化
      const encryptedAccessToken = await this.cryptoService.encrypt(newTokens.access_token);
      const encryptedRefreshToken = newTokens.refresh_token 
        ? await this.cryptoService.encrypt(newTokens.refresh_token)
        : config.refresh_token; // 既存のトークンを保持

      // 暗号化された状態で保存
      const updatedConfig = {
        ...config,
        access_token: encryptedAccessToken,
        refresh_token: encryptedRefreshToken,
      };

      await this.kv.put(`server:${guildId}`, JSON.stringify(updatedConfig));
      console.log(`Access token updated for guild: ${guildId}`);
    } catch (error) {
      console.error("Failed to update access token:", error);
      throw new Error("Failed to update access token");
    }
  }

  /**
   * サーバー設定を削除
   */
  async deleteServerConfig(guildId: string): Promise<void> {
    try {
      await this.kv.delete(`server:${guildId}`);
      console.log(`Server config deleted for guild: ${guildId}`);
    } catch (error) {
      console.error("Failed to delete server config:", error);
      throw new Error("Failed to delete server configuration");
    }
  }

  /**
   * サーバー設定が存在するかチェック
   */
  async hasServerConfig(guildId: string): Promise<boolean> {
    try {
      const configStr = await this.kv.get(`server:${guildId}`);
      return configStr !== null;
    } catch (error) {
      console.error("Failed to check server config:", error);
      return false;
    }
  }

  /**
   * サーバーの所有者かチェック
   */
  async isServerOwner(guildId: string, userId: string): Promise<boolean> {
    try {
      const config = await this.getServerConfig(guildId);
      return config?.owner_id === userId;
    } catch (error) {
      console.error("Failed to check server owner:", error);
      return false;
    }
  }

  /**
   * 設定のステータス情報を取得
   */
  async getServerStatus(guildId: string): Promise<{
    configured: boolean;
    spreadsheetUrl?: string;
    createdAt?: string;
    ownerId?: string;
  }> {
    try {
      const config = await this.getServerConfig(guildId);

      if (!config) {
        return { configured: false };
      }

      return {
        configured: true,
        spreadsheetUrl: config.sheet_url,
        createdAt: config.created_at,
        ownerId: config.owner_id,
      };
    } catch (error) {
      console.error("Failed to get server status:", error);
      return { configured: false };
    }
  }

  /**
   * Google Apps Script設定を保存（新方式）
   */
  async saveGASConfig(
    guildId: string,
    ownerId: string,
    gasUrl: string
  ): Promise<void> {
    try {
      const config = {
        gas_url: gasUrl,
        owner_id: ownerId,
        created_at: new Date().toISOString(),
        setup_method: 'gas', // GAS方式を示すフラグ
      };

      await this.kv.put(`server:${guildId}`, JSON.stringify(config));
      console.log(`GAS config saved for guild: ${guildId}`);
    } catch (error) {
      console.error("Failed to save GAS config:", error);
      throw new Error("Failed to save GAS configuration");
    }
  }
}
