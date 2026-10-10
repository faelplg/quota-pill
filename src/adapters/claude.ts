import { homedir } from "node:os";
import { join } from "node:path";
import { cachePath, readJson, writeJson } from "../cache.ts";
import { exec } from "../exec.ts";
import { clampPct, UnavailableError, type Adapter, type QuotaWindow } from "../types.ts";

interface OAuthCreds {
  accessToken: string;
  expiresAt?: number;
  subscriptionType?: string;
}

interface RawWindow {
  utilization?: number | null;
  resets_at?: string | null;
}

type Usage = Record<string, unknown> & {
  extra_usage?: { is_enabled?: boolean; utilization?: number } | null;
};

const WINDOWS: [key: string, label: string][] = [
  ["five_hour", "5h"],
  ["seven_day", "Week"],
  ["seven_day_opus", "Week · Opus"],
  ["seven_day_sonnet", "Week · Sonnet"],
];

const RENEW = "Open Claude Code to renew the login.";

/** The usage endpoint rate limits aggressively and is shared by every caller. */
const MIN_INTERVAL_MS = 5 * 60_000;
const DEFAULT_BACKOFF_MS = 10 * 60_000;

interface UsageCache {
  fetchedAt: number;
  usage: Usage;
  retryAt?: number;
}

export function parseClaude(usage: Usage, subscriptionType: string | undefined, now: Date) {
  const windows: QuotaWindow[] = [];
  for (const [key, label] of WINDOWS) {
    const raw = usage[key] as RawWindow | null | undefined;
    if (!raw || typeof raw.utilization !== "number") continue;
    const resetsAt = raw.resets_at ? new Date(raw.resets_at) : undefined;
    const expired = resetsAt !== undefined && resetsAt <= now;
    windows.push({
      id: key,
      label,
      usedPct: expired ? 0 : clampPct(raw.utilization),
      resetsAt: expired ? undefined : resetsAt,
      detail: expired ? "reset since last read" : undefined,
    });
  }
  const extra = usage.extra_usage;
  if (extra?.is_enabled && typeof extra.utilization === "number") {
    windows.push({ id: "extra_usage", label: "Extra usage (month)", usedPct: clampPct(extra.utilization) });
  }
  const plan = subscriptionType ? subscriptionType[0]!.toUpperCase() + subscriptionType.slice(1) : undefined;
  return { status: "ok" as const, plan, windows };
}

async function readCredentials(): Promise<OAuthCreds> {
  const keychain = await exec(["security", "find-generic-password", "-s", "Claude Code-credentials", "-w"]);
  let raw = keychain.code === 0 ? keychain.stdout : undefined;
  if (!raw) {
    const file = Bun.file(join(homedir(), ".claude", ".credentials.json"));
    raw = (await file.exists()) ? await file.text() : undefined;
  }
  const creds = raw ? JSON.parse(raw)?.claudeAiOauth : undefined;
  if (!creds?.accessToken) throw new UnavailableError(`Claude Code login not found. ${RENEW}`);
  return creds;
}

/**
 * The usage endpoint answers 429 to any client that does not identify as Claude
 * Code, so we present the installed CLI's version, as it is Claude Code's token.
 */
async function userAgent(): Promise<string> {
  const { code, stdout } = await exec(["claude", "--version"]);
  const version = code === 0 ? stdout.match(/^\d+\.\d+\.\d+/)?.[0] : undefined;
  return `claude-code/${version ?? "2.1.0"}`;
}

export function retryAfterMs(header: string | null, now: Date): number {
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds > 0) return seconds * 1000;
    const date = Date.parse(header);
    if (Number.isFinite(date) && date > now.getTime()) return date - now.getTime();
  }
  return DEFAULT_BACKOFF_MS;
}

function fromCache(cache: UsageCache, subscriptionType: string | undefined, now: Date, message?: string) {
  const report = parseClaude(cache.usage, subscriptionType, now);
  const stale = now.getTime() - cache.fetchedAt >= MIN_INTERVAL_MS;
  return { ...report, dataAsOf: stale ? new Date(cache.fetchedAt) : undefined, message };
}

export const claude: Adapter = {
  harness: "claude",
  name: "Claude Code",
  short: "CC",
  async collect(now, { force }) {
    const creds = await readCredentials();
    // Never refresh the token here: refresh tokens rotate, and doing it outside
    // Claude Code would invalidate the copy Claude Code keeps in the Keychain.
    if (creds.expiresAt && creds.expiresAt <= now.getTime()) {
      throw new UnavailableError(`Claude Code token expired. ${RENEW}`);
    }
    const path = cachePath("claude-usage.json");
    const cache = await readJson<UsageCache>(path);
    if (!force && cache && now.getTime() - cache.fetchedAt < MIN_INTERVAL_MS) {
      return fromCache(cache, creds.subscriptionType, now);
    }
    const limited = "Anthropic rate-limited usage queries. Retrying in a few minutes.";
    if (cache?.retryAt && cache.retryAt > now.getTime()) {
      if (cache.usage) return fromCache(cache, creds.subscriptionType, now, limited);
      throw new Error(limited);
    }

    let res: Response;
    try {
      res = await fetch("https://api.anthropic.com/api/oauth/usage", {
        headers: {
          Authorization: `Bearer ${creds.accessToken}`,
          "anthropic-beta": "oauth-2025-04-20",
          "User-Agent": await userAgent(),
        },
        signal: AbortSignal.timeout(8000),
      });
    } catch (err) {
      if (cache?.usage) return fromCache(cache, creds.subscriptionType, now, "No connection to api.anthropic.com.");
      throw err;
    }
    if (res.status === 401) throw new UnavailableError(`Claude Code token rejected. ${RENEW}`);
    if (res.status === 429) {
      const retryAt = now.getTime() + retryAfterMs(res.headers.get("retry-after"), now);
      await writeJson(path, { ...(cache ?? { fetchedAt: 0 }), retryAt });
      if (cache?.usage) return fromCache(cache, creds.subscriptionType, now, limited);
      throw new Error(limited);
    }
    if (!res.ok) {
      const message = `api.anthropic.com respondeu ${res.status}`;
      if (cache?.usage) return fromCache(cache, creds.subscriptionType, now, message);
      throw new Error(message);
    }
    const usage = (await res.json()) as Usage;
    await writeJson(path, { fetchedAt: now.getTime(), usage } satisfies UsageCache);
    return parseClaude(usage, creds.subscriptionType, now);
  },
};
