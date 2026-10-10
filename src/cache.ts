import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export function cachePath(name: string): string {
  const base = process.env.XDG_CACHE_HOME || join(homedir(), "Library", "Caches");
  return join(base, "ai-quota", name);
}

export async function readJson<T>(path: string): Promise<T | undefined> {
  try {
    return await Bun.file(path).json();
  } catch {
    return undefined;
  }
}

export async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await Bun.write(path, JSON.stringify(value, null, 2));
}
