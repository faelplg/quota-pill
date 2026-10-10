import { antigravity } from "./adapters/antigravity.ts";
import { claude } from "./adapters/claude.ts";
import { codex } from "./adapters/codex.ts";
import { copilot } from "./adapters/copilot.ts";
import { UnavailableError, type Adapter, type HarnessReport } from "./types.ts";

export const adapters: Adapter[] = [copilot, codex, claude, antigravity];

const TIMEOUT_MS = 12_000;

async function run(adapter: Adapter, now: Date): Promise<HarnessReport> {
  const base = { harness: adapter.harness, name: adapter.name, short: adapter.short };
  try {
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Tempo esgotado ao consultar.")), TIMEOUT_MS).unref(),
    );
    return { ...base, ...(await Promise.race([adapter.collect(now), timeout])) };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ...base,
      status: err instanceof UnavailableError ? "unavailable" : "error",
      windows: [],
      message,
    };
  }
}

export function collectAll(now = new Date()): Promise<HarnessReport[]> {
  return Promise.all(adapters.map((a) => run(a, now)));
}
