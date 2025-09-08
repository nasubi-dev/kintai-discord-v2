- `/status`の実装
  - エンドポイントは､ユーザーの今月の合計稼働時間を返します｡
  - `/status`: status 単体であれば今月のコマンドを打ったユーザーの合計稼働時間､各プロジェクトごとの合計時間を返します｡
  - `/status @username`: 指定したユーザーの今月の合計稼働時間､各プロジェクトごとの合計時間を返します｡
  - `/status project:project_name`: 指定したプロジェクトの今月の合計稼働時間､各ユーザーごとの合計時間を返します｡
  - `/status  project:all-projects`: 全プロジェクトの今月の合計稼働時間､各ユーザーごとの合計時間を返します｡

## 実装方法

### 1. コマンド登録 (register-commands.js)

```javascript
{
  name: "status",
  type: 1, // CHAT_INPUT
  description: "今月の稼働時間統計を表示します",
  options: [
    {
      name: "user",
      description: "対象ユーザーを指定 (@ユーザー名)",
      type: 6, // USER
      required: false,
    },
    {
      name: "project",
      description: "対象プロジェクトを指定 (チャンネル名またはall-projects)",
      type: 3, // STRING
      required: false,
    },
  ],
}
```

### 2. メインハンドラー (src/index.ts)

- `handleSlashCommandDeferred`関数に`case "status"`を追加
- `handleStatusStatsCommand`関数を新規作成
- パラメータ解析: user (Discord User), project (string)

### 3. Google Sheets 統計機能 (src/sheets-service.ts)

新規メソッドを追加:

#### 3.1 `getMonthlyStats` - 今月のデータ統計

```typescript
async getMonthlyStats(
  accessToken: string,
  spreadsheetId: string,
  guildId?: string
): Promise<{
  success: boolean;
  totalWorkTime?: string;
  projectStats?: { [projectName: string]: string };
  userStats?: { [userId: string]: { username: string; totalTime: string } };
  error?: string;
}>
```

#### 3.2 `getUserMonthlyStats` - 特定ユーザーの統計

```typescript
async getUserMonthlyStats(
  accessToken: string,
  spreadsheetId: string,
  userId: string,
  guildId?: string
): Promise<{
  success: boolean;
  username?: string;
  totalWorkTime?: string;
  projectBreakdown?: { [projectName: string]: string };
  error?: string;
}>
```

#### 3.3 `getProjectMonthlyStats` - 特定プロジェクトの統計

```typescript
async getProjectMonthlyStats(
  accessToken: string,
  spreadsheetId: string,
  projectName: string,
  guildId?: string
): Promise<{
  success: boolean;
  projectName?: string;
  totalWorkTime?: string;
  userBreakdown?: { [userId: string]: { username: string; workTime: string } };
  error?: string;
}>
```

### 4. 実装のポイント

#### 4.1 データ取得処理

- 今月のシート名: `new Date().toISOString().slice(0, 7)` (YYYY-MM 形式)
- 列構造: `KINTAI_COLUMNS`定数を活用
  - A: プロジェクト名, B: ユーザー名, D: 差分(労働時間), H: discord_id
- 完了レコードのみ対象: 終了時刻(F 列)が空でない

#### 4.2 時間計算ロジック

- D 列の数式結果を解析: "8 時間 30 分" → 分換算
- 正規表現: `/(\d+)時間(\d+)分/` または `/(\d+)時間/` または `/(\d+)分/`
- 合計時間を "XX 時間 YY 分" 形式で表示

#### 4.3 Discord 表示フォーマット

```typescript
// 基本統計
`📊 **${username}さんの今月の勤務統計**\n\n` +
  `🕒 **合計勤務時間**: ${totalTime}\n\n` +
  `📁 **プロジェクト別内訳**:\n` +
  projectBreakdown
    .map((p) => `• ${p.name}: ${p.time}`)
    .join("\n")// プロジェクト統計
  `📁 **${projectName}の今月の統計**\n\n` +
  `🕒 **合計勤務時間**: ${totalTime}\n\n` +
  `👥 **メンバー別内訳**:\n` +
  userBreakdown.map((u) => `• ${u.username}: ${u.time}`).join("\n");
```

### 5. エラーハンドリング

- スプレッドシート未設定: "勤怠管理が設定されていません。`/init`で初期設定を行ってください。"
- 今月のデータなし: "今月の勤務データがありません。"
- ユーザー/プロジェクト不明: "指定されたユーザー/プロジェクトが見つかりません。"
- API エラー: Discord API Service 経由でエラーレスポンス

### 6. パフォーマンス考慮

- 一回の API 呼び出しで全データ取得: `getRange(spreadsheetId, `${sheetName}!A:I`)`
- メモリ内で集計処理
- 大量データ対応: 1000 行程度まで対応済み
