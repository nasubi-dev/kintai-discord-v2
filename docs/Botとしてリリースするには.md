# Discord Bot としてリリースするための構想

## 概要

現在の実装は開発者が個別に設定する必要がありますが、将来的には Discord Bot として一般公開し、ユーザーがサーバーに招待するだけで使用できるようにします。

## 現在の課題

### 1. Google Apps Script (GAS) への依存

- 各ユーザーが個別に GAS を設定する必要がある
- スプレッドシート ID の手動設定が必要
- スクリプトプロパティの設定が必要

### 2. セキュリティとスケーラビリティ

- 各ユーザーの機密情報（スプレッドシート ID）の管理
- Bot が複数のサーバーで使用される際の分離
- 認証情報の安全な管理

## 解決策

### `/setup`コマンドによる自動シート作成の実装

#### 1. 実装フローの詳細

```
1. ユーザーが Discord で `/setup` コマンドを実行
2. Bot が Google OAuth 2.0 認証 URL を生成
3. ユーザーが認証 URL をクリックして Google アカウントで認証
4. 認証完了後、Bot が自動でスプレッドシートを作成
5. 作成されたシート情報をサーバー設定として保存
6. Discord に設定完了メッセージを送信
```

#### 2. 技術実装の詳細

##### `/setup` コマンドの実装

```typescript
// src/discord-service.ts
export class DiscordService {
  async handleSetupCommand(interaction: any, env: Env): Promise<Response> {
    const guildId = interaction.guild_id;
    const userId = interaction.member.user.id;

    // 管理者権限チェック
    if (!this.hasAdminPermission(interaction.member)) {
      return this.createResponse({
        type: 4,
        data: {
          content: "❌ このコマンドを実行するには管理者権限が必要です。",
          flags: 64, // EPHEMERAL
        },
      });
    }

    // 既存設定チェック
    const existingConfig = await env.KV.get(`server:${guildId}`);
    if (existingConfig) {
      return this.createResponse({
        type: 4,
        data: {
          content:
            "⚠️ このサーバーは既に設定されています。設定をリセットする場合は `/reset` コマンドを使用してください。",
          flags: 64,
        },
      });
    }

    // OAuth URL 生成
    const oauthService = new OAuthService(env);
    const authUrl = await oauthService.generateAuthUrl(guildId, userId);

    return this.createResponse({
      type: 4,
      data: {
        content:
          `📋 **勤怠管理システムのセットアップ**\n\n` +
          `以下のリンクをクリックして Google アカウントで認証を行ってください：\n\n` +
          `🔗 [Google 認証を開始](${authUrl})\n\n` +
          `✅ 認証完了後、自動でスプレッドシートが作成されます\n` +
          `⏰ この認証リンクは10分間有効です`,
        flags: 64,
      },
    });
  }
}
```

##### OAuth サービスの実装

