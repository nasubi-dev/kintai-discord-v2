import { GoogleSheetsResponse, GoogleOAuthTokens, Bindings } from "./types";

// スプレッドシートのカラム定義を統一
const KINTAI_COLUMNS = {
  DATE: 0, // A: 日付
  USERNAME: 1, // B: ユーザー名
  USER_ID: 2, // C: ユーザーID
  PROJECT: 3, // D: プロジェクト名
  START_TIME: 4, // E: 開始時刻
  END_TIME: 5, // F: 終了時刻
  WORK_HOURS: 6, // G: 勤務時間
  RECORD_ID: 7, // H: 記録ID
} as const;

// 統一されたヘッダー定義
const KINTAI_HEADERS = [
  "日付",
  "ユーザー名",
  "ユーザーID",
  "プロジェクト名",
  "開始時刻",
  "終了時刻",
  "勤務時間",
  "記録ID",
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
      const errorData = await response.text();
      console.error(`Sheets API Error (${operation}):`, {
        status: response.status,
        statusText: response.statusText,
        error: errorData,
      });
      throw new Error(
        `${operation}に失敗しました: ${response.status} ${response.statusText}`
      );
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
    sheetTitle: string
  ): Promise<void> {
    // ヘッダー行を設定
    await this.updateRange(spreadsheetId, `${sheetTitle}!A1:H1`, [
      KINTAI_HEADERS,
    ]);

    // ヘッダー行のフォーマットを設定
    await this.formatHeaders(spreadsheetId, 0); // 最初のシートのID
  }

  /**
   * ヘッダー行のフォーマットを設定（改善版）
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
      // 列幅の自動調整
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

    await this.handleApiResponse(response, "ヘッダーフォーマット設定");
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

      // 統一されたヘッダー行を追加
      await this.setupKintaiHeaders(spreadsheetId, currentMonth);

      return {
        success: true,
        spreadsheetId,
        spreadsheetUrl,
      };
    } catch (error) {
      console.error("Spreadsheet creation error:", error);
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "スプレッドシート作成中に不明なエラーが発生しました",
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

      // 日付フォーマット（統一されたJST処理）
      const dateStr = this.formatDateToJST(startTime);
      const timeStr = this.formatTimeToJST(startTime);

      // 記録ID生成
      const recordId = `${userId}_${Date.now()}`;

      // データを追加（統一されたカラム構造を使用）
      const values = [
        [
          dateStr, // A: 日付
          username, // B: ユーザー名
          userId, // C: ユーザーID
          projectName, // D: プロジェクト名
          timeStr, // E: 開始時刻
          "", // F: 終了時刻
          "", // G: 勤務時間
          recordId, // H: 記録ID
        ],
      ];

      await this.appendRow(spreadsheetId, `${sheetName}!A:H`, values);

      return {
        success: true,
        recordId,
      };
    } catch (error) {
      console.error("Failed to record start time:", error);
      return {
        success: false,
        error:
          error instanceof Error ? error.message : "記録の保存に失敗しました",
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
      for (let i = 1; i < values.length; i++) {
        // ヘッダー行をスキップ
        const row = values[i];
        if (row[7] === recordId && row[5] === "") {
          // 記録IDが一致し、終了時刻が空
          targetRowIndex = i + 1; // Google Sheetsは1ベース
          break;
        }
      }

      if (targetRowIndex === -1) {
        return {
          success: false,
          error: "対応する開始記録が見つかりません",
        };
      }

      const timeStr = endTime.toLocaleTimeString("ja-JP", {
        timeZone: "Asia/Tokyo",
        hour12: false,
      });

      // 勤務時間を計算
      const startTimeStr = values[targetRowIndex - 1][4]; // 開始時刻
      const workHours = this.calculateWorkHours(startTimeStr, timeStr);

      // 終了時刻と勤務時間を更新
      await this.updateRange(
        spreadsheetId,
        `${sheetName}!F${targetRowIndex}:G${targetRowIndex}`,
        [[timeStr, workHours]]
      );

      return {
        success: true,
        workHours,
      };
    } catch (error) {
      console.error("Failed to record end time:", error);
      return {
        success: false,
        error:
          error instanceof Error ? error.message : "記録の更新に失敗しました",
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
      console.error("Failed to calculate work hours:", error);
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
}
