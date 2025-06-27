# Discord 勤怠管理Bot 運用者向けガイド

このドキュメントは、Discord勤怠管理Botを運用する開発者・管理者向けの包括的なガイドです。

## 概要

本Botは「直接OAuth方式」を採用しており、以下の特徴があります：

- **各サーバー独立**: Discordサーバーごとに独立したGoogle Cloud Projectとスプレッドシート
- **Bot開発者の責任範囲**: Discord Bot の運用とシステム基盤の管理のみ
- **サーバー管理者の責任範囲**: 自身のサーバー用Google認証設定
- **完全分離**: サーバー間でのデータ共有や漏洩の心配なし

## Bot開発者の設定項目

Bot開発者（運用者）が管理する環境変数は最小限です：

### 必要な環境変数

```bash
# Discord Bot設定
DISCORD_PUBLIC_KEY=596ec5e4dd47e5af2c9b3044c892e305f4a0a9204325899c21d4b16d5a5cef7e
DISCORD_APPLICATION_ID=1388221578675748904
DISCORD_TOKEN=MTM4ODIyMTU3ODY3NTc0ODkwNA.GSaZIq.QP6DeTTDJbxHAuj874elG5kkDdmuOHIcObKZ6M

# 暗号化設定（32文字のランダム文字列）
ENCRYPTION_KEY=4ca64aa2a30371e413470742dbf27841

# チャンネル制限（* で全チャンネル許可）
ALLOWED_CHANNEL_IDS=*
```

### 設定しないもの（重要）

以下は各サーバー管理者が個別設定するため、**Bot開発者は設定不要**：

- `GOOGLE_CLIENT_ID` - サーバーごとに異なる
- `GOOGLE_CLIENT_SECRET` - サーバーごとに異なる
- `GOOGLE_REDIRECT_URI` - サーバーごとに異なる
- `GAS_WEB_APP_URL` - 直接OAuth方式では使用しない

## デプロイ手順

### 1. 開発環境セットアップ

```bash
# リポジトリクローン
git clone <repository-url>
cd kintai-discord-v2

# 依存関係インストール
bun install

# 設定ファイル準備
bun run setup
```

### 2. Discord Application設定

