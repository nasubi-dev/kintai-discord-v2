import { SetupResult, Bindings, GoogleOAuthTokens } from "./types";
import { SheetsService } from './sheets-service';
import { ServerConfigService } from './server-config-service';

/**
 * グローバルBot対応のOAuthサービス
 * 各サーバー管理者が個別にGoogle認証を行う方式
 */
export class OAuthService {
  private kv: KVNamespace;
  private env: Bindings;

  constructor(env: Bindings) {
    this.kv = env.KINTAI_DISCORD_KV;
    this.env = env;
  }

  /**
   * サーバー管理者用のOAuth認証URLを生成
   * 管理者が自分のGoogleアカウントで認証するためのURL
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

      // Google OAuth URLを生成（各サーバー管理者が自分のプロジェクトを使用）
      const params = new URLSearchParams({
        response_type: 'code',
        client_id: 'USER_WILL_SETUP_THEIR_OWN', // プレースホルダー
        redirect_uri: `https://kintai-discord-v2.r916nis1748.workers.dev/oauth/callback`,
        scope: 'https://www.googleapis.com/auth/spreadsheets',
        state: state,
        access_type: 'offline',
        prompt: 'consent'
      });

      return `https://accounts.google.com/o/oauth2/auth?${params.toString()}`;
    } catch (error) {
      console.error('Auth URL generation error:', error);
      throw new Error('認証URLの生成に失敗しました');
    }
  }

  /**
   * OAuth コールバック処理
   * 新方式：管理者が自分のGoogle Apps Scriptを設置する方式
   */
  async handleCallback(code: string, state: string): Promise<SetupResult> {
    try {
      // 状態確認
      const authDataStr = await this.kv.get(`oauth_state:${state}`);
      if (!authDataStr) {
        return {
          success: false,
          error: '認証セッションが無効または期限切れです。再度 /setup コマンドを実行してください。'
        };
      }

      const authData = JSON.parse(authDataStr);

      // セッション削除
      await this.kv.delete(`oauth_state:${state}`);

      // 新方式：Google Apps Script設置ガイドを表示
      return {
        success: true,
        message: 'Google Apps Script設置ガイドを表示します',
        spreadsheetUrl: await this.generateGASSetupGuide(authData.guildId, authData.userId),
        requiresGASSetup: true
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
   * Google Apps Script設置ガイドのURLを生成
   */
  private async generateGASSetupGuide(guildId: string, userId: string): Promise<string> {
    // セットアップガイドページのURLを返す
    const setupParams = new URLSearchParams({
      guild: guildId,
      user: userId,
      timestamp: Date.now().toString()
    });

    return `https://kintai-discord-v2.r916nis1748.workers.dev/setup-guide?${setupParams.toString()}`;
  }

  /**
   * サーバー管理者がGAS URLを登録
   */
  async registerGASUrl(
    guildId: string, 
    userId: string, 
    gasUrl: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      // GAS URLの形式チェック
      if (!gasUrl.includes('script.google.com') || !gasUrl.includes('/exec')) {
        return {
          success: false,
          error: 'Google Apps Script Web App URLの形式が正しくありません'
        };
      }

      // テスト接続
      const testResult = await this.testGASConnection(gasUrl);
      if (!testResult.success) {
        return {
          success: false,
          error: `GAS接続テストに失敗しました: ${testResult.error}`
        };
      }

      // サーバー設定として保存
      const serverConfigService = new ServerConfigService(this.env);
      await serverConfigService.saveGASConfig(guildId, userId, gasUrl);

      return { success: true };
    } catch (error) {
      console.error('GAS URL registration error:', error);
      return {
        success: false,
        error: 'GAS URL登録中にエラーが発生しました'
      };
    }
  }

  /**
   * GAS接続テスト
   */
  private async testGASConnection(gasUrl: string): Promise<{ success: boolean; error?: string }> {
    try {
      const response = await fetch(gasUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          action: 'test',
          timestamp: new Date().toISOString()
        })
      });

      if (!response.ok) {
        return {
          success: false,
          error: `HTTP ${response.status}: ${response.statusText}`
        };
      }

      const result = await response.json() as any;
      if (result && result.success) {
        return { success: true };
      } else {
        return {
          success: false,
          error: (result && result.message) || 'GASからエラーレスポンスが返されました'
        };
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'ネットワークエラー'
      };
    }
  }
}
