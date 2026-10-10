import { describe, expect, test } from "bun:test";
import { parseAntigravity } from "../src/adapters/antigravity.ts";
import { findLatestSnapshot, parseCodex } from "../src/adapters/codex.ts";
import { evaluateAlerts } from "../src/alerts.ts";
import { renderTitle } from "../src/render.ts";
import type { HarnessReport } from "../src/types.ts";

const now = new Date("2026-10-10T03:00:00Z");

describe("antigravity", () => {
  test("treats an omitted remainingFraction as exhausted", () => {
    const { windows } = parseAntigravity({
      userStatus: {
        cascadeModelConfigData: {
          clientModelConfigs: [
            { label: "Claude Opus 5.5 (High)", quotaInfo: { resetTime: "2026-10-10T07:00:00Z" } },
            { label: "Gemini 3.1 Pro (Low)", quotaInfo: { remainingFraction: 0.75 } },
          ],
        },
      },
    });
    expect(windows.map((w) => [w.label, w.usedPct])).toEqual([
      ["Claude Opus 5.5", 100],
      ["Gemini 3.1 Pro", 25],
    ]);
  });

  test("collapses models that share one quota into a single window", () => {
    const quotaInfo = { remainingFraction: 0.5, resetTime: "2026-10-10T07:00:00Z" };
    const { windows } = parseAntigravity({
      userStatus: {
        cascadeModelConfigData: {
          clientModelConfigs: [
            { label: "Gemini 3.8 Flash (Low)", quotaInfo },
            { label: "Gemini 3.8 Flash (High)", quotaInfo },
            { label: "Claude Opus 5.5 (Low)", quotaInfo },
          ],
        },
      },
    });
    expect(windows).toHaveLength(1);
    expect(windows[0]).toMatchObject({ label: "Todos os modelos", usedPct: 50, detail: "2 modelos" });
  });
});

describe("codex", () => {
  const event = (ts: string, rateLimits: unknown) =>
    JSON.stringify({ timestamp: ts, type: "event_msg", payload: { type: "token_count", rate_limits: rateLimits } });

  test("uses the last complete event with rate limits", () => {
    const jsonl = [
      event("2026-10-09T10:00:00Z", { primary: { used_percent: 10, window_minutes: 300 } }),
      event("2026-10-09T11:00:00Z", { primary: { used_percent: 20, window_minutes: 300 } }),
      event("2026-10-09T12:00:00Z", null),
      '{"timestamp":"2026-10-09T13:00:00Z","payload":{"rate_limits":{"primary"',
    ].join("\n");
    const snapshot = findLatestSnapshot(jsonl);
    expect(snapshot?.timestamp.toISOString()).toBe("2026-10-09T11:00:00.000Z");
    expect(snapshot?.rateLimits.primary?.used_percent).toBe(20);
  });

  test("reports a window whose reset already passed as empty", () => {
    const past = Math.floor(now.getTime() / 1000) - 60;
    const future = past + 3600;
    const { windows } = parseCodex(
      {
        timestamp: new Date("2026-10-09T12:00:00Z"),
        rateLimits: {
          primary: { used_percent: 90, window_minutes: 300, resets_at: past },
          secondary: { used_percent: 40, window_minutes: 10080, resets_at: future },
        },
      },
      now,
    );
    expect(windows.map((w) => [w.label, w.usedPct])).toEqual([["5h", 0], ["Semana", 40]]);
  });
});

describe("alerts", () => {
  const report = (usedPct: number, resetsAt = new Date("2026-10-10T05:30:00.112Z")): HarnessReport => ({
    harness: "claude",
    name: "Claude Code",
    short: "CC",
    status: "ok",
    windows: [{ id: "five_hour", label: "5h", usedPct, resetsAt }],
  });

  test("notifies once per threshold and re-arms on a new reset cycle", () => {
    const first = evaluateAlerts([report(82)], {});
    expect(first.alerts.map((a) => a.body)).toEqual(["5h passou de 80%."]);

    const jittered = evaluateAlerts([report(85, new Date("2026-10-10T05:30:00.301Z"))], first.next);
    expect(jittered.alerts).toEqual([]);

    const critical = evaluateAlerts([report(96)], jittered.next);
    expect(critical.alerts.map((a) => a.body)).toEqual(["5h passou de 95%."]);

    const nextCycle = evaluateAlerts([report(81, new Date("2026-10-10T10:30:00Z"))], critical.next);
    expect(nextCycle.alerts).toHaveLength(1);
  });

  test("keeps state while a source is unreachable", () => {
    const { next } = evaluateAlerts([report(90)], {});
    const offline = evaluateAlerts([{ ...report(0), status: "error", windows: [] }], next);
    expect(evaluateAlerts([report(90)], offline.next).alerts).toEqual([]);
  });
});

test("menu bar title is blue until a quota crosses a threshold", () => {
  const base = { name: "", windows: [] };
  const ok = (usedPct: number) => ({
    ...base, harness: "copilot" as const, short: "CP", status: "ok" as const,
    windows: [{ id: "p", label: "p", usedPct }],
  });
  const others: HarnessReport[] = [
    { ...base, harness: "codex", short: "CX", status: "error" },
    { ...base, harness: "antigravity", short: "AG", status: "unavailable" },
  ];
  expect(renderTitle([ok(46.4), ...others])).toBe("CP 46  CX !  AG – | color=#0A6CDB,#5AA9FF");
  expect(renderTitle([ok(96), ...others])).toBe("CP 96  CX !  AG – | color=#E5484D");
});
