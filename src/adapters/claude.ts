import { homedir } from "node:os";
import { join } from "node:path";
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
  ["seven_day", "Semana"],
  ["seven_day_opus", "Semana · Opus"],
  ["seven_day_sonnet", "Semana · Sonnet"],
];

const RENEW = "Abra o Claude Code para renovar o login.";

export function parseClaude(usage: Usage, subscriptionType?: string) {
  const windows: QuotaWindow[] = [];
  for (const [key, label] of WINDOWS) {
    const raw = usage[key] as RawWindow | null | undefined;
    if (!raw || typeof raw.utilization !== "number") continue;
    windows.push({
      id: key,
      label,
      usedPct: clampPct(raw.utilization),
      resetsAt: raw.resets_at ? new Date(raw.resets_at) : undefined,
    });
  }
  const extra = usage.extra_usage;
  if (extra?.is_enabled && typeof extra.utilization === "number") {
    windows.push({ id: "extra_usage", label: "Uso extra (mês)", usedPct: clampPct(extra.utilization) });
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
  if (!creds?.accessToken) throw new UnavailableError(`Login do Claude Code não encontrado. ${RENEW}`);
  return creds;
}

export const claude: Adapter = {
  harness: "claude",
  name: "Claude Code",
  short: "CC",
  async collect(now) {
    const creds = await readCredentials();
    // Never refresh the token here: refresh tokens rotate, and doing it outside
    // Claude Code would invalidate the copy Claude Code keeps in the Keychain.
    if (creds.expiresAt && creds.expiresAt <= now.getTime()) {
      throw new UnavailableError(`Token do Claude Code expirou. ${RENEW}`);
    }
    const res = await fetch("https://api.anthropic.com/api/oauth/usage", {
      headers: {
        Authorization: `Bearer ${creds.accessToken}`,
        "anthropic-beta": "oauth-2025-04-20",
      },
      signal: AbortSignal.timeout(8000),
    });
    if (res.status === 401) throw new UnavailableError(`Token do Claude Code recusado. ${RENEW}`);
    if (!res.ok) throw new Error(`api.anthropic.com respondeu ${res.status}`);
    return parseClaude((await res.json()) as Usage, creds.subscriptionType);
  },
};
