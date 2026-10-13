/**
 * The file the Claude Code plugin writes and the collector reads. Kept free of
 * Bun and Claude Code APIs so both sides can import it.
 */

/** One plan window as Claude Code reports it to mods. */
export interface RateLimit {
  /** `five_hour`, `seven_day`, or a gateway's `spend_limit`. */
  kind: string;
  /** 0 to 100, or past 100 on an exceeded spend limit. */
  percentUsed: number;
  /** ISO 8601. */
  resetsAt?: string;
}

export interface RateLimitSnapshot {
  /** ISO 8601 time Claude Code measured these windows. */
  capturedAt: string;
  rateLimits: RateLimit[];
}

export const SNAPSHOT_FILE = "claude-rate-limits.json";

/** Mirrors cachePath in src/cache.ts, which the plugin cannot import. */
export function snapshotPath(home: string, xdgCacheHome: string | undefined): string {
  const base = xdgCacheHome || `${home}/Library/Caches`;
  return `${base}/quota-pill/${SNAPSHOT_FILE}`;
}

export function toSnapshot(rateLimits: readonly RateLimit[], capturedAt: Date): RateLimitSnapshot {
  return {
    capturedAt: capturedAt.toISOString(),
    rateLimits: rateLimits.map(({ kind, percentUsed, resetsAt }) => ({ kind, percentUsed, resetsAt })),
  };
}
