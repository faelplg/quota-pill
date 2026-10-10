import { worstPct, type HarnessId, type HarnessReport, type QuotaWindow } from "./types.ts";

const WARN = 80;
const CRITICAL = 95;

const COLORS = {
  accent: "#0A6CDB,#5AA9FF",
  // Styled SwiftBar items lose the menu's default text color, so set it per appearance.
  text: "#1D1D1F,#F2F2F7",
  warn: "#E8890C",
  critical: "#E5484D",
  muted: "#8E8E93",
};

const LINKS: Partial<Record<HarnessId, string>> = {
  copilot: "https://github.com/settings/billing/premium_requests_usage",
  codex: "https://chatgpt.com/codex/settings/usage",
  claude: "https://claude.ai/settings/usage",
};

function level(pct: number): "warn" | "critical" | undefined {
  if (pct >= CRITICAL) return "critical";
  if (pct >= WARN) return "warn";
  return undefined;
}

/** SwiftBar treats "|" as the start of parameters and newlines as new items. */
function clean(text: string): string {
  return text.replace(/\|/g, "¦").replace(/\s*\n\s*/g, " ");
}

export function formatRelative(target: Date, now: Date): string {
  const minutes = Math.max(0, Math.round((target.getTime() - now.getTime()) / 60_000));
  if (minutes < 60) return `${minutes}min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${String(minutes % 60).padStart(2, "0")}min`;
  const days = Math.floor(hours / 24);
  return days < 7 ? `${days}d ${hours % 24}h` : `${days}d`;
}

function formatClock(date: Date): string {
  return date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function formatWhen(date: Date, now: Date): string {
  if (date.toDateString() === now.toDateString()) return formatClock(date);
  const day = date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
  return `${day} ${formatClock(date)}`;
}

function bar(pct: number, cells = 10): string {
  const filled = Math.round((pct / 100) * cells);
  return "▰".repeat(filled) + "▱".repeat(cells - filled);
}

/**
 * Plain text instead of ANSI: SwiftBar renders ANSI titles without native
 * vibrancy, which reads as disabled. The whole title takes the worst level's
 * color, with a light/dark blue pair when everything is under the thresholds.
 */
export function renderTitle(reports: HarnessReport[]): string {
  let worst = 0;
  const parts = reports.map((r) => {
    if (r.status === "error") return `${r.short} !`;
    const pct = worstPct(r);
    if (pct === undefined) return `${r.short} –`;
    worst = Math.max(worst, pct);
    return `${r.short} ${Math.round(pct)}`;
  });
  return `${parts.join("  ")} | color=${COLORS[level(worst) ?? "accent"]}`;
}

function renderWindow(w: QuotaWindow, labelWidth: number, now: Date): string {
  const pct = `${Math.round(w.usedPct)}%`.padStart(4);
  const tail = [w.resetsAt ? `reinicia em ${formatRelative(w.resetsAt, now)}` : undefined, w.detail]
    .filter(Boolean)
    .join(" · ");
  const lvl = level(w.usedPct);
  const color = ` color=${COLORS[lvl ?? "text"]}`;
  const text = `${w.label.padEnd(labelWidth)}  ${pct}  ${bar(w.usedPct)}  ${tail}`.trimEnd();
  return `${clean(text)} | font=Menlo size=12${color}`;
}

export function renderSection(report: HarnessReport, now: Date): string[] {
  const link = LINKS[report.harness];
  const header = [report.name, report.plan].filter(Boolean).join(" · ");
  const lines = [`${clean(header)} | size=13 color=${COLORS.accent}${link ? ` href=${link}` : ""}`];

  if (report.status !== "ok") {
    const icon = report.status === "error" ? "⚠ " : "";
    const color = report.status === "error" ? COLORS.critical : COLORS.muted;
    const action = report.harness === "antigravity" && report.status === "unavailable"
      ? " bash=/usr/bin/open param1=-a param2=Antigravity terminal=false refresh=true"
      : "";
    lines.push(`${icon}${clean(report.message ?? "Indisponível.")} | size=12 color=${color}${action}`);
    return lines;
  }

  if (report.windows.length === 0) {
    lines.push(`Sem limites ativos. | size=12 color=${COLORS.muted}`);
  }
  const width = Math.max(0, ...report.windows.map((w) => w.label.length));
  for (const w of report.windows) lines.push(renderWindow(w, width, now));

  const caveat = [report.dataAsOf ? `Dados de ${formatWhen(report.dataAsOf, now)}` : undefined, report.message]
    .filter(Boolean)
    .join(" · ");
  if (caveat) lines.push(`${clean(caveat)} | size=11 color=${COLORS.muted}`);
  return lines;
}

export function renderSwiftBar(reports: HarnessReport[], now: Date): string {
  const lines = [renderTitle(reports), "---"];
  reports.forEach((report, i) => {
    if (i > 0) lines.push("---");
    lines.push(...renderSection(report, now));
  });
  lines.push("---", "Atualizar agora | refresh=true", `Atualizado às ${formatClock(now)} | size=11 color=${COLORS.muted}`);
  return lines.join("\n") + "\n";
}
