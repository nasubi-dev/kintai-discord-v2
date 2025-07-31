export async function verifyDiscordRequest(
  request: Request,
  publicKey: string
): Promise<boolean> {
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

  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    publicKeyBytes,
    { name: "Ed25519", namedCurve: "Ed25519" },
    false,
    ["verify"]
  );
  return await crypto.subtle.verify(
    "Ed25519",
    cryptoKey,
    signatureBytes,
    message
  );
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
  }
  return bytes;
}

export function isTimestampValid(
  timestamp: string,
  maxAge: number = 300
): boolean {
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
 * 日付文字列をパースしてDateオブジェクトを作成（JST基準）
 * @param dateString 日付文字列 (例: "2023-03-15", "20230315", "today", "yesterday", "0", "-1")
 * @returns パースされたDateオブジェクト、失敗時はnull
 */
export function parseDateString(dateString: string): Date | null {
  if (!dateString) return null;

  // JSTベースで今日の日付を取得
  const now = new Date();
  const jstOffset = 9 * 60 * 60 * 1000; // +9時間
  const jstNow = new Date(now.getTime() + jstOffset);
  const today = new Date(
    jstNow.getUTCFullYear(),
    jstNow.getUTCMonth(),
    jstNow.getUTCDate()
  );

  switch (dateString.toLowerCase()) {
    case "today":
      return today;
    case "yesterday":
      const yesterday = new Date(today);
      yesterday.setDate(today.getDate() - 1);
      return yesterday;
  }

  // YYYY-MM-DD形式
  const dashMatch = dateString.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (dashMatch) {
    const [, year, month, day] = dashMatch;
    const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
    return isValidDate(date) ? date : null;
  }

  // YYYYMMDD形式
  const compactMatch = dateString.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (compactMatch) {
    const [, year, month, day] = compactMatch;
    const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
    return isValidDate(date) ? date : null;
  }

  // 相対日付 (例: "0", "-1", "1")
  const relativeMatch = dateString.match(/^(-?\d{1,2})$/);
  if (relativeMatch) {
    const days = parseInt(relativeMatch[1], 10);
    const targetDate = new Date(today);
    targetDate.setDate(today.getDate() + days);
    return targetDate;
  }

  return null;
}

/**
 * 日付が有効かチェック
 */
function isValidDate(date: Date): boolean {
  return date instanceof Date && !isNaN(date.getTime());
}

/**
 * 時刻文字列と日付文字列を組み合わせてDateオブジェクトを作成（JST基準）
 * @param timeString 時刻文字列 (例: "09:00", "0900") - undefinedの場合は現在時刻を使用
 * @param dateString 日付文字列 (例: "today", "2023-03-15") - undefinedの場合は今日を使用
 * @returns パースされたDateオブジェクト（内部はUTCだが、JST時刻として作成）
 */
export function parseTimeStringWithDate(
  timeString?: string,
  dateString?: string
): Date | null {
  // 日付を決定
  let targetYear: number, targetMonth: number, targetDay: number;

  if (dateString) {
    const parsedDate = parseDateString(dateString);
    if (!parsedDate) return null;

    targetYear = parsedDate.getFullYear();
    targetMonth = parsedDate.getMonth();
    targetDay = parsedDate.getDate();
  } else {
    // 今日の日付をJST基準で取得（システムローカル日付を使用）
    const today = new Date();
    targetYear = today.getFullYear();
    targetMonth = today.getMonth();
    targetDay = today.getDate();
  }

  // 時刻を決定
  let targetHours: number, targetMinutes: number;

  if (timeString) {
    // 時刻が指定された場合
    if (timeString.includes(":")) {
      // "HH:MM" 形式
      const parts = timeString.split(":");
      if (parts.length !== 2) return null;
      targetHours = parseInt(parts[0], 10);
      targetMinutes = parseInt(parts[1], 10);
    } else if (timeString.length === 3 || timeString.length === 4) {
      // "HMM" または "HHMM" 形式
      if (timeString.length === 3) {
        targetHours = parseInt(timeString.substring(0, 1), 10);
        targetMinutes = parseInt(timeString.substring(1), 10);
      } else {
        targetHours = parseInt(timeString.substring(0, 2), 10);
        targetMinutes = parseInt(timeString.substring(2), 10);
      }
    } else {
      return null;
    }

    // 時刻の有効性をチェック
    if (
      isNaN(targetHours) ||
      isNaN(targetMinutes) ||
      targetHours < 0 ||
      targetHours > 23 ||
      targetMinutes < 0 ||
      targetMinutes > 59
    ) {
      return null;
    }
  } else {
    // 時刻が未指定の場合は現在のJST時刻を使用
    const now = new Date();
    // 現在時刻をJSTとして取得（システムローカル時刻を使用）
    targetHours = now.getHours();
    targetMinutes = now.getMinutes();
  }

  // dayの引数がある場合のみUTC変換を行う
  let utcDate: Date;
  if (timeString) {
    // 日付が指定されている場合：JST→UTC変換
    const utcHours = targetHours - 9;
    utcDate = new Date(
      Date.UTC(
        targetYear,
        targetMonth,
        targetDay,
        utcHours,
        targetMinutes,
        0,
        0
      )
    );
  } else {
    // 日付が未指定の場合：現在時刻をそのまま使用（UTC変換なし）
    utcDate = new Date(
      targetYear,
      targetMonth,
      targetDay,
      targetHours,
      targetMinutes,
      0,
      0
    );
  }

  return utcDate;
}

/**
 * Date オブジェクトをJST文字列に変換（更新版）
 * @param date Date オブジェクト
 * @param includeDate 日付も含めるかどうか
 * @returns JST形式の文字列
 */
export function formatDateToJST(
  date: Date,
  includeDate: boolean = false
): string {
  const jstDate = new Date(date.getTime() + 9 * 60 * 60 * 1000);

  const year = jstDate.getUTCFullYear();
  const month = String(jstDate.getUTCMonth() + 1).padStart(2, "0");
  const day = String(jstDate.getUTCDate()).padStart(2, "0");
  const hours = String(jstDate.getUTCHours()).padStart(2, "0");
  const minutes = String(jstDate.getUTCMinutes()).padStart(2, "0");
  const seconds = String(jstDate.getUTCSeconds()).padStart(2, "0");

  if (includeDate) {
    return `${year}/${month}/${day} ${hours}:${minutes}:${seconds}`;
  } else {
    return `${year}/${month}/${day} ${hours}:${minutes}:${seconds}`;
  }
}

/**
 * 日本語ロケール形式の日時文字列をDateオブジェクトに変換
 * Google Sheetsから取得した日時文字列（例：2025/06/28 14:30:00）を適切にパース
 * @param jstDateTimeString JST形式の日時文字列
 * @returns Dateオブジェクト（UTC）、パースに失敗した場合はnull
 */
export function parseDateTimeFromJST(jstDateTimeString: string): Date | null {
  try {
    // 分まで（秒なし）の形式: "2025/07/31 17:32"
    const matchMinutes = jstDateTimeString.match(
      /^(\d{4})\/(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{1,2})$/
    );
    
    // 秒ありの形式: "2025/07/31 17:32:00" (後方互換性のため)
    const matchSeconds = jstDateTimeString.match(
      /^(\d{4})\/(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{1,2}):(\d{1,2})$/
    );

    let year: string, month: string, day: string, hours: string, minutes: string, seconds: string = "0";

    if (matchMinutes) {
      [, year, month, day, hours, minutes] = matchMinutes;
    } else if (matchSeconds) {
      [, year, month, day, hours, minutes, seconds] = matchSeconds;
    } else {
      // フォールバック：標準的なDate.parseを試行
      const parsed = new Date(jstDateTimeString);
      if (!isNaN(parsed.getTime())) {
        return parsed;
      }
      return null;
    }

    // JST時刻として正確に解釈してUTCに変換
    const jstOffset = 9 * 60; // JST = UTC+9 (分単位)
    
    // ローカル時刻として作成（JST想定）
    const localDate = new Date(
      parseInt(year),
      parseInt(month) - 1, // 月は0ベース
      parseInt(day),
      parseInt(hours),
      parseInt(minutes),
      parseInt(seconds)
    );

    // JSTからUTCに変換
    const utcTime = localDate.getTime() - (jstOffset * 60000);
    const utcDate = new Date(utcTime);

    return utcDate;
  } catch (error) {
    console.error("JST DateTime parsing error:", error);
    return null;
  }
}
