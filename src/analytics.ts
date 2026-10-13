/**
 * Cloudflare Analytics Engine への利用状況の記録。
 *
 * nasubi-bot の日次レポート（daily-report）が SQL API で集計する前提のスキーマ:
 *   blobs:   blob1 = command, blob2 = outcome, blob3 = platform, blob4 = guildId/teamId, blob5 = 匿名化したユーザー
 *   doubles: double1 = durationMs
 *   indexes: [command]
 *
 * blob5 は HMAC-SHA256(ANALYTICS_SALT, JST の日付 + userId) の先頭 16 桁。
 * 同じ日の同じ人は同じ値になるので日次の利用人数は数えられるが、
 * 日をまたぐと別の値になり、鍵を知らなければ元のユーザー ID にも戻せない。
 * ANALYTICS_SALT は `wrangler secret put` でだけ設定し、手元には残さない。
 *
 * バインディングや鍵が無い環境（ローカル開発など）では何もしない。
 */

export type CommandOutcome = "ok" | "error" | "rejected";

export interface CommandEvent {
  platform: "discord" | "slack";
  command: string;
  outcome: CommandOutcome;
  guildId: string;
  userId: string;
  durationMs: number;
}

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

async function anonymizeUser(salt: string, userId: string): Promise<string> {
  const day = new Date(Date.now() + JST_OFFSET_MS).toISOString().slice(0, 10);
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(salt),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${day}:${userId}`)
  );
  return [...new Uint8Array(sig).slice(0, 8)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function recordCommand(
  env: { ANALYTICS?: AnalyticsEngineDataset; ANALYTICS_SALT?: string },
  event: CommandEvent
): Promise<void> {
  if (!env.ANALYTICS || !env.ANALYTICS_SALT) return;
  try {
    env.ANALYTICS.writeDataPoint({
      blobs: [
        event.command,
        event.outcome,
        event.platform,
        event.guildId,
        await anonymizeUser(env.ANALYTICS_SALT, event.userId),
      ],
      doubles: [event.durationMs],
      indexes: [event.command],
    });
  } catch (error) {
    console.error(`Analytics event failed for ${event.command}:`, error);
  }
}
