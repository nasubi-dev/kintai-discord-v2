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
    operation: string,
    guildId?: string
  ): Promise<any> {
    if (!response.ok) {
      // 401エラーの場合、トークンリフレッシュを試行
      if (response.status === 401 && guildId) {
        console.log(`401エラーが発生しました。トークンをリフレッシュします (guildId: ${guildId})`);
        
        const { OAuthService } = await import('./oauth-service');
        const oauthService = new OAuthService(this.env);
        const refreshResult = await oauthService.refreshTokens(guildId);
        
        if (refreshResult.success) {
          // 新しいトークンを取得してリトライ
          const { ServerConfigService } = await import('./server-config-service');
          const serverConfigService = new ServerConfigService(this.env);
          const config = await serverConfigService.getServerConfig(guildId);
          
          if (config?.access_token) {
            this.accessToken = config.access_token;
            throw new Error('RETRY_WITH_NEW_TOKEN'); // リトライを指示
          }
        }
        
        console.error('トークンリフレッシュに失敗しました:', refreshResult.error);
      }

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
  async createSpreadsheet(title: string, guildId?: string): Promise<GoogleSheetsResponse> {
    const currentMonth = new Date().toISOString().slice(0, 7); // YYYY-MM format

    const data = await this.makeApiRequest(
      this.baseUrl,
      {
        method: "POST",
        body: JSON.stringify({
          properties: {
            title: title || `勤怠ログ管理_kintai-discord`,
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
      },
      "スプレッドシート作成",
      guildId
    );

    // 統一されたヘッダー行を追加
    await this.setupKintaiHeaders(data.spreadsheetId, currentMonth, guildId);

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
    guildId?: string,
    sheetId: number = 0
  ): Promise<void> {
    // ヘッダー行を設定
    await this.updateRange(spreadsheetId, `${sheetTitle}!A1:H1`, [
      KINTAI_HEADERS,
    ], guildId);

    // ヘッダー行のフォーマットを設定
    await this.formatHeaders(spreadsheetId, sheetId, guildId);
  }

  /**
   * ヘッダー行のフォーマットを設定（修正版）
   */
  private async formatHeaders(
    spreadsheetId: string,
    sheetId: number,
    guildId?: string
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
      // 各列の幅を設定
      {
        updateDimensionProperties: {
          range: {
            sheetId: sheetId,
            dimension: "COLUMNS",
            startIndex: 0, // A列: プロジェクト名
            endIndex: 1,
          },
          properties: {
            pixelSize: 150,
          },
          fields: "pixelSize",
        },
      },
      {
        updateDimensionProperties: {
          range: {
            sheetId: sheetId,
            dimension: "COLUMNS",
            startIndex: 1, // B列: ユーザー名
            endIndex: 2,
          },
          properties: {
            pixelSize: 120,
          },
          fields: "pixelSize",
        },
      },
      {
        updateDimensionProperties: {
          range: {
            sheetId: sheetId,
            dimension: "COLUMNS",
            startIndex: 2, // C列: 差分
            endIndex: 3,
          },
          properties: {
            pixelSize: 120,
          },
          fields: "pixelSize",
        },
      },
      {
        updateDimensionProperties: {
          range: {
            sheetId: sheetId,
            dimension: "COLUMNS",
            startIndex: 3, // D列: 開始時刻
            endIndex: 4,
          },
          properties: {
            pixelSize: 180,
          },
          fields: "pixelSize",
        },
      },
      {
        updateDimensionProperties: {
          range: {
            sheetId: sheetId,
            dimension: "COLUMNS",
            startIndex: 4, // E列: 終了時刻
            endIndex: 5,
          },
          properties: {
            pixelSize: 180,
          },
          fields: "pixelSize",
        },
      },
      {
        updateDimensionProperties: {
          range: {
            sheetId: sheetId,
            dimension: "COLUMNS",
            startIndex: 5, // F列: channel_id
            endIndex: 6,
          },
          properties: {
            pixelSize: 150,
          },
          fields: "pixelSize",
        },
      },
      {
        updateDimensionProperties: {
          range: {
            sheetId: sheetId,
            dimension: "COLUMNS",
            startIndex: 6, // G列: discord_id
            endIndex: 7,
          },
          properties: {
            pixelSize: 150,
          },
          fields: "pixelSize",
        },
      },
      {
        updateDimensionProperties: {
          range: {
            sheetId: sheetId,
            dimension: "COLUMNS",
            startIndex: 7, // H列: uuid
            endIndex: 8,
          },
          properties: {
            pixelSize: 250,
          },
          fields: "pixelSize",
        },
      },
    ];

    await this.makeApiRequest(
      `${this.baseUrl}/${spreadsheetId}:batchUpdate`,
      {
        method: "POST",
        body: JSON.stringify({ requests }),
      },
      "ヘッダーフォーマット設定",
      guildId
    );
  }

  /**
   * スプレッドシートに行を追加
   */
  async appendRow(
    spreadsheetId: string,
    range: string,
    values: string[][],
    guildId?: string
  ): Promise<void> {
    await this.makeApiRequest(
      `${this.baseUrl}/${spreadsheetId}/values/${range}:append?valueInputOption=USER_ENTERED`,
      {
        method: "POST",
        body: JSON.stringify({ values }),
      },
      "行の追加",
      guildId
    );
  }

  /**
   * 指定範囲のセルを更新
   */
  async updateRange(
    spreadsheetId: string,
    range: string,
    values: string[][],
    guildId?: string
  ): Promise<void> {
    await this.makeApiRequest(
      `${this.baseUrl}/${spreadsheetId}/values/${range}?valueInputOption=USER_ENTERED`,
      {
        method: "PUT",
        body: JSON.stringify({ values }),
      },
      "範囲の更新",
      guildId
    );
  }

  /**
   * 指定範囲の値を取得
   */
  async getRange(
    spreadsheetId: string,
    range: string,
    guildId?: string
  ): Promise<string[][]> {
    const data = await this.makeApiRequest(
      `${this.baseUrl}/${spreadsheetId}/values/${range}`,
      {
        method: "GET",
      },
      "範囲の取得",
      guildId
    );
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
      const spreadsheetTitle = `勤怠ログ管理_kintai-discord`;

      // スプレッドシートを作成
      const spreadsheetData = await this.makeApiRequest(
        this.baseUrl,
        {
          method: "POST",
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
        },
        "スプレッドシート作成",
        guildId
      );
      const spreadsheetId = spreadsheetData.spreadsheetId;
      const spreadsheetUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}`;

      // 最初のシートのIDを取得
      const firstSheetId =
        spreadsheetData.sheets?.[0]?.properties?.sheetId || 0;

      // 統一されたヘッダー行を追加
      await this.setupKintaiHeaders(spreadsheetId, currentMonth, guildId, firstSheetId);

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
    startTime: Date,
    guildId?: string
  ): Promise<{ success: boolean; recordId?: string; error?: string }> {
    try {
      // アクセストークンを更新
      this.accessToken = accessToken;

      const currentMonth = new Date().toISOString().slice(0, 7); // YYYY-MM
      const sheetName = currentMonth;

      // シートが存在するかチェック
      const sheetsData = await this.getSpreadsheetInfo(spreadsheetId, guildId);
      const sheetExists = sheetsData.sheets?.some(
        (sheet: any) => sheet.properties.title === sheetName
      );

      // シートが存在しない場合は作成
      if (!sheetExists) {
        await this.createMonthlySheet(spreadsheetId, sheetName, guildId);
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
          "", // C: 差分（後で数式を設定）
          startTimeStr, // D: 開始時刻
          "", // E: 終了時刻（空のまま）
          channelId, // F: channel_id
          userId, // G: discord_id
          recordId, // H: uuid
        ],
      ];

      await this.appendRow(spreadsheetId, `${sheetName}!A:H`, values, guildId);

      // 追加された行の番号を特定して数式を設定
      const allValues = await this.getRange(spreadsheetId, `${sheetName}!A:H`, guildId);
      let targetRowIndex = -1;

      for (let i = 1; i < allValues.length; i++) {
        const row = allValues[i];
        if (row[KINTAI_COLUMNS.UUID] === recordId) {
          targetRowIndex = i + 1; // Google Sheetsは1ベース
          break;
        }
      }

      if (targetRowIndex > 0) {
        // 差分の数式を設定
        await this.updateRange(
          spreadsheetId,
          `${sheetName}!C${targetRowIndex}`,
          [
            [
              `=IF(E${targetRowIndex}="","",HOUR(E${targetRowIndex}-D${targetRowIndex})&"時間"&MINUTE(E${targetRowIndex}-D${targetRowIndex})&"分")`,
            ],
          ]
        );
      }

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
    recordId: string,
    guildId?: string
  ): Promise<{ success: boolean; workHours?: string; error?: string }> {
    try {
      // アクセストークンを更新
      this.accessToken = accessToken;

      const currentMonth = new Date().toISOString().slice(0, 7); // YYYY-MM
      const sheetName = currentMonth;

      // 該当する開始記録を検索
      const range = `${sheetName}!A:H`;
      const values = await this.getRange(spreadsheetId, range, guildId);

      let targetRowIndex = -1;
      let startTimeStr = "";

      for (let i = 1; i < values.length; i++) {
        // ヘッダー行をスキップ
        const row = values[i];
        if (
          row[KINTAI_COLUMNS.UUID] === recordId &&
          row[KINTAI_COLUMNS.END_TIME] === ""
        ) {
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

      // 終了時刻のみを更新（差分は数式で自動計算される）
      await this.updateRange(
        spreadsheetId,
        `${sheetName}!E${targetRowIndex}`, // 終了時刻のみ
        [[endTimeStr]],
        guildId
      );

      // 差分値を取得（数式で計算された結果）
      const workHoursResult = await this.getRange(
        spreadsheetId,
        `${sheetName}!C${targetRowIndex}`,
        guildId
      );
      const workHours = workHoursResult[0]?.[0] || "計算中";

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
   * リトライ機能付きのAPIリクエスト
   */
  private async makeApiRequest(
    url: string,
    options: RequestInit,
    operation: string,
    guildId?: string,
    retryCount = 0
  ): Promise<any> {
    try {
      const response = await fetch(url, {
        ...options,
        headers: {
          ...options.headers,
          ...this.getHeaders(),
        },
      });

      return await this.handleApiResponse(response, operation, guildId);
    } catch (error) {
      if (error instanceof Error && error.message === 'RETRY_WITH_NEW_TOKEN' && retryCount < 1) {
        console.log('新しいトークンでリトライします');
        return this.makeApiRequest(url, options, operation, guildId, retryCount + 1);
      }
      throw error;
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
      hour12: false,
    });
  }

  /**
   * 勤務時間を計算（日時文字列から）
   */
  private calculateWorkHoursFromDateTime(
    startTimeStr: string,
    endTimeStr: string
  ): string {
    try {
      const startTime = new Date(
        startTimeStr.replace(
          /(\d{4})\/(\d{2})\/(\d{2}) (\d{2}):(\d{2})/,
          "$1-$2-$3T$4:$5:00+09:00"
        )
      );
      const endTime = new Date(
        endTimeStr.replace(
          /(\d{4})\/(\d{2})\/(\d{2}) (\d{2}):(\d{2})/,
          "$1-$2-$3T$4:$5:00+09:00"
        )
      );

      const diffMs = endTime.getTime() - startTime.getTime();

      if (diffMs < 0) {
        return "エラー";
      }

      const hours = Math.floor(diffMs / (1000 * 60 * 60));
      const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));

      return `${hours}時間${minutes}分`;
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
    sheetName: string,
    guildId?: string
  ): Promise<void> {
    // シートを追加
    await this.makeApiRequest(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`,
      {
        method: "POST",
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
      },
      "月次シート作成",
      guildId
    );

    // 統一されたヘッダー行を追加
    await this.appendRow(spreadsheetId, `${sheetName}!A1:H1`, [KINTAI_HEADERS], guildId);
  }

  /**
   * スプレッドシート情報を取得
   */
  private async getSpreadsheetInfo(
    spreadsheetId: string,
    guildId?: string
  ): Promise<any> {
    return this.makeApiRequest(
      `${this.baseUrl}/${spreadsheetId}`,
      {
        method: "GET",
      },
      "スプレッドシート情報取得",
      guildId
    );
  }

  /**
   * 指定ユーザーの勤務開始済み記録をチェック（スプレッドシート直接確認）
   * KVの代わりにスプレッドシートを直接確認して再打刻を防ぐ
   */
  async checkActiveWorkSession(
    accessToken: string,
    spreadsheetId: string,
    userId: string,
    channelId: string,
    guildId?: string
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
      const sheetsData = await this.getSpreadsheetInfo(spreadsheetId, guildId);
      const sheetExists = sheetsData.sheets?.some(
        (sheet: any) => sheet.properties.title === sheetName
      );

      if (!sheetExists) {
        // シートが存在しない場合はアクティブセッションなし
        return { hasActiveSession: false };
      }

      // 該当ユーザーの未完了記録を検索
      const range = `${sheetName}!A:H`;
      const values = await this.getRange(spreadsheetId, range, guildId);

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
    channelId: string,
    guildId?: string
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
      const sheetsData = await this.getSpreadsheetInfo(spreadsheetId, guildId);
      const sheetExists = sheetsData.sheets?.some(
        (sheet: any) => sheet.properties.title === sheetName
      );

      if (!sheetExists) {
        return { found: false };
      }

      // 該当ユーザーの未完了記録を検索
      const range = `${sheetName}!A:H`;
      const values = await this.getRange(spreadsheetId, range, guildId);

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
