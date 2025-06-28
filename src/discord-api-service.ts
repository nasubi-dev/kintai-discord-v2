import { Bindings } from "./types";
import { APIChannel, ChannelType, MessageFlags } from "discord-api-types/v10";

export class DiscordApiService {
  private botToken: string;
  private baseUrl = "https://discord.com/api/v10";

  constructor(botToken: string) {
    this.botToken = botToken;
  }

  async getChannel(channelId: string): Promise<APIChannel | null> {
    try {
      const response = await fetch(`${this.baseUrl}/channels/${channelId}`, {
        method: "GET",
        headers: {
          Authorization: `Bot ${this.botToken}`,
          "Content-Type": "application/json",
        },
      });

      if (!response.ok) {
        throw new Error(`Discord API error: ${response.status}`);
      }

      const channelData = (await response.json()) as APIChannel;
      return channelData;
    } catch (error) {
      throw error;
    }
  }

  async getChannelName(channelId: string): Promise<string> {
    try {
      const channel = await this.getChannel(channelId);
      return channel?.name || `channel-${channelId.slice(-6)}`;
    } catch (error) {
      return `channel-${channelId.slice(-6)}`;
    }
  }

  /**
   * チャンネルタイプを判定
   */
  getChannelTypeDescription(channelType: ChannelType): string {
    const channelTypes: { [key in ChannelType]: string } = {
      [ChannelType.GuildText]: "テキストチャンネル",
      [ChannelType.DM]: "DMチャンネル",
      [ChannelType.GuildVoice]: "ボイスチャンネル",
      [ChannelType.GroupDM]: "グループDM",
      [ChannelType.GuildCategory]: "カテゴリ",
      [ChannelType.GuildAnnouncement]: "アナウンスチャンネル",
      [ChannelType.AnnouncementThread]: "アナウンススレッド",
      [ChannelType.PublicThread]: "パブリックスレッド",
      [ChannelType.PrivateThread]: "プライベートスレッド",
      [ChannelType.GuildStageVoice]: "ステージチャンネル",
      [ChannelType.GuildDirectory]: "ディレクトリ",
      [ChannelType.GuildForum]: "フォーラムチャンネル",
      [ChannelType.GuildMedia]: "メディアチャンネル",
    };
    return channelTypes[channelType] || "不明なチャンネル";
  }

  async editDeferredResponse(
    applicationId: string,
    token: string,
    content: string,
    ephemeral: boolean = false
  ): Promise<void> {
    const editUrl = `${this.baseUrl}/webhooks/${applicationId}/${token}/messages/@original`;
    const payload: any = { content };
    if (ephemeral) payload.flags = MessageFlags.Ephemeral;

    const response = await fetch(editUrl, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(
        `Discord API error: ${response.status} - ${await response.text()}`
      );
    }
  }

  async createFollowupMessage(
    applicationId: string,
    token: string,
    content: string,
    ephemeral: boolean = false
  ): Promise<void> {
    const followupUrl = `${this.baseUrl}/webhooks/${applicationId}/${token}`;
    const payload: any = { content };
    if (ephemeral) payload.flags = MessageFlags.Ephemeral;

    const response = await fetch(followupUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(
        `Discord API error: ${response.status} - ${await response.text()}`
      );
    }
  }

  async deleteOriginalResponse(
    applicationId: string,
    token: string
  ): Promise<void> {
    const deleteUrl = `${this.baseUrl}/webhooks/${applicationId}/${token}/messages/@original`;
    const response = await fetch(deleteUrl, { method: "DELETE" });

    if (!response.ok) {
      throw new Error(
        `Discord API error: ${response.status} - ${await response.text()}`
      );
    }
  }
}
