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

export interface DiscordInteraction {
  id: string;
  application_id: string;
  type: InteractionType;
  data?: ApplicationCommandData;
  guild_id?: string;
  channel_id?: string;
  member?: GuildMember;
  user?: User;
  token: string;
  version: number;
  message?: Message;
}

export interface ApplicationCommandData {
  id: string;
  name: string;
  type: number;
  resolved?: any;
  options?: ApplicationCommandOption[];
  guild_id?: string;
  target_id?: string;
}

export interface ApplicationCommandOption {
  name: string;
  type: number;
  value?: any;
  options?: ApplicationCommandOption[];
  focused?: boolean;
  autocomplete?: boolean;
}

export interface GuildMember {
  user?: User;
  nick?: string;
  avatar?: string;
  roles: string[];
  joined_at: string;
  premium_since?: string;
  deaf: boolean;
  mute: boolean;
  flags: number;
  pending?: boolean;
  permissions?: string;
  communication_disabled_until?: string;
}

export interface User {
  id: string;
  username: string;
  discriminator: string;
  avatar?: string;
  bot?: boolean;
  system?: boolean;
  mfa_enabled?: boolean;
  banner?: string;
  accent_color?: number;
  locale?: string;
  verified?: boolean;
  email?: string;
  flags?: number;
  premium_type?: number;
  public_flags?: number;
}

export interface Message {
  id: string;
  channel_id: string;
  author: User;
  content: string;
  timestamp: string;
  edited_timestamp?: string;
  tts: boolean;
  mention_everyone: boolean;
  mentions: User[];
  mention_roles: string[];
  mention_channels?: any[];
  attachments: any[];
  embeds: any[];
  reactions?: any[];
  nonce?: string | number;
  pinned: boolean;
  webhook_id?: string;
  type: number;
  activity?: any;
  application?: any;
  application_id?: string;
  message_reference?: any;
  flags?: number;
  referenced_message?: Message;
  interaction?: any;
  thread?: any;
  components?: any[];
  sticker_items?: any[];
  stickers?: any[];
  position?: number;
}

export enum InteractionType {
  PING = 1,
  APPLICATION_COMMAND = 2,
  MESSAGE_COMPONENT = 3,
  APPLICATION_COMMAND_AUTOCOMPLETE = 4,
  MODAL_SUBMIT = 5,
}

export enum InteractionResponseType {
  PONG = 1,
  CHANNEL_MESSAGE_WITH_SOURCE = 4,
  DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE = 5,
  DEFERRED_UPDATE_MESSAGE = 6,
  UPDATE_MESSAGE = 7,
  APPLICATION_COMMAND_AUTOCOMPLETE_RESULT = 8,
  MODAL = 9,
  PREMIUM_REQUIRED = 10,
}

export interface InteractionResponse {
  type: InteractionResponseType;
  data?: InteractionResponseData;
}

export interface InteractionResponseData {
  tts?: boolean;
  content?: string;
  embeds?: any[];
  allowed_mentions?: any;
  flags?: number;
  components?: any[];
  attachments?: any[];
}

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
}

// KVストレージ用の型定義
export interface KVAttendanceRecord {
  startTime: string;
  uuid: string;
  username: string;
  channelName: string;
  projectName: string;
}

export enum MessageFlags {
  EPHEMERAL = 64,
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
