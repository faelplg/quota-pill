import { parseArgs } from "node:util";
import { evaluateAlerts, loadState, notify, saveState } from "./alerts.ts";
import { adapters, collectAll } from "./collect.ts";
import type { HarnessId } from "./types.ts";

const HARNESSES = adapters.map((a) => a.harness);

const USAGE = `Uso: bun src/cli.ts [--only <harness>] [--force] [--no-alerts]

  Imprime o relatório normalizado das fontes, em JSON, e notifica quando
  uma quota cruza 80% ou 95%.

  --only <harness>  Consulta só esse harness (${HARNESSES.join(", ")}); pode repetir
  --force           Ignora caches locais e consulta a fonte agora
  --no-alerts       Não envia notificações nem altera o estado dos alertas`;

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
