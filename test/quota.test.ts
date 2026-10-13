import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { snapshotPath } from "../plugins/quota-pill/hooks/snapshot.ts";
import { parseAntigravity } from "../src/adapters/antigravity.ts";
import { parseClaude } from "../src/adapters/claude.ts";
import { findLatestSnapshot, parseCodex } from "../src/adapters/codex.ts";
import { evaluateAlerts } from "../src/alerts.ts";
import type { HarnessReport } from "../src/types.ts";

const now = new Date("2026-10-10T03:00:00Z");

describe("claude", () => {
  test("resets windows whose recorded reset time has passed", () => {
    const { windows, dataAsOf } = parseClaude(
      {
        capturedAt: "2026-10-10T01:00:00.000Z",
        rateLimits: [
          { kind: "seven_day", percentUsed: 17, resetsAt: "2026-10-16T14:00:00Z" },
          { kind: "five_hour", percentUsed: 77, resetsAt: "2026-10-10T02:30:00Z" },
        ],
      },
      now,
    );
    expect(windows.map((w) => [w.id, w.label, w.usedPct, w.resetsAt !== undefined])).toEqual([
      ["five_hour", "5h", 0, false],
      ["seven_day", "Week", 17, true],
    ]);
    expect(dataAsOf).toEqual(new Date("2026-10-10T01:00:00Z"));
  });

  test("clamps an exceeded spend limit and keeps unknown windows last", () => {
    const { windows } = parseClaude(
      {
        capturedAt: "2026-10-10T02:59:00.000Z",
        rateLimits: [
          { kind: "future_window", percentUsed: 5 },
          { kind: "spend_limit", percentUsed: 112.5, resetsAt: "2026-11-01T00:00:00Z" },
        ],
      },
      now,
    );
    expect(windows.map((w) => [w.label, w.usedPct])).toEqual([
      ["Spend limit", 100],
      ["future_window", 5],
    ]);
  });

  test("the collector reads the snapshot under HOME and explains an empty one", async () => {
    const home = await mkdtemp(join(tmpdir(), "quota-pill-home-"));
    const collect = async () => {
      const cli = join(import.meta.dir, "..", "src", "cli.ts");
      const child = Bun.spawn([process.execPath, cli, "--only", "claude", "--no-alerts"], {
        // A different XDG_CACHE_HOME must not move the snapshot the plugin writes.
        env: { ...Bun.env, HOME: home, XDG_CACHE_HOME: join(home, "elsewhere") },
        stdout: "pipe",
      });
      const [report] = JSON.parse(await new Response(child.stdout).text()) as HarnessReport[];
      return report!;
    };
    const write = (rateLimits: unknown[]) =>
      Bun.write(snapshotPath(home), JSON.stringify({ capturedAt: now.toISOString(), rateLimits }));
    try {
      expect((await collect()).message).toStartWith("No Claude Code usage recorded yet");
      await write([]);
      expect((await collect()).message).toContain("only on Pro and Max plans");
      await write([{ kind: "five_hour", percentUsed: 12 }]);
      expect((await collect()).windows.map((w) => w.usedPct)).toEqual([12]);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

});

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
    expect(windows[0]).toMatchObject({ label: "All models", usedPct: 50, detail: "2 models" });
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
    expect(windows.map((w) => [w.label, w.usedPct])).toEqual([["5h", 0], ["Week", 40]]);
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
    expect(first.alerts.map((a) => a.body)).toEqual(["5h crossed 80%."]);

    const jittered = evaluateAlerts([report(85, new Date("2026-10-10T05:30:00.301Z"))], first.next);
    expect(jittered.alerts).toEqual([]);

    const critical = evaluateAlerts([report(96)], jittered.next);
    expect(critical.alerts.map((a) => a.body)).toEqual(["5h crossed 95%."]);

    const nextCycle = evaluateAlerts([report(81, new Date("2026-10-10T10:30:00Z"))], critical.next);
    expect(nextCycle.alerts).toHaveLength(1);
  });

  test("keeps state for sources left out of a partial refresh", () => {
    const { next } = evaluateAlerts([report(90)], {});
    const partial = evaluateAlerts([{ ...report(10), harness: "codex" }], next);
    expect(evaluateAlerts([report(90)], partial.next).alerts).toEqual([]);
  });

  test("keeps state while a source is unreachable", () => {
    const { next } = evaluateAlerts([report(90)], {});
    const offline = evaluateAlerts([{ ...report(0), status: "error", windows: [] }], next);
    expect(evaluateAlerts([report(90)], offline.next).alerts).toEqual([]);
  });
});
