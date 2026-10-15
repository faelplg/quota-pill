import { expect, mock, test } from "claude-code/testing";

const rateLimits = [
  { kind: "five_hour", percentUsed: 23.5, resetsAt: "2026-10-13T15:00:00.000Z" },
  { kind: "seven_day", percentUsed: 41, resetsAt: "2026-10-17T09:00:00.000Z" },
];
const measured = { context: { window: 200_000 }, rateLimits, changed: ["rateLimits" as const] };
const snapshot = "/Users/someone/Library/Caches/quota-pill/claude-rate-limits.json";
const ran = (exitCode: number) => ({
  value: { exitCode, stdout: "", stderr: "", isStdoutTruncated: false, isStderrTruncated: false },
});

test("writes the windows beside the snapshot and moves them over it", async ($, on) => {
  const writes: { path: string; text: string }[] = [];
  const runs: string[][] = [];
  mock.env(on, { HOME: "/Users/someone" });
  mock.clock(on);
  on("fs.write", ($, e) => (writes.push({ path: e.path, text: e.text }), { value: undefined }));
  on("process.run", ($, e) => (runs.push([...e.argv]), ran(0)));
  on("session.measure", ($, e) => ({ changed: e.changed }));

  await $.session.measure(measured);

  expect(writes.length).toBe(1);
  expect(writes[0]!.path).toMatch(/claude-rate-limits\.json\.[0-9a-f-]+\.tmp$/);
  expect(JSON.parse(writes[0]!.text).rateLimits).toEqual(rateLimits);
  expect(runs).toEqual([["/bin/mv", "-f", writes[0]!.path, snapshot]]);
});

test("writes in place when the move fails", async ($, on) => {
  const writes: string[] = [];
  mock.env(on, { HOME: "/Users/someone" });
  mock.clock(on);
  on("fs.write", ($, e) => (writes.push(e.path), { value: undefined }));
  on("process.run", ($, e) => ran(e.argv[0] === "/bin/mv" ? 1 : 0));
  on("session.measure", ($, e) => ({ changed: e.changed }));

  await $.session.measure(measured);

  expect(writes[1]).toBe(snapshot);
});

test("ignores XDG_CACHE_HOME, which the pill's LaunchAgent does not see", async ($, on) => {
  const runs: string[][] = [];
  mock.env(on, { HOME: "/Users/someone", XDG_CACHE_HOME: "/tmp/cache" });
  mock.clock(on);
  on("fs.write", () => ({ value: undefined }));
  on("process.run", ($, e) => (runs.push([...e.argv]), ran(0)));
  on("session.measure", ($, e) => ({ changed: e.changed }));

  await $.session.measure(measured);

  expect(runs[0]![3]).toBe(snapshot);
});

test("records nothing before the first reading and still passes the event on", async ($, on) => {
  on("session.measure", ($, e) => ({ changed: e.changed }));

  const result = await $.session.measure({ ...measured, rateLimits: [], changed: ["context"] });

  expect(result).toEqual({ changed: ["context"] });
});

test("records an empty list when the plan's windows go away", async ($, on) => {
  const texts: string[] = [];
  mock.env(on, { HOME: "/Users/someone" });
  mock.clock(on);
  on("fs.write", ($, e) => (texts.push(e.text), { value: undefined }));
  on("process.run", () => ran(0));
  on("session.measure", ($, e) => ({ changed: e.changed }));

  await $.session.measure({ ...measured, rateLimits: [] });

  expect(JSON.parse(texts[0]!).rateLimits).toEqual([]);
});

test("a failed write never breaks the event", async ($, on) => {
  mock.env(on, { HOME: "/Users/someone" });
  mock.clock(on);
  on("fs.write", () => ({ deny: "read-only" }));
  on("session.measure", ($, e) => ({ changed: e.changed }));

  const result = await $.session.measure(measured);

  expect(result).toEqual({ changed: ["rateLimits"] });
});
