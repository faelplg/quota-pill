import { parseArgs } from "node:util";
import { evaluateAlerts, loadState, notify, saveState } from "./alerts.ts";
import { adapters, collectAll } from "./collect.ts";
import type { HarnessId } from "./types.ts";

const HARNESSES = adapters.map((a) => a.harness);

const USAGE = `Usage: bun src/cli.ts [--only <harness>] [--force] [--no-alerts]

  Prints normalized source reports as JSON and notifies when a quota crosses
  80% or 95%.

  --only <harness>  Queries only this harness (${HARNESSES.join(", ")}); can be repeated
  --force           Skips local caches and queries the source now
  --no-alerts       Sends no notifications and does not change alert state`;

async function main(argv: string[]): Promise<number> {
  let values;
  try {
    ({ values } = parseArgs({
      args: argv,
      options: {
        only: { type: "string", multiple: true },
        force: { type: "boolean" },
        "no-alerts": { type: "boolean" },
      },
    }));
  } catch {
    console.error(USAGE);
    return 2;
  }
  const only = values.only as HarnessId[] | undefined;
  if (only?.some((h) => !HARNESSES.includes(h))) {
    console.error(USAGE);
    return 2;
  }

  const reports = await collectAll(new Date(), { only, force: values.force });

  if (!values["no-alerts"]) {
    const { alerts, next } = evaluateAlerts(reports, await loadState());
    await Promise.all(alerts.map(notify));
    await saveState(next);
  }

  process.stdout.write(JSON.stringify(reports, null, 2) + "\n");
  return 0;
}

process.exitCode = await main(process.argv.slice(2));
