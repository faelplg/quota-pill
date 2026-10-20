# Quota Pill

A floating macOS pill that shows how much of your GitHub Copilot, Codex, Claude Code, Antigravity, and Cursor quotas you have used.

```
CP 47  CX 6  CC 69  AG 0  CU 12
```

Each number is the fullest window for that harness, in %. `–` means the source is currently unavailable, and `!` means an error occurred. Numbers are blue, turn orange at 80%, and red at 95%. When a threshold is crossed, macOS shows one notification per threshold in each reset cycle.

The pill stays visible over full-screen apps. Hover over it to expand the details for each window, and click a section to open that service's usage page (or the Antigravity app). You can drag it, and its position is saved. The ↻ in the footer refreshes everything, while the ↻ shown when hovering over a section refreshes only that harness and bypasses the cache. Right-click offers "Refresh now" and "Quit".

You only need the harnesses you actually use. The others show `–`.

## Requirements

- macOS 15 or later. On macOS 26 the pill uses Liquid Glass; earlier versions get a blurred background.
- [Bun](https://bun.sh).
- Xcode 26 or its Command Line Tools (`xcode-select --install`), for Swift 6.2. Xcode 26 needs macOS 15.6 or later.

## Installation

```sh
git clone https://github.com/faelplg/quota-pill.git
cd quota-pill
bun install
bun run install-pill
```

`install-pill` builds the app and registers a LaunchAgent (`~/Library/LaunchAgents/org.quota-pill.agent.plist`) that starts it at login and restarts it after a crash, but respects "Quit". Installation and uninstallation also remove older Quota Pill agents pointing to the same checkout.

The pill runs from the checkout, so keep the folder where it is. If you move it, run `bun run install-pill` again. To update, pull and reinstall:

```sh
git pull
bun install
bun run install-pill
```

To remove it:

```sh
bun run uninstall-pill
```

### Claude Code plugin

Claude Code reports your plan usage only to code running inside it, so the Claude Code numbers come from a small plugin in this repository. Install it once:

```sh
claude plugin marketplace add faelplg/quota-pill
claude plugin install quota-pill@quota-pill
```

Inside a session, `/plugin marketplace add faelplg/quota-pill` and `/plugin install quota-pill@quota-pill` do the same. Claude Code keeps a copy of the installed version, so update it when the plugin changes:

```sh
claude plugin marketplace update quota-pill
claude plugin update quota-pill@quota-pill
```

If your Claude Code settings are managed declaratively (for example with Nix), load the plugin straight from your checkout instead. It then updates with `git pull`:

```json
{
  "env": { "CLAUDE_CODE_PLUGIN_DIRS": "/path/to/quota-pill/plugins/quota-pill" }
}
```

The plugin is a [mod](https://code.claude.com/docs/en/plugins/mods/overview) with one hook. After each turn, and whenever a plan window moves, it writes the windows Claude Code measured to `~/Library/Caches/quota-pill/claude-rate-limits.json`. It needs no credentials and makes no network requests. Tested end to end with Claude Code 2.1.286, and CI checks it against 2.1.296. To remove it, run `claude plugin uninstall quota-pill@quota-pill`.

## Sources

Only the Claude Code source is a documented interface. The others are not public APIs and may change without notice. Each adapter fails independently and shows what happened in the pill.

| Harness | Source | Setup |
| --- | --- | --- |
| Copilot | `gh api /copilot_internal/user`, plus the [billing usage summary](https://docs.github.com/rest/billing/usage) for extra spend | Install the [GitHub CLI](https://cli.github.com) and run `gh auth login`. When you allow spending past your plan, an "Extra" window shows how much of that budget you used. To see it in dollars, run `gh auth refresh -h github.com -s user`; without it, the window shows units. |
| Codex | Latest `rate_limits` event in `~/.codex/sessions` (or `$CODEX_HOME`) | None. Updates only when you use Codex. Windows whose reset has passed are shown as zero. |
| Claude Code | Plan windows recorded by the [Claude Code plugin](#claude-code-plugin) | Install the plugin. Updates only when you use Claude Code, on a Pro or Max plan. Windows whose reset has passed are shown as zero. |
| Antigravity | `GetUserStatus` in the app's local language server | None. Works only while Antigravity is open. |
| Cursor | `POST https://cursor.com/api/dashboard/get-current-period-usage` and `GET https://cursor.com/api/usage-summary` with the IDE session cookie | Sign in to the Cursor IDE (reads `state.vscdb`), or fall back to `cursor-agent` / `agent` login credentials. Shows included usage for the current period (weekly on plans like Premium) and extra/on-demand budget remaining. |

## Privacy

Quota Pill has no server and no telemetry, and it never reads or stores credentials itself.

- The only network requests go to GitHub, through `gh` and its own login; to Cursor's usage-summary and current-period usage endpoints, using the session already stored by the Cursor IDE or `cursor-agent` CLI; and to Antigravity's language server on `127.0.0.1`. Codex and Claude Code are read from local files.
- Alert state and other caches are kept in `~/Library/Caches/quota-pill/` (or `$XDG_CACHE_HOME/quota-pill/`). The Claude Code snapshot always stays in `~/Library/Caches/quota-pill/`, because Claude Code and the pill's LaunchAgent do not share environment variables.

## Troubleshooting

- **Claude Code shows "No Claude Code usage recorded yet".** Check that `claude plugin list` shows `quota-pill@quota-pill` as enabled (or that `CLAUDE_CODE_PLUGIN_DIRS` points to the plugin), then send a message in Claude Code. On an API key instead of a Pro or Max plan there are no plan windows to show. Organizations that allow only managed mods block the plugin.
- **"bun not found".** The pill looks for Bun in `~/.bun/bin`, Homebrew, `/usr/local/bin`, and Nix profiles. Install it in one of those places.
- **"Cannot locate the collector".** The app finds `src/cli.ts` by walking up from its executable. If you run a copy outside the checkout, set `QUOTA_PILL_ROOT` to the project root.
- **To see raw data**, run `bun start` in the checkout. It prints the same JSON the pill reads.

## Development

```sh
bun start           # JSON report without alerts (accepts --only <harness> and --force)
bun run pill        # builds and runs the pill once in the foreground
bun test
bun run typecheck
```

`src/adapters/` contains one file per harness, and all adapters return the same shape (`HarnessReport` in `src/types.ts`). `src/cli.ts` combines everything into JSON and triggers alerts, while `src/alerts.ts` stores notification state in the cache folder.

The Claude Code plugin lives in `plugins/quota-pill/`, and the repository root is its marketplace. Its tests run with Claude Code's own test kit:

```sh
claude plugin validate .
cd plugins/quota-pill && claude plugin test
```

To try a change in a session without installing it, run `claude --plugin-dir plugins/quota-pill`.

The pill is a SwiftUI app in `app/`. It runs `bun src/cli.ts` every two minutes and when the Mac wakes. After changing Swift code, run `bun run install-pill` again to rebuild and restart it.

The locally generated LaunchAgent contains absolute paths to your checkout. Do not commit it, local caches, credentials, or build artifacts.

## Contributing

Issues and pull requests are welcome. Run `bun test` and `bun run typecheck` before opening a PR, and `claude plugin test` if you changed the plugin. CI also builds the pill on macOS 15 and macOS 26. A new harness is a new file in `src/adapters/` plus its tests in `test/`.

## Disclaimer

Quota Pill is an independent project and is not affiliated with or endorsed by GitHub, OpenAI, Anthropic, Google, or Cursor. Product names belong to their owners.

## License

[MIT](LICENSE)