```typescript
// src/oauth-service.ts
export class OAuthService {
  private clientId: string;
  private clientSecret: string;
  private redirectUri: string;
  private kv: KVNamespace;

  constructor(env: Env) {
    this.clientId = env.GOOGLE_CLIENT_ID;
    this.clientSecret = env.GOOGLE_CLIENT_SECRET;
    this.redirectUri = env.GOOGLE_REDIRECT_URI;
    this.kv = env.KV;
  }

  async generateAuthUrl(guildId: string, userId: string): Promise<string> {
    // ランダムな state パラメータを生成
    const state = crypto.randomUUID();

    // state と guild 情報を一時保存（10分間）
    await this.kv.put(
      `oauth_state:${state}`,
      JSON.stringify({
        guildId,
        userId,
        timestamp: Date.now(),
      }),
      { expirationTtl: 600 }
    );

    // OAuth URL を構築
    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
      scope:
        "https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive.file",
      response_type: "code",
      access_type: "offline",
      prompt: "consent",
      state: state,
    });

    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  }

  async handleCallback(
    code: string,
    state: string
  ): Promise<{ success: boolean; guildId?: string; error?: string }> {
    try {
      // state の検証
      const stateData = await this.kv.get(`oauth_state:${state}`);
      if (!stateData) {
        return {
          success: false,
          error: "認証セッションが無効または期限切れです。",
        };
      }

      const { guildId, userId } = JSON.parse(stateData);

      // state を削除（使い回し防止）
      await this.kv.delete(`oauth_state:${state}`);

      // アクセストークンを取得
      const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          client_id: this.clientId,
          client_secret: this.clientSecret,
          code: code,
          grant_type: "authorization_code",
          redirect_uri: this.redirectUri,
        }).toString(),
      });

      const tokenData = await tokenResponse.json();

      if (!tokenResponse.ok) {
        return { success: false, error: "トークン取得に失敗しました。" };
      }

      // スプレッドシートを自動作成
      const sheetsService = new SheetsService(tokenData.access_token);
      const spreadsheetId = await sheetsService.createKintaiSpreadsheet(
        guildId
      );
      const spreadsheetUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}`;

      // 設定を暗号化して保存
      const encryptedConfig = await this.encryptConfig({
        spreadsheet_id: spreadsheetId,
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token,
        sheet_url: spreadsheetUrl,
        owner_id: userId,
        created_at: new Date().toISOString(),
      });

      await this.kv.put(`server:${guildId}`, JSON.stringify(encryptedConfig));

      // Discord に成功通知を送信
      await this.notifySetupComplete(guildId, spreadsheetUrl);

      return { success: true, guildId };
    } catch (error) {
      console.error("OAuth callback error:", error);
      return { success: false, error: "認証処理中にエラーが発生しました。" };
    }
  }

  private async notifySetupComplete(
    guildId: string,
    spreadsheetUrl: string
  ): Promise<void> {
    // Discord Webhook または Bot API を使用して通知
    // 実装は Discord API の仕様に依存
  }
}
```

##### Sheets API サービスの実装

```typescript
// src/sheets-service.ts
export class SheetsService {
  constructor(private accessToken: string) {}

