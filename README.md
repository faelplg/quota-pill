# Quota Pill

A floating macOS pill that shows how much of your GitHub Copilot, Codex, Claude Code, and Antigravity quotas you have used.

```
CP 47  CX 6  CC 69  AG 0
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

## Sources

None of these is a public API, so any of them may change without notice. Each adapter fails independently and shows what happened in the pill.

| Harness | Source | Setup |
| --- | --- | --- |
| Copilot | `gh api /copilot_internal/user` | Install the [GitHub CLI](https://cli.github.com) and run `gh auth login`. |
| Codex | Latest `rate_limits` event in `~/.codex/sessions` (or `$CODEX_HOME`) | None. Updates only when you use Codex. Windows whose reset has passed are shown as zero. |
| Claude Code | `api.anthropic.com/api/oauth/usage` with Claude Code's OAuth token | Sign in to Claude Code. The token is read from the Keychain, or from `~/.claude/.credentials.json`. |
| Antigravity | `GetUserStatus` in the app's local language server | None. Works only while Antigravity is open. |

## Privacy

Quota Pill has no server and no telemetry. It reads credentials that other tools already store and never saves them anywhere.

- The only network requests go to GitHub (through `gh`), to `api.anthropic.com`, and to Antigravity's language server on `127.0.0.1`. Codex is read from local files.
- The Claude Code token is never refreshed, because refresh tokens rotate and doing it outside Claude Code would invalidate Claude Code's own copy. If it expires, open Claude Code. Requests identify as the installed Claude Code version, since the endpoint rejects other clients.
- Usage responses and alert state are cached in `~/Library/Caches/quota-pill/` (or `$XDG_CACHE_HOME/quota-pill/`).

## Troubleshooting

- **macOS asks for Keychain access.** The collector reads the "Claude Code-credentials" item with `security`. Choose "Always Allow" to stop the prompt from coming back.
- **"bun not found".** The pill looks for Bun in `~/.bun/bin`, Homebrew, `/usr/local/bin`, and Nix profiles. Install it in one of those places.
- **"Cannot locate the collector".** The app finds `src/cli.ts` by walking up from its executable. If you run a copy outside the checkout, set `QUOTA_PILL_ROOT` to the project root.
- **Claude Code shows a rate limit.** Anthropic limits the usage endpoint for every client using the same token. The pill queries it at most every five minutes and backs off when asked to.
- **To see raw data**, run `bun start` in the checkout. It prints the same JSON the pill reads.

## Development

```sh
bun start           # JSON report without alerts (accepts --only <harness> and --force)
bun run pill        # builds and runs the pill once in the foreground
bun test
bun run typecheck
```

`src/adapters/` contains one file per harness, and all adapters return the same shape (`HarnessReport` in `src/types.ts`). `src/cli.ts` combines everything into JSON and triggers alerts, while `src/alerts.ts` stores notification state in the cache folder.

The pill is a SwiftUI app in `app/`. It runs `bun src/cli.ts` every two minutes and when the Mac wakes. After changing Swift code, run `bun run install-pill` again to rebuild and restart it.

The locally generated LaunchAgent contains absolute paths to your checkout. Do not commit it, local caches, credentials, or build artifacts.

## Contributing

Issues and pull requests are welcome. Run `bun test` and `bun run typecheck` before opening a PR. CI also builds the pill on macOS 15 and macOS 26. A new harness is a new file in `src/adapters/` plus its tests in `test/`.

## Disclaimer

Quota Pill is an independent project and is not affiliated with or endorsed by GitHub, OpenAI, Anthropic, or Google. Product names belong to their owners.

## License

[MIT](LICENSE)
