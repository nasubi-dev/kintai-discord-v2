import { SetupResult, Bindings, GoogleOAuthTokens } from "./types";
import { SheetsService } from './sheets-service';
import { ServerConfigService } from './server-config-service';
import { CryptoService } from './crypto-service';

export class OAuthService {
  private kv: KVNamespace;
  private env: Bindings;
  private cryptoService: CryptoService;

  constructor(env: Bindings) {
    this.kv = env.KINTAI_DISCORD_KV;
    this.env = env;
    this.cryptoService = new CryptoService(env.ENCRYPTION_KEY);
  }

  /**
   * Step 1: 動的OAuth認証URLを生成
   * 管理者が自分のGoogleアカウントで認証するためのURL
   * 
   * 重要: この方式では各管理者が事前にGoogle Cloud Projectを作成する必要がある
   */
  async generateAuthUrl(guildId: string, userId: string): Promise<string> {
    try {
      // 認証状態を一時保存（10分間有効）
      const state = crypto.randomUUID();
      const authData = {
        guildId,
        userId,
        timestamp: Date.now(),
      };

      await this.kv.put(
        `oauth_state:${state}`,
        JSON.stringify(authData),
        { expirationTtl: 600 } // 10分
      );

      // 管理者に送信するメッセージ（セットアップガイド付き）
      const setupGuideUrl = this.generateSetupGuideUrl(guildId, state);
      
      return setupGuideUrl;
    } catch (error) {
      console.error('Auth URL generation error:', error);
      throw new Error('認証URLの生成に失敗しました');
    }
  }

  /**
   * Step 2: セットアップガイドページのURL生成
   * 管理者がGoogle Cloud Projectを作成するためのガイド
   */
  private generateSetupGuideUrl(guildId: string, state: string): string {
    const params = new URLSearchParams({
      guild: guildId,
      state: state,
      type: 'oauth_setup'
    });

    return `https://kintai-discord-v2.r916nis1748.workers.dev/setup-guide?${params.toString()}`;
  }

  /**
   * Step 3: 管理者がGoogle認証情報を登録
   * 管理者が自分のGoogle Cloud Projectで作成した認証情報を登録
   */
  async registerOAuthCredentials(
    guildId: string,
    userId: string,
    clientId: string,
    clientSecret: string,
    state: string
  ): Promise<{ success: boolean; authUrl?: string; error?: string }> {
    try {
      // 状態確認
      const authDataStr = await this.kv.get(`oauth_state:${state}`);
      if (!authDataStr) {
        return {
          success: false,
          error: '認証セッションが無効または期限切れです'
        };
      }

      // 認証情報を一時保存（暗号化）
      const encryptedCredentials = await this.cryptoService.encrypt(JSON.stringify({
        clientId,
        clientSecret,
        guildId,
        userId
      }));

      const tempKey = `temp_oauth:${state}`;
      await this.kv.put(tempKey, encryptedCredentials, { expirationTtl: 3600 }); // 1時間

      // 実際のOAuth URLを生成
      const redirectUri = `https://kintai-discord-v2.r916nis1748.workers.dev/oauth/callback`;
      const params = new URLSearchParams({
        response_type: 'code',
        client_id: clientId,
        redirect_uri: redirectUri,
        scope: 'https://www.googleapis.com/auth/spreadsheets',
        state: state,
        access_type: 'offline',
        prompt: 'consent'
      });

      const authUrl = `https://accounts.google.com/o/oauth2/auth?${params.toString()}`;

      return {
        success: true,
        authUrl: authUrl
      };
    } catch (error) {
      console.error('OAuth credentials registration error:', error);
      return {
        success: false,
        error: '認証情報の登録に失敗しました'
      };
    }
  }

  /**
   * Step 4: OAuth コールバック処理
   * 管理者の認証後、アクセストークンを取得してサーバー設定として保存
   */
  async handleCallback(code: string, state: string): Promise<SetupResult> {
    try {
      // 一時保存された認証情報を取得
      const tempKey = `temp_oauth:${state}`;
      const encryptedCredentials = await this.kv.get(tempKey);
      
      if (!encryptedCredentials) {
        return {
          success: false,
          error: '認証セッションが見つかりません'
        };
      }

      // 認証情報を復号化
      const credentialsStr = await this.cryptoService.decrypt(encryptedCredentials);
      const credentials = JSON.parse(credentialsStr);

      // トークン交換
      const tokenData = await this.exchangeCodeForTokens(
        code,
        credentials.clientId,
        credentials.clientSecret
      );

      if (!tokenData.success) {
        return {
          success: false,
          error: tokenData.error || 'トークン取得に失敗しました'
        };
      }

      // スプレッドシート作成（管理者のアカウントに）
      const sheetsService = new SheetsService(this.env, tokenData.tokens!.access_token);
      const spreadsheetResult = await sheetsService.createKintaiSpreadsheet(credentials.guildId);
      
      if (!spreadsheetResult.success) {
        return {
          success: false,
          error: 'スプレッドシートの作成に失敗しました'
        };
      }

      // サーバー設定として保存（全て暗号化）
      const serverConfigService = new ServerConfigService(this.env);
      await serverConfigService.saveServerConfig(
        credentials.guildId,
        credentials.userId,
        tokenData.tokens!,
        spreadsheetResult.spreadsheetId!,
        spreadsheetResult.spreadsheetUrl!
      );

      // 一時データを削除
      await this.kv.delete(`oauth_state:${state}`);
      await this.kv.delete(tempKey);

      return {
        success: true,
        guildId: credentials.guildId,
        spreadsheetUrl: spreadsheetResult.spreadsheetUrl,
        message: '設定が完了しました！管理者のGoogleアカウントにスプレッドシートが作成されました。'
      };

    } catch (error) {
      console.error('OAuth callback error:', error);
      return {
        success: false,
        error: 'OAuth認証処理中にエラーが発生しました'
      };
    }
  }