  async createKintaiSpreadsheet(guildId: string): Promise<string> {
    const spreadsheetTitle = `勤怠管理_${guildId}_${new Date().toLocaleDateString(
      "ja-JP"
    )}`;

    // スプレッドシートを作成
    const createResponse = await fetch(
      "https://sheets.googleapis.com/v4/spreadsheets",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          properties: {
            title: spreadsheetTitle,
            locale: "ja_JP",
            timeZone: "Asia/Tokyo",
          },
          sheets: [
            {
              properties: {
                title: new Date().toISOString().slice(0, 7), // YYYY-MM
                gridProperties: {
                  rowCount: 1000,
                  columnCount: 10,
                },
              },
            },
          ],
        }),
      }
    );

    const spreadsheetData = await createResponse.json();
    const spreadsheetId = spreadsheetData.spreadsheetId;

    // ヘッダー行を追加
    await this.setupInitialData(spreadsheetId);

    return spreadsheetId;
  }

  private async setupInitialData(spreadsheetId: string): Promise<void> {
    const headers = [
      "タイムスタンプ",
      "ユーザーID",
      "ユーザー名",
      "アクション",
      "チャンネル名",
      "メッセージ",
      "日付",
      "時刻",
      "勤務時間",
    ];

    await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/A1:I1?valueInputOption=RAW`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          values: [headers],
        }),
      }
    );

    // ヘッダー行のフォーマットを設定
    await this.formatHeaders(spreadsheetId);
  }

  private async formatHeaders(spreadsheetId: string): Promise<void> {
    await fetch(
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
              repeatCell: {
                range: {
                  sheetId: 0,
                  startRowIndex: 0,
                  endRowIndex: 1,
                  startColumnIndex: 0,
                  endColumnIndex: 9,
                },
                cell: {
                  userEnteredFormat: {
                    backgroundColor: { red: 0.9, green: 0.9, blue: 0.9 },
                    textFormat: { bold: true },
                    horizontalAlignment: "CENTER",
                  },
                },
                fields:
                  "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)",
              },
            },
          ],
        }),
      }
    );
  }
}
```

#### 3. OAuth コールバック処理

```typescript
// src/index.ts - OAuth コールバック用のエンドポイント
app.get("/oauth/callback", async (c) => {
  const code = c.req.query("code");
  const state = c.req.query("state");
  const error = c.req.query("error");

  if (error) {
    return c.html(`
      <html>
        <body>
          <h1>❌ 認証がキャンセルされました</h1>
          <p>Discord に戻って再度 /setup コマンドを実行してください。</p>
        </body>
      </html>
    `);
  }

  if (!code || !state) {
    return c.html(`
      <html>
        <body>
          <h1>❌ 認証パラメータが不正です</h1>
          <p>Discord に戻って再度 /setup コマンドを実行してください。</p>
        </body>
      </html>
    `);
  }

  const oauthService = new OAuthService(c.env);
  const result = await oauthService.handleCallback(code, state);

  if (result.success) {
    return c.html(`
      <html>
        <body>
          <h1>✅ 設定完了！</h1>
          <p>勤怠管理システムの設定が完了しました。</p>
          <p>Discord に戻って <code>/status</code> コマンドで設定を確認できます。</p>
          <script>
            setTimeout(() => {
              window.close();
            }, 5000);
          </script>
        </body>
      </html>
    `);
  } else {
    return c.html(`
      <html>
        <body>
          <h1>❌ 設定エラー</h1>
          <p>${result.error}</p>
          <p>Discord に戻って再度 /setup コマンドを実行してください。</p>
        </body>
      </html>
    `);
  }
});
```

#### 4. 必要な環境変数

```bash
# Google OAuth 2.0 設定
GOOGLE_CLIENT_ID=your_google_client_id.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-xxxxxxxxxxxxxxxxxx
GOOGLE_REDIRECT_URI=https://your-workers-domain.workers.dev/oauth/callback

# 暗号化キー（トークン保護用）
ENCRYPTION_KEY=your_32_character_encryption_key

# Discord Bot 設定
DISCORD_APPLICATION_ID=your_discord_application_id
DISCORD_BOT_TOKEN=your_discord_bot_token
DISCORD_PUBLIC_KEY=your_discord_public_key
```

#### 5. セキュリティ考慮事項

##### トークン暗号化

```typescript
// src/crypto-service.ts
export class CryptoService {
  constructor(private encryptionKey: string) {}

  async encrypt(data: any): Promise<string> {
    const encoder = new TextEncoder();
    const dataString = JSON.stringify(data);
    const dataBuffer = encoder.encode(dataString);

    // Web Crypto API を使用した暗号化
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(this.encryptionKey),
      { name: "AES-GCM" },
      false,
      ["encrypt"]
    );

    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      dataBuffer
    );

    // IV と暗号化データを結合
    const result = new Uint8Array(iv.length + encrypted.byteLength);
    result.set(iv);
    result.set(new Uint8Array(encrypted), iv.length);

    return btoa(String.fromCharCode(...result));
  }

  async decrypt(encryptedData: string): Promise<any> {
    // 復号化の実装
  }
}
```

##### CSRF 対策

- `state` パラメータによる状態検証
- 一時的な認証セッション（10 分間の有効期限）
- ワンタイム使用の state トークン

#### 6. ユーザー体験の最適化

##### 認証フローの改善

```typescript
// レスポンシブな認証画面
const authHtml = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>勤怠管理 Bot - 認証</title>
  <style>
    body { font-family: Arial, sans-serif; text-align: center; padding: 20px; }
    .container { max-width: 500px; margin: 0 auto; }
    .success { color: #28a745; }
    .error { color: #dc3545; }
    .loading { color: #007bff; }
  </style>
</head>
<body>
  <div class="container">
    <h1>🤖 勤怠管理 Bot</h1>
    <div id="status" class="loading">
      <p>⏳ 設定を処理中です...</p>
    </div>
  </div>
  <script>
    // 認証処理の進行状況を表示
    setTimeout(() => {
      document.getElementById('status').innerHTML = 
        '<div class="success"><h2>✅ 設定完了！</h2><p>Discord に戻って /status コマンドで確認できます。</p></div>';
      setTimeout(() => window.close(), 3000);
    }, 2000);
  </script>
</body>
</html>
`;
```

#### 7. エラーハンドリング

```typescript
// 包括的なエラーハンドリング
export class SetupErrorHandler {
  static handleOAuthError(error: any): string {
    if (error.code === "access_denied") {
      return "認証がキャンセルされました。Discord で再度 /setup コマンドを実行してください。";
    }

    if (error.code === "invalid_grant") {
      return "認証コードが無効です。時間が経過した可能性があります。再度 /setup コマンドを実行してください。";
    }

    if (error.message?.includes("quota")) {
      return "Google API の利用制限に達しました。しばらく時間をおいて再試行してください。";
    }

    return "認証処理中にエラーが発生しました。管理者にお問い合わせください。";
  }

  static handleSheetsError(error: any): string {
    if (error.status === 403) {
      return "Google Sheets へのアクセス権限が不足しています。認証をやり直してください。";
    }

    if (error.status === 429) {
      return "API リクエスト制限に達しました。しばらく時間をおいて再試行してください。";
    }

    return "スプレッドシートの作成中にエラーが発生しました。";
  }
}
```

### `/setup`コマンドによる自動シート作成の利点

#### 1. ユーザビリティの向上

- **ワンクリック設定**: 複雑な手動設定が不要
- **自動化**: スプレッドシート作成からヘッダー設定まで全自動
- **即座の利用開始**: 認証完了後すぐに勤怠記録が可能

#### 2. セキュリティの強化

- **サーバー別分離**: 各 Discord サーバーで独立したシート
- **暗号化保存**: アクセストークンの安全な管理
- **最小権限**: 必要な Google API スコープのみを要求

#### 3. 管理の簡素化

- **自動メンテナンス**: トークンリフレッシュの自動化
- **設定の透明性**: `/status` コマンドで現在の設定状況を確認
- **簡単リセット**: `/reset` コマンドで設定の完全削除

この実装により、Discord Bot として一般公開可能な勤怠管理システムを構築できます。ユーザーは Bot をサーバーに招待し、`/setup` コマンド一つで Google 認証からスプレッドシート作成まで完了できるため、技術的な知識がなくても簡単に利用開始できます。

### 1. Google Sheets API 直接統合

#### OAuth 2.0 認証フロー

```
1. ユーザーが Bot をサーバーに招待
2. `/setup` コマンドで初期設定を開始
3. Google OAuth 認証 URL を提供
4. ユーザーが認証を完了
5. アクセストークンとリフレッシュトークンを安全に保存
6. スプレッドシートを自動作成
```

#### 実装方式

- **GAS 廃止**: Google Apps Script を使わず、Cloudflare Workers から直接 Google Sheets API を呼び出し
- **OAuth 2.0**: サービスアカウントではなく、ユーザーアカウントでの認証
- **自動スプレッドシート作成**: 認証完了後、Bot が自動でスプレッドシートを作成

### 2. セキュアな情報管理

#### Cloudflare KV による分離管理

```typescript
// サーバー別設定の保存構造
{
  "server:{guild_id}": {
    "spreadsheet_id": "1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms",
    "access_token": "encrypted_access_token",
    "refresh_token": "encrypted_refresh_token",
    "sheet_url": "https://docs.google.com/spreadsheets/d/...",
    "owner_id": "123456789012345678",
    "created_at": "2025-01-XX"
  }
}
```

#### 暗号化とセキュリティ

- **アクセストークン暗号化**: Cloudflare Workers の暗号化機能を使用
- **サーバー別分離**: Discord サーバー（Guild）ID ベースでデータを完全分離
- **権限管理**: サーバー管理者のみが設定変更可能

### 3. ユーザー体験の改善

#### セットアップフロー

```
1. `/setup` - 初期設定開始
   → OAuth URL とガイダンスを提供

2. Google認証完了後
   → スプレッドシート自動作成
   → 設定完了通知

3. `/status` - 設定状況確認
   → スプレッドシート URL とステータス表示
   → **接続テスト結果の詳細表示**
   → **権限状態とレコード数の確認**

4. `/reset` - 設定リセット（管理者のみ）
   → 認証情報と設定を完全削除
```

#### 接続テスト機能

`/status` コマンドで以下の詳細情報を確認可能：

```
✅ 接続正常 / ❌ 接続エラー
📊 スプレッドシート詳細
• 権限: 読み書き可能 / 読み取り専用
```

#### エラーハンドリング

- **トークン期限切れ**: 自動リフレッシュ機能
- **権限エラー**: 詳細なガイダンス提供
- **設定競合**: サーバー管理者による上書き確認
- **接続エラー**: 具体的な解決方法を表示

**主なエラーパターンと対応:**

1. **認証エラー** → リフレッシュトークンでの自動更新または再認証ガイダンス
2. **権限エラー** → スプレッドシート共有設定の確認方法を案内
3. **404 エラー** → スプレッドシート削除の可能性を通知し、再作成を提案
4. **ネットワークエラー** → 一時的な問題として再試行を促す

### 4. 技術実装

#### Google Sheets API 呼び出し

```typescript
// src/sheets-service.ts
export class SheetsService {
  constructor(private accessToken: string) {}

  async createSpreadsheet(title: string): Promise<string> {
    const response = await fetch(
      "https://sheets.googleapis.com/v4/spreadsheets",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          properties: { title },
          sheets: [
            { properties: { title: new Date().toISOString().slice(0, 7) } },
          ],
        }),
      }
    );

    const data = await response.json();
    return data.spreadsheetId;
  }

  async appendRow(spreadsheetId: string, values: string[]): Promise<void> {
    // 行追加の実装
  }

  async updateRow(
    spreadsheetId: string,
    range: string,
    values: string[]
  ): Promise<void> {
    // 行更新の実装
  }
}
```

#### OAuth 管理

```typescript
// src/oauth-service.ts
export class OAuthService {
  async generateAuthUrl(guildId: string): Promise<string> {
    const state = crypto.randomUUID();
    await this.kv.put(`oauth_state:${state}`, guildId, { expirationTtl: 600 });

    return (
      `https://accounts.google.com/o/oauth2/v2/auth?` +
      `client_id=${this.clientId}&` +
      `redirect_uri=${this.redirectUri}&` +
      `scope=https://www.googleapis.com/auth/spreadsheets&` +
      `response_type=code&` +
      `state=${state}`
    );
  }
}
```

### 5. マイグレーション計画

#### フェーズ 1: Sheets API 統合

- Google Sheets API の直接呼び出し実装
- OAuth 2.0 認証フローの構築
- 既存 GAS との並行動作

#### フェーズ 2: Bot 機能追加

- `/setup` コマンドの実装
- サーバー別設定管理
- 暗号化とセキュリティ強化

#### フェーズ 3: 一般公開準備

- Discord Bot リスト掲載
- ドキュメント整備
- サポート体制構築

#### フェーズ 4: GAS 廃止

- 完全な Sheets API 移行
- GAS コードの削除
- パフォーマンス最適化

### 6. 必要な設定値

#### 新しい環境変数

```bash
# Google OAuth 2.0
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
GOOGLE_REDIRECT_URI=https://your-workers-domain.com/oauth/callback