1. [Discord Developer Portal](https://discord.com/developers/applications) でアプリケーション作成
2. Bot作成 & 権限設定：
   - `applications.commands` - スラッシュコマンド
   - `bot` - 基本Bot機能
   - Scope: `bot`, `applications.commands`
   - Bot Permissions: `View Channels`, `Send Messages`, `Use Slash Commands`

3. 情報取得：
   - Application ID
   - Bot Token
   - Public Key

### 3. Cloudflare Workers設定

```bash
# KVネームスペース作成
bun run kv:setup

# 型定義生成
bun run cf-typegen

# コマンド登録
bun run register-commands
```

### 4. 本番デプロイ

```bash
# 開発環境テスト
bun run dev

# 本番デプロイ
bun run deploy

# シークレット設定（本番環境）
bun run secrets:setup
```

## 運用監視

### ログ監視

```bash
# リアルタイムログ監視
wrangler tail

# 特定の期間のログ
wrangler tail --since 1h
```

### 重要な監視項目

1. **署名検証エラー**: 不正アクセスの可能性
2. **OAuth関連エラー**: サーバー設定の問題
3. **Google API エラー**: API制限やトークン問題
4. **KV エラー**: データ整合性の問題

### エラーパターンと対処

#### 1. 署名検証エラー
```
Error: Invalid signature
```
**原因**: Discord Public Keyが間違っているか、不正なリクエスト
**対処**: 
- Public Keyを再確認
- Discord Developer Portalで最新のKeyを取得

#### 2. OAuth設定エラー
```
Error: redirect_uri_mismatch
```
**原因**: サーバー管理者のGoogle OAuth設定ミス
**対処**: 
- 該当サーバーの管理者に設定ガイドを案内
- リダイレクトURIの形式確認: `https://your-domain.workers.dev/oauth/callback`

#### 3. Google API制限
```
Error: Rate limit exceeded
```
**原因**: Google Sheets APIの使用量制限
**対処**: 
- API使用量の監視
- 必要に応じてプロジェクトのクォータ増加申請

## セキュリティ対策

### 暗号化キー管理

- **ENCRYPTION_KEY**: 32文字のランダムな文字列
- 定期的な変更（ただし既存データへの影響を考慮）
- 本番環境では必ずCloudflare Workersシークレット機能を使用

### アクセス制御

- 管理者権限チェック: Discord APIの権限ビットフィールドで厳密判定
- チャンネル制限: `ALLOWED_CHANNEL_IDS`で制御可能

### データ分離

- Guild IDベースでの完全データ分離
- サーバー間でのデータ共有なし
- 暗号化トークンもサーバーごとに独立

## スケーラビリティ対策

### Cloudflare Workers制限

- CPU時間: 10ms (無料) / 50ms (有料)
- メモリ: 128MB
- リクエスト数: 100,000/日 (無料) / 10M/月 (有料)

### Google API制限

- Sheets API: 100リクエスト/100秒/ユーザー
- Drive API: 1,000リクエスト/100秒/ユーザー

### 最適化方法

- KVキャッシュの活用
- バッチ処理の実装
- リトライ機構の調整

## トラブルシューティング

### よくある問合せ

#### 1. 「/setupコマンドが動かない」
**チェック項目**:
- Botがサーバーに招待済みか
- 必要な権限が付与されているか
- コマンド登録が完了しているか

#### 2. 「Google認証でエラーが出る」
**チェック項目**:
- リダイレクトURIの設定
- Google Cloud ProjectでのAPI有効化
- OAuth同意画面の設定

#### 3. 「データが記録されない」
**チェック項目**:
- `/status`での設定確認
- Google Sheets APIの権限
- KVアクセスの確認

### デバッグ手順

1. **ログ確認**: `wrangler tail`でリアルタイム監視
2. **設定確認**: 該当サーバーで`/status`実行
3. **手動テスト**: 設定ガイドページでOAuth状況確認
4. **KV確認**: Cloudflare Dashboardで直接確認

## 更新・メンテナンス

### 定期メンテナンス

- **毎月**: ログの確認とエラー分析
- **四半期**: 依存関係の更新
- **半年**: セキュリティレビュー

### 機能追加時の注意点

1. **後方互換性**: 既存のKVデータ構造を壊さない
2. **段階的リリース**: 開発環境での十分なテスト
3. **ドキュメント更新**: 設定ガイドの同期更新

## サポート体制

### ユーザーサポート

1. **設定ガイド**: `/setup`から案内されるページ
2. **トラブルシューティング**: README.mdの詳細説明
3. **FAQ**: よくある質問の文書化

### 開発者向けサポート

1. **技術ドキュメント**: 本ドキュメント
2. **コードコメント**: 主要な処理の詳細説明
3. **型定義**: TypeScriptでの厳密な型定義

## パフォーマンス監視

### 重要なメトリクス

- **応答時間**: Deferred Response含む全体処理時間
- **成功率**: コマンド処理の成功・失敗率
- **API使用量**: Google Sheets APIの使用状況
- **KV使用量**: ストレージとリクエスト数

### アラート設定

Cloudflare Analytics または外部監視ツールで以下を監視：

- エラー率 > 5%
- 応答時間 > 10秒
- API制限到達

## 将来の拡張計画

### 短期（1-3ヶ月）

- 管理者権限チェックの厳密化
- より詳細なエラーハンドリング
- トークンリフレッシュの自動化

### 中期（3-6ヶ月）

- ダッシュボード機能
- レポート生成機能
- 多言語対応

### 長期（6ヶ月以上）

- 他のスプレッドシートサービス対応
- Web UIの提供
- エンタープライズ機能

## まとめ

直接OAuth方式により、Bot開発者の管理負荷を大幅に軽減しながら、各サーバーの完全な独立性を実現しています。この運用ガイドに従って適切な監視とメンテナンスを行うことで、安定したサービス提供が可能です。
