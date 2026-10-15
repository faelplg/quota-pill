import { exec } from "../exec.ts";
import { clampPct, UnavailableError, type Adapter, type QuotaWindow } from "../types.ts";

interface Snapshot {
  unlimited?: boolean;
  percent_remaining?: number;
  remaining?: number;
  entitlement?: number;
  overage_permitted?: boolean;
  overage_count?: number;
  overage_entitlement?: number;
}

interface CopilotUser {
  login?: string;
  copilot_plan?: string;
  quota_reset_date_utc?: string;
  quota_reset_date?: string;
  quota_snapshots?: Record<string, Snapshot>;
}

export interface BillingSummary {
  usageItems?: { product?: string; sku?: string; netAmount?: number; pricePerUnit?: number }[];
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

const usd = (n: number) => `$${n.toFixed(2)}`;

function premiumOverage(user: CopilotUser) {
  const snap = user.quota_snapshots?.premium_interactions;
  if (!snap?.overage_permitted || !snap.overage_entitlement) return undefined;
  return { count: snap.overage_count ?? 0, entitlement: snap.overage_entitlement };
}

/** Extra spend past the plan, in dollars when the billing summary is available, units otherwise. */
function extraWindow(user: CopilotUser, resetsAt: Date | undefined, billing?: BillingSummary) {
  const overage = premiumOverage(user);
  if (!overage) return undefined;
  let detail = `${Math.round(overage.count)}/${overage.entitlement}`;
  const items = billing?.usageItems?.filter((i) => i.product?.toLowerCase() === "copilot") ?? [];
  const price = (items.find((i) => i.sku === "copilot_ai_unit") ?? items[0])?.pricePerUnit;
  if (price) {
    const spent = items.reduce((sum, i) => sum + (i.netAmount ?? 0), 0);
    detail = `${usd(spent)}/${usd(overage.entitlement * price)}`;
  }
  return {
    id: "extra",
    label: "Extra (month)",
    usedPct: clampPct((overage.count / overage.entitlement) * 100),
    resetsAt,
    detail,
  } satisfies QuotaWindow;
}

export function parseCopilot(user: CopilotUser, billing?: BillingSummary) {
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
  const extra = extraWindow(user, resetsAt, billing);
  if (extra) windows.push(extra);
  const plan = user.copilot_plan ? PLANS[user.copilot_plan] ?? user.copilot_plan : undefined;
  return { status: "ok" as const, plan, windows };
}

/** Leaves room inside the collector deadline after the quota request, so a slow billing call keeps the quota windows. */
const BILLING_TIMEOUT_MS = 3000;

export function billingFailureMessage(stderr: string, code: number) {
  if (/"user" scope|-s user/.test(stderr)) {
    return "Run `gh auth refresh -h github.com -s user` to see extra spend in dollars.";
  }
  const detail = stderr.trim().split("\n")[0] || `gh exited with code ${code}`;
  return `Extra spend shown in units. Billing request failed: ${detail}`;
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
        throw new UnavailableError("gh is not authenticated. Run `gh auth login`.");
      }
      throw new Error(res.stderr.trim().split("\n")[0] || `gh exited with code ${res.code}`);
    }
    const user: CopilotUser = JSON.parse(res.stdout);
    if (!premiumOverage(user) || !user.login) return parseCopilot(user);
    const billing = await exec(
      ["gh", "api", `/users/${user.login}/settings/billing/usage/summary`],
      BILLING_TIMEOUT_MS,
    );
    if (billing.code !== 0) {
      return { ...parseCopilot(user), message: billingFailureMessage(billing.stderr, billing.code) };
    }
    return parseCopilot(user, JSON.parse(billing.stdout));
  },
};
