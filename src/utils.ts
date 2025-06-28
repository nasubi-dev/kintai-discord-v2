export async function verifyDiscordRequest(request: Request, publicKey: string): Promise<boolean> {
  const signature = request.headers.get("x-signature-ed25519");
  const timestamp = request.headers.get("x-signature-timestamp");
  const body = await request.text();

  if (!signature || !timestamp) return false;

  const encoder = new TextEncoder();
  const timestampData = encoder.encode(timestamp);
  const bodyData = encoder.encode(body);

  const message = new Uint8Array(timestampData.length + bodyData.length);
  message.set(timestampData);
  message.set(bodyData, timestampData.length);

  const publicKeyBytes = hexToBytes(publicKey);
  const signatureBytes = hexToBytes(signature);

  const cryptoKey = await crypto.subtle.importKey("raw", publicKeyBytes, { name: "Ed25519", namedCurve: "Ed25519" }, false, ["verify"]);
  return await crypto.subtle.verify("Ed25519", cryptoKey, signatureBytes, message);
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
  }
  return bytes;
}

export function isTimestampValid(timestamp: string, maxAge: number = 300): boolean {
  const now = Math.floor(Date.now() / 1000);
  const requestTime = parseInt(timestamp, 10);
  return Math.abs(now - requestTime) <= maxAge;
}

export function getCurrentTimestamp(): string {
  return new Date().toISOString();
}

/**
 * チャンネルIDが許可リストに含まれているかチェック
 * @param channelId チャンネルID
 * @param allowedChannels 許可されたチャンネルIDのリスト
 * @returns チャンネルが許可されているかどうか
 */
export function isChannelAllowed(
  channelId: string,
  allowedChannels: string[]
): boolean {
  // "*" が設定されている場合はすべてのチャンネルを許可
  if (allowedChannels.includes("*")) {
    return true;
  }
  return allowedChannels.includes(channelId);
}

/**
 * 時刻文字列をパースしてDate オブジェクトを作成（JST基準）
 * @param timeString 時刻文字列 (例: "09:00", "0900", "19:30", "1930")
 * @param baseDate 基準日（省略時は今日）
 * @returns パースされたDate オブジェクト（UTC）
 */
export function parseTimeStringToJST(
  timeString: string,
  baseDate?: Date
): Date | null {
  try {
    // 基準日を設定（JSTで今日）
    const base = baseDate || new Date();

    // JSTで日付を作成（UTCから9時間戻す）
    const jstDate = new Date(base.getTime() + 9 * 60 * 60 * 1000);
    const year = jstDate.getUTCFullYear();
    const month = jstDate.getUTCMonth();
    const day = jstDate.getUTCDate();

    // 時刻文字列をパース
    let hours: number, minutes: number;

    if (timeString.includes(":")) {
      // "HH:MM" 形式
      const parts = timeString.split(":");
      if (parts.length !== 2) return null;

      hours = parseInt(parts[0], 10);
      minutes = parseInt(parts[1], 10);
    } else if (timeString.length === 3 || timeString.length === 4) {
      // "HMM" または "HHMM" 形式
      if (timeString.length === 3) {
        // "HMM" 形式 (例: "900" -> 9:00)
        hours = parseInt(timeString.substring(0, 1), 10);
        minutes = parseInt(timeString.substring(1), 10);
      } else {
        // "HHMM" 形式 (例: "1900" -> 19:00)
        hours = parseInt(timeString.substring(0, 2), 10);
        minutes = parseInt(timeString.substring(2), 10);
      }
    } else {
      return null;
    }

    // 時刻の有効性をチェック
    if (
      isNaN(hours) ||
      isNaN(minutes) ||
      hours < 0 ||
      hours > 23 ||
      minutes < 0 ||
      minutes > 59
    ) {
      return null;
    }

    // JSTでDateオブジェクトを作成し、UTCに変換
    const jstDateTime = new Date(year, month, day, hours, minutes, 0, 0);
    const utcDateTime = new Date(jstDateTime.getTime() - 9 * 60 * 60 * 1000);

    return utcDateTime;
  } catch (error) {
    console.error("Time parsing error:", error);
    return null;
  }
}

/**
 * 指定された時刻が現在時刻より未来かどうかをチェック（JST基準）
 * @param targetTime チェック対象の時刻
 * @returns 未来の時刻の場合 true
 */
export function isFutureTime(targetTime: Date): boolean {
  const now = new Date();
  return targetTime.getTime() > now.getTime();
}

/**
 * 終了時刻が開始時刻より前になっていないかチェック
 * @param startTime 開始時刻
 * @param endTime 終了時刻
 * @returns 終了時刻が開始時刻より前の場合 true
 */
export function isEndTimeBeforeStartTime(
  startTime: Date,
  endTime: Date
): boolean {
  return endTime.getTime() < startTime.getTime();
}

/**
 * Date オブジェクトをJST文字列に変換
 * @param date Date オブジェクト
 * @returns JST形式の文字列 (yyyy/MM/dd HH:mm:ss)
 */
export function formatDateToJST(date: Date): string {
  const jstDate = new Date(date.getTime() + 9 * 60 * 60 * 1000);

  const year = jstDate.getUTCFullYear();
  const month = String(jstDate.getUTCMonth() + 1).padStart(2, "0");
  const day = String(jstDate.getUTCDate()).padStart(2, "0");
  const hours = String(jstDate.getUTCHours()).padStart(2, "0");
  const minutes = String(jstDate.getUTCMinutes()).padStart(2, "0");
  const seconds = String(jstDate.getUTCSeconds()).padStart(2, "0");

  return `${year}/${month}/${day} ${hours}:${minutes}:${seconds}`;
}

/**
 * 日本語ロケール形式の日時文字列をDateオブジェクトに変換
 * Google Sheetsから取得した日時文字列（例：2025/06/28 14:30:00）を適切にパース
 * @param jstDateTimeString JST形式の日時文字列
 * @returns Dateオブジェクト（UTC）、パースに失敗した場合はnull
 */
export function parseDateTimeFromJST(jstDateTimeString: string): Date | null {
  try {
    // 日本語ロケール形式の例: "2025/06/28 14:30:00"
    const match = jstDateTimeString.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{1,2}):(\d{1,2})$/);
    
    if (!match) {
      // フォールバック：標準的なDate.parseを試行
      const parsed = new Date(jstDateTimeString);
      if (!isNaN(parsed.getTime())) {
        // JSTとして解釈されているか確認し、UTCに調整
        // 既にUTCとして正しく解釈されている場合はそのまま返す
        return parsed;
      }
      return null;
    }

    const [, year, month, day, hours, minutes, seconds] = match;
    
    // JST時刻として解釈してUTCに変換
    const jstDate = new Date(
      parseInt(year),
      parseInt(month) - 1, // 月は0ベース
      parseInt(day),
      parseInt(hours),
      parseInt(minutes),
      parseInt(seconds)
    );

    // JSTからUTCに変換（-9時間）
    const utcDate = new Date(jstDate.getTime() - 9 * 60 * 60 * 1000);
    
    return utcDate;
  } catch (error) {
    console.error("JST DateTime parsing error:", error);
    return null;
  }
}
