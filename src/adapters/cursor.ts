import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { homedir, platform, tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { exec } from "../exec.ts";
import { clampPct, UnavailableError, type Adapter, type QuotaWindow } from "../types.ts";

const USAGE_SUMMARY_URL = "https://cursor.com/api/usage-summary";
const AUTH_KEY = "cursorAuth/accessToken";
const NO_SESSION =
  "No Cursor session found. Sign in to the Cursor IDE, or run `agent login` / `cursor-agent login`.";

interface UsageBucket {
  enabled?: boolean;
  used?: number;
  limit?: number | null;
  remaining?: number | null;
  totalPercentUsed?: number;
  autoPercentUsed?: number;
  apiPercentUsed?: number;
}

export interface UsageSummary {
  billingCycleStart?: string;
  billingCycleEnd?: string;
  membershipType?: string;
  isUnlimited?: boolean;
  individualUsage?: {
    plan?: UsageBucket;
    onDemand?: UsageBucket;
  };
  teamUsage?: {
    onDemand?: UsageBucket;
  };
}

const PLANS: Record<string, string> = {
  free: "Free",
  hobby: "Hobby",
  pro: "Pro",
  pro_plus: "Pro+",
  pro_plus_annual: "Pro+",
  ultra: "Ultra",
  business: "Business",
  enterprise: "Enterprise",
  team: "Team",
};

const usdFromCents = (cents: number) => `$${(cents / 100).toFixed(2)}`;

function decodeJwtSub(token: string): string | undefined {
  const payload = token.split(".")[1];
  if (!payload) return undefined;
  try {
    const json = Buffer.from(payload, "base64url").toString("utf8");
    const sub = (JSON.parse(json) as { sub?: string }).sub;
    return typeof sub === "string" && sub.length > 0 ? sub : undefined;
  } catch {
    return undefined;
  }
}

/** Cursor sometimes stores the JWT as a UTF-16LE blob; reading that as UTF-8 inserts NULs. */
export function normalizeAccessToken(raw: string | Uint8Array | Buffer): string | undefined {
  let text: string;
  if (typeof raw === "string") {
    text = raw.includes("\0") ? Buffer.from(raw, "utf8").toString("utf16le") : raw;
  } else {
    const buf = Buffer.from(raw);
    text = buf.includes(0) ? buf.toString("utf16le") : buf.toString("utf8");
  }
  text = text.replace(/\0/g, "").trim();
  return text.includes(".") ? text : undefined;
}

export function sessionCookie(accessToken: string): string | undefined {
  const sub = decodeJwtSub(accessToken);
  if (!sub) return undefined;
  return `WorkosCursorSessionToken=${encodeURIComponent(`${sub}::${accessToken}`)}`;
}

function ideStatePaths(home = homedir()): string[] {
  const relative = join("Cursor", "User", "globalStorage", "state.vscdb");
  if (platform() === "darwin") {
    return [join(home, "Library", "Application Support", relative)];
  }
  if (platform() === "win32") {
    const appData = process.env.APPDATA || join(home, "AppData", "Roaming");
    return [join(appData, relative)];
  }
  const xdg = process.env.XDG_CONFIG_HOME || join(home, ".config");
  return [join(xdg, relative)];
}

function readTokenFromDb(dbPath: string): string | undefined {
  using db = new Database(dbPath, { readonly: true });
  const row = db.query("SELECT value FROM ItemTable WHERE key = ?").get(AUTH_KEY) as
    | { value: string | Uint8Array | Buffer }
    | null;
  if (!row) return undefined;
  return normalizeAccessToken(row.value);
}

/** Prefer a copy so a locked WAL (Cursor open) does not block the read. */
export async function readIdeAccessToken(home = homedir()): Promise<string | undefined> {
  for (const path of ideStatePaths(home)) {
    if (!(await Bun.file(path).exists())) continue;
    const dir = await mkdtemp(join(tmpdir(), "quota-pill-cursor-"));
    const copy = join(dir, "state.vscdb");
    try {
      await copyFile(path, copy);
      for (const suffix of ["-wal", "-shm"] as const) {
        const side = path + suffix;
        if (await Bun.file(side).exists()) {
          await copyFile(side, copy + suffix).catch(() => undefined);
        }
      }
      const token = readTokenFromDb(copy);
      if (token) return token;
    } catch {
      try {
        const token = readTokenFromDb(path);
        if (token) return token;
      } catch {
        // Try the next known path.
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
  return undefined;
}

async function readCliAccessToken(): Promise<string | undefined> {
  if (platform() === "darwin") {
    const res = await exec([
      "security",
      "find-generic-password",
      "-a",
      "cursor-user",
      "-s",
      "cursor-access-token",
      "-w",
    ]);
    if (res.code === 0) {
      const token = normalizeAccessToken(res.stdout.trim());
      if (token) return token;
    }
  }

  const home = homedir();
  const candidates = [
    join(home, ".cursor", "auth.json"),
    join(process.env.XDG_CONFIG_HOME || join(home, ".config"), "cursor", "auth.json"),
  ];
  for (const path of candidates) {
    try {
      const json = (await Bun.file(path).json()) as { accessToken?: string };
      const token = json.accessToken ? normalizeAccessToken(json.accessToken) : undefined;
      if (token) return token;
    } catch {
      // Missing or unreadable file — try the next candidate.
    }
  }
  return undefined;
}

export async function resolveAccessToken(home = homedir()): Promise<string | undefined> {
  return (await readIdeAccessToken(home)) ?? (await readCliAccessToken());
}

function planWindow(plan: UsageBucket | undefined, resetsAt: Date | undefined): QuotaWindow | undefined {
  if (!plan?.enabled) return undefined;
  const limit = plan.limit;
  const used = plan.used;
  const remaining = plan.remaining;
  if (limit == null || limit <= 0) {
    if (plan.totalPercentUsed === undefined) return undefined;
    return {
      id: "plan",
      label: "Plan",
      usedPct: clampPct(plan.totalPercentUsed),
      resetsAt,
    };
  }
  const usedPct = plan.totalPercentUsed !== undefined
    ? clampPct(plan.totalPercentUsed)
    : used !== undefined
    ? clampPct((used / limit) * 100)
    : remaining != null
    ? clampPct(((limit - remaining) / limit) * 100)
    : undefined;
  if (usedPct === undefined) return undefined;
  const left = remaining != null ? remaining : used !== undefined ? Math.max(0, limit - used) : undefined;
  return {
    id: "plan",
    label: "Plan",
    usedPct,
    resetsAt,
    detail: left !== undefined ? `${Math.round(left)}/${Math.round(limit)}` : undefined,
  };
}

function onDemandWindow(
  bucket: UsageBucket | undefined,
  id: string,
  label: string,
  resetsAt: Date | undefined,
  asCents: boolean,
): QuotaWindow | undefined {
  if (!bucket?.enabled) return undefined;
  const limit = bucket.limit;
  if (limit == null || limit <= 0) return undefined;
  const used = bucket.used ?? 0;
  const remaining = bucket.remaining ?? Math.max(0, limit - used);
  const fmt = asCents
    ? (n: number) => usdFromCents(n)
    : (n: number) => String(Math.round(n));
  return {
    id,
    label,
    usedPct: clampPct((used / limit) * 100),
    resetsAt,
    detail: `${fmt(remaining)}/${fmt(limit)}`,
  };
}

export function parseCursor(summary: UsageSummary) {
  if (summary.isUnlimited) {
    return {
      status: "ok" as const,
      plan: summary.membershipType ? PLANS[summary.membershipType] ?? titleCase(summary.membershipType) : undefined,
      windows: [] as QuotaWindow[],
      message: "Unlimited plan.",
    };
  }

  const resetsAt = summary.billingCycleEnd ? new Date(summary.billingCycleEnd) : undefined;
  const windows: QuotaWindow[] = [];
  const plan = planWindow(summary.individualUsage?.plan, resetsAt);
  if (plan) windows.push(plan);

  const individualExtra = onDemandWindow(
    summary.individualUsage?.onDemand,
    "extra",
    "Extra",
    resetsAt,
    true,
  );
  if (individualExtra) {
    windows.push(individualExtra);
  } else {
    const teamExtra = onDemandWindow(
      summary.teamUsage?.onDemand,
      "extra",
      "Extra",
      resetsAt,
      true,
    );
    if (teamExtra) windows.push(teamExtra);
  }

  const planName = summary.membershipType
    ? PLANS[summary.membershipType] ?? titleCase(summary.membershipType)
    : undefined;
  return { status: "ok" as const, plan: planName, windows };
}

function titleCase(value: string): string {
  return value
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => part[0]!.toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

export async function fetchUsageSummary(cookie: string): Promise<UsageSummary> {
  const res = await fetch(USAGE_SUMMARY_URL, {
    headers: {
      Cookie: cookie,
      Accept: "application/json",
    },
    redirect: "manual",
    signal: AbortSignal.timeout(8000),
  });
  if (res.status === 401 || res.status === 403) {
    throw new UnavailableError("Cursor session expired. Sign in to the Cursor IDE again.");
  }
  if (res.status >= 300 && res.status < 400) {
    throw new UnavailableError("Cursor session was rejected. Sign in to the Cursor IDE again.");
  }
  if (!res.ok) {
    throw new Error(`Cursor usage-summary returned HTTP ${res.status}.`);
  }
  return (await res.json()) as UsageSummary;
}

export const cursor: Adapter = {
  harness: "cursor",
  name: "Cursor",
  short: "CU",
  async collect() {
    const token = await resolveAccessToken();
    if (!token) throw new UnavailableError(NO_SESSION);
    const cookie = sessionCookie(token);
    if (!cookie) throw new UnavailableError(NO_SESSION);
    return parseCursor(await fetchUsageSummary(cookie));
  },
};
