import { evaluateAlerts, loadState, notify, saveState } from "./alerts.ts";
import { collectAll } from "./collect.ts";

const USAGE = `Uso: bun src/cli.ts [--no-alerts]

  Imprime o relatório normalizado de todas as fontes, em JSON, e notifica
  quando uma quota cruza 80% ou 95%.

  --no-alerts  Não envia notificações nem altera o estado dos alertas`;

async function main(argv: string[]): Promise<number> {
  if (argv.some((a) => a !== "--no-alerts")) {
    console.error(USAGE);
    return 2;
  }

  const reports = await collectAll();

  if (!argv.includes("--no-alerts")) {
    const { alerts, next } = evaluateAlerts(reports, await loadState());
    await Promise.all(alerts.map(notify));
    await saveState(next);
  }

  process.stdout.write(JSON.stringify(reports, null, 2) + "\n");
  return 0;
}

process.exitCode = await main(process.argv.slice(2));