# 暗号化キー
ENCRYPTION_KEY=your_encryption_key_for_tokens

# Bot 設定
BOT_VERSION=public
```

### 7. セキュリティ考慮事項

#### データ保護

- **最小権限原則**: 必要最小限のスコープのみ要求
- **トークン暗号化**: アクセストークンとリフレッシュトークンの暗号化保存
- **定期的な監査**: 使用されていない設定の自動クリーンアップ

#### プライバシー

- **データ分離**: サーバー間でのデータ完全分離
- **削除権**: ユーザーによる設定とデータの完全削除機能
- **透明性**: データ使用方法の明確な説明

### 8. スケーラビリティ

#### パフォーマンス最適化

- **バッチ処理**: 複数の操作をまとめて実行
- **キャッシュ戦略**: 頻繁にアクセスされるデータのキャッシュ
- **レート制限**: Google API の制限に対する適切な制御

#### 監視とログ

- **エラー追跡**: 詳細なエラーログとアラート
- **使用状況監視**: API 使用量とパフォーマンスの監視
- **ユーザーサポート**: 問題の迅速な特定と解決

## 実装ロードマップ

### 短期目標（1-2 ヶ月）

- [x] Google Sheets API の基本実装
- [x] OAuth 2.0 認証フローの構築
- [x] セキュアなトークン管理の実装

### 中期目標（3-4 ヶ月）

- [x] `/setup` コマンドの完全実装
- [x] サーバー別設定管理の構築
- [x] 既存機能との統合テスト

### 長期目標（5-6 ヶ月）

- [ ] Discord Bot としての一般公開準備
- [ ] ドキュメントとサポート体制の整備準備
- [ ] GAS からの完全移行準備

## 結論

この構想により、Discord Bot として一般公開可能な勤怠管理システムを構築できます。ユーザーは Bot をサーバーに招待し、簡単な設定を行うだけで勤怠管理を開始できるようになります。セキュリティとプライバシーを重視し、スケーラブルなアーキテクチャを採用することで、多くのサーバーで安全に利用可能なサービスを提供できます。

## Discord Bot 権限要件

Discord Bot として一般公開する際に必要な権限とスコープについて詳しく説明します。

### 必須 Discord 権限

#### 1. Bot スコープ

```
• bot - 基本的なBot機能
• applications.commands - スラッシュコマンドの使用
```

#### 2. チャンネル権限

```
• View Channels - チャンネル情報の取得（チャンネル名取得に必要）
• Send Messages - メッセージ送信（現在は使用していないが将来的に必要）
• Use Slash Commands - スラッシュコマンドの実行
```

#### 3. サーバー権限

```
• Read Messages/View Channels - サーバー内のチャンネル一覧とメッセージ履歴の参照
```

### 推奨権限（将来の機能拡張用）

```
• Manage Messages - メッセージの編集・削除（エラー修正機能用）
• Embed Links - 埋め込みメッセージの送信（リッチな通知用）
• Add Reactions - リアクション追加（操作確認用）
```

### Discord OAuth2 URL 生成例

```
https://discord.com/api/oauth2/authorize?client_id=YOUR_CLIENT_ID&permissions=2147486720&scope=bot%20applications.commands
```

**権限計算内訳:**

- View Channels: 1024
- Send Messages: 2048
- Use Slash Commands: 2147483648
- 合計: 2147486720

### 管理者権限の検証

現在の実装では `/setup` と `/reset` コマンドで管理者権限をチェックしています：

```typescript
// 簡易的な管理者権限チェック（改善予定）
const hasAdminRole = member.roles.some(
  (role: string) => role.includes("admin") || role.includes("管理者")
);
```

**今後の改善予定:**

- Discord API を使用した正確な権限チェック
- `ADMINISTRATOR` 権限または `MANAGE_GUILD` 権限の確認
- カスタムロール設定機能

### セキュリティ考慮事項

#### 1. 最小権限の原則

- 必要最小限の権限のみを要求
- 機能に応じて権限を段階的に追加

#### 2. 権限の透明性

- ユーザーに各権限の用途を明確に説明
- プライバシーポリシーでデータ使用方法を明示

#### 3. 権限エラーの適切な処理

```typescript
// チャンネル情報取得失敗時のフォールバック
async getChannelName(channelId: string): Promise<string> {
  try {
    const channel = await this.getChannel(channelId);
    return channel?.name || `channel-${channelId.slice(-6)}`;
  } catch (error) {
    console.error("Error getting channel name:", error);
    return `channel-${channelId.slice(-6)}`;
  }
}
```

### Bot 招待時の権限設定

#### 推奨設定手順

1. **Bot 招待 URL**: 必須権限のみを含む招待 URL を提供
2. **権限説明**: 各権限の用途をユーザーに説明
3. **段階的権限**: 基本機能から順次権限を追加

#### 権限不足時の対応

- 適切なエラーメッセージの表示
- 必要な権限と設定方法の案内
- フォールバック機能の提供（可能な場合）

### Google OAuth 2.0 権限スコープ

Bot が Google Sheets にアクセスする際に必要なスコープ：

```bash
# 必須スコープ
https://www.googleapis.com/auth/spreadsheets - スプレッドシートの読み書き
https://www.googleapis.com/auth/drive.file - 作成したファイルのみの管理

