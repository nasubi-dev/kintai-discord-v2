# Discord Bot エンドポイント URL 設定手順

Discord Bot のインタラクション・エンドポイント URL を設定し、署名検証を有効にする手順を説明します。

## 前提条件

- Discord Developer Portal でアプリケーションが作成済み
- Cloudflare Workers に Bot がデプロイ済み
- 環境変数（`DISCORD_PUBLIC_KEY`等）が設定済み

## 設定手順

### 1. エンドポイント URL の確認

デプロイ後に表示される Cloudflare Workers の URL を確認：

```
https://kintai-discord.r916nis1748.workers.dev
```

エンドポイント URL は以下のパスになります：

```
https://kintai-discord.r916nis1748.workers.dev/api/interactions
```

### 2. Discord Developer Portal での設定

1. [Discord Developer Portal](https://discord.com/developers/applications) にアクセス
2. あなたのアプリケーションを選択
3. 左側のメニューから **General Information** を選択
4. **Interactions Endpoint URL** フィールドに以下のURLを入力：
   ```
   https://kintai-discord.r916nis1748.workers.dev/api/interactions
   ```
5. **Save Changes** ボタンをクリック

### 3. 署名検証の自動テスト

Discord が自動的に以下のテストを実行します：

1. **PING リクエスト** をエンドポイントに送信
2. **Ed25519 署名検証** を実行
3. **PONG レスポンス** の確認

### 4. 成功確認

設定が成功すると：
- ✅ 緑色のチェックマークが表示される
- エラーメッセージが表示されない
- **Save Changes** ボタンが有効になる

### 5. 失敗時のトラブルシューティング

#### エラー: "指定されたインタラクション・エンドポイントURLを認証できませんでした"

**原因と解決策:**

1. **DISCORD_PUBLIC_KEY が間違っている**
   ```bash
   # 公開鍵を再設定
   cd /Users/k24083kk/development/kintai-discord
   bunx wrangler secret put DISCORD_PUBLIC_KEY
   ```
   
2. **エンドポイント URL が間違っている**
   - `/api/interactions` パスが含まれているか確認
   - HTTPS が使用されているか確認
   - URL にタイポがないか確認

3. **署名検証の実装問題**
   - `src/index.ts` で署名検証が有効になっているか確認
   - Ed25519 署名検証の実装が正しいか確認

#### エラー: "Missing required headers"

**原因:** Discord からの署名ヘッダーが正しく受信されていない

**解決策:**
- Cloudflare Workers のログを確認: `bunx wrangler tail`
- リクエストヘッダーが正しく処理されているか確認

#### エラー: "Invalid timestamp"

**原因:** タイムスタンプの検証に失敗

**解決策:**
- サーバー時刻が正確か確認
- タイムスタンプの許容範囲（300秒）を確認

### 6. 設定確認のテスト

#### リアルタイムログ監視

```bash
cd /Users/k24083kk/development/kintai-discord
bunx wrangler tail
```

#### 手動テスト（署名検証が有効か確認）

```bash
curl -X POST https://kintai-discord.r916nis1748.workers.dev/api/interactions \
  -H "Content-Type: application/json" \
  -d '{"type": 1}' \
  -v
```

**期待される結果:** 401 Unauthorized（署名検証が有効）

### 7. 環境変数の確認

現在設定されている環境変数を確認：

```bash
cd /Users/k24083kk/development/kintai-discord
bunx wrangler secret list
```

**必要な環境変数:**
- `DISCORD_PUBLIC_KEY`
- `DISCORD_APPLICATION_ID`
- `DISCORD_TOKEN`
- `GAS_WEB_APP_URL`
- `ALLOWED_CHANNEL_IDS`

### 8. 署名検証の仕組み

Discord は以下の方法で署名検証を行います：

1. **タイムスタンプ + リクエストボディ** を結合
2. **Ed25519 秘密鍵** で署名を生成
3. **署名をヘッダー** に含めてリクエスト送信
4. **Bot側で公開鍵** を使用して署名を検証

### 9. セキュリティ注意事項

- **DISCORD_PUBLIC_KEY** は公開鍵です（秘密鍵ではありません）
- **署名検証は必須** です（セキュリティ上の理由）
- **タイムスタンプ検証** でリプレイ攻撃を防止
- **HTTPS通信** が必須です

## 参考情報

- [Discord Developer Documentation - Interactions](https://discord.com/developers/docs/interactions/receiving-and-responding)
- [Discord Developer Documentation - Security and Authorization](https://discord.com/developers/docs/interactions/receiving-and-responding#security-and-authorization)
- [Ed25519 Signature Verification](https://ed25519.cr.yp.to/)

## 更新履歴

- 2025/06/24: 初版作成
- 署名検証の実装と設定手順を追加
