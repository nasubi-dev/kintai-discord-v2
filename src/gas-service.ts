import { GASRequest, GASResponse } from "./types";

/**
 * Google Apps Scriptとの通信を行うサービスクラス
 */
export class GASService {
  private gasUrl: string;
  private timeout: number;

  constructor(gasUrl: string, timeout: number = 10000) {
    this.gasUrl = gasUrl;
    this.timeout = timeout; // デフォルト10秒に延長
  }

  /**
   * 勤怠開始をGASに送信
   * @param userId Discord ユーザーID
   * @param username Discord ユーザー名
   * @param channelId チャンネルID
   * @param channelName チャンネル名
   * @param customTimestamp カスタムタイムスタンプ（省略時は現在時刻）
   * @returns GASからのレスポンス
   */
  async startWork(
    userId: string,
    username: string,
    channelId: string,
    channelName: string,
    customTimestamp?: string
  ): Promise<GASResponse> {
    console.log("GASService.startWork called");
    console.log("GAS URL:", this.gasUrl);
    console.log("User ID:", userId);
    console.log("Username:", username);
    console.log("Channel ID:", channelId);
    console.log("Channel Name:", channelName);
    console.log("Custom timestamp:", customTimestamp);

    const timestamp = customTimestamp || new Date().toISOString();

    const request: GASRequest = {
      action: "start",
      userId,
      username,
      channelId,
      channelName,
      projectName: channelName, // プロジェクト名はチャンネル名を使用
      timestamp,
      customTime: customTimestamp, // カスタム時刻を追加
    };

    console.log("GAS request:", JSON.stringify(request, null, 2));
    return await this.sendRequest(request);
  }

  /**
   * 勤怠終了をGASに送信
   * @param userId Discord ユーザーID
   * @param username Discord ユーザー名
   * @param channelId チャンネルID
   * @param channelName チャンネル名
   * @param customTimestamp カスタムタイムスタンプ（省略時は現在時刻）
   * @returns GASからのレスポンス
   */
  async endWork(
    userId: string,
    username: string,
    channelId: string,
    channelName: string,
    customTimestamp?: string
  ): Promise<GASResponse> {
    const timestamp = customTimestamp || new Date().toISOString();

    const request: GASRequest = {
      action: "end",
      userId,
      username,
      channelId,
      channelName,
      projectName: channelName, // プロジェクト名はチャンネル名を使用
      timestamp,
      customTime: customTimestamp, // カスタム時刻を追加
    };

    return await this.sendRequest(request);
  }

  /**
   * GASにHTTPリクエストを送信
   * @param request リクエストデータ
   * @returns GASからのレスポンス
   */
  private async sendRequest(request: GASRequest): Promise<GASResponse> {
    console.log("GASService.sendRequest called");
    console.log("Sending request to GAS:", this.gasUrl);

    try {
      console.log("Making fetch request...");

      // タイムアウト付きのfetchリクエスト
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout); // 设定されたタイムアウト値を使用

      const response = await fetch(this.gasUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(request),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      console.log("Fetch response status:", response.status);
      console.log("Fetch response ok:", response.ok);

      if (!response.ok) {
        const errorText = await response.text();
        console.error("HTTP error response:", errorText);
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      console.log("Parsing JSON response...");
      const data = (await response.json()) as GASResponse;
      console.log("GAS response data:", JSON.stringify(data, null, 2));
      return data;
    } catch (error) {
      console.error("GAS request failed:", error);
      console.error(
        "Error details:",
        error instanceof Error ? error.stack : "No stack available"
      );

      // タイムアウトエラーの場合
      if (error instanceof Error && error.name === "AbortError") {
        return {
          success: false,
          message: `通信タイムアウトが発生しました（${
            this.timeout / 1000
          }秒）。ネットワーク状況を確認してください。`,
          error: "Request timeout",
        };
      }

      return {
        success: false,
        message:
          "サーバーエラーが発生しました。しばらく待ってから再試行してください。",
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }
}
