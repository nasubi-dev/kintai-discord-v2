# Discord 勤怠管理ボット

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Version](https://img.shields.io/badge/version-2.0-blue.svg)
![Security](https://img.shields.io/badge/OAuth-2.0-green.svg)
![Platform](https://img.shields.io/badge/platform-Cloudflare%20Workers-orange.svg)

Discord を使用して勤怠管理を行うボットです。Hono フレームワークを使用して Cloudflare Workers 上で動作し、各サーバー管理者が個別に Google OAuth 2.0 認証を行うことで、データの保存には Google スプレッドシートを使用します。

## 🎉 Bot リリース対応版（直接 OAuth 方式）

このバージョンでは、Discord Bot として一般公開可能な勤怠管理システムを実装しています。各 Discord サーバーの管理者が個別に Google Cloud Project を設定し、OAuth 認証を行うことで、完全に独立したデータ管理を実現します。

### 主要機能

- **完全なマルチテナント対応**: サーバーごとに独立した Google スプレッドシート
- **簡単セットアップ**: `/setup` コマンドから始まる分かりやすい設定フロー
- **セキュリティ**: OAuth 2.0 + 暗号化トークン管理
- **自動スプレッドシート作成**: 設定時に専用シートを自動生成
- **管理者権限制御**: 管理者のみが設定変更可能

### 設定コマンド

- `/setup` - 勤怠管理システムの初期設定（管理者のみ）
  - 設定ガイドページの表示
  - Google OAuth 2.0 認証フロー
  - 自動スプレッドシート作成
  - 暗号化されたトークン管理
- `/status` - 設定状況と接続テストの確認
- `/reset` - 設定のリセット（管理者のみ）

## 機能

### 基本機能

- `/start` - 勤務開始の記録
  - 時刻指定対応: `/start time:09:00` で指定時刻での開始記録
- `/end` - 勤務終了の記録と労働時間の計算
  - 時刻指定対応: `/end time:18:00` で指定時刻での終了記録

### 管理機能

- `/setup` - システム初期設定（管理者のみ）
- `/status` - 設定状況確認と接続テスト
- `/reset` - 設定リセット（管理者のみ）

### 技術機能

- 月別シートでの自動勤怠管理
- 二重打刻防止（Cloudflare KV による高速チェック）
- 通信環境対応（Deferred Response + リトライ機能）
- スマホ対応（安定した応答システム）
- サーバー別データ分離（Guild ID ベース）
- Discord 署名検証によるセキュリティ確保
- 暗号化されたトークン管理
- ユーザー名と Discord ID の分離記録
- 日時形式での時刻記録（yyyy/MM/dd HH:mm:ss）
- リアルタイム労働時間計算
- Discord API による実際のチャンネル名取得
- KV による自動クリーンアップ（24 時間 TTL）
- JST/UTC 自動変換: 日本時間での入力を内部的に UTC で管理

## Bot として使用する場合（推奨）

この Bot は **直接 OAuth 方式** を採用しており、各サーバーの管理者が独自に Google Cloud Project を設定し、OAuth 認証を行うことで完全に独立したデータ管理を実現しています。

### 管理者向け設定手順

1. **Bot を Discord サーバーに招待**

   - 必要な権限: `View Channels`, `Send Messages`, `Use Slash Commands`
   - Bot 招待 URL: `https://discord.com/oauth2/authorize?client_id=YOUR_BOT_ID&scope=bot%20applications.commands&permissions=2147483648`

2. **初期設定の開始**

   ```
   /setup
   ```

   設定ガイドページの URL が表示されるので、そのページにアクセスして以下の手順を進めてください：

3. **Google Cloud Project の設定**

   - Google Cloud Console でプロジェクトを作成
   - Google Sheets API と Google Drive API を有効化
   - OAuth 2.0 クライアント ID を作成（ウェブアプリケーション）
   - リダイレクト URI を正しく設定

4. **OAuth 認証の完了**

   - 設定ガイドページで Client ID と Client Secret を入力
   - Google 認証を完了
   - 自動でスプレッドシートが作成されます

5. **設定確認**

   ```
   /status
   ```

   - 接続状態とスプレッドシート情報を確認

6. **利用開始**
   - すべてのメンバーが `/start` と `/end` コマンドを使用可能

### 一般ユーザー向け使用方法

```
/start          # 勤務開始
/start time:09:00  # 時刻指定での勤務開始
/end            # 勤務終了
/end time:18:00   # 時刻指定での勤務終了
```

## 技術スタック

- **Runtime:** Cloudflare Workers
- **Framework:** Hono (TypeScript)
- **Package Manager:** Bun
- **Authentication:** Discord 署名検証 + OAuth 2.0（直接 OAuth 方式）
- **Database:** Google Spreadsheet（サーバーごとに独立）
- **Cache/State:** Cloudflare KV（重複チェック・暗号化トークン管理）
- **API:** Google Sheets API（直接連携）+ Discord API
- **Security:** 暗号化トークン管理、署名検証、管理者権限制御

## 開発者向けセットアップ

### 前提条件

- Bun（パッケージマネージャー）
- Cloudflare アカウント
- Discord Developer Portal アカウント

### 0. プロジェクトのクローンと初期設定

```bash
git clone <repository-url>
cd kintai-discord-v2
bun install
bun run setup  # .env と wrangler.jsonc をテンプレートからコピー
```

### 1. Discord Application の作成

1. [Discord Developer Portal](https://discord.com/developers/applications) でアプリケーションを作成
2. Bot を作成し、必要な権限を付与：
   - `applications.commands` - スラッシュコマンドの使用
   - `bot` - 基本的な Bot 機能
   - `View Channels` - チャンネル情報の取得
3. 以下の情報を記録：
   - Application ID
   - Bot Token
   - Public Key

**重要**: チャンネル名を正しく取得するには、Bot がそのチャンネルの View Channels 権限を持っている必要があります。

### 2. 環境変数の設定（Bot 開発者向け）

Bot 開発者は、Discord 関連の情報と暗号化キーのみを設定します。Google 認証は各サーバー管理者が個別に行います。

**開発環境用**：`.dev.vars` ファイルに以下の情報を設定：

```bash
# Discord Bot設定
DISCORD_PUBLIC_KEY=your_discord_public_key_here
DISCORD_APPLICATION_ID=your_discord_application_id_here
DISCORD_TOKEN=your_discord_bot_token_here

# 暗号化設定（32文字のランダムな文字列）
ENCRYPTION_KEY=your_32_character_encryption_key_here

# チャンネル設定（* で全チャンネル許可）
ALLOWED_CHANNEL_IDS=*
```

**重要事項**:

- `.dev.vars` ファイルは Git で管理されません
- 開発時は `.dev.vars` が Wrangler により自動的に読み込まれます
- 本番環境では Cloudflare Workers のシークレット機能を使用してください
- Google OAuth の設定は各サーバー管理者が行うため、Bot 開発者は設定不要です

### 3. Cloudflare KV の設定

勤怠の重複チェックと暗号化トークン管理用に Cloudflare KV を設定します：

```bash
# KVネームスペースを作成
bun run kv:setup
```

出力された KV ネームスペース ID を `wrangler.jsonc` の `kv_namespaces` セクションに設定してください。

### 4. スラッシュコマンドの登録

環境変数を設定後、コマンドを登録：

```bash
bun run register-commands
```

### 5. デプロイ

```bash
# 開発環境での実行
bun run dev

# 本番環境へのデプロイ
bun run deploy
```

### 6. 本番環境でのシークレット設定（推奨）

開発環境では `.dev.vars` ファイルを使用しますが、本番環境では Cloudflare Workers のシークレット機能を使用することを強く推奨します：

```bash
# 自動設定スクリプト（.dev.vars の内容を使用）
bun run secrets:setup

# または手動設定
wrangler secret put DISCORD_PUBLIC_KEY
wrangler secret put DISCORD_APPLICATION_ID
wrangler secret put DISCORD_TOKEN
wrangler secret put ENCRYPTION_KEY
wrangler secret put ALLOWED_CHANNEL_IDS
```

各コマンド実行時に、対応する値を入力してください。

## 使用方法

### 初期設定（管理者のみ）

1. Discord サーバーに Bot を招待
2. 管理者が `/setup` コマンドを実行
3. 表示されたガイドページに従って Google OAuth 設定を完了
4. `/status` で設定状況を確認

### 勤怠記録（全メンバー）

任意のチャンネルで以下のコマンドを実行（全チャンネル対応）：

### 勤務開始

```
# 現在時刻で開始
/start

# 指定時刻で開始（時刻指定オプション）
/start time:09:00    # 9:00開始
/start time:0900     # 9:00開始（HHMM形式）
/start time:900      # 9:00開始（HMM形式）
/start time:09:30    # 9:30開始
```

### 勤務終了

```
# 現在時刻で終了
/end

# 指定時刻で終了（時刻指定オプション）
/end time:18:00      # 18:00終了
/end time:1800       # 18:00終了（HHMM形式）
/end time:600        # 6:00終了（HMM形式）
/end time:17:45      # 17:45終了
```

### 時刻指定機能の詳細

**対応フォーマット**:

- `HH:MM` 形式: `09:00`, `18:30`, `07:15`
- `HHMM` 形式: `0900`, `1830`, `0715`
- `HMM` 形式: `900`, `630`, `715`

**エラー処理**:

- **開始時刻（/start）**: 現在時刻より未来の時刻は指定できません
- **終了時刻（/end）**: 開始時刻より前の時刻は指定できません
- **時刻形式**: 無効な形式の場合はエラーメッセージが表示されます

**タイムゾーン**:

- 入力時刻は**日本標準時（JST）**として解釈されます
- 内部的には UTC で保存・計算され、表示時は JST に変換されます

## データ構造

Google スプレッドシートの各月別シート（yyyy-MM 形式）は以下の列を持ちます：

| 列名           | 説明                   | 例                         |
| -------------- | ---------------------- | -------------------------- |
| 日付           | 勤務日                 | 2025/06/23                 |
| ユーザー名     | Discord のユーザー名   | nasubi_dev                 |
| ユーザー ID    | Discord ユーザー ID    | 123456789012345678         |
| プロジェクト名 | チャンネル名           | general                    |
| 開始時刻       | 勤務開始時刻           | 09:00:00                   |
| 終了時刻       | 勤務終了時刻           | 17:30:15                   |
| 勤務時間       | 労働時間（自動計算）   | 8:30:15                    |
| 記録 ID        | 各レコードの一意識別子 | xxxxxxxx-xxxx-xxxx-xxxx... |

## エラーハンドリング

- **二重打刻防止**: KV で開始済み勤務をチェック。前回の勤務が終了していない状態で開始しようとした場合
- **未終了勤怠なし**: KV で開始記録をチェック。開始していない状態で終了しようとした場合
- **🆕 時刻指定エラー**:
  - 無効な時刻形式（HH:MM, HHMM, HMM 以外）
  - 開始時刻が現在時刻より未来
  - 終了時刻が開始時刻より前
- **署名検証エラー**: Discord 署名が無効な場合（セキュリティ）
- **Google Sheets API エラー**: Google Sheets API との通信に失敗した場合（自動リトライ機能付き）
- **OAuth 認証エラー**: トークンの有効期限切れや権限不足
- **KV アクセスエラー**: Cloudflare KV との通信に失敗した場合
- **ネットワークタイムアウト**: 通信環境が悪い場合の自動リトライ（最大 3 回）

## 開発

### 依存関係のインストール

```bash
bun install
```

### 開発サーバーの起動

```bash
bun run dev
```

### TypeScript の型チェック

```bash
bun run tsc --noEmit
```

### ログ監視（デバッグ用）

```bash
bun run wrangler tail
```

## トラブルシューティング

### よくある問題

1. **署名検証エラー**

   - Discord Public Key が正しく設定されているか確認
   - `wrangler.jsonc`の環境変数を再確認

2. **OAuth 認証エラー**

   - `redirect_uri_mismatch`: リダイレクト URI が正確に設定されているか確認
   - Google Cloud Project での設定と Bot ドメインが一致するか確認
   - 設定ガイドページの手順を再度確認

3. **Google Sheets API エラー**

   - OAuth トークンの有効性を `/status` で確認
   - Google Sheets API と Google Drive API が有効化されているか確認
   - スプレッドシートの共有設定を確認

4. **コマンドが表示されない**

   - Bot の権限（`applications.commands`）を確認
   - `register-commands.js`でコマンド登録が成功しているか確認

5. **データが記録されない**

   - Cloudflare Workers のログを`bun run wrangler tail`で確認
   - `/status` でサーバー設定状況を確認
   - スプレッドシートの権限設定を確認
   - KV ネームスペースの設定を確認

6. **KV 関連のエラー**

   - `wrangler.jsonc` の KV ネームスペース設定を確認
   - KV ネームスペース ID が正しく設定されているか確認
   - `bun run cf-typegen` で型定義を再生成

7. **通信エラー・タイムアウト**

   - スマホなど通信環境が悪い場合は、自動的にリトライされます
   - 処理中のメッセージが表示されてから最終結果が表示されるまでお待ちください
   - 長時間応答がない場合は、再度コマンドを実行してください

8. **設定リセットが必要な場合**
   - 管理者が `/reset` コマンドを実行
   - その後 `/setup` で再設定

### デバッグ方法

- **Cloudflare Workers**: `wrangler tail`でリアルタイムログ確認
- **Discord**: Developer Portal のインタラクション履歴確認
- **OAuth 状況**: `/status` コマンドで設定状況確認
- **Google API**: 設定ガイドページでテスト機能を使用

## アーキテクチャ

### 直接 OAuth 方式のデータフロー

```
Discord Slash Command
        ↓
Cloudflare Workers (Hono)
        ↓
Cloudflare KV (重複チェック・暗号化トークン管理)
        ↓
Google Sheets API (直接連携)
        ↓
Google Spreadsheet (サーバーごとに独立)
```

### セットアップフロー

1. **管理者が `/setup` コマンド実行**:

   - Discord → Cloudflare Workers
   - 設定ガイドページの URL 返却

2. **OAuth 認証フロー**:

   - 管理者が Google Cloud Project を設定
   - ガイドページで Client ID/Secret 入力
   - Google OAuth 認証完了
   - アクセストークン暗号化して KV に保存
   - スプレッドシート自動作成

3. **勤怠記録フロー**:
   - Discord → Cloudflare Workers
   - KV から暗号化トークン取得・復号化
   - Google Sheets API 直接呼び出し
   - サーバー専用スプレッドシートに記録

### データフロー

1. **開始時 (`/start`)**:

   - Discord → Cloudflare Workers
   - 即座に Deferred Response 返却（100ms 以内）
   - バックグラウンドで KV から暗号化トークン取得
   - KV 重複チェック (高速)
   - チェック通過 → Google Sheets API でスプレッドシート記録（10 秒タイムアウト）
   - 失敗時は最大 3 回リトライ
   - 成功 → KV に状態保存 (24 時間 TTL)
   - 最終結果を Discord に送信

2. **終了時 (`/end`)**:
   - Discord → Cloudflare Workers
   - 即座に Deferred Response 返却（100ms 以内）
   - バックグラウンドで KV から暗号化トークン取得
   - KV 存在チェック (高速)
   - チェック通過 → Google Sheets API でスプレッドシート更新（10 秒タイムアウト）
   - 失敗時は最大 3 回リトライ
   - 成功 → KV から状態削除
   - 最終結果を Discord に送信

### セキュリティ

- **Discord 署名検証**: 不正なリクエストをブロック
- **暗号化トークン管理**: OAuth トークンを AES-256-GCM で暗号化して KV に保存
- **サーバー分離**: Guild ID ベースでデータを完全分離
- **管理者権限制御**: セットアップ・リセット操作は管理者のみ実行可能
- **環境変数管理**: 機密情報の適切な管理（`.dev.vars` ファイルは Git 管理対象外）
- **本番環境セキュリティ**: Cloudflare Workers シークレット機能を使用
- **HTTPS 通信**: すべての通信でデータ暗号化
- **直接 OAuth 方式**: 各サーバーが独立した Google 認証で完全分離

### パフォーマンス最適化

- **KV 活用**: 重複チェック・トークン管理を Cloudflare KV で高速実行
- **責任分離**: KV で状態管理、Google Sheets API でデータ永続化
- **自動クリーンアップ**: 24 時間 TTL で KV を自動クリーンアップ
- **Deferred Response**: 通信環境が悪くても即座に応答（100ms 以内）
- **リトライ機構**: 失敗時の自動再試行（最大 3 回、指数バックオフ）
- **タイムアウト拡張**: Google Sheets API 通信に 10 秒のタイムアウト設定
- **詳細フィードバック**: 処理状況とエラー詳細の分かりやすい通知
- **直接 API 連携**: Google Sheets API に直接アクセス

### 機密情報の管理

- **開発環境**: `.dev.vars` ファイルを使用（Git で管理されません）
- **本番環境**: `wrangler secret` コマンドでシークレットを設定
- **暗号化トークン**: AES-256-GCM で OAuth トークンを暗号化して KV に保存
- **サーバー分離**: Guild ID をキーとして各サーバーのデータを完全分離
- **Bot 開発者**: Discord 関連情報と暗号化キーのみ管理
- **サーバー管理者**: 個別の Google Cloud Project で認証

## 今後の実装予定

### 優先度高

- **勤務状況確認コマンド**
  - `/status` のみ: 自分の勤務時間確認
  - `/status` メンション: その人の勤務時間確認
- **打刻忘れ通知**: 平日 18 時に未完了勤務をメンション通知

### 優先度中

- **勤務記録追加コマンド**
  - `/add 19:00 21:00`: 指定時間範囲で勤務記録を追加
  - `/add 2h`: 現在時間までの指定時間分を記録

### 優先度低

- **タイムゾーン対応**: 複数地域での利用対応
- **Discord 専用設定**: Bot としてリリースするために Discord だけで設定完了

### 実装予定なし

- **削除コマンド**: `/delete` - 複雑性を避けるため
- **グラフビュー**: スプレッドシートで十分
- **ダッシュボード**: スプレッドシートで十分

## ライセンス

このプロジェクトは MIT ライセンスの下で公開されています。詳細は [LICENSE](LICENSE) ファイルを参照してください。
