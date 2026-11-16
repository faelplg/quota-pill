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
  token_based_billing?: boolean;
}

interface CopilotUser {
  login?: string;
  copilot_plan?: string;
  access_type_sku?: string;
  token_based_billing?: boolean;
  quota_reset_date_utc?: string;
  quota_reset_date?: string;
  quota_snapshots?: Record<string, Snapshot>;
}

export interface BillingSummary {
  usageItems?: { product?: string; sku?: string; unitType?: string; netAmount?: number; pricePerUnit?: number }[];
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
const AI_CREDIT_USD = 0.01;

function usesAiCredits(user: CopilotUser): boolean {
  return user.quota_snapshots?.premium_interactions?.token_based_billing ?? user.token_based_billing ?? false;
}

function planName(user: CopilotUser): string | undefined {
  // The quota endpoint can report individual_pro for a monthly Pro+ subscription.
  if (user.access_type_sku === "plus_monthly_subscriber_quota") return "Pro+";
  return user.copilot_plan ? PLANS[user.copilot_plan] ?? user.copilot_plan : undefined;
}

function premiumOverage(user: CopilotUser) {
  const snap = user.quota_snapshots?.premium_interactions;
  if (!snap?.overage_permitted || !snap.overage_entitlement) return undefined;
  return { count: snap.overage_count ?? 0, entitlement: snap.overage_entitlement };
}

function paidAiCreditSpend(report: BillingSummary | undefined): number | undefined {
  const amounts = report?.usageItems?.flatMap((item) => {
    const product = item.product?.toLowerCase();
    const unit = item.unitType?.toLowerCase();
    if (product !== "copilot" && product !== "copilot ai credits") return [];
    if (unit !== "ai-credits" && unit !== "credits") return [];
    return typeof item.netAmount === "number" && Number.isFinite(item.netAmount) ? [item.netAmount] : [];
  }) ?? [];
  if (amounts.length === 0) return undefined;
  return Math.max(0, amounts.reduce((sum, amount) => sum + amount, 0));
}

/** Show how much of the extra budget has been used. */
function extraWindow(user: CopilotUser, resetsAt: Date | undefined, billing?: BillingSummary) {
  const overage = premiumOverage(user);
  if (!overage) return undefined;
  let detail = `${Math.round(overage.count)}/${overage.entitlement}`;
  let usedPct = (overage.count / overage.entitlement) * 100;
  if (usesAiCredits(user)) {
    detail += " AI credits";
    const spent = paidAiCreditSpend(billing);
    const budget = overage.entitlement * AI_CREDIT_USD;
    // The billing report can lag the quota endpoint when paid usage begins.
    if (spent !== undefined && (spent > 0 || overage.count === 0)) {
      detail = `${usd(spent)}/${usd(budget)}`;
      usedPct = (spent / budget) * 100;
    }
  } else {
    const items = billing?.usageItems?.filter((i) => i.product?.toLowerCase() === "copilot") ?? [];
    const price = (items.find((i) => i.sku === "copilot_ai_unit") ?? items[0])?.pricePerUnit;
    if (price) {
      const spent = items.reduce((sum, i) => sum + (i.netAmount ?? 0), 0);
      detail = `${usd(spent)}/${usd(overage.entitlement * price)}`;
    }
  }
  return {
    id: "extra",
    label: "Extra (month)",
    usedPct: clampPct(usedPct),
    resetsAt,
    detail,
  } satisfies QuotaWindow;
}

export function parseCopilot(user: CopilotUser, billing?: BillingSummary) {
  const reset = user.quota_reset_date_utc ?? user.quota_reset_date;
  const resetsAt = reset ? new Date(reset) : undefined;
  const aiCredits = usesAiCredits(user);
  const windows: QuotaWindow[] = [];
  for (const [id, snap] of Object.entries(user.quota_snapshots ?? {})) {
    if (snap.unlimited || snap.percent_remaining === undefined) continue;
    const includedCredits = id === "premium_interactions" && aiCredits;
    let detail: string | undefined;
    if (snap.entitlement !== undefined && snap.remaining !== undefined) {
      const used = Math.round(snap.entitlement - snap.remaining);
      const included = includedCredits ? Math.min(snap.entitlement, Math.max(0, used)) : used;
      detail = `${included}/${snap.entitlement}`;
    }
    windows.push({
      id,
      label: includedCredits ? "AI credits (month)" : LABELS[id] ?? id,
      usedPct: clampPct(100 - snap.percent_remaining),
      resetsAt,
      detail,
    });
  }
  const extra = extraWindow(user, resetsAt, billing);
  if (extra) windows.push(extra);
  return { status: "ok" as const, plan: planName(user), windows };
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
  async collect(now) {
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
    const billingPath = usesAiCredits(user) ? "ai_credit/usage" : "usage/summary";
    const month = now.getUTCMonth() + 1;
    const billing = await exec([
      "gh", "api", `/users/${user.login}/settings/billing/${billingPath}?year=${now.getUTCFullYear()}&month=${month}`,
    ], BILLING_TIMEOUT_MS);
    if (billing.code !== 0) {
      return { ...parseCopilot(user), message: billingFailureMessage(billing.stderr, billing.code) };
    }
    return parseCopilot(user, JSON.parse(billing.stdout));
  },
};
