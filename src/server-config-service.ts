import { ServerConfig, Bindings, GoogleOAuthTokens } from "./types";
import { CryptoService } from "./crypto-service";

export class ServerConfigService {
  private kv: KVNamespace;
  private cryptoService: CryptoService;

  constructor(env: Bindings) {
    this.kv = env.KINTAI_DISCORD_KV;
    this.cryptoService = new CryptoService(env.ENCRYPTION_KEY);
  }

  async saveServerConfig(
    guildId: string,
    ownerId: string,
    tokens: GoogleOAuthTokens,
    spreadsheetId: string,
    sheetUrl: string
  ): Promise<void> {
    const config: ServerConfig = {
      spreadsheet_id: spreadsheetId,
      access_token: await this.cryptoService.encrypt(tokens.access_token),
      refresh_token: tokens.refresh_token
        ? await this.cryptoService.encrypt(tokens.refresh_token)
        : "",
      sheet_url: sheetUrl,
      owner_id: ownerId,
      created_at: new Date().toISOString(),
    };
    await this.kv.put(`server:${guildId}`, JSON.stringify(config));
  }

  async getServerConfig(guildId: string): Promise<ServerConfig | null> {
    const configStr = await this.kv.get(`server:${guildId}`);
    if (!configStr) return null;
    const config = JSON.parse(configStr) as ServerConfig;
    return {
      ...config,
      access_token: await this.cryptoService.decrypt(config.access_token),
      refresh_token: config.refresh_token
        ? await this.cryptoService.decrypt(config.refresh_token)
        : "",
    };
  }

  async updateAccessToken(
    guildId: string,
    newTokens: GoogleOAuthTokens
  ): Promise<void> {
    const config = await this.getServerConfig(guildId);
    if (!config) throw new Error("Server config not found");
    await this.kv.put(
      `server:${guildId}`,
      JSON.stringify({
        ...config,
        access_token: await this.cryptoService.encrypt(newTokens.access_token),
        refresh_token: newTokens.refresh_token
          ? await this.cryptoService.encrypt(newTokens.refresh_token)
          : config.refresh_token,
      })
    );
  }

  async deleteServerConfig(guildId: string): Promise<void> {
    await this.kv.delete(`server:${guildId}`);
  }

  async hasServerConfig(guildId: string): Promise<boolean> {
    return (await this.kv.get(`server:${guildId}`)) !== null;
  }

  async isServerOwner(guildId: string, userId: string): Promise<boolean> {
    return (await this.getServerConfig(guildId))?.owner_id === userId;
  }

  async getServerStatus(
    guildId: string
  ): Promise<{
    configured: boolean;
    spreadsheetUrl?: string;
    createdAt?: string;
    ownerId?: string;
  }> {
    const config = await this.getServerConfig(guildId);
    return config
      ? {
          configured: true,
          spreadsheetUrl: config.sheet_url,
          createdAt: config.created_at,
          ownerId: config.owner_id,
        }
      : { configured: false };
  }
}
