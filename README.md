# Discord 勤怠管理ボット

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Version](https://img.shields.io/badge/version-2.0-green.svg)

Discord のスラッシュコマンドを使用して勤怠管理を行うボットです。Hono フレームワークを使用して Cloudflare Workers 上で動作し、データの保存には Google スプレッドシートを使用します。

## 機能

- `/start` - 勤務開始の記録
  - 時刻指定対応: `/start time:09:00` で指定時刻での開始記録
- `/end` - 勤務終了の記録と労働時間の計算
  - 時刻指定対応: `/end time:18:00` で指定時刻での終了記録
- 月別シートでの自動勤怠管理
- 二重打刻防止（Cloudflare KV による高速チェック）
- 通信環境対応（Deferred Response + リトライ機能）
- スマホ対応（安定した応答システム）
- 全チャンネル対応（チャンネル制限なし）
- Discord 署名検証によるセキュリティ確保
- ユーザー名と Discord ID の分離記録
- 日時形式での時刻記録（yyyy/MM/dd HH:mm:ss）
- リアルタイム労働時間計算
- Discord API による実際のチャンネル名取得
- KV による自動クリーンアップ（24 時間 TTL）
- JST/UTC 自動変換: 日本時間での入力を内部的に UTC で管理

## リリース予定
現在は開発者向けの実装ですが、将来的には Discord Bot としてリリース予定です。Bot の設定は Discord Developer Portal で行い、スラッシュコマンドを通じて操作します｡

Discord上で操作が完結するようにGASの設定についての構想が固まり次第、Botとしてのリリースを行います。


## 技術スタック

- **Runtime:** Cloudflare Workers
- **Framework:** Hono (TypeScript)
- **Package Manager:** Bun
- **Frontend:** Discord (スラッシュコマンド)
- **Database:** Google Spreadsheet
- **Cache/State:** Cloudflare KV (重複チェック用)
- **API:** Google Apps Script (GAS) Web App + Discord API
- **Authentication:** Discord 署名検証

## セットアップ

### 0. プロジェクトのクローンと初期設定

```bash
git clone <repository-url>
cd kintai-discord
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

### 2. Google スプレッドシートの準備

1. 新しい Google スプレッドシートを作成
2. スプレッドシート ID を記録（URL の `/d/` と `/edit` の間の部分）

### 3. Google Apps Script の設定

1. [Google Apps Script](https://script.google.com/)で新しいプロジェクトを作成
2. `gas-code.js` の内容をコピー&ペースト
3. コード内の `SPREADSHEET_ID` を作成したスプレッドシートの ID に設定
4. 「デプロイ」→「新しいデプロイ」→「Web App」として実行
5. アクセス権限を「全員」に設定
6. デプロイ後の Web App URL を記録

### 4. 環境変数の設定

**開発環境用**：`.env` ファイルに以下の情報を設定（Wrangler は`.dev.vars`を自動生成）：

```bash
# Discord Bot設定
DISCORD_PUBLIC_KEY=your_discord_public_key_here
DISCORD_APPLICATION_ID=your_discord_application_id_here
DISCORD_TOKEN=your_discord_bot_token_here

# Google Apps Script設定
GAS_WEB_APP_URL=your_gas_web_app_url_here

# チャンネル設定
ALLOWED_CHANNEL_IDS=*
```

**重要**:

- `.env` と `.dev.vars` ファイルは Git で管理されません
- 開発時は `.dev.vars` が Wrangler により自動的に読み込まれます
- 本番環境では Cloudflare Workers のシークレット機能を使用してください

### 5. Cloudflare KV の設定

勤怠の重複チェック用に Cloudflare KV を設定します：

```bash
# KVネームスペースを作成
bun run kv:setup
```

出力された KV ネームスペース ID を `wrangler.jsonc` の `kv_namespaces` セクションに設定してください。

### 6. スラッシュコマンドの登録

環境変数を設定後、コマンドを登録：

```bash
bun run register-commands
```

### 7. デプロイ

```bash
# 開発環境での実行
bun run dev

# 本番環境へのデプロイ
bun run deploy
```

### 8. 本番環境でのシークレット設定（推奨）

開発環境では `.dev.vars` ファイルを使用しますが、本番環境では Cloudflare Workers のシークレット機能を使用することを強く推奨します：

```bash
# 自動設定スクリプト（.env の内容を使用）
bun run secrets:setup

# または手動設定
wrangler secret put DISCORD_PUBLIC_KEY
wrangler secret put DISCORD_APPLICATION_ID
wrangler secret put DISCORD_TOKEN
wrangler secret put GAS_WEB_APP_URL
wrangler secret put ALLOWED_CHANNEL_IDS
```

各コマンド実行時に、対応する値を入力してください。

## 使用方法

1. Discord サーバーに Bot を招待
2. 任意のチャンネルで以下のコマンドを実行（全チャンネル対応）：

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

| 列名           | 説明                     | 例                         |
| -------------- | ------------------------ | -------------------------- |
| プロジェクト名 | チャンネル名             | general                    |
| ユーザー名     | Discord のユーザー名     | nasubi_dev                 |
| 差分           | 労働時間（自動計算）     | 8 時間 30 分 15 秒         |
| 開始時刻       | 勤務開始時刻（日時形式） | 2025/06/23 09:00:00        |
| 終了時刻       | 勤務終了時刻（日時形式） | 2025/06/23 17:30:15        |
| channel_id     | Discord チャンネル ID    | 1234567890123456789        |
| discord_id     | Discord ユーザー ID      | 123456789012345678         |
| uuid           | 各レコードの一意識別子   | xxxxxxxx-xxxx-xxxx-xxxx... |

## エラーハンドリング

- **二重打刻防止**: KV で開始済み勤務をチェック。前回の勤務が終了していない状態で開始しようとした場合
- **未終了勤怠なし**: KV で開始記録をチェック。開始していない状態で終了しようとした場合
- **🆕 時刻指定エラー**:
  - 無効な時刻形式（HH:MM, HHMM, HMM 以外）
  - 開始時刻が現在時刻より未来
  - 終了時刻が開始時刻より前
- **署名検証エラー**: Discord 署名が無効な場合（セキュリティ）
- **GAS 通信エラー**: Google Apps Script との通信に失敗した場合（自動リトライ機能付き）
- **スプレッドシートアクセスエラー**: 権限や ID が正しくない場合
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

2. **GAS 通信エラー**

   - GAS Web App の URL が正確か確認
   - GAS のアクセス権限が「全員」に設定されているか確認
   - スプレッドシート ID が正しいか確認

3. **コマンドが表示されない**

   - Bot の権限（`applications.commands`）を確認
   - `register-commands.js`でコマンド登録が成功しているか確認

4. **データが記録されない**

   - Cloudflare Workers のログを`bun run wrangler tail`で確認
   - GAS のログを Apps Script エディタで確認
   - スプレッドシートの共有設定を確認
   - KV ネームスペースの設定を確認

5. **KV 関連のエラー**

   - `wrangler.jsonc` の KV ネームスペース設定を確認
   - KV ネームスペース ID が正しく設定されているか確認
   - `bun run cf-typegen` で型定義を再生成

6. **通信エラー・タイムアウト**
   - スマホなど通信環境が悪い場合は、自動的にリトライされます
   - 処理中のメッセージが表示されてから最終結果が表示されるまでお待ちください
   - 長時間応答がない場合は、再度コマンドを実行してください

### デバッグ方法

- **Cloudflare Workers**: `wrangler tail`でリアルタイムログ確認
- **GAS**: Apps Script エディタの実行ログ確認
- **Discord**: Developer Portal のインタラクション履歴確認

## アーキテクチャ

```
Discord Slash Command
        ↓
Cloudflare Workers (Hono)
        ↓
Cloudflare KV (重複チェック)
        ↓
Google Apps Script (Web App)
        ↓
Google Spreadsheet
```

### データフロー

1. **開始時 (`/start`)**:

   - Discord → Cloudflare Workers
   - 即座に Deferred Response 返却（100ms 以内）
   - バックグラウンドで KV 重複チェック (高速)
   - チェック通過 → GAS でスプレッドシート記録（10 秒タイムアウト）
   - 失敗時は最大 3 回リトライ
   - 成功 → KV に状態保存 (24 時間 TTL)
   - 最終結果を Discord に送信

2. **終了時 (`/end`)**:
   - Discord → Cloudflare Workers
   - 即座に Deferred Response 返却（100ms 以内）
   - バックグラウンドで KV 存在チェック (高速)
   - チェック通過 → GAS でスプレッドシート更新（10 秒タイムアウト）
   - 失敗時は最大 3 回リトライ
   - 成功 → KV から状態削除
   - 最終結果を Discord に送信

### セキュリティ

- Discord 署名検証により不正なリクエストをブロック
- 環境変数による機密情報の管理（`.env` ファイルは Git 管理対象外）
- 本番環境では Cloudflare Workers シークレット機能を使用
- HTTPS 通信によるデータ暗号化
- KV による高速な重複チェックでパフォーマンス向上

### パフォーマンス最適化

- **KV 活用**: 重複チェックを Cloudflare KV で高速実行
- **責任分離**: KV で状態管理、GAS でデータ永続化
- **自動クリーンアップ**: 24 時間 TTL で KV を自動クリーンアップ
- **Deferred Response**: 通信環境が悪くても即座に応答（100ms 以内）
- **リトライ機構**: 失敗時の自動再試行（最大 3 回、指数バックオフ）
- **タイムアウト拡張**: GAS 通信に 10 秒のタイムアウト設定
- **詳細フィードバック**: 処理状況とエラー詳細の分かりやすい通知

### 機密情報の管理

- **開発環境**: `.dev.vars` ファイルを使用（Git で管理されません）
- **本番環境**: `wrangler secret` コマンドでシークレットを設定
- **GAS**: スクリプトプロパティでスプレッドシート ID を管理
- **テンプレート**: `.env.example` と `.dev.vars.example` で設定項目を明示

## 今後の実装予定

優先度高

- コマンド
  - /status
    - のみ: 自分の勤務時間確認
    - メンション: その人の勤務時間確認
- 打刻忘れ通知: 平日 18 時に未完了勤務をメンション通知

優先度低

- タイムゾーン対応
  コマンド
  - /add
    - 19:00 21:00: start,end を記載して記録
    - 2h: 現在時間までの勤務時間を記録
- Discord Bot としてリリースするために Discord だけで設定できるように

実装予定なし

- コマンド
  - /delete
- グラフビュー
- ダッシュボード

## ライセンス

このプロジェクトは MIT ライセンスの下で公開されています。詳細は [LICENSE](LICENSE) ファイルを参照してください。
