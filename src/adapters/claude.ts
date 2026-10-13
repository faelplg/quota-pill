import { SNAPSHOT_FILE, type RateLimitSnapshot } from "../../plugins/quota-pill/hooks/snapshot.ts";
import { cachePath, readJson } from "../cache.ts";
import { clampPct, UnavailableError, type Adapter, type QuotaWindow } from "../types.ts";

/** Known windows, in display order. Unknown kinds follow, labeled as reported. */
const LABELS: Record<string, string> = {
  five_hour: "5h",
  seven_day: "Week",
  spend_limit: "Spend limit",
};

const ORDER = Object.keys(LABELS);

const rank = (kind: string) => {
  const index = ORDER.indexOf(kind);
  return index === -1 ? ORDER.length : index;
};

export function parseClaude(snapshot: RateLimitSnapshot, now: Date) {
  const windows: QuotaWindow[] = [...snapshot.rateLimits]
    .sort((a, b) => rank(a.kind) - rank(b.kind))
    .map((limit) => {
      const resetsAt = limit.resetsAt ? new Date(limit.resetsAt) : undefined;
      const expired = resetsAt !== undefined && resetsAt <= now;
      return {
        id: limit.kind,
        label: LABELS[limit.kind] ?? limit.kind,
        usedPct: expired ? 0 : clampPct(limit.percentUsed),
        resetsAt: expired ? undefined : resetsAt,
        detail: expired ? "reset since last use" : undefined,
      };
    });
  return {
    status: "ok" as const,
    windows,
    dataAsOf: new Date(snapshot.capturedAt),
    message: "Updates when you use Claude Code.",
  };
}

/**
 * Reads the windows the quota-pill Claude Code plugin records from the
 * session's own measurements, so no credential or private endpoint is involved.
 */
export const claude: Adapter = {
  harness: "claude",
  name: "Claude Code",
  short: "CC",
  async collect(now) {
    const snapshot = await readJson<RateLimitSnapshot>(cachePath(SNAPSHOT_FILE));
    if (!snapshot?.rateLimits?.length) {
      throw new UnavailableError(
        "No Claude Code usage recorded yet. Install the quota-pill plugin in Claude Code and send a message.",
      );
    }
    return parseClaude(snapshot, now);
  },
};
