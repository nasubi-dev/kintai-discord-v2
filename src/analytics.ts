/**
 * Cloudflare Analytics Engine への利用状況の記録。
 *
 * nasubi-bot の日次レポート（daily-report）が SQL API で集計する前提のスキーマ:
 *   blobs:   blob1 = command, blob2 = outcome, blob3 = platform, blob4 = guildId/teamId, blob5 = userId
 *   doubles: double1 = durationMs
 *   indexes: [command]
 *
 * writeDataPoint は同期的にキューイングされるので await しない。
 * バインディングが無い環境（ローカル開発など）では何もしない。
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

export function recordCommand(
  env: { ANALYTICS?: AnalyticsEngineDataset },
  event: CommandEvent
): void {
  if (!env.ANALYTICS) return;
  try {
    env.ANALYTICS.writeDataPoint({
      blobs: [
        event.command,
        event.outcome,
        event.platform,
        event.guildId,
        event.userId,
      ],
      doubles: [event.durationMs],
      indexes: [event.command],
    });
  } catch (error) {
    console.error(`Analytics event failed for ${event.command}:`, error);
  }
}
