#!/usr/bin/env bash
# <xbar.title>AI quota</xbar.title>
# <xbar.desc>Quotas de uso do Copilot, Codex, Claude Code e Antigravity.</xbar.desc>
# <swiftbar.hideAbout>true</swiftbar.hideAbout>
# <swiftbar.hideRunInTerminal>true</swiftbar.hideRunInTerminal>
# <swiftbar.hideDisablePlugin>true</swiftbar.hideDisablePlugin>
set -euo pipefail

# SwiftBar starts plugins with a minimal PATH.
export PATH="$HOME/.bun/bin:/etc/profiles/per-user/$USER/bin:$HOME/.nix-profile/bin:/run/current-system/sw/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"

if ! command -v bun >/dev/null; then
  echo "AI ! | color=#E5484D"
  echo "---"
  echo "bun não encontrado no PATH. Instale com: brew install bun"
  exit 0
fi

root="$(cd "$(dirname "$(readlink -f "$0")")/.." && pwd)"
exec bun "$root/src/cli.ts" swiftbar
