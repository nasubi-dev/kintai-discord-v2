// Slack用打刻システムエントリーポイント
// Cloudflare Workers + Hono + Google Sheets連携
import { Hono } from "hono";
import { cors } from "hono/cors";
import { Bindings } from "./slack-types";
import { formatDateToJST, parseDateTimeFromJST } from "./slack-utils";
import { verifySlackRequest } from "./slack-utils";
import { OAuthService } from "./slack-oauth-service";
import { ServerConfigService } from "./slack-server-config-service";
import { SheetsService } from "./slack-sheets-service";

const app = new Hono<{ Bindings: Bindings }>();

// CORS設定（必要に応じて）
app.use(
  "/api/*",
  cors({
    origin: (origin) => {
      const allowedOrigins = [
        "https://kintai-discord.nasubi.dev",
        "https://nasubi.dev",
        "https://kintai-discord-v2.nasubi.dev",
        "https://kintai-discord-v2.nasubi.dev/slack",
        "http://localhost:3000",
        "http://localhost:8080",
        "http://localhost:5173", // Vite開発サーバー
        "http://localhost:3001", // Next.js開発サーバー
      ];
      if (!origin || allowedOrigins.includes(origin)) {
        return origin || null;
      }
      if (origin && /^http:\/\/localhost:\d+$/.test(origin)) {
        return origin;
      }
      return null;
    },
    allowMethods: ["POST", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
    credentials: false,
    maxAge: 86400,
  })
);

app.post("/slack/interactions", async (c) => {
  try {
    console.log("[Slack] リクエスト受信");
    const slackSignature = c.req.header("x-slack-signature");
    const slackTimestamp = c.req.header("x-slack-request-timestamp");
    const rawBody = await c.req.text();
    console.log("[Slack] 受信リクエスト:", rawBody);
    console.log("[Slack] x-slack-signature:", slackSignature);
    console.log("[Slack] x-slack-request-timestamp:", slackTimestamp);
    if (!slackSignature || !slackTimestamp) {
      console.log("[Slack] 署名ヘッダーがありません");
      return c.json({ error: "署名ヘッダーがありません" }, 400);
    }
    const isValid = await verifySlackRequest(
      slackSignature,
      slackTimestamp,
      rawBody,
      c.env.SLACK_SIGNING_SECRET
    );
    console.log("[Slack] 署名検証結果:", isValid);
    if (!isValid) {
      console.log("[Slack] 署名検証に失敗");
      return c.json({ error: "署名検証に失敗しました" }, 401);
    }

    // application/x-www-form-urlencoded形式でパース
    const params = new URLSearchParams(rawBody);
    const command = params.get("command");
    console.log("[Slack] コマンド:", command);

    switch (command) {
      case "/start":
        return await handleSlackStartCommand(c, params);
      case "/end":
        return await handleSlackEndCommand(c, params);
      case "/init":
        return await handleSlackInitCommand(c, params);
      case "/config":
        return await handleSlackConfigCommand(c, params);
      case "/reset":
        return await handleSlackResetCommand(c, params);
      default:
        console.log("[Slack] 未対応コマンド:", command);
        return c.json({ text: "❌ 未対応のコマンドです。" });
    }
  } catch (error) {
    console.error("[Slack] コマンド処理エラー:", error);
    return c.json({ text: "❌ エラーが発生しました。" }, 500);
  }
});

// Google Sheets連携初期化コマンド
async function handleSlackInitCommand(c: any, body: any) {
  try {
    // SlackユーザーID・チームID取得
    const userId = body.get("user_id");
    const teamId = body.get("team_id");
    if (!userId || !teamId) {
      return c.json({ text: "❌ Slackユーザー情報の取得に失敗しました。" });
    }

    // 既に設定済みかチェック（KVやDBで管理する場合はここで判定）
    // 例: const hasConfig = await c.env.KINTAI_SLACK_KV.get(`slack_sheet_config:${teamId}`);
    // if (hasConfig) {
    //   return c.json({ text: "⚠️ 既に設定が完了しています。設定を変更したい場合は /reset コマンドで一度リセットしてください。" });
    // }

    // OAuth認証URL生成
    const oauthService = new OAuthService(c.env);
    const state = `${teamId}:${userId}`;
    const authUrl = await oauthService.generateAuthUrl(teamId, userId);

    // セットアップガイドページURL生成
    const guideUrl = `https://kintai-discord-v2.nasubi.dev/slack/init-guide?team=${teamId}&state=${encodeURIComponent(
      state
    )}&type=oauth_init`;

    return c.json({
      text: `🔧 勤怠管理システム初期設定
Google スプレッドシートとの連携設定を行います。

1. 下記のリンクをクリックしてGoogle認証を完了してください
2. 認証完了後、自動でスプレッドシートが作成されます
3. /config コマンドで設定を確認できます

**🔗 認証リンク**
${authUrl}

セットアップガイド: ${guideUrl}

⚠️ 注意事項
- 管理者のみがこの設定を行えます
- Google アカウントでスプレッドシートの作成権限が必要です
- 認証リンクは10分間有効です`,
    });
  } catch (error) {
    console.error("[Slack] /init 初期化エラー:", error);
    return c.json({
      text: "❌ 初期化処理中にエラーが発生しました。管理者にお問い合わせください。",
    });
  }
}

async function handleSlackConfigCommand(c: any, body: any) {
  // 設定処理
  // ...実装...
}

async function handleSlackResetCommand(c: any, body: any) {
  // リセット処理
  // ...実装...
}

// Slackコマンド受信エンドポイント
// Slack用 /end コマンドハンドラ
async function handleSlackEndCommand(c: any, body: any) {
  try {
    // Slackパラメータ取得
    const userId = body.get("user_id");
    const channelId = body.get("channel_id");
    const teamId = body.get("team_id");
    const todoString = body.get("text")?.trim();
    const customTimeString = body.get("time") || undefined;
    const customDateString = body.get("day") || undefined;

    if (!userId || !channelId || !teamId) {
      return c.json({
        response_type: "ephemeral",
        text: "❌ Slackユーザー情報の取得に失敗しました。",
      });
    }
    if (!todoString) {
      return c.json({
        response_type: "ephemeral",
        text: "❌ `todo` パラメータは必須です。やったことを記録してください。\n\n例: /end todo:コーディング",
      });
    }

    // サーバー設定確認
    const serverConfigService = new ServerConfigService(c.env);
    const serverConfig = await serverConfigService.getServerConfig(teamId);
    if (!serverConfig) {
      return c.json({
        response_type: "ephemeral",
        text: "❌ チーム設定が見つかりません。管理者に /init コマンドの実行を依頼してください。",
      });
    }

    // 勤務記録チェック
    const sheetsService = new SheetsService(c.env);
    const activeWorkRecord = await sheetsService.getActiveWorkRecord(
      serverConfig.access_token,
      serverConfig.spreadsheet_id,
      userId,
      channelId,
      teamId
    );
    if (activeWorkRecord.error) {
      return c.json({
        response_type: "ephemeral",
        text: `❌ 勤務記録の確認に失敗しました\n\n**エラー**: ${activeWorkRecord.error}`,
      });
    }
    if (!activeWorkRecord.found || !activeWorkRecord.recordId) {
      return c.json({
        response_type: "ephemeral",
        text: "❌ まだ勤務を開始していません\n\n先に /start コマンドで開始してください。",
      });
    }

    // 終了時刻の決定
    let endTime: Date;
    if (customTimeString || customDateString) {
      endTime = new Date(); // TODO: 実際はパース関数を使う
    } else {
      endTime = new Date();
    }

    // 終了時刻が開始時刻より前でないかチェック
    if (activeWorkRecord.startTime) {
      const startTime = parseDateTimeFromJST(activeWorkRecord.startTime);
      if (!startTime) {
        return c.json({
          response_type: "ephemeral",
          text: "❌ 開始時刻の形式が不正です。管理者にお問い合わせください。",
        });
      }
      if (endTime.getTime() < startTime.getTime()) {
        return c.json({
          response_type: "ephemeral",
          text: `❌ 終了時刻が開始時刻より前になっています。\n開始時刻: ${
            activeWorkRecord.startTime
          }\n終了時刻: ${endTime.toLocaleString("ja-JP", {
            timeZone: "Asia/Tokyo",
          })}\n正しい終了時刻を指定してください。`,
        });
      }
    }

    // 勤務終了記録
    const endResult = await sheetsService.recordEndTime(
      serverConfig.access_token,
      serverConfig.spreadsheet_id,
      userId,
      endTime,
      activeWorkRecord.recordId,
      todoString,
      teamId
    );

    if (endResult.success) {
      let workDuration = endResult.workHours || "計算中...";
      if (activeWorkRecord.startTime) {
        const startTime = new Date(activeWorkRecord.startTime);
        const duration = endTime.getTime() - startTime.getTime();
        const hours = Math.floor(duration / (1000 * 60 * 60));
        const minutes = Math.floor((duration % (1000 * 60 * 60)) / (1000 * 60));
        workDuration = endResult.workHours || `${hours}時間${minutes}分`;
      }
      return c.json({
        response_type: "in_channel",
        text: `✅ 勤務を終了しました！お疲れ様でした！\n\n⏰ 労働時間: ${workDuration}\n📝 やったこと: ${todoString}`,
      });
    } else {
      return c.json({
        response_type: "ephemeral",
        text: `❌ 勤務終了の記録に失敗しました\n\n**エラー**: ${endResult.error}`,
      });
    }
  } catch (error) {
    console.error("Slack /end コマンドエラー:", error);
    return c.json({
      response_type: "ephemeral",
      text: "❌ 勤務終了処理中にエラーが発生しました。しばらく待ってから再試行してください。",
    });
  }
}
// Slack用 /start コマンドハンドラ
async function handleSlackStartCommand(c: any, body: any) {
  try {
    // Slackパラメータ取得
    const userId = body.get("user_id");
    const channelId = body.get("channel_id");
    const teamId = body.get("team_id");
    const customTimeString = body.get("time") || undefined;
    const customDateString = body.get("day") || undefined;

    if (!userId || !channelId || !teamId) {
      return c.json({
        response_type: "ephemeral",
        text: "❌ Slackユーザー情報の取得に失敗しました。",
      });
    }

    // サーバー設定確認
    const serverConfigService = new ServerConfigService(c.env);
    const isConfigured = await serverConfigService.hasServerConfig(teamId);
    if (!isConfigured) {
      return c.json({
        response_type: "ephemeral",
        text: "❌ チームが設定されていません。管理者に /init コマンドの実行を依頼してください。",
      });
    }

    const serverConfig = await serverConfigService.getServerConfig(teamId);
    if (!serverConfig) {
      return c.json({
        response_type: "ephemeral",
        text: "❌ チーム設定が見つかりません。管理者に /init コマンドの実行を依頼してください。",
      });
    }

    // 勤務開始の重複チェック
    const sheetsService = new SheetsService(c.env);
    const activeSessionCheck = await sheetsService.checkActiveWorkSession(
      serverConfig.access_token,
      serverConfig.spreadsheet_id,
      userId,
      channelId,
      teamId
    );
    if (activeSessionCheck.error) {
      return c.json({
        response_type: "ephemeral",
        text: `❌ 勤務状態の確認に失敗しました\n\n**エラー**: ${activeSessionCheck.error}`,
      });
    }
    if (activeSessionCheck.hasActiveSession) {
      return c.json({
        response_type: "ephemeral",
        text: `❌ 既に勤務を開始しています\n\n**開始時刻**: ${activeSessionCheck.startTime}\n\n先に /end コマンドで終了してください。`,
      });
    }

    // 勤務開始記録
    let startTime: Date;
    if (customTimeString || customDateString) {
      // JSTパース関数（必要ならutils.ts等から流用）
      startTime = new Date(); // TODO: 実際はパース関数を使う
    } else {
      startTime = new Date();
    }

    const username = userId; // Slackはユーザー名取得APIが必要。ここではIDで代用
    const displayChannelName = channelId; // Slackはチャンネル名取得APIが必要。ここではIDで代用

    const startResult = await sheetsService.recordStartTime(
      serverConfig.access_token,
      serverConfig.spreadsheet_id,
      userId,
      username,
      displayChannelName,
      channelId,
      startTime,
      teamId
    );

    if (startResult.success) {
      return c.json({
        response_type: "in_channel",
        text: `✅ 勤務を開始しました！\n\n📍 チャンネル: ${displayChannelName}\n⏰ 開始時刻: ${formatDateToJST(
          startTime
        )}`,
      });
    } else {
      return c.json({
        response_type: "ephemeral",
        text: `❌ 勤務開始の記録に失敗しました\n\n**エラー**: ${startResult.error}`,
      });
    }
  } catch (error) {
    console.error("Slack /start コマンドエラー:", error);
    return c.json({
      response_type: "ephemeral",
      text: "❌ 勤務開始処理中にエラーが発生しました。しばらく待ってから再試行してください。",
    });
  }
}

// OAuthコールバックエンドポイント (html)
app.get("/slack/oauth/callback", async (c) => {
  try {
    let code: string | null = null;
    let state: string | null = null;
    let error: string | null = null;
    if (c.req.method === "POST") {
      const body = await c.req.parseBody();
      code = typeof body["code"] === "string" ? body["code"] : null;
      state = typeof body["state"] === "string" ? body["state"] : null;
      error = typeof body["error"] === "string" ? body["error"] : null;
    } else {
      const url = new URL(c.req.url);
      code = url.searchParams.get("code");
      state = url.searchParams.get("state");
      error = url.searchParams.get("error");
    }
    if (error) {
      console.error("Slack OAuth error:", error);
      return c.html(`
        <html>
          <head><title>認証エラー</title><meta charset="UTF-8"></head>
          <body>
            <h1 style="color:#dc3545">❌ 認証がキャンセルされました</h1>
            <p>Slackに戻って再度 /init コマンドを実行してください。</p>
          </body>
        </html>
      `);
    }
    if (!code || !state) {
      return c.html(`
        <html>
          <head><title>認証エラー</title><meta charset="UTF-8"></head>
          <body>
            <h1 style="color:#dc3545">❌ 認証パラメータが不正です</h1>
            <p>Slackに戻って再度 /init コマンドを実行してください。</p>
          </body>
        </html>
      `);
    }
    const oauthService = new OAuthService(c.env);
    const result = await oauthService.handleCallback(code, state);
    // ...必要に応じて実装...
    return c.html(`
      <html>
        <head><title>認証完了</title><meta charset="UTF-8"></head>
        <body>
          <h1 style="color:#28a745">✅ 認証完了！</h1>
          <p>Slack認証が
          正常に完了しました。必要に応じて /config コマンドで設定を確認できます。</p>
          <p><a href="${result.spreadsheetUrl}" target="_blank">📊 スプレッドシートを開く</a></p>
              <p>Discord に戻って <code>/config</code> コマンドで設定を確認できます。</p>
              <script>
                setTimeout(() => {
                  window.close();
                }, 5000);
              </script>
        </body>
      </html>
    `);
  } catch (error) {
    console.error("Slack OAuth callback error:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return c.html(`
      <html>
        <head><title>認証エラー</title><meta charset="UTF-8"></head>
        <body>
          <h1 style="color:#dc3545">❌ 認証エラー</h1>
          <p>${errorMessage}。Slackに戻って再度 /init コマンドを実行してください。</p>
        </body>
      </html>
    `);
  }
});

// OAuthコールバックエンドポイント (html)
app.get("/slack/oauth/install-callback", async (c) => {
  try {
    const url = new URL(c.req.url);
    const code = url.searchParams.get("code");
    // const state = url.searchParams.get("state");
    const error = url.searchParams.get("error");
    if (error) {
      console.error("Slack OAuth install error:", error);
      return c.html(`
        <html>
          <head><title>インストールキャンセル</title><meta charset="UTF-8"></head>
          <body>
            <h1 style="color:#dc3545">❌ インストールがキャンセルされました</h1>
            <p>Slack Appのインストールが中断されました。</p>
          </body>
        </html>
      `);
    }
    if (!code) {
      return c.html(`
        <html>
          <head><title>インストールエラー</title><meta charset="UTF-8"></head>
          <body>
            <h1 style="color:#dc3545">❌ インストールエラー</h1>
            <p>認証パラメータが不正です。Slackに戻って再度 /init コマンドを実行してください。</p>
          </body>
        </html>
      `);
    }
    const tokenRes = await fetch("https://slack.com/api/oauth.v2.access", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        code,
        client_id: c.env.SLACK_CLIENT_ID,
        client_secret: c.env.SLACK_CLIENT_SECRET,
        redirect_uri:
          "https://kintai-discord-v2.nasubi.dev/slack/oauth/callback",
      }),
    });
    const tokenJson = (await tokenRes.json()) as any;
    if (!tokenJson.ok) {
      return c.html(`
        <html>
          <head><title>トークン取得エラー</title><meta charset="UTF-8"></head>
          <body>
            <h1 style="color:#dc3545">❌ トークン取得エラー</h1>
            <p>Slack APIからアクセストークンの取得に失敗しました。</p>
          </body>
        </html>
      `);
    }
    // KVにアクセストークン・リフレッシュトークンを保存
    try {
      // KV登録形式: slack_bot_token:TEAM_ID, slack_refresh_token:TEAM_ID
      await c.env.KINTAI_SLACK_KV.put(
        `slack_bot_token:${tokenJson.team.id}`,
        tokenJson.access_token
      );
      if (tokenJson.refresh_token) {
        await c.env.KINTAI_SLACK_KV.put(
          `slack_refresh_token:${tokenJson.team.id}`,
          tokenJson.refresh_token
        );
      }
    } catch (kvError) {
      console.error("KV保存エラー:", kvError);
      return c.html(`
        <html>
          <head><title>KV保存エラー</title><meta charset="UTF-8"></head>
          <body>
            <h1 style="color:#dc3545">❌ KV保存エラー</h1>
            <p>アクセストークンの保存に失敗しました。</p>
          </body>
        </html>
      `);
    }
    return c.html(`
      <html>
        <head><title>インストール完了</title><meta charset="UTF-8"></head>
        <body>
          <h1 style="color:#28a745">✅ インストール完了！</h1>
          <p>Slack Appのインストールが正常に完了し、トークンを保存しました。</p>
        </body>
      </html>
    `);
  } catch (error) {
    console.error("Slack OAuth install callback error:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return c.html(`
      <html>
        <head><title>インストールエラー</title><meta charset="UTF-8"></head>
        <body>
          <h1 style="color:#dc3545">❌ インストールエラー</h1>
          <p>${errorMessage}。管理者にお問い合わせください。</p>
        </body>
      </html>
    `);
  }
});

// セットアップガイドページ
app.get("/slack/init-guide", async (c) => {
  const url = new URL(c.req.url);
  const teamId = url.searchParams.get("team");
  const state = url.searchParams.get("state");
  const type = url.searchParams.get("type");

  if (!teamId || !state || type !== "oauth_init") {
    return c.html(`
      <html>
        <head><title>無効なリクエスト</title></head>
        <body>
          <h1>❌ 無効なリクエストです</h1>
          <p>slackに戻って /init コマンドを再実行してください。</p>
        </body>
      </html>
    `);
  }

  // セットアップガイドHTML（直接OAuth方式用）
  return c.html(`
    <!DOCTYPE html>
    <html lang="ja">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>勤怠管理Bot - Google認証設定</title>
        <style>
            body { 
                font-family: Arial, sans-serif; 
                max-width: 800px; 
                margin: 0 auto; 
                padding: 20px; 
                line-height: 1.6;
            }
            .step { 
                background: #f5f5f5; 
                padding: 15px; 
                margin: 10px 0; 
                border-radius: 5px; 
            }
            .warning { 
                background: #fff3cd; 
                border: 1px solid #ffeaa7; 
                padding: 10px; 
                border-radius: 5px; 
            }
            .success { 
                background: #d4edda; 
                border: 1px solid #c3e6cb; 
                padding: 10px; 
                border-radius: 5px; 
            }
            code { 
                background: #e9ecef; 
                padding: 2px 4px; 
                border-radius: 3px; 
                word-break: break-all;
            }
            .form-group {
                margin: 15px 0;
            }
            input[type="text"] {
                width: 100%;
                padding: 8px;
                border: 1px solid #ddd;
                border-radius: 4px;
                box-sizing: border-box;
            }
            button {
                background: #007bff;
                color: white;
                padding: 10px 20px;
                border: none;
                border-radius: 4px;
                cursor: pointer;
            }
            button:hover {
                background: #0056b3;
            }
            .loading {
                display: none;
            }
        </style>
    </head>
    <body>
        <h1>🔧 勤怠管理Bot - Google認証設定</h1>
        
        <div class="warning">
            <h3>⚠️ 重要な注意事項</h3>
            <p>この設定により、<strong>あなたのGoogleアカウント</strong>にスプレッドシートが作成されます。</p>
            <p>勤怠データはあなたのGoogle Driveに保存され、Botの開発者はアクセスできません。</p>
        </div>

        <h2>📋 設定手順</h2>
        
        <div class="step">
            <h3>Step 1: Google Cloud Projectの作成</h3>
            <ol>
                <li><a href="https://console.cloud.google.com/" target="_blank">Google Cloud Console</a>にアクセス</li>
                <li>新しいプロジェクトを作成（または既存のプロジェクトを選択）</li>
                <li>プロジェクト名: 例）「勤怠管理Bot用」</li>
            </ol>
        </div>

        <div class="step">
            <h3>Step 2: OAuth同意画面の設定</h3>
            <ol>
                <li>「APIとサービス」→「OAuth同意画面」</li>
                <li>User Type: 「外部」を選択して「作成」をクリック</li>
                <li>アプリ情報を入力：
                    <ul>
                        <li>アプリ名: 「勤怠管理Bot」わかりやすい名前をつけてください</li>
                        <li>ユーザーサポートメール: あなたのGmailアドレス</li>
                        <li>デベロッパーの連絡先情報: あなたのGmailアドレス</li>
                    </ul>
                </li>
                <li>「保存して次へ」をクリック</li>
                <li>スコープ画面: 何も追加せず「保存して次へ」をクリック</li>
                <li>テストユーザー画面: あなたのGmailアドレスを追加して「保存して次へ」</li>
                <li>概要画面: 「ダッシュボードに戻る」をクリック</li>
            </ol>
            <div class="warning">
                <p><strong>注意:</strong> 初回設定時は「テスト」状態です。</p>
            </div>
        </div>

        <div class="step">
            <h3>Step 3: Google Sheets APIの有効化</h3>
            <ol>
                <li>左側メニューから「APIとサービス」→「ライブラリ」</li>
                <li>「Google Sheets API」を検索</li>
                <li>「有効にする」をクリック</li>
            </ol>
        </div>

        <div class="step">
            <h3>Step 4: OAuth認証情報の作成</h3>
            <ol>
                <li>「APIとサービス」→「認証情報」</li>
                <li>「認証情報を作成」→「OAuth クライアント ID」</li>
                <li>アプリケーションの種類：「ウェブアプリケーション」</li>
                <li>名前：「勤怠管理Bot」</li>
                <li><strong>⚠️ 重要：</strong> 承認済みのリダイレクト URI に以下を<strong>正確に</strong>追加：<br>
                    <code style="font-size: 14px; background: #f8f9fa; padding: 8px; display: block; margin: 5px 0; border: 2px solid #007bff;">https://kintai-discord-v2.nasubi.dev/slack/oauth/callback</code>
                    <div style="background: #fff3cd; padding: 8px; margin: 5px 0; border-radius: 4px; font-size: 12px;">
                        <strong>注意:</strong> このURLを<strong>完全に一致</strong>するように入力してください。スペースや余分な文字があるとエラーになります。
                    </div>
                </li>
                <li>「作成」をクリック</li>
            </ol>
        </div>

        <div class="step">
            <h3>Step 5: 認証情報の入力</h3>
            <p>作成されたクライアント ID とクライアント シークレットを以下に入力してください：</p>
            
            <form id="oauth-form">
                <div class="form-group">
                    <label for="client-id">クライアント ID:</label>
                    <input type="text" id="client-id" name="clientId" placeholder="例: 123456789-abcdef.apps.googleusercontent.com" required>
                </div>
                
                <div class="form-group">
                    <label for="client-secret">クライアント シークレット:</label>
                    <input type="text" id="client-secret" name="clientSecret" placeholder="例: GOCSPX-abcdefghijklmnop" required>
                </div>
                
                <button type="submit">認証を開始</button>
                <div class="loading" id="loading">処理中...</div>
            </form>
        </div>

        <div class="step">
            <h3>🔧 トラブルシューティング</h3>
            <div style="background: #f8d7da; border: 1px solid #f5c6cb; padding: 10px; border-radius: 4px;">
                <h4>❌ "redirect_uri_mismatch" エラーが出る場合:</h4>
                <ol>
                    <li>Google Cloud Console の認証情報設定を再確認</li>
                    <li>リダイレクトURIが以下と<strong>完全に一致</strong>しているか確認：<br>
                        <code style="background: #fff; padding: 4px;">https://kintai-discord-v2.nasubi.dev/slack/oauth/callback</code>
                    </li>
                    <li>設定を保存後、数分待ってから再試行</li>
                    <li>ブラウザのキャッシュをクリアしてから再試行</li>
                </ol>
            </div>
            <div style="background: #d1ecf1; border: 1px solid #bee5eb; padding: 10px; border-radius: 4px; margin-top: 10px;">
                <h4>💡 確認のコツ:</h4>
                <ul>
                    <li>リダイレクトURIをコピー&ペーストで入力することを推奨</li>
                    <li>末尾にスペースや改行が入っていないか確認</li>
                    <li>HTTPSであることを確認（HTTPではない）</li>
                </ul>
            </div>
        </div>

        <div id="result"></div>

        <script>
            document.getElementById('oauth-form').addEventListener('submit', async function(e) {
                e.preventDefault();
                
                const submitButton = e.target.querySelector('button[type="submit"]');
                const loading = document.getElementById('loading');
                
                submitButton.style.display = 'none';
                loading.style.display = 'block';
                
                const formData = new FormData(e.target);
                const clientId = formData.get('clientId');
                const clientSecret = formData.get('clientSecret');
                
                try {
                    const response = await fetch('/slack/api/register-oauth', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify({
                            teamId: '${teamId}',
                            clientId,
                            clientSecret,
                            state: '${state}'
                        })
                    });
                    
                    const result = await response.json();
                    
                    if (result.success) {
                        document.getElementById('result').innerHTML = \`
                            <div class="success">
                                <h3>✅ 認証情報が登録されました</h3>
                                <p><a href="\${result.authUrl}" target="_blank">こちらをクリックしてGoogle認証を完了してください</a></p>
                                <p>認証完了後、slackに戻って勤怠管理が利用できます。</p>
                            </div>
                        \`;
                    } else {
                        document.getElementById('result').innerHTML = \`
                            <div class="warning">
                                <h3>❌ エラーが発生しました</h3>
                                <p>\${result.error}</p>
                            </div>
                        \`;
                        submitButton.style.display = 'block';
                    }
                } catch (error) {
                    document.getElementById('result').innerHTML = \`
                        <div class="warning">
                            <h3>❌ 通信エラーが発生しました</h3>
                            <p>\${error.message}</p>
                        </div>
                    \`;
                    submitButton.style.display = 'block';
                } finally {
                    loading.style.display = 'none';
                }
            });
        </script>
    </body>
    </html>
  `);
});

// OAuth認証情報登録API
app.post("/slack/api/register-oauth", async (c) => {
  try {
    const { teamId, clientId, clientSecret, state } = await c.req.json();
    console.log("[register-oauth] 受信値:", {
      teamId,
      clientId,
      clientSecret,
      state,
    });

    const body = await c.req.json();
    console.log("[register-oauth] 受信body:", body);
    console.log("[register-oauth] teamId:", teamId, "type:", typeof teamId);
    console.log(
      "[register-oauth] clientId:",
      clientId,
      "type:",
      typeof clientId
    );
    console.log(
      "[register-oauth] clientSecret:",
      clientSecret,
      "type:",
      typeof clientSecret
    );
    console.log("[register-oauth] state:", state, "type:", typeof state);

    const missing = [];
    if (typeof teamId !== "string" || teamId === "") missing.push("teamId");
    if (typeof clientId !== "string" || clientId === "")
      missing.push("clientId");
    if (typeof clientSecret !== "string" || clientSecret === "")
      missing.push("clientSecret");
    if (typeof state !== "string" || state === "") missing.push("state");
    if (missing.length > 0) {
      return c.json({
        success: false,
        error: `必要なパラメータが不足しています: ${missing.join(", ")}`,
      });
    }

    const oauthService = new OAuthService(c.env);
    const result = await oauthService.registerOAuthCredentials(
      teamId,
      "", // userIdは後で取得
      clientId,
      clientSecret,
      state
    );

    return c.json(result);
  } catch (error) {
    console.error("OAuth registration error:", error);
    return c.json({
      success: false,
      error: "OAuth認証情報の登録に失敗しました",
    });
  }
});

export default app;
