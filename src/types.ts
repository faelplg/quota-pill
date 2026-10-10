export type HarnessId = "copilot" | "codex" | "claude" | "antigravity";

export interface QuotaWindow {
  id: string;
  label: string;
  /** 0-100, already clamped. */
  usedPct: number;
  resetsAt?: Date;
  detail?: string;
}

export type ReportStatus = "ok" | "unavailable" | "error";

export interface HarnessReport {
  harness: HarnessId;
  name: string;
  short: string;
  status: ReportStatus;
  plan?: string;
  windows: QuotaWindow[];
  /** Actionable explanation when status is not "ok", or a caveat when it is. */
  message?: string;
  /** When the underlying data was produced, if older than the fetch itself. */
  dataAsOf?: Date;
}

export interface CollectOptions {
  /** Skip local caches; set when the user explicitly asks for fresh data. */
  force?: boolean;
}

export interface Adapter {
  harness: HarnessId;
  name: string;
  short: string;
  collect(now: Date, options: CollectOptions): Promise<Omit<HarnessReport, "harness" | "name" | "short">>;
}

/** Thrown for expected, user-fixable conditions; the message is shown as is. */
export class UnavailableError extends Error {}

export function clampPct(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(100, Math.max(0, n));
}

export function worstPct(report: HarnessReport): number | undefined {
  if (report.status !== "ok" || report.windows.length === 0) return undefined;
  return Math.max(...report.windows.map((w) => w.usedPct));
}
