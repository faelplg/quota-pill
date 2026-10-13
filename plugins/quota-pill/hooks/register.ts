import type { Hook, On, SessionRateLimit } from "claude-code";
import { snapshotPath, toSnapshot } from "./snapshot.js";

type Api = Parameters<Hook<"session.measure">>[0];

/** Records the plan windows Claude Code measures, for the pill to read. */
export function register(on: On) {
  on("session.measure", async ($, e, next) => {
    if (e.rateLimits.length > 0) {
      try {
        await record($, e.rateLimits);
      } catch {
        // Never disturb the session. The pill keeps showing the last snapshot.
      }
    }
    return next(e);
  });
}

async function record($: Api, rateLimits: readonly SessionRateLimit[]) {
  const home = await $.env.get("HOME");
  if (!home) return;
  const path = snapshotPath(home, await $.env.get("XDG_CACHE_HOME"));
  const text = JSON.stringify(toSnapshot(rateLimits, new Date(await $.clock.now())));

  // $.fs.write replaces content in place, so write beside the file and move it
  // over, keeping the collector from reading a half-written snapshot.
  const temporary = `${path}.${crypto.randomUUID()}.tmp`;
  await $.fs.write(temporary, text);
  const moved = await $.process.run(["/bin/mv", "-f", temporary, path]);
  if (moved.exitCode !== 0) {
    await $.process.run(["/bin/rm", "-f", temporary]);
    await $.fs.write(path, text);
  }
}
