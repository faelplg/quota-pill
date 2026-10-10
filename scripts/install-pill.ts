import { mkdir, readdir, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { exec } from "../src/exec.ts";

const LABEL = "org.quota-pill.agent";
const root = resolve(import.meta.dir, "..");
const binary = join(root, "app", ".build", "release", "QuotaPill");
const plist = join(homedir(), "Library", "LaunchAgents", `${LABEL}.plist`);
const uid = process.getuid?.() ?? Number((await exec(["id", "-u"])).stdout.trim());
const domain = `gui/${uid}`;

async function launchctl(...args: string[]) {
  return exec(["launchctl", ...args], 15_000);
}

async function removePreviousAgents() {
  const directory = join(homedir(), "Library", "LaunchAgents");
  const entries = await readdir(directory).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  for (const entry of entries) {
    if (!entry.endsWith(".quota-pill.plist")) continue;
    const previous = join(directory, entry);
    const program = await exec(["plutil", "-extract", "ProgramArguments.0", "raw", "-o", "-", previous]);
    if (program.code !== 0) throw new Error(`Cannot inspect previous Quota Pill agent: ${entry}`);
    if (program.stdout.trim() !== binary) continue;
    const label = await exec(["plutil", "-extract", "Label", "raw", "-o", "-", previous]);
    if (label.code !== 0) throw new Error(`Cannot read previous Quota Pill agent label: ${entry}`);
    const stopped = await launchctl("bootout", `${domain}/${label.stdout.trim()}`);
    if (stopped.code !== 0 && stopped.code !== 3) {
      throw new Error(stopped.stderr.trim() || `launchctl bootout exited with code ${stopped.code}`);
    }
    await unlink(previous);
  }
}

if (process.argv.includes("--uninstall")) {
  await removePreviousAgents();
  await launchctl("bootout", `${domain}/${LABEL}`);
  await unlink(plist).catch(() => undefined);
  console.log("Pill removed from login.");
  process.exit(0);
}

const build = Bun.spawnSync(["swift", "build", "-c", "release", "--package-path", join(root, "app")], {
  stdout: "inherit",
  stderr: "inherit",
});
if (build.exitCode !== 0) process.exit(build.exitCode ?? 1);

const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

await removePreviousAgents();
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
    <!-- Restart after a crash, but respect "Quit" from the context menu. -->
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
  console.error(boot.stderr.trim() || `launchctl bootstrap exited with code ${boot.code}`);
  process.exit(1);
}
console.log("Pill installed and started.");
