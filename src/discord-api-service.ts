import { Bindings } from "./types";
import { APIChannel, ChannelType, MessageFlags } from "discord-api-types/v10";

/**
 * Discord API サービスクラス
 * チャンネル情報の取得などを行う
 */
export class DiscordApiService {
  private botToken: string;
  private baseUrl = "https://discord.com/api/v10";

  constructor(botToken: string) {
    this.botToken = botToken;
  }

  /**
   * チャンネル情報を取得
   * @param channelId Discord チャンネルID
   * @returns チャンネル情報
   */
  async getChannel(channelId: string): Promise<APIChannel | null> {
    try {
      console.log("Discord API: Getting channel info for", channelId);

      const response = await fetch(`${this.baseUrl}/channels/${channelId}`, {
        method: "GET",
        headers: {
          Authorization: `Bot ${this.botToken}`,
          "Content-Type": "application/json",
          "User-Agent":
            "Discord勤怠管理ボット (https://github.com/your-repo, 1.0.0)",
        },
      });

      if (!response.ok) {
        console.error(
          "Discord API error:",
          response.status,
          response.statusText
        );
        const errorText = await response.text();
        console.error("Error details:", errorText);
        return null;
      }

      const channel = (await response.json()) as APIChannel;
      console.log("Channel info retrieved:", {
        id: channel.id,
        name: channel.name,
        type: channel.type,
      });

      return channel;
    } catch (error) {
      console.error("Failed to get channel info:", error);
      return null;
    }
  }

  /**
   * チャンネル名を取得（フォールバック付き）
   * @param channelId Discord チャンネルID
   * @returns チャンネル名
   */
  async getChannelName(channelId: string): Promise<string> {
    try {
      const channel = await this.getChannel(channelId);

      if (channel && channel.name) {
        return channel.name;
      }

      // フォールバック: チャンネル名が取得できない場合
      console.warn("Channel name not available, using fallback");
      return `channel-${channelId.slice(-6)}`;
    } catch (error) {
      console.error("Error getting channel name:", error);
      // エラー時のフォールバック
      return `channel-${channelId.slice(-6)}`;
    }
  }

  /**
   * チャンネルタイプを判定
   * @param channelType Discord チャンネルタイプ
   * @returns チャンネルタイプの説明
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

  /**
   * Deferred Response（遅延応答）の編集を行う
   * 通信環境が悪い場合でもバックグラウンドで結果を送信
   * @param applicationId Discord Application ID
   * @param token インタラクショントークン
   * @param content 送信するメッセージ内容
   */
  async editDeferredResponse(
    applicationId: string,
    token: string,
    content: string,
    ephemeral: boolean = false
  ): Promise<void> {
    const editUrl = `${this.baseUrl}/webhooks/${applicationId}/${token}/messages/@original`;

    const payload: any = {
      content: content,
    };

    if (ephemeral) {
      payload.flags = MessageFlags.Ephemeral;
    }

    try {
      console.log("Discord API: Editing deferred response...");
      console.log("Application ID:", applicationId);
      console.log("Token length:", token?.length || 0);
      console.log("Edit URL:", editUrl);

      const response = await fetch(editUrl, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error("Failed to edit deferred response:", errorText);
        console.error("Response status:", response.status);
        console.error(
          "Response headers:",
          Object.fromEntries(response.headers.entries())
        );
        throw new Error(`Discord API error: ${response.status} - ${errorText}`);
      }

      console.log("Discord API: Deferred response edited successfully");
    } catch (error) {
      console.error("Error editing deferred response:", error);
      throw error;
    }
  }

  /**
   * フォローアップメッセージを送信する
   * @param applicationId Discord Application ID
   * @param token インタラクショントークン
   * @param content 送信するメッセージ内容
   * @param ephemeral 本人のみに表示するかどうか
   */
  async createFollowupMessage(
    applicationId: string,
    token: string,
    content: string,
    ephemeral: boolean = false
  ): Promise<void> {
    const followupUrl = `${this.baseUrl}/webhooks/${applicationId}/${token}`;

    const payload: any = {
      content: content,
    };

    if (ephemeral) {
      payload.flags = MessageFlags.Ephemeral;
    }

    try {
      console.log("Discord API: Creating followup message...");
      console.log("Followup URL:", followupUrl);
      console.log("Application ID:", applicationId);
      console.log("Token length:", token?.length || 0);
      console.log("Payload:", JSON.stringify(payload));

      const response = await fetch(followupUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error("Failed to create followup message:", errorText);
        throw new Error(`Discord API error: ${response.status} - ${errorText}`);
      }

      console.log("Discord API: Followup message created successfully");
    } catch (error) {
      console.error("Error creating followup message:", error);
      throw error;
    }
  }

  /**
   * 元のDeferred Responseを削除する
   * @param applicationId Discord Application ID
   * @param token インタラクショントークン
   */
  async deleteOriginalResponse(
    applicationId: string,
    token: string
  ): Promise<void> {
    const deleteUrl = `${this.baseUrl}/webhooks/${applicationId}/${token}/messages/@original`;

    try {
      console.log("Discord API: Deleting original response...");
      console.log("Delete URL:", deleteUrl);
      console.log("Application ID:", applicationId);
      console.log("Token length:", token?.length || 0);

      const response = await fetch(deleteUrl, {
        method: "DELETE",
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error("Failed to delete original response:", errorText);
        console.error("Response status:", response.status);
        throw new Error(`Discord API error: ${response.status} - ${errorText}`);
      }

      console.log("Discord API: Original response deleted successfully");
    } catch (error) {
      console.error("Error deleting original response:", error);
      throw error;
    }
  }
}
