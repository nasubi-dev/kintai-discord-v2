# Discord 勤怠管理ボット

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Version](https://img.shields.io/badge/version-2.0-blue.svg)
![Security](https://img.shields.io/badge/OAuth-2.0-green.svg)
![Platform](https://img.shields.io/badge/platform-Cloudflare%20Workers-orange.svg)

Discord のスラッシュコマンドで簡単に勤怠記録ができるボットです。各サーバー専用の Google スプレッドシートに自動でデータを記録し、労働時間も自動計算します。

## ✨ 主な特徴

- **🚀 簡単**: `/start` と `/end` だけで勤怠記録完了
- **🔒 安全**: 各サーバーのデータは完全に分離され、管理者の Google アカウントに保存
- **📊 自動**: 労働時間の計算、月別シート作成、データフォーマットすべて自動化
- **⚡ 高速**: 即座にレスポンス、通信環境が悪くても安定動作
- **💰 無料**: 無料で利用可能（Google スプレッドシート使用）

## 📋 使用可能なコマンド

### 管理者向けコマンド

- `/init` - 勤怠管理システムの初期設定
- `/config` - 設定状況と接続テスト
- `/reset` - 設定のリセット

### 一般ユーザー向けコマンド

- `/start` - 勤務開始の記録
  - `/start time:09:00` - 指定時刻での勤務開始
- `/end` - 勤務終了の記録
  - `/end time:18:00` - 指定時刻での勤務終了

### 対応する時刻形式

- `09:00` (HH:MM 形式)
- `0900` (HHMM 形式)
- `900` (HMM 形式)

## 🚀 導入方法

### ステップ 1: Bot を Discord サーバーに招待

[**こちらから Bot を招待**](https://discord.com/oauth2/authorize?client_id=1388221578675748904&permissions=2147552256&integration_type=0&scope=bot+applications.commands)

必要な権限: `チャンネルを見る`, `メッセージを送信`, `スラッシュコマンドを使用`

### ステップ 2: 初期設定（管理者のみ）

1. Discord サーバーで `/init` コマンドを実行
2. 表示されたガイドページにアクセス
3. Google Cloud Project を作成（無料）
4. OAuth 認証情報を設定
5. Google 認証を完了
6. 専用スプレッドシートが自動作成されます

### ステップ 3: 利用開始

設定完了後、すべてのメンバーが以下のコマンドを使用できます：

```
/start          # 勤務開始
/end            # 勤務終了
/start time:09:00    # 時刻指定も可能
```

勤怠データは月別に整理され、労働時間は自動計算されます。

## 🛠️ トラブルシューティング

### よくある問題と解決方法

#### 1. コマンドが表示されない

- Bot に `スラッシュコマンドを使用` 権限があるか確認
- サーバーから一度 Bot を削除して、再度招待してください

#### 2. 「管理者権限が必要です」と表示される

- `/init` や `/reset` は Discord サーバーの管理者のみ実行可能です
- サーバー設定で管理者権限を確認してください

#### 3. 「サーバー設定が見つかりません」

- 最初に管理者が `/init` コマンドで初期設定を行ってください
- 設定に問題がある場合は `/reset` でリセット後、再設定してください

#### 4. Google OAuth エラー

- **redirect_uri_mismatch**: Google Cloud Console のリダイレクト URI 設定を確認
- **権限不足**: Google Sheets API が有効化されているか確認
- 設定ガイドページの手順を再度確認してください

#### 5. データが記録されない

- `/config` コマンドで設定状況を確認
- Google スプレッドシートの共有設定を確認
- 時間を置いて再度お試しください

#### 6. チャンネル名が `channel-XXXXXX` と表示される

- Bot に該当チャンネルの「チャンネルを見る」権限を付与してください
- 権限不足でも勤怠記録は正常に動作します

#### 7. 通信エラー・タイムアウト

- スマホなど通信環境が悪い場合は自動的にリトライされます
- 「処理中...」メッセージの後、最終結果をお待ちください
- 長時間応答がない場合は再度コマンドを実行してください

#### 8. 設定をリセットしたい

管理者が以下のコマンドを実行：

```
/reset
```

その後、`/init` で再設定を行ってください。

### サポート

- 技術的な問題: GitHub Issues で報告してください

## データ構造

Google スプレッドシートの各月別シート（yyyy-MM 形式）は以下の列を持ちます：

| 列名           | 説明                            | 例                           |
| -------------- | ------------------------------- | ---------------------------- |
| 日付           | 勤務日                          | 2025/06/23                   |
| ユーザー名     | Discord のユーザー名            | nasubi_dev                   |
| ユーザー ID    | Discord ユーザー ID             | 123456789012345678           |
| プロジェクト名 | チャンネル名（権限不足時は ID） | kintai または channel-713082 |
| 開始時刻       | 勤務開始時刻                    | 09:00:00                     |
| 終了時刻       | 勤務終了時刻                    | 17:30:15                     |
| 勤務時間       | 労働時間（自動計算）            | 8:30:15                      |
| 記録 ID        | 各レコードの一意識別子          | xxxxxxxx-xxxx-xxxx-xxxx...   |

## 技術スタック

- **Runtime:** Cloudflare Workers
- **Framework:** Hono (TypeScript)
- **Package Manager:** Bun
- **Authentication:** Discord 署名検証 + OAuth 2.0（直接 OAuth 方式）
- **Database:** Google Spreadsheet（サーバーごとに独立）
- **Cache/State:** Cloudflare KV（重複チェック・暗号化トークン管理）
- **API:** Google Sheets API（直接連携）+ Discord API
- **Security:** 暗号化トークン管理、署名検証、管理者権限制御


## 技術的な詳細

### 採用技術とその選択理由

この Bot は以下の技術スタックで構築されています：

- **Cloudflare Workers + Hono**: サーバーレスでの高速応答、エッジでの実行によるグローバル対応
- **TypeScript**: 型安全性による開発効率向上とバグ削減
- **Cloudflare KV**: 勤怠状態の高速チェックと暗号化トークン管理
- **Google Sheets API**: スプレッドシート形式での直感的なデータ管理
- **Bun**: 高速なパッケージマネージャーとランタイム

### サービス構成と役割

```
Discord App ← → Cloudflare Workers ← → Google Sheets API
                      ↓
                 Cloudflare KV
```

**各サービスの役割**:

1. **Discord API Service** (`discord-api-service.ts`)
   - Discord との通信処理
   - 署名検証、レスポンス管理
2. **Sheets Service** (`sheets-service.ts`)

   - Google Sheets API との直接連携
   - スプレッドシートの作成・更新

3. **OAuth Service** (`oauth-service.ts`)

   - Google OAuth 認証フロー
   - アクセストークンの取得・管理

4. **Crypto Service** (`crypto-service.ts`)

   - OAuth トークンの暗号化・復号化
   - AES-256-GCM による安全な保存

5. **Server Config Service** (`server-config-service.ts`)
   - サーバー別設定の管理
   - KV ストレージとの連携

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

1. **管理者が `/init` コマンド実行**:

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

---

## 開発者・コントリビューター向け

- **[開発者向けガイド](docs/開発者向けガイド.md)** - 開発環境のセットアップからデプロイまで

---

## ロードマップ・今後の実装予定

### 🚀 優先度高（近日実装予定）

- **勤務状況確認コマンド**
  - `/status` のみ: 自分の勤務時間確認
  - `/status` メンション: その人の勤務時間確認
- **打刻忘れ通知**: 平日 18 時に未完了勤務をメンション通知

### 📋 優先度中（今後検討）

- **勤務記録追加コマンド**
  - `/add 19:00 21:00`: 指定時間範囲で勤務記録を追加
  - `/add 2h`: 現在時間までの指定時間分を記録
- **Discord API 権限の改善**: チャンネル名取得の安定性向上

### 🔮 優先度低（将来的な検討）

- **タイムゾーン対応**: 複数地域での利用対応
- **Discord 専用設定**: Bot としてリリースするために Discord だけで設定完了

### ❌ 実装予定なし

- **削除コマンド**: `/delete` - 複雑性を避けるため、スプレッドシートで直接編集
- **グラフビュー**: スプレッドシートで十分対応可能
- **ダッシュボード**: Google Sheets の機能で十分

---

## ライセンス

このプロジェクトは MIT ライセンスの下で公開されています。詳細は [LICENSE](LICENSE) ファイルを参照してください。
