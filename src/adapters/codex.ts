import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { clampPct, UnavailableError, type Adapter, type QuotaWindow } from "../types.ts";

interface RawWindow {
  used_percent?: number;
  window_minutes?: number;
  resets_at?: number;
}

interface RateLimits {
  primary?: RawWindow | null;
  secondary?: RawWindow | null;
  plan_type?: string | null;
}

export interface CodexSnapshot {
  timestamp: Date;
  rateLimits: RateLimits;
}

export function windowLabel(minutes: number | undefined): string {
  if (!minutes) return "Window";
  if (minutes === 10080) return "Week";
  if (minutes % 1440 === 0) return `${minutes / 1440}d`;
  if (minutes % 60 === 0) return `${minutes / 60}h`;
  return `${minutes}min`;
}

/** Returns the last token_count event that carries rate limits, scanning from the end. */
export function findLatestSnapshot(jsonl: string): CodexSnapshot | undefined {
  let end = jsonl.length;
  while (end > 0) {
    const start = jsonl.lastIndexOf("\n", end - 1) + 1;
    const line = jsonl.slice(start, end);
    end = start - 1;
    if (!line.includes('"rate_limits"')) continue;
    try {
      const event = JSON.parse(line);
      const rl = event?.payload?.rate_limits;
      if (rl && (rl.primary || rl.secondary)) {
        return { timestamp: new Date(event.timestamp), rateLimits: rl };
      }
    } catch {
      // A partially written last line is expected while Codex is running.
    }
  }
  return undefined;
}

export function parseCodex(snapshot: CodexSnapshot, now: Date) {
  const windows: QuotaWindow[] = [];
  for (const [id, raw] of Object.entries({
    primary: snapshot.rateLimits.primary,
    secondary: snapshot.rateLimits.secondary,
  })) {
    if (!raw || raw.used_percent === undefined) continue;
    const resetsAt = raw.resets_at ? new Date(raw.resets_at * 1000) : undefined;
    const expired = resetsAt !== undefined && resetsAt <= now;
    windows.push({
      id,
      label: windowLabel(raw.window_minutes),
      usedPct: expired ? 0 : clampPct(raw.used_percent),
      resetsAt: expired ? undefined : resetsAt,
      detail: expired ? "reset since last use" : undefined,
    });
  }
  const plan = snapshot.rateLimits.plan_type ?? undefined;
  return {
    status: "ok" as const,
    plan: plan ? plan[0]!.toUpperCase() + plan.slice(1) : undefined,
    windows,
    dataAsOf: snapshot.timestamp,
    message: "Updates when you use Codex.",
  };
}

async function listSessionFiles(dir: string, since: number): Promise<{ path: string; mtime: number }[]> {
  let entries: string[];
  try {
    entries = await readdir(dir, { recursive: true });
  } catch {
    return [];
  }
  const files = await Promise.all(
    entries
      .filter((e) => e.endsWith(".jsonl"))
      .map(async (e) => {
        const path = join(dir, e);
        const s = await stat(path).catch(() => undefined);
        return s && s.mtimeMs >= since ? { path, mtime: s.mtimeMs } : undefined;
      }),
  );
  return files.filter((f) => f !== undefined).sort((a, b) => b.mtime - a.mtime);
}

export const codex: Adapter = {
  harness: "codex",
  name: "Codex",
  short: "CX",
  async collect(now) {
    const home = process.env.CODEX_HOME || join(homedir(), ".codex");
    // The weekly window bounds how old a snapshot can be and still matter.
    const since = now.getTime() - 8 * 24 * 3600 * 1000;
    const files = await listSessionFiles(join(home, "sessions"), since);
    for (const file of files.slice(0, 20)) {
      const snapshot = findLatestSnapshot(await Bun.file(file.path).text());
      if (snapshot) return parseCodex(snapshot, now);
    }
    throw new UnavailableError("No Codex session in the last 8 days. Use Codex once to record one.");
  },
};
