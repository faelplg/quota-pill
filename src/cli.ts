import { evaluateAlerts, loadState, notify, saveState } from "./alerts.ts";
import { collectAll } from "./collect.ts";
import { renderSwiftBar } from "./render.ts";

const USAGE = `Uso: bun src/cli.ts [swiftbar|json] [--no-alerts]

  swiftbar   Saída no formato de plugin do SwiftBar (padrão)
  json       Relatório normalizado de todas as fontes
  --no-alerts  Não envia notificações nem altera o estado dos alertas`;

async function main(argv: string[]): Promise<number> {
  const command = argv.find((a) => !a.startsWith("-")) ?? "swiftbar";
  const alertsEnabled = !argv.includes("--no-alerts");

  if (command !== "swiftbar" && command !== "json") {
    console.error(USAGE);
    return 2;
  }

  const now = new Date();
  const reports = await collectAll(now);

  if (alertsEnabled) {
    const { alerts, next } = evaluateAlerts(reports, await loadState());
    await Promise.all(alerts.map(notify));
    await saveState(next);
  }

  process.stdout.write(command === "json" ? JSON.stringify(reports, null, 2) + "\n" : renderSwiftBar(reports, now));
  return 0;
}

process.exitCode = await main(process.argv.slice(2));
