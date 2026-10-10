import { mkdir, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { exec } from "../src/exec.ts";

const LABEL = "dev.faelplg.quota-pill";
const root = resolve(import.meta.dir, "..");
const binary = join(root, "app", ".build", "release", "QuotaPill");
const plist = join(homedir(), "Library", "LaunchAgents", `${LABEL}.plist`);
const uid = process.getuid?.() ?? Number((await exec(["id", "-u"])).stdout.trim());
const domain = `gui/${uid}`;

async function launchctl(...args: string[]) {
  return exec(["launchctl", ...args], 15_000);
}

if (process.argv.includes("--uninstall")) {
  await launchctl("bootout", `${domain}/${LABEL}`);
  await unlink(plist).catch(() => undefined);
  console.log("Pílula removida do login.");
  process.exit(0);
}

const build = Bun.spawnSync(["swift", "build", "-c", "release", "--package-path", join(root, "app")], {
  stdout: "inherit",
  stderr: "inherit",
});
if (build.exitCode !== 0) process.exit(build.exitCode ?? 1);

const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

await mkdir(join(homedir(), "Library", "LaunchAgents"), { recursive: true });
await Bun.write(
  plist,
  `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xml(binary)}</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>QUOTA_PILL_ROOT</key>
    <string>${xml(root)}</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <dict>
    <!-- Restart after a crash, but respect "Sair" from the context menu. -->
    <key>SuccessfulExit</key>
    <false/>
  </dict>
  <key>LimitLoadToSessionType</key>
  <string>Aqua</string>
  <key>ProcessType</key>
  <string>Interactive</string>
</dict>
</plist>
`,
);

// Reload so a rebuilt binary or changed plist takes effect right away. bootout
// finishes asynchronously, so retry bootstrap briefly while it settles.
await launchctl("bootout", `${domain}/${LABEL}`);
let boot = await launchctl("bootstrap", domain, plist);
for (let attempt = 0; boot.code !== 0 && attempt < 10; attempt++) {
  await Bun.sleep(300);
  boot = await launchctl("bootstrap", domain, plist);
}
if (boot.code !== 0) {
  console.error(boot.stderr.trim() || `launchctl bootstrap saiu com código ${boot.code}`);
  process.exit(1);
}
console.log(`Pílula instalada e iniciada: ${plist}`);
