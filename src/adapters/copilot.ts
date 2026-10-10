import { exec } from "../exec.ts";
import { clampPct, UnavailableError, type Adapter, type QuotaWindow } from "../types.ts";

interface Snapshot {
  unlimited?: boolean;
  percent_remaining?: number;
  remaining?: number;
  entitlement?: number;
}

interface CopilotUser {
  copilot_plan?: string;
  quota_reset_date_utc?: string;
  quota_reset_date?: string;
  quota_snapshots?: Record<string, Snapshot>;
}

const LABELS: Record<string, string> = {
  premium_interactions: "Premium (month)",
  chat: "Chat (month)",
  completions: "Completions (month)",
};

const PLANS: Record<string, string> = {
  individual_pro: "Pro",
  individual_pro_plus: "Pro+",
  individual_free: "Free",
  business: "Business",
  enterprise: "Enterprise",
};

export function parseCopilot(user: CopilotUser) {
  const reset = user.quota_reset_date_utc ?? user.quota_reset_date;
  const resetsAt = reset ? new Date(reset) : undefined;
  const windows: QuotaWindow[] = [];
  for (const [id, snap] of Object.entries(user.quota_snapshots ?? {})) {
    if (snap.unlimited || snap.percent_remaining === undefined) continue;
    const used = snap.entitlement !== undefined && snap.remaining !== undefined
      ? `${Math.round(snap.entitlement - snap.remaining)}/${snap.entitlement}`
      : undefined;
    windows.push({
      id,
      label: LABELS[id] ?? id,
      usedPct: clampPct(100 - snap.percent_remaining),
      resetsAt,
      detail: used,
    });
  }
  const plan = user.copilot_plan ? PLANS[user.copilot_plan] ?? user.copilot_plan : undefined;
  return { status: "ok" as const, plan, windows };
}

export const copilot: Adapter = {
  harness: "copilot",
  name: "GitHub Copilot",
  short: "CP",
  async collect() {
    const res = await exec(["gh", "api", "/copilot_internal/user"]);
    if (res.code === 127) throw new UnavailableError("GitHub CLI (gh) was not found in PATH.");
    if (res.code !== 0) {
      if (/auth login|401/i.test(res.stderr)) {
        throw new UnavailableError("gh sem login. Rode `gh auth login`.");
      }
      throw new Error(res.stderr.trim().split("\n")[0] || `gh exited with code ${res.code}`);
    }
    return parseCopilot(JSON.parse(res.stdout));
  },
};
