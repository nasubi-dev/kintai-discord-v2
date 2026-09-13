export type Bindings = {
  // 暗号化キー
  ENCRYPTION_KEY: string;
  // Slack署名検証用
  SLACK_SIGNING_SECRET: string;
  SLACK_CLIENT_ID: string;
  SLACK_CLIENT_SECRET: string;
  KINTAI_SLACK_KV: KVNamespace;
  // 利用状況の記録（未設定なら記録しない）
  ANALYTICS?: AnalyticsEngineDataset;
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
  teamId: string;
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
  teamId?: string;
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

// Discord team関連の型定義
export interface Discordteam {
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

// 統計機能の型定義
export interface UserMonthlyStats {
  success: boolean;
  username?: string;
  totalWorkTime?: string;
  projectBreakdown?: { [projectName: string]: string };
  error?: string;
}

export interface ProjectMonthlyStats {
  success: boolean;
  projectName?: string;
  totalWorkTime?: string;
  userBreakdown?: { [userId: string]: { username: string; workTime: string } };
  error?: string;
}
