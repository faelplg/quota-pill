import { mkdir, readlink, symlink, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { exec } from "../src/exec.ts";

const DOMAIN = "com.ameba.SwiftBar";
const plugin = resolve(import.meta.dir, "..", "plugin", "ai-quota.2m.sh");

const configured = await exec(["defaults", "read", DOMAIN, "PluginDirectory"]);
let dir = configured.code === 0 ? configured.stdout.trim() : "";
if (!dir) {
  dir = join(homedir(), "Library", "Application Support", "SwiftBar", "Plugins");
  await exec(["defaults", "write", DOMAIN, "PluginDirectory", dir]);
  console.log(`Pasta de plugins do SwiftBar definida: ${dir}`);
}
await mkdir(dir, { recursive: true });

const link = join(dir, "ai-quota.2m.sh");
const existing = await readlink(link).catch(() => undefined);
if (existing !== plugin) {
  if (existing !== undefined || (await Bun.file(link).exists())) await unlink(link);
  await symlink(plugin, link);
}
console.log(`Plugin instalado: ${link} -> ${plugin}`);

const running = await exec(["pgrep", "-x", "SwiftBar"]);
await exec(running.code === 0 ? ["open", "-g", "swiftbar://refreshallplugins"] : ["open", "-a", "SwiftBar"]);
