import { GoogleSheetsResponse, GoogleOAuthTokens, Bindings } from "./types";
import { parseDateTimeFromJST } from "./utils";

// スプレッドシートのカラム定義を統一（新しいテーブル構造に対応）
const KINTAI_COLUMNS = {
  PROJECT: 0, // A: プロジェクト名（チャンネル名）
  USERNAME: 1, // B: ユーザー名
  WORK_HOURS: 2, // C: 差分（労働時間）
  START_TIME: 3, // D: 開始時刻
  END_TIME: 4, // E: 終了時刻
  CHANNEL_ID: 5, // F: channel_id
  DISCORD_ID: 6, // G: discord_id
  UUID: 7, // H: uuid
} as const;

// 統一されたヘッダー定義（新しいテーブル構造に対応）
const KINTAI_HEADERS = [
  "プロジェクト名",
  "ユーザー名", 
  "差分",
  "開始時刻",
  "終了時刻",
  "channel_id",
  "discord_id", 
  "uuid",
];

export class SheetsService {
  private accessToken: string;
  private env: Bindings;
  private readonly baseUrl = "https://sheets.googleapis.com/v4/spreadsheets";

  constructor(env: Bindings, accessToken?: string) {
    this.env = env;
    this.accessToken = accessToken || "";
  }

