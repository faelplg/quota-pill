import { cachePath, readJson, writeJson } from "./cache.ts";
import { exec } from "./exec.ts";
import type { HarnessReport } from "./types.ts";

export const THRESHOLDS = [80, 95] as const;

/** Highest threshold already notified, per harness window and reset cycle. */
export type AlertState = Record<string, number>;

export interface Alert {
  title: string;
  body: string;
}

function cycleKey(harness: string, windowId: string, resetsAt?: Date): string {
  // Some APIs jitter the reset timestamp by milliseconds between calls.
  const bucket = resetsAt ? Math.round(resetsAt.getTime() / 600_000) : "none";
  return `${harness}:${windowId}:${bucket}`;
}

export function evaluateAlerts(reports: HarnessReport[], previous: AlertState) {
  const next: AlertState = {};
  const alerts: Alert[] = [];
  for (const report of reports) {
    if (report.status !== "ok") {
      // Keep state for sources that are temporarily unreachable.
      for (const [key, value] of Object.entries(previous)) {
        if (key.startsWith(`${report.harness}:`)) next[key] = value;
      }
      continue;
    }
    for (const window of report.windows) {
      const key = cycleKey(report.harness, window.id, window.resetsAt);
      const notified = previous[key] ?? 0;
      const crossed = THRESHOLDS.filter((t) => window.usedPct >= t).at(-1) ?? 0;
      next[key] = Math.max(notified, crossed);
      if (crossed > notified) {
        alerts.push({
          title: `${report.name}: ${Math.round(window.usedPct)}% usado`,
          body: `${window.label} passou de ${crossed}%.`,
        });
      }
    }
  }
  return { alerts, next };
}

export function stateFile(): string {
  return cachePath("alerts.json");
}

export async function loadState(path = stateFile()): Promise<AlertState> {
  return (await readJson<AlertState>(path)) ?? {};
}

export async function saveState(state: AlertState, path = stateFile()): Promise<void> {
  await writeJson(path, state);
}

export async function notify(alert: Alert): Promise<void> {
  // Pass text as argv so quotes in messages never reach AppleScript source.
  await exec([
    "osascript",
    "-e", "on run argv",
    "-e", "display notification (item 2 of argv) with title (item 1 of argv)",
    "-e", "end run",
    alert.title,
    alert.body,
  ]);
}
