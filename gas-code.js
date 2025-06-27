/**
 * Discord勤怠管理ボット用 Google Apps Script
 *
 * このスクリプトは以下の処理を行います：
 * - 月別シートの作成・管理
 * - 勤怠開始・終了の記録
 * - 労働時間の計算
 */

// スプレッドシートIDを取得（スクリプトプロパティから）
// GAS エディタで「プロジェクトの設定」→「スクリプト プロパティ」で設定してください
const SPREADSHEET_ID =
  PropertiesService.getScriptProperties().getProperty("SPREADSHEET_ID");

/**
 * デバッグ用：設定を確認する関数
 */
function debugConfiguration() {
  try {
    console.log("=== デバッグ情報 ===");
    console.log("SPREADSHEET_ID:", SPREADSHEET_ID);

    if (!SPREADSHEET_ID) {
      console.error("❌ SPREADSHEET_ID が設定されていません");
      return {
        error: "SPREADSHEET_ID が設定されていません",
        suggestion: "スクリプトプロパティに SPREADSHEET_ID を設定してください",
      };
    }

    // スプレッドシートへのアクセステスト
    const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
    console.log("✅ スプレッドシートアクセス成功");
    console.log("スプレッドシート名:", spreadsheet.getName());
    console.log("シート数:", spreadsheet.getSheets().length);

    return {
      success: true,
      spreadsheetName: spreadsheet.getName(),
      sheetCount: spreadsheet.getSheets().length,
      spreadsheetId: SPREADSHEET_ID,
    };
  } catch (error) {
    console.error("❌ デバッグエラー:", error.toString());
    return {
      error: error.toString(),
      suggestion: "スプレッドシートIDまたはアクセス権限を確認してください",
    };
  }
}

/**
 * Web Appのメインエントリポイント
 */
