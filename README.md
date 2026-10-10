# Quota Pill

A floating macOS pill that shows how much of your GitHub Copilot, Codex, Claude Code, and Antigravity quotas you have used.

```
CP 47  CX 6  CC 69  AG 0
```

Each number is the fullest window for that harness, in %. `–` means the source is currently unavailable, and `!` means an error occurred. Numbers are blue, turn orange at 80%, and red at 95%. When a threshold is crossed, macOS shows one notification per threshold in each reset cycle.

The pill stays visible over full-screen apps. Hover over it to expand the details for each window. You can drag it, and its position is saved. The ↻ in the footer refreshes everything, while the ↻ shown when hovering over a section refreshes only that harness and bypasses the cache. Right-click offers "Refresh now" and "Quit".

## Installation

Requires [Bun](https://bun.sh), macOS 26, and Xcode or the Command Line Tools.

```sh
bun install
bun run install-pill    # builds and starts at login (LaunchAgent)
bun run uninstall-pill
```

The LaunchAgent (`~/Library/LaunchAgents/org.quota-pill.agent.plist`) restarts the pill after a crash but respects "Quit". After changing Swift code, run `bun run install-pill` again to rebuild and restart it.

## Fontes

All sources are read without storing credentials. None of them is a public API, so any of them may change without notice. Each adapter fails independently and displays what happened in the pill.

| Harness | Source | Notes |
| --- | --- | --- |
| Copilot | `gh api /copilot_internal/user` | Requires `gh auth login`. |
| Codex | Latest `rate_limits` event in `~/.codex/sessions` (or `$CODEX_HOME`) | Updates only when you use Codex. Windows whose reset has passed are shown as zero. |
| Claude Code | `api.anthropic.com/api/oauth/usage` with the Keychain OAuth token | The token is never refreshed here because doing so would invalidate Claude Code's copy. If it expires, open Claude Code. |
| Antigravity | `GetUserStatus` in the app's local language server | Works only while Antigravity is open. |

## Desenvolvimento

```sh
bun start           # JSON report without alerts (accepts --only <harness> and --force)
bun run pill        # runs the pill once in the foreground
bun test
bun run typecheck
```

`src/adapters/` contains one file per harness, and all adapters return the same shape (`HarnessReport` in `src/types.ts`). `src/cli.ts` combines everything into JSON and triggers alerts, while `src/alerts.ts` stores notification state in `~/Library/Caches/quota-pill/alerts.json`.

The pill is a SwiftUI app in `app/`. It runs `bun src/cli.ts` every two minutes and when the Mac wakes. If the app is not inside the checkout, set `QUOTA_PILL_ROOT` to the project root.