  /**
   * APIリクエストの共通ヘッダーを取得
   */
  private getHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.accessToken}`,
      "Content-Type": "application/json",
    };
  }

  /**
   * Google Sheets APIのエラーハンドリング
   */
  private async handleApiResponse(
    response: Response,
    operation: string
  ): Promise<any> {
    if (!response.ok) {
      const errorText = await response.text();
      let errorDetails = "";

      try {
        const errorData = JSON.parse(errorText);
        const errorMessage = errorData.error?.message || "unknown error";
        const errorCode = errorData.error?.code || response.status;
        errorDetails = `${errorCode}: ${errorMessage}`;

        if (errorData.error?.details) {
          errorDetails += ` (詳細: ${JSON.stringify(errorData.error.details)})`;
        }
      } catch {
        errorDetails = `${response.status} ${response.statusText}`;
      }

      console.error(`Sheets API Error (${operation}):`, {
        status: response.status,
        statusText: response.statusText,
        errorBody: errorText,
      });

      throw new Error(`${operation}に失敗しました: ${errorDetails}`);
    }
    return response.json();
  }

  /**
   * 新しいスプレッドシートを作成
   */
  async createSpreadsheet(title: string): Promise<GoogleSheetsResponse> {
    const currentMonth = new Date().toISOString().slice(0, 7); // YYYY-MM format

    const response = await fetch(this.baseUrl, {
      method: "POST",
      headers: this.getHeaders(),
      body: JSON.stringify({
        properties: {
          title: title || `勤怠管理_${currentMonth}`,
          locale: "ja_JP",
          timeZone: "Asia/Tokyo",
        },
        sheets: [
          {
            properties: {
              title: currentMonth,
              gridProperties: {
                rowCount: 1000,
                columnCount: 10,
              },
            },
          },
        ],
      }),
    });

    const data = await this.handleApiResponse(response, "スプレッドシート作成");

    // 統一されたヘッダー行を追加
    await this.setupKintaiHeaders(data.spreadsheetId, currentMonth);

    return {
      spreadsheetId: data.spreadsheetId,
      properties: data.properties,
      sheets: data.sheets,
    };
  }

  /**
   * 勤怠管理用のヘッダー行を設定（統一版）
   */
  private async setupKintaiHeaders(
    spreadsheetId: string,
    sheetTitle: string,
    sheetId: number = 0
  ): Promise<void> {
    // ヘッダー行を設定
    await this.updateRange(spreadsheetId, `${sheetTitle}!A1:H1`, [
      KINTAI_HEADERS,
    ]);

    // ヘッダー行のフォーマットを設定
    await this.formatHeaders(spreadsheetId, sheetId);
  }

  /**
   * ヘッダー行のフォーマットを設定（修正版）
   */
  private async formatHeaders(
    spreadsheetId: string,
    sheetId: number
  ): Promise<void> {
    const requests = [
      {
        repeatCell: {
          range: {
            sheetId: sheetId,
            startRowIndex: 0,
            endRowIndex: 1,
            startColumnIndex: 0,
            endColumnIndex: KINTAI_HEADERS.length,
          },
          cell: {
            userEnteredFormat: {
              backgroundColor: {
                red: 0.2,
                green: 0.4,
                blue: 0.6,
              },
              textFormat: {
                bold: true,
                foregroundColor: {
                  red: 1.0,
                  green: 1.0,
                  blue: 1.0,
                },
              },
              horizontalAlignment: "CENTER",
            },
          },
          fields:
            "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)",
        },
      },
      {
        autoResizeDimensions: {
          dimensions: {
            sheetId: sheetId,
            dimension: "COLUMNS",
            startIndex: 0,
            endIndex: KINTAI_HEADERS.length,
          },
        },
      },
    ];

    const response = await fetch(
      `${this.baseUrl}/${spreadsheetId}:batchUpdate`,
      {
        method: "POST",
        headers: this.getHeaders(),
        body: JSON.stringify({ requests }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      let errorDetails = "";
      try {
        const errorData = JSON.parse(errorText);
        errorDetails = `Google Sheets API エラー: ${
          errorData.error?.message || "unknown error"
        }`;
      } catch {
        errorDetails = `HTTP ${response.status}: ${response.statusText}`;
      }

      throw new Error(
        `ヘッダーフォーマット設定に失敗しました: ${errorDetails}`
      );
    }
  }

  /**
   * スプレッドシートに行を追加
   */
  async appendRow(
    spreadsheetId: string,
    range: string,
    values: string[][]
  ): Promise<void> {
    const response = await fetch(
      `${this.baseUrl}/${spreadsheetId}/values/${range}:append?valueInputOption=USER_ENTERED`,
      {
        method: "POST",
        headers: this.getHeaders(),
        body: JSON.stringify({ values }),
      }
    );

    await this.handleApiResponse(response, "行の追加");
  }

  /**
   * 指定範囲のセルを更新
   */
  async updateRange(
    spreadsheetId: string,
    range: string,
    values: string[][]
  ): Promise<void> {
    const response = await fetch(
      `${this.baseUrl}/${spreadsheetId}/values/${range}?valueInputOption=USER_ENTERED`,
      {
        method: "PUT",
        headers: this.getHeaders(),
        body: JSON.stringify({ values }),
      }
    );

    await this.handleApiResponse(response, "範囲の更新");
  }

  /**
   * 指定範囲の値を取得
   */
  async getRange(spreadsheetId: string, range: string): Promise<string[][]> {
    const response = await fetch(
      `${this.baseUrl}/${spreadsheetId}/values/${range}`,
      {
        method: "GET",
        headers: this.getHeaders(),
      }
    );

    const data = await this.handleApiResponse(response, "範囲の取得");
    return data.values || [];
  }

  /**
   * 特定のUUIDを持つ行を検索
   */
  async findRowByUUID(
    spreadsheetId: string,
    uuid: string
  ): Promise<number | null> {
    const currentMonth = new Date().toISOString().slice(0, 7);
    const values = await this.getRange(spreadsheetId, `${currentMonth}!A:I`);

    for (let i = 1; i < values.length; i++) {
      // ヘッダー行をスキップ
      if (values[i][8] === uuid) {
        // UUID列（I列）
        return i + 1; // 1-indexed
      }
    }

    return null;
  }

  /**
   * 特定の行を更新
   */
  async updateRow(
    spreadsheetId: string,
    rowNumber: number,
    values: string[]
  ): Promise<void> {
    const currentMonth = new Date().toISOString().slice(0, 7);
    const range = `${currentMonth}!A${rowNumber}:I${rowNumber}`;

    await this.updateRange(spreadsheetId, range, [values]);
  }

  /**
   * 勤怠管理用スプレッドシートを作成（Botセットアップ用）
   */
  async createKintaiSpreadsheet(guildId: string): Promise<{
    success: boolean;
    spreadsheetId?: string;
    spreadsheetUrl?: string;
    error?: string;
  }> {
    try {
      const currentMonth = new Date().toISOString().slice(0, 7);
      const spreadsheetTitle = `勤怠管理_${guildId}_${new Date().toLocaleDateString(
        "ja-JP"
      )}`;

      // スプレッドシートを作成
      const response = await fetch(this.baseUrl, {
        method: "POST",
        headers: this.getHeaders(),
        body: JSON.stringify({
          properties: {
            title: spreadsheetTitle,
            locale: "ja_JP",
            timeZone: "Asia/Tokyo",
          },
          sheets: [
            {
              properties: {
                title: currentMonth,
                gridProperties: {
                  rowCount: 1000,
                  columnCount: 10,
                },
              },
            },
          ],
        }),
      });

      const spreadsheetData = await this.handleApiResponse(
        response,
        "スプレッドシート作成"
      );
      const spreadsheetId = spreadsheetData.spreadsheetId;
      const spreadsheetUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}`;

      // 最初のシートのIDを取得
      const firstSheetId =
        spreadsheetData.sheets?.[0]?.properties?.sheetId || 0;

      // 統一されたヘッダー行を追加
      await this.setupKintaiHeaders(spreadsheetId, currentMonth, firstSheetId);

      return {
        success: true,
        spreadsheetId,
        spreadsheetUrl,
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
        error: `スプレッドシート作成中にエラーが発生しました: ${errorMessage}`,
      };
    }
  }

  /**
   * 勤務開始時刻を記録
   */
  async recordStartTime(
    accessToken: string,
    spreadsheetId: string,
    userId: string,
    username: string,
    projectName: string,
    channelId: string,
    startTime: Date
  ): Promise<{ success: boolean; recordId?: string; error?: string }> {
    try {
      // アクセストークンを更新
      this.accessToken = accessToken;

      const currentMonth = new Date().toISOString().slice(0, 7); // YYYY-MM
      const sheetName = currentMonth;

      // シートが存在するかチェック
      const sheetsData = await this.getSpreadsheetInfo(spreadsheetId);
      const sheetExists = sheetsData.sheets?.some(
        (sheet: any) => sheet.properties.title === sheetName
      );

      // シートが存在しない場合は作成
      if (!sheetExists) {
        await this.createMonthlySheet(spreadsheetId, sheetName);
      }

      // 日時フォーマット（完全な日時形式）
      const startTimeStr = this.formatDateTimeToJST(startTime);

      // 記録ID生成（UUID形式）
      const recordId = crypto.randomUUID();

      // データを追加（新しいテーブル構造に対応）
      const values = [
        [
          projectName, // A: プロジェクト名（チャンネル名）
          username, // B: ユーザー名
          "", // C: 差分（終了時に計算される）
          startTimeStr, // D: 開始時刻
          "", // E: 終了時刻（空のまま）
          channelId, // F: channel_id
          userId, // G: discord_id
          recordId, // H: uuid
        ],
      ];

      await this.appendRow(spreadsheetId, `${sheetName}!A:H`, values);

      return {
        success: true,
        recordId,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : typeof error === "object"
          ? JSON.stringify(error, null, 2)
          : String(error);

      console.error("Failed to record start time:", error);
      return {
        success: false,
        error: `勤務開始時刻の記録に失敗しました: ${errorMessage}`,
      };
    }
  }

  /**
   * 勤務終了時刻を記録
   */
  async recordEndTime(
    accessToken: string,
    spreadsheetId: string,
    userId: string,
    endTime: Date,
    recordId: string
  ): Promise<{ success: boolean; workHours?: string; error?: string }> {
    try {
      // アクセストークンを更新
      this.accessToken = accessToken;

      const currentMonth = new Date().toISOString().slice(0, 7); // YYYY-MM
      const sheetName = currentMonth;

      // 該当する開始記録を検索
      const range = `${sheetName}!A:H`;
      const values = await this.getRange(spreadsheetId, range);

      let targetRowIndex = -1;
      let startTimeStr = "";
      
      for (let i = 1; i < values.length; i++) {
        // ヘッダー行をスキップ
        const row = values[i];
        if (row[KINTAI_COLUMNS.UUID] === recordId && row[KINTAI_COLUMNS.END_TIME] === "") {
          // UUIDが一致し、終了時刻が空
          targetRowIndex = i + 1; // Google Sheetsは1ベース
          startTimeStr = row[KINTAI_COLUMNS.START_TIME];
          break;
        }
      }

      if (targetRowIndex === -1) {
        return {
          success: false,
          error: "対応する開始記録が見つかりません",
        };
      }

      // 終了時刻フォーマット
      const endTimeStr = this.formatDateTimeToJST(endTime);

      // 勤務時間を計算（新しい形式で）
      const workHours = this.calculateWorkHoursFromDateTime(startTimeStr, endTimeStr);

      // 終了時刻と勤務時間を更新（新しいカラム位置に対応）
      await this.updateRange(
        spreadsheetId,
        `${sheetName}!C${targetRowIndex}:E${targetRowIndex}`, // 差分、開始時刻、終了時刻
        [[workHours, startTimeStr, endTimeStr]]
      );

      return {
        success: true,
        workHours,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : typeof error === "object"
          ? JSON.stringify(error, null, 2)
          : String(error);

      console.error("Failed to record end time:", error);
      return {
        success: false,
        error: `勤務終了時刻の記録に失敗しました: ${errorMessage}`,
      };
    }
  }

  /**
   * 日時フォーマットのヘルパーメソッド
   */
  private formatDateToJST(date: Date): string {
    return date.toLocaleDateString("ja-JP", {
      timeZone: "Asia/Tokyo",
    });
  }

  private formatTimeToJST(date: Date): string {
    return date.toLocaleTimeString("ja-JP", {
      timeZone: "Asia/Tokyo",
      hour12: false,
    });
  }

  private formatDateTimeToJST(date: Date): string {
    return date.toLocaleString("ja-JP", {
      timeZone: "Asia/Tokyo",
      year: "numeric",
      month: "2-digit", 
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
  }

  /**
   * 勤務時間を計算（日時文字列から）
   */
  private calculateWorkHoursFromDateTime(startTimeStr: string, endTimeStr: string): string {
    try {
      const startTime = new Date(startTimeStr.replace(/(\d{4})\/(\d{2})\/(\d{2}) (\d{2}):(\d{2}):(\d{2})/, '$1-$2-$3T$4:$5:$6+09:00'));
      const endTime = new Date(endTimeStr.replace(/(\d{4})\/(\d{2})\/(\d{2}) (\d{2}):(\d{2}):(\d{2})/, '$1-$2-$3T$4:$5:$6+09:00'));

      const diffMs = endTime.getTime() - startTime.getTime();
      
      if (diffMs < 0) {
        return "エラー";
      }

      const hours = Math.floor(diffMs / (1000 * 60 * 60));
      const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((diffMs % (1000 * 60)) / 1000);

      return `${hours}時間${minutes}分${seconds}秒`;
    } catch (error) {
      console.error("Work hours calculation error:", error);
      return "計算エラー";
    }
  }

  /**
   * 勤務時間を計算
   */
  private calculateWorkHours(startTimeStr: string, endTimeStr: string): string {
    try {
      const today = new Date().toDateString();
      const startTime = new Date(`${today} ${startTimeStr}`);
      const endTime = new Date(`${today} ${endTimeStr}`);

      const diffMs = endTime.getTime() - startTime.getTime();
      const diffHours = diffMs / (1000 * 60 * 60);

      if (diffHours < 0) {
        return "エラー";
      }

      const hours = Math.floor(diffHours);
      const minutes = Math.floor((diffHours - hours) * 60);

      return `${hours.toString().padStart(2, "0")}:${minutes
        .toString()
        .padStart(2, "0")}`;
    } catch (error) {
      return "計算エラー";
    }
  }

  /**
   * 月次シートを作成
   */
  async createMonthlySheet(
    spreadsheetId: string,
    sheetName: string
  ): Promise<void> {
    // シートを追加
    const addSheetResponse = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          requests: [
            {
              addSheet: {
                properties: {
                  title: sheetName,
                  gridProperties: {
                    rowCount: 1000,
                    columnCount: 10,
                  },
                },
              },
            },
          ],
        }),
      }
    );

    if (!addSheetResponse.ok) {
      const errorData = await addSheetResponse.text();
      throw new Error(
        `Failed to add sheet: ${addSheetResponse.status} ${errorData}`
      );
    }

    // 統一されたヘッダー行を追加
    await this.appendRow(spreadsheetId, `${sheetName}!A1:H1`, [KINTAI_HEADERS]);
  }

  /**
   * スプレッドシート情報を取得
   */
  private async getSpreadsheetInfo(spreadsheetId: string): Promise<any> {
    const response = await fetch(`${this.baseUrl}/${spreadsheetId}`, {
      method: "GET",
      headers: this.getHeaders(),
    });

    return this.handleApiResponse(response, "スプレッドシート情報取得");
  }

  /**
   * 指定ユーザーの勤務開始済み記録をチェック（スプレッドシート直接確認）
   * KVの代わりにスプレッドシートを直接確認して再打刻を防ぐ
   */
  async checkActiveWorkSession(
    accessToken: string,
    spreadsheetId: string,
    userId: string,
    channelId: string
  ): Promise<{
    hasActiveSession: boolean;
    startTime?: string;
    recordId?: string;
    error?: string;
  }> {
    try {
      this.accessToken = accessToken;

      const currentMonth = new Date().toISOString().slice(0, 7); // YYYY-MM
      const sheetName = currentMonth;

      // シートが存在するかチェック
      const sheetsData = await this.getSpreadsheetInfo(spreadsheetId);
      const sheetExists = sheetsData.sheets?.some(
        (sheet: any) => sheet.properties.title === sheetName
      );

      if (!sheetExists) {
        // シートが存在しない場合はアクティブセッションなし
        return { hasActiveSession: false };
      }

      // 該当ユーザーの未完了記録を検索
      const range = `${sheetName}!A:H`;
      const values = await this.getRange(spreadsheetId, range);

      for (let i = 1; i < values.length; i++) {
        // ヘッダー行をスキップ
        const row = values[i];
        
        // discord_id、channel_idが一致し、終了時刻が空の記録を検索
        if (
          row[KINTAI_COLUMNS.DISCORD_ID] === userId &&
          row[KINTAI_COLUMNS.CHANNEL_ID] === channelId &&
          row[KINTAI_COLUMNS.END_TIME] === ""
        ) {
          // 開始時刻が24時間以内かチェック
          const startTimeStr = row[KINTAI_COLUMNS.START_TIME];
          if (startTimeStr) {
            const startTime = parseDateTimeFromJST(startTimeStr);
            if (startTime) {
              const now = new Date();
              const timeDiff = now.getTime() - startTime.getTime();
              const hoursDiff = timeDiff / (1000 * 60 * 60);

              if (hoursDiff <= 24) {
                // 24時間以内のアクティブセッションが存在
                return {
                  hasActiveSession: true,
                  startTime: startTimeStr,
                  recordId: row[KINTAI_COLUMNS.UUID] || undefined,
                };
              }
            }
          }
        }
      }

      return { hasActiveSession: false };
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : typeof error === "object"
          ? JSON.stringify(error, null, 2)
          : String(error);

      console.error("Failed to check active work session:", error);
      return {
        hasActiveSession: false,
        error: `アクティブセッションの確認に失敗しました: ${errorMessage}`,
      };
    }
  }

  /**
   * 指定ユーザーの未完了勤務記録を取得（終了処理用）
   * KVの代わりにスプレッドシートを直接確認
   */
  async getActiveWorkRecord(
    accessToken: string,
    spreadsheetId: string,
    userId: string,
    channelId: string
  ): Promise<{
    found: boolean;
    recordId?: string;
    startTime?: string;
    username?: string;
    projectName?: string;
    error?: string;
  }> {
    try {
      this.accessToken = accessToken;

      const currentMonth = new Date().toISOString().slice(0, 7); // YYYY-MM
      const sheetName = currentMonth;

      // シートが存在するかチェック
      const sheetsData = await this.getSpreadsheetInfo(spreadsheetId);
      const sheetExists = sheetsData.sheets?.some(
        (sheet: any) => sheet.properties.title === sheetName
      );

      if (!sheetExists) {
        return { found: false };
      }

      // 該当ユーザーの未完了記録を検索
      const range = `${sheetName}!A:H`;
      const values = await this.getRange(spreadsheetId, range);

      for (let i = 1; i < values.length; i++) {
        // ヘッダー行をスキップ
        const row = values[i];
        
        // discord_id、channel_idが一致し、終了時刻が空の記録を検索
        if (
          row[KINTAI_COLUMNS.DISCORD_ID] === userId &&
          row[KINTAI_COLUMNS.CHANNEL_ID] === channelId &&
          row[KINTAI_COLUMNS.END_TIME] === ""
        ) {
          return {
            found: true,
            recordId: row[KINTAI_COLUMNS.UUID] || undefined,
            startTime: row[KINTAI_COLUMNS.START_TIME] || undefined,
            username: row[KINTAI_COLUMNS.USERNAME] || undefined,
            projectName: row[KINTAI_COLUMNS.PROJECT] || undefined,
          };
        }
      }

      return { found: false };
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : typeof error === "object"
          ? JSON.stringify(error, null, 2)
          : String(error);

      console.error("Failed to get active work record:", error);
      return {
        found: false,
        error: `アクティブ勤務記録の取得に失敗しました: ${errorMessage}`,
      };
    }
  }
}