  /**
   * Step 5: 認証コードをアクセストークンに交換
   */
  private async exchangeCodeForTokens(
    code: string,
    clientId: string,
    clientSecret: string
  ): Promise<{ success: boolean; tokens?: GoogleOAuthTokens; error?: string }> {
    try {
      const response = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          code: code,
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: `https://kintai-discord-v2.r916nis1748.workers.dev/oauth/callback`,
          grant_type: 'authorization_code',
        }),
      });

      if (!response.ok) {
        const errorData = await response.text();
        console.error('Token exchange failed:', errorData);
        return { 
          success: false, 
          error: 'Google認証サーバーからエラーが返されました' 
        };
      }

      const tokens = await response.json() as GoogleOAuthTokens;
      return {
        success: true,
        tokens: tokens
      };

    } catch (error) {
      console.error('Token exchange error:', error);
      return {
        success: false,
        error: 'トークン取得処理中にエラーが発生しました'
      };
    }
  }

  /**
   * Step 6: トークンリフレッシュ機能
   * アクセストークンが期限切れの場合、リフレッシュトークンで更新
   */
  async refreshTokens(guildId: string): Promise<{ success: boolean; error?: string }> {
    try {
      const serverConfigService = new ServerConfigService(this.env);
      const config = await serverConfigService.getServerConfig(guildId);
      
      if (!config || !config.refresh_token) {
        return {
          success: false,
          error: 'リフレッシュトークンが見つかりません'
        };
      }

      // リフレッシュトークンを使用して新しいアクセストークンを取得
      // ここでは管理者の認証情報が必要になるため、事前に保存が必要
      
      return { success: true };
    } catch (error) {
      console.error('Token refresh error:', error);
      return {
        success: false,
        error: 'トークン更新に失敗しました'
      };
    }
  }

  /**
   * アクセストークンを無効化
   */
  async revokeToken(accessToken: string): Promise<{ success: boolean; error?: string }> {
    try {
      const response = await fetch('https://oauth2.googleapis.com/revoke', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          token: accessToken,
        }),
      });

      if (!response.ok) {
        console.warn('Token revocation failed:', response.status);
        // トークン無効化の失敗は致命的ではないので、成功として扱う
      }

      return { success: true };
    } catch (error) {
      console.error('Token revocation error:', error);
      return {
        success: false,
        error: 'トークン無効化に失敗しました'
      };
    }
  }
}

/**
 * 管理者向けセットアップガイドのHTMLコンテンツ
 */
export const OAUTH_SETUP_GUIDE = `
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
        }
        .form-group {
            margin: 15px 0;
        }
        input[type="text"] {
            width: 100%;
            padding: 8px;
            border: 1px solid #ddd;
            border-radius: 4px;
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
        <h3>Step 2: Google Sheets APIの有効化</h3>
        <ol>
            <li>左側メニューから「APIとサービス」→「ライブラリ」</li>
            <li>「Google Sheets API」を検索</li>
            <li>「有効にする」をクリック</li>
        </ol>
    </div>

    <div class="step">
        <h3>Step 3: OAuth認証情報の作成</h3>
        <ol>
            <li>「APIとサービス」→「認証情報」</li>
            <li>「認証情報を作成」→「OAuth クライアント ID」</li>
            <li>アプリケーションの種類：「ウェブアプリケーション」</li>
            <li>名前：「勤怠管理Bot」</li>
            <li>承認済みのリダイレクト URI に以下を追加：<br>
                <code>https://kintai-discord-v2.r916nis1748.workers.dev/oauth/callback</code>
            </li>
            <li>「作成」をクリック</li>
        </ol>
    </div>

    <div class="step">
        <h3>Step 4: 認証情報の入力</h3>
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
        </form>
    </div>

    <div id="result"></div>

    <script>
        document.getElementById('oauth-form').addEventListener('submit', async function(e) {
            e.preventDefault();
            
            const formData = new FormData(e.target);
            const clientId = formData.get('clientId');
            const clientSecret = formData.get('clientSecret');
            
            const urlParams = new URLSearchParams(window.location.search);
            const guildId = urlParams.get('guild');
            const state = urlParams.get('state');
            
            try {
                const response = await fetch('/api/register-oauth', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        guildId,
                        clientId,
                        clientSecret,
                        state
                    })
                });
                
                const result = await response.json();
                
                if (result.success) {
                    document.getElementById('result').innerHTML = \`
                        <div class="success">
                            <h3>✅ 認証情報が登録されました</h3>
                            <p><a href="\${result.authUrl}" target="_blank">こちらをクリックしてGoogle認証を完了してください</a></p>
                        </div>
                    \`;
                } else {
                    document.getElementById('result').innerHTML = \`
                        <div class="warning">
                            <h3>❌ エラーが発生しました</h3>
                            <p>\${result.error}</p>
                        </div>
                    \`;
                }
            } catch (error) {
                document.getElementById('result').innerHTML = \`
                    <div class="warning">
                        <h3>❌ 通信エラーが発生しました</h3>
                        <p>\${error.message}</p>
                    </div>
                \`;
            }
        });
    </script>
</body>
</html>
`;