# 推奨スコープ（将来的）
https://www.googleapis.com/auth/drive.metadata.readonly - ファイル情報の読み取り
```

**スコープの説明:**

- `spreadsheets`: 勤怠データの記録と取得
- `drive.file`: Bot が作成したスプレッドシートのみへのアクセス
- `drive.metadata.readonly`: ファイル存在確認とメタデータ取得

### 権限チェックリスト

#### Discord 設定確認

- [ ] Bot スコープが有効
- [ ] applications.commands が有効
- [ ] View Channels 権限が付与
- [ ] サーバーでスラッシュコマンドが表示される

#### Google OAuth 確認

- [ ] OAuth 2.0 クライアントが設定済み
- [ ] 適切なスコープが設定済み
- [ ] リダイレクト URI が正しい
- [ ] 認証フローが正常に動作

#### セキュリティ確認

- [ ] Discord 署名検証が有効
- [ ] 環境変数が適切に設定
- [ ] トークン暗号化が実装
- [ ] 管理者権限チェックが動作

### トラブルシューティング

#### よくある権限エラー

1. **「チャンネル名が取得できません」**

   - Bot に View Channels 権限がない
   - プライベートチャンネルへのアクセス権限不足

2. **「スラッシュコマンドが表示されない」**

   - applications.commands スコープが不足
   - Bot がサーバーに正しく招待されていない

3. **「管理者権限エラー」**
   - ユーザーに適切な管理者権限がない
   - ロール設定の確認が必要

#### 解決方法

- Bot を一度サーバーから削除し、正しい権限で再招待
- Discord Developer Portal で権限設定を確認
- サーバー管理者にロール設定を依頼
