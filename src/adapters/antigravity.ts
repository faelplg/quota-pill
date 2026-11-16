import { exec } from "../exec.ts";
import { clampPct, UnavailableError, type Adapter, type QuotaWindow } from "../types.ts";

interface ModelConfig {
  label?: string;
  disabled?: boolean;
  quotaInfo?: { remainingFraction?: number; resetTime?: string };
}

interface ModelQuota {
  remaining: number;
  resetTime?: string;
}

interface UserStatusResponse {
  userStatus?: {
    planStatus?: { planInfo?: { planName?: string } };
    cascadeModelConfigData?: { clientModelConfigs?: ModelConfig[] };
  };
}

interface Server {
  pid: number;
  csrf: string;
}

const OPEN_APP = "Open Antigravity to read the quota.";

export function parseAntigravity(body: UserStatusResponse) {
  const configs = body.userStatus?.cascadeModelConfigData?.clientModelConfigs ?? [];
  const byModel = new Map<string, Map<string, ModelQuota>>();
  for (const config of configs) {
    if (!config.label || !config.quotaInfo || config.disabled) continue;
    const label = config.label;
    const model = label.replace(/\s*\((low|medium|high|xhigh)\)\s*$/i, "");
    const variants = byModel.get(model) ?? new Map<string, ModelQuota>();
    // Protobuf JSON omits zero values, so a missing fraction means nothing is left.
    const remaining = config.quotaInfo.remainingFraction ?? 0;
    const current = variants.get(label);
    if (!current || remaining < current.remaining) {
      variants.set(label, { remaining, resetTime: config.quotaInfo.resetTime });
    }
    byModel.set(model, variants);
  }

  const windows: QuotaWindow[] = [];
  for (const [model, variants] of byModel) {
    const [first, ...others] = variants.values();
    if (!first) continue;
    // Show identical readings once within a named model. Distinct models can have independent limits.
    const identical = others.every((q) => q.remaining === first.remaining && q.resetTime === first.resetTime);
    for (const [label, q] of identical ? [[model, first]] as const : variants) {
      windows.push({
        id: label,
        label,
        usedPct: clampPct((1 - q.remaining) * 100),
        resetsAt: q.resetTime ? new Date(q.resetTime) : undefined,
      });
    }
  }
  windows.sort((a, b) => b.usedPct - a.usedPct || a.label.localeCompare(b.label));

  return {
    status: "ok" as const,
    plan: body.userStatus?.planStatus?.planInfo?.planName,
    windows,
  };
}

export function findServers(psOutput: string): Server[] {
  const servers: Server[] = [];
  for (const line of psOutput.split("\n")) {
    if (!/language_server/.test(line) || !/antigravity/i.test(line)) continue;
    const pid = Number(line.trim().split(/\s+/, 1)[0]);
    const csrf = line.match(/--csrf_token[= ](\S+)/)?.[1];
    if (pid && csrf) servers.push({ pid, csrf });
  }
  return servers;
}

async function listeningPorts(pid: number): Promise<number[]> {
  const res = await exec(["lsof", "-nP", "-a", "-p", String(pid), "-iTCP", "-sTCP:LISTEN"]);
  const ports = res.stdout
    .split("\n")
    .slice(1)
    .map((line) => Number(line.match(/:(\d+)\s+\(LISTEN\)/)?.[1]))
    .filter((p) => p > 0);
  return [...new Set(ports)];
}

async function queryUserStatus(port: number, csrf: string): Promise<UserStatusResponse | undefined> {
  try {
    const res = await fetch(
      `https://127.0.0.1:${port}/exa.language_server_pb.LanguageServerService/GetUserStatus`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Connect-Protocol-Version": "1",
          "X-Codeium-Csrf-Token": csrf,
        },
        body: JSON.stringify({ metadata: { ideName: "antigravity", extensionName: "antigravity", locale: "en" } }),
        // The language server uses a self-signed certificate on loopback.
        tls: { rejectUnauthorized: false },
        signal: AbortSignal.timeout(4000),
      },
    );
    if (!res.ok) return undefined;
    const body = (await res.json()) as UserStatusResponse;
    return body.userStatus ? body : undefined;
  } catch {
    return undefined;
  }
}

export const antigravity: Adapter = {
  harness: "antigravity",
  name: "Antigravity",
  short: "AG",
  async collect() {
    const ps = await exec(["ps", "-axo", "pid=,args="]);
    const servers = findServers(ps.stdout);
    if (servers.length === 0) throw new UnavailableError(OPEN_APP);
    for (const server of servers) {
      for (const port of await listeningPorts(server.pid)) {
        const body = await queryUserStatus(port, server.csrf);
        if (body) return parseAntigravity(body);
      }
    }
    throw new Error("Antigravity is open, but the language server did not respond.");
  },
};
