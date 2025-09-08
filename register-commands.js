/**
 * Discord スラッシュコマンド登録スクリプト
 *
 * このスクリプトを実行してDiscordにスラッシュコマンドを登録します。
 * 使用前に .env ファイルを設定してください。
 */

// 環境変数の読み込み
import { config } from "dotenv";
config();

const DISCORD_API_BASE = "https://discord.com/api/v10";

// 環境変数から取得
const APPLICATION_ID = process.env.DISCORD_APPLICATION_ID;
const BOT_TOKEN = process.env.DISCORD_TOKEN;

/**
 * スラッシュコマンドを登録する関数
 */
async function registerCommands() {
  if (!APPLICATION_ID || !BOT_TOKEN) {
    console.error(
      "❌ Discord Application ID と Bot Token を設定してください。"
    );
    return;
  }

  // 登録するコマンドの定義
  const commands = [
    {
      name: "start",
      type: 1, // CHAT_INPUT
      description: "勤務を開始します",
      options: [
        {
          name: "time",
          description: "開始時刻を指定 (例: 09:00, 0900)",
          type: 3, // STRING
          required: false,
        },
        {
          name: "day",
          description:
            "開始日を指定 (例: 2023-03-15, 20230315, today, yesterday, -1)",
          type: 3, // STRING
          required: false,
        },
      ],
    },
    {
      name: "end",
      type: 1, // CHAT_INPUT
      description: "勤務を終了します",
      options: [
        {
          name: "todo",
          description: "やったことを記録 (例: コーディング, 会議, 資料作成)",
          type: 3, // STRING
          required: true, // 必須に変更
        },
        {
          name: "time",
          description: "終了時刻を指定 (例: 18:00, 1800)",
          type: 3, // STRING
          required: false,
        },
        {
          name: "day",
          description:
            "終了日を指定 (例: 2023-03-15, 20230315, today, yesterday, -1)",
          type: 3, // STRING
          required: false,
        },
      ],
    },
    {
      name: "init",
      type: 1, // CHAT_INPUT
      description: "勤怠管理システムを初期設定します（管理者のみ）",
    },
    {
      name: "config",
      type: 1, // CHAT_INPUT
      description: "勤怠管理システムの設定状況を確認します",
    },
    {
      name: "reset",
      type: 1, // CHAT_INPUT
      description: "勤怠管理システムの設定をリセットします（管理者のみ）",
    },
    {
      name: "status",
      type: 1, // CHAT_INPUT
      description: "今月の稼働時間統計を表示します",
      options: [
        {
          name: "user",
          description: "対象ユーザーを指定 (@ユーザー名)",
          type: 6, // USER
          required: false,
        },
        {
          name: "project",
          description:
            "対象プロジェクトを指定 (チャンネル名またはall-projects)",
          type: 3, // STRING
          required: false,
        },
      ],
    },
  ];

  try {
    console.log("🔄 Discord スラッシュコマンドを登録中...");

    const response = await fetch(
      `${DISCORD_API_BASE}/applications/${APPLICATION_ID}/commands`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bot ${BOT_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(commands),
      }
    );

    if (!response.ok) {
      const errorData = await response.text();
      throw new Error(`HTTP ${response.status}: ${errorData}`);
    }

    const result = await response.json();
    console.log("✅ スラッシュコマンドの登録が完了しました:");
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error("❌ スラッシュコマンドの登録に失敗しました:", error);
  }
}

/**
 * 既存のコマンドを確認する関数
 */
async function listCommands() {
  if (!APPLICATION_ID || !BOT_TOKEN) {
    console.error(
      "❌ Discord Application ID と Bot Token を設定してください。"
    );
    return;
  }

  try {
    const response = await fetch(
      `${DISCORD_API_BASE}/applications/${APPLICATION_ID}/commands`,
      {
        headers: {
          Authorization: `Bot ${BOT_TOKEN}`,
        },
      }
    );

    if (!response.ok) {
      const errorData = await response.text();
      throw new Error(`HTTP ${response.status}: ${errorData}`);
    }

    const commands = await response.json();
    console.log("📝 現在登録されているコマンド:");
    console.log(JSON.stringify(commands, null, 2));
  } catch (error) {
    console.error("❌ コマンドの取得に失敗しました:", error);
  }
}

// 実行部分
registerCommands(); // コマンドを登録

// export { registerCommands, listCommands };