function doPost(e) {
  try {
    console.log("=== doPost開始 ===");
    console.log("SPREADSHEET_ID:", SPREADSHEET_ID);

    // スプレッドシートID確認
    if (!SPREADSHEET_ID) {
      console.error("❌ SPREADSHEET_ID が設定されていません");
      return ContentService.createTextOutput(
        JSON.stringify({
          success: false,
          message: "サーバー設定エラー：SPREADSHEET_ID が設定されていません",
          error: "SPREADSHEET_ID not configured",
        })
      ).setMimeType(ContentService.MimeType.JSON);
    }

    // リクエストボディを解析
    console.log("リクエストボディを解析中...");
    const requestBody = JSON.parse(e.postData.contents);
    console.log("リクエストデータ:", JSON.stringify(requestBody, null, 2));
    const {
      action,
      userId,
      username,
      channelId,
      channelName,
      projectName,
      timestamp,
    } = requestBody;

    // スプレッドシートを開く
    console.log("スプレッドシートを開いています...");
    const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
    console.log("✅ スプレッドシートアクセス成功:", spreadsheet.getName());

    // 現在の月を取得してシート名を生成
    const now = new Date(timestamp);
    const sheetName = Utilities.formatDate(
      now,
      Session.getScriptTimeZone(),
      "yyyy-MM"
    );

    // 月別シートを取得または作成
    let sheet = spreadsheet.getSheetByName(sheetName);
    if (!sheet) {
      sheet = createMonthlySheet(spreadsheet, sheetName);
    }

    let response;

    // アクションによって処理を分岐
    switch (action) {
      case "start":
        response = handleStartWork(
          sheet,
          userId,
          username,
          channelId,
          channelName,
          projectName,
          timestamp
        );
        break;
      case "end":
        response = handleEndWork(
          sheet,
          userId,
          username,
          channelId,
          channelName,
          projectName,
          timestamp
        );
        break;
      default:
        response = {
          success: false,
          message: "不明なアクションです",
        };
    }

    return ContentService.createTextOutput(
      JSON.stringify(response)
    ).setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    console.error("doPost error:", error);
    const errorResponse = {
      success: false,
      message: "サーバーエラーが発生しました",
      error: error.toString(),
    };

    return ContentService.createTextOutput(
      JSON.stringify(errorResponse)
    ).setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * 月別シートを作成
 */
function createMonthlySheet(spreadsheet, sheetName) {
  const sheet = spreadsheet.insertSheet(sheetName);

  // ヘッダー行を設定
  const headers = [
    "プロジェクト名",
    "ユーザー名",
    "差分",
    "開始時刻",
    "終了時刻",
    "channel_id",
    "discord_id",
    "uuid",
  ];

  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);

  // ヘッダー行のスタイリング
  const headerRange = sheet.getRange(1, 1, 1, headers.length);
  headerRange.setBackground("#4285f4");
  headerRange.setFontColor("white");
  headerRange.setFontWeight("bold");

  // 列幅を調整
  sheet.setColumnWidth(1, 120); // プロジェクト名
  sheet.setColumnWidth(2, 150); // ユーザー名
  sheet.setColumnWidth(3, 120); // 差分
  sheet.setColumnWidth(4, 160); // 開始時刻
  sheet.setColumnWidth(5, 160); // 終了時刻
  sheet.setColumnWidth(6, 180); // channel_id
  sheet.setColumnWidth(7, 180); // discord_id
  sheet.setColumnWidth(8, 280); // uuid

  return sheet;
}

/**
 * Discord APIからユーザー名を取得
 * @param {string} userId Discord ユーザーID
 * @returns {string} ユーザー名（取得できない場合はフォールバック名を返す）
 */
function getDiscordUsername(userId) {
  try {
    // 実際の実装では、リクエストからユーザー名を受け取るか、
    // Discord API を呼び出してユーザー名を取得する
    // 現在は簡単なフォールバック処理
    return `user_${userId.slice(-4)}`;
  } catch (error) {
    console.error("Discord username error:", error);
    return `user_${userId.slice(-4)}`;
  }
}

/**
 * 勤怠開始の処理
 * 注意: 重複チェックはKV側で行うため、GAS側では直接記録を追加します
 */
function handleStartWork(
  sheet,
  userId,
  username,
  channelId,
  channelName,
  projectName,
  timestamp
) {
  try {
    // 新しい勤怠記録を追加（重複チェックはKV側で実施済み）
    const uuid = Utilities.getUuid();
    const startTime = new Date(timestamp);

    const newRow = [
      channelName, // プロジェクト名（チャンネル名）
      username, // ユーザー名
      "", // 差分（空白）
      Utilities.formatDate(
        startTime,
        Session.getScriptTimeZone(),
        "yyyy/MM/dd HH:mm:ss"
      ), // 開始時刻
      "", // 終了時刻（空白）
      channelId, // channel_id
      userId, // discord_id
      uuid, // uuid
    ];

    sheet.appendRow(newRow);

    return {
      success: true,
      message: "勤務を開始しました",
    };
  } catch (error) {
    console.error("handleStartWork error:", error);
    return {
      success: false,
      message: "勤怠開始の処理中にエラーが発生しました",
      error: error.toString(),
    };
  }
}

/**
 * 勤怠終了の処理
 * 注意: 存在チェックはKV側で行うため、GAS側では最新の未終了レコードを直接更新します
 */
function handleEndWork(
  sheet,
  userId,
  username,
  channelId,
  channelName,
  projectName,
  timestamp
) {
  try {
    const data = sheet.getDataRange().getValues();
    const headers = data[0];

    // ヘッダーのインデックスを取得
    const discordIdIndex = headers.indexOf("discord_id");
    const startTimeIndex = headers.indexOf("開始時刻");
    const endTimeIndex = headers.indexOf("終了時刻");
    const workHoursIndex = headers.indexOf("差分");

    // 同ユーザーの最新の未終了レコードを検索（存在チェックはKV側で実施済み）
    let targetRowIndex = -1;
    for (let i = data.length - 1; i >= 1; i--) {
      // 最新から検索
      const row = data[i];
      if (row[discordIdIndex] === userId && !row[endTimeIndex]) {
        targetRowIndex = i;
        break;
      }
    }

    // KV側でチェック済みなので、通常は見つかるはずだが、念のため確認
    if (targetRowIndex === -1) {
      console.warn(
        "Warning: KV側で存在確認済みだが、GAS側で未終了レコードが見つからない"
      );
      return {
        success: false,
        message: "未終了の勤怠がありません",
      };
    }

    // 終了時刻を記録
    const endTime = new Date(timestamp);
    const startTimeStr = data[targetRowIndex][startTimeIndex];
    const startTime = new Date(startTimeStr);

    // 労働時間を計算
    const workHours = calculateWorkHours(startTime, endTime);

    // セルを更新（配列のインデックスは0から、シートの行番号は1から）
    const sheetRowIndex = targetRowIndex + 1;
    const formattedEndTime = Utilities.formatDate(
      endTime,
      Session.getScriptTimeZone(),
      "yyyy/MM/dd HH:mm:ss"
    );

    sheet.getRange(sheetRowIndex, endTimeIndex + 1).setValue(formattedEndTime);
    sheet.getRange(sheetRowIndex, workHoursIndex + 1).setValue(workHours);

    return {
      success: true,
      message: "勤務を終了しました",
      workHours: workHours,
    };
  } catch (error) {
    console.error("handleEndWork error:", error);
    return {
      success: false,
      message: "勤怠終了の処理中にエラーが発生しました",
      error: error.toString(),
    };
  }
}

/**
 * 労働時間を計算
 */
function calculateWorkHours(startTime, endTime) {
  const diffMs = endTime.getTime() - startTime.getTime();

  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
  const seconds = Math.floor((diffMs % (1000 * 60)) / 1000);

  return `${hours}時間${minutes}分${seconds}秒`;
}

/**
 * テスト用関数 - 手動でテストする場合に使用
 */
function testStartWork() {
  const testRequest = {
    action: "start",
    userId: "test_user_123",
    username: "test_user",
    channelId: "123456789012345678",
    channelName: "テストチャンネル",
    projectName: "テストプロジェクト",
    timestamp: new Date().toISOString(),
  };

  const mockEvent = {
    postData: {
      contents: JSON.stringify(testRequest),
    },
  };

  const result = doPost(mockEvent);
  console.log(result.getContent());
}

function testEndWork() {
  const testRequest = {
    action: "end",
    userId: "test_user_123",
    username: "test_user",
    channelId: "123456789012345678",
    channelName: "テストチャンネル",
    projectName: "テストプロジェクト",
    timestamp: new Date().toISOString(),
  };

  const mockEvent = {
    postData: {
      contents: JSON.stringify(testRequest),
    },
  };

  const result = doPost(mockEvent);
  console.log(result.getContent());
}

/**
 * Web App の GET リクエスト用エンドポイント（テスト用）
 */
function doGet(e) {
  try {
    const debugInfo = debugConfiguration();

    return ContentService.createTextOutput(
      JSON.stringify(
        {
          message: "Discord勤怠管理ボット GAS Web App",
          timestamp: new Date().toISOString(),
          debug: debugInfo,
        },
        null,
        2
      )
    ).setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    return ContentService.createTextOutput(
      JSON.stringify(
        {
          success: false,
          error: error.toString(),
          message: "GETリクエストでエラーが発生しました",
        },
        null,
        2
      )
    ).setMimeType(ContentService.MimeType.JSON);
  }
}
