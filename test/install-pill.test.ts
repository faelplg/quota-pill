import { expect, test } from "bun:test";
import { copyFile, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const macTest = process.platform === "darwin" ? test : test.skip;

macTest("installer migrates only previous agents targeting the same checkout", async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "quota-pill-install-")));
  try {
    const home = join(directory, "home");
    const agents = join(home, "Library", "LaunchAgents");
    const tools = join(directory, "tools");
    await Promise.all([
      mkdir(agents, { recursive: true }),
      mkdir(tools),
      mkdir(join(directory, "scripts")),
      mkdir(join(directory, "src")),
    ]);
    await Promise.all([
      copyFile(join(root, "scripts", "install-pill.ts"), join(directory, "scripts", "install-pill.ts")),
      copyFile(join(root, "src", "exec.ts"), join(directory, "src", "exec.ts")),
      writeFile(join(tools, "swift"), "#!/bin/sh\nexit 0\n", { mode: 0o755 }),
      writeFile(join(tools, "launchctl"), '#!/bin/sh\nprintf "%s\\n" "$*" >> "$AGENT_LOG"\nexit 0\n', { mode: 0o755 }),
    ]);
    const binary = join(directory, "app", ".build", "release", "QuotaPill");
    const previousLabel = "dev.previous-owner.quota-pill";
    const previous = join(agents, `${previousLabel}.plist`);
    const unrelated = join(agents, "dev.unrelated.quota-pill.plist");
    const xml = (label: string, program: string) =>
      `<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>Label</key><string>${label}</string><key>ProgramArguments</key><array><string>${program.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</string></array></dict></plist>`;
    await writeFile(previous, xml(previousLabel, binary));
    const unrelatedContent = xml("dev.unrelated.quota-pill", "/unrelated/QuotaPill");
    await writeFile(unrelated, unrelatedContent);
    const log = join(directory, "launchctl.log");
    const bun = process.execPath;
    const run = async (...args: string[]) => {
      const child = Bun.spawn([bun, join(directory, "scripts", "install-pill.ts"), ...args], {
        env: { ...Bun.env, HOME: home, PATH: `${tools}:/usr/bin:/bin`, AGENT_LOG: log },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, code] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);
      expect({ code, stderr }).toEqual({ code: 0, stderr: "" });
      return stdout;
    };
    expect(await run()).toBe("Pill installed and started.\n");
    expect(await Bun.file(previous).exists()).toBe(false);
    expect(await readFile(unrelated, "utf8")).toBe(unrelatedContent);
    const current = join(agents, "org.quota-pill.agent.plist");
    expect(await readFile(current, "utf8")).toContain("<string>org.quota-pill.agent</string>");
    expect(await readFile(log, "utf8")).toContain(`/${previousLabel}`);

    await writeFile(previous, xml(previousLabel, binary));
    expect(await run("--uninstall")).toBe("Pill removed from login.\n");
    expect(await Bun.file(previous).exists()).toBe(false);
    expect(await Bun.file(current).exists()).toBe(false);
    expect(await readFile(unrelated, "utf8")).toBe(unrelatedContent);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
