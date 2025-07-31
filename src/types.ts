// Discord API関連の型定義
export type Bindings = {
  DISCORD_PUBLIC_KEY: string;
  DISCORD_APPLICATION_ID: string;
  DISCORD_TOKEN: string;
  ALLOWED_CHANNEL_IDS: string;
  KINTAI_DISCORD_KV: KVNamespace;
  // 暗号化キー
  ENCRYPTION_KEY: string;
};

// GAS関連の型定義
export interface GASRequest {
  action: "start" | "end";
  userId: string;
  username: string;
  channelId: string;
  channelName: string;
  projectName: string;
  timestamp: string;
  customTime?: string; // 追加：カスタム時刻（ISO文字列）
}

export interface GASResponse {
  success: boolean;
  message: string;
  workHours?: string;
  error?: string;
}

// 勤怠データの型定義
export interface AttendanceRecord {
  projectName: string;
  userId: string;
  workHours: string;
  startTime: string;
  endTime: string;
  uuid: string;
  todo: string; // 必須フィールドに変更
}

// KVストレージ用の型定義
export interface KVAttendanceRecord {
  startTime: string;
  uuid: string;
  username: string;
  channelName: string;
  projectName: string;
}

// Google OAuth関連の型定義
export interface OAuthState {
  guildId: string;
  userId: string;
  timestamp: number;
}

export interface ServerConfig {
  spreadsheet_id: string;
  access_token: string;
  refresh_token: string;
  sheet_url: string;
  owner_id: string;
  created_at: string;
}

export interface EncryptedServerConfig {
  spreadsheet_id: string;
  encrypted_tokens: string;
  sheet_url: string;
  owner_id: string;
  created_at: string;
}

export interface GoogleTokens {
  access_token: string;
  refresh_token: string;
  expires_in?: number;
  token_type?: string;
}

export interface GoogleSheetsCreateRequest {
  properties: {
    title: string;
    locale: string;
    timeZone: string;
  };
  sheets: Array<{
    properties: {
      title: string;
      gridProperties: {
        rowCount: number;
        columnCount: number;
      };
    };
  }>;
}

// Setup コマンドのレスポンス型
export interface SetupResult {
  success: boolean;
  guildId?: string;
  error?: string;
  spreadsheetUrl?: string;
  message?: string;
  requiresGASSetup?: boolean;
}

// Google OAuth 関連の型定義（既存コードとの互換性）
export interface GoogleOAuthTokens {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
  scope?: string;
}

export interface GoogleOAuthErrorResponse {
  error: string;
  error_description?: string;
}

export interface GoogleSheetsResponse {
  spreadsheetId: string;
  properties: {
    title: string;
    locale?: string;
    timeZone?: string;
  };
  sheets?: any[];
}

// Discord Guild関連の型定義
export interface DiscordGuild {
  id: string;
  name: string;
  icon?: string;
  owner?: boolean;
  permissions?: string;
  features?: string[];
}

// Bot統計情報の型定義
export interface BotStats {
  serverCount: number;
  timestamp: string;
  version: string;
}

export interface DetailedBotStats {
  totalServers: number;
  configuredServers: number;
  unconfiguredServers: number;
  configurationRate: number;
  timestamp: string;
  version: string;
}
