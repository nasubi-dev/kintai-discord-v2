このリポジトリでは bun を使用しているため、bun を使用してコードを実行してください。

## プロジェクト固有の指示

### 技術スタック

- **ランタイム**: Cloudflare Workers
- **フレームワーク**: Hono
- **言語**: TypeScript
- **パッケージマネージャー**: Bun
- **外部 API**: Discord API, Google Apps Script

### コーディング規約

- TypeScript の厳密な型チェックを使用
- async/await を使用（Promise チェーンは避ける）
- エラーハンドリングは適切に try-catch で実装
- 環境変数は`c.env`経由でアクセス
- Discord API のレスポンスは適切な型を使用

### 実行コマンド

- 開発サーバー: `bun run dev`
- デプロイ: `bun run deploy`
- 型チェック: `bun run cf-typegen`
- TypeScript コンパイル: `bun run tsc --noEmit`

### セキュリティ注意事項

- Discord 署名検証は必須
- 環境変数に機密情報を保存
- チャンネル制限機能を適切に実装
- エラーメッセージに機密情報を含めない

### デバッグ方法

- `console.log`で Cloudflare Workers のログを確認
- `wrangler tail`でリアルタイムログ監視
- Discord Developer Portal でインタラクションをテスト

### ファイル構造の方針

- `src/types.ts`: 全ての型定義
- `src/utils.ts`: ユーティリティ関数
- `src/*-service.ts`: 各種サービスクラス
- `gas-code.js`: Google Apps Script コード（別ファイル）

### 実装方針
- GAS側での処理は最小限に抑える
- Cloudflare Workers 側での処理を中心に実装
- エラーハンドリングは Cloudflare Workers 側で行う