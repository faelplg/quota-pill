<!-- radiant:begin -->
# Project guidance

This project uses Radiant. Locate its checkout through the user's global
bootstrap and read there the README of the adapter for the harness in use, in
`adapters/<harness>/`, to validate the revision and load the Core. If the
pointer is missing, set it up before running under Radiant. Anyone who does
not use Radiant follows only the local commands and rules below. In harnesses
that read another instructions file, that file holds only an import of this
map; in Claude Code, `CLAUDE.md` with the line `@AGENTS.md`.

The state map and the chosen commit are in `.radiant.json` at this root. Read
the artifacts the task needs and the contract pointer given in the map. This
product's rules and commands belong to the local context indicated there.
When the map has an `engineering_profile`, read it together with the Baseline
in the Radiant checkout before starting a Build.

Safe commands: `bun test`, `bun run typecheck`,
`swift build -c release --package-path app`.
Only in CI or with network: `bun install --frozen-lockfile`,
`claude plugin validate .`, `claude plugin test`.
Never without a request: `bun start`, `bun run install-pill`,
`bun run uninstall-pill`.

Project rules are in the README (Development and Contributing): do not commit
the LaunchAgent, caches, credentials or build output; a new harness is an
adapter in `src/adapters/` with tests in `test/`; run `bun test` and
`bun run typecheck` before a PR.
<!-- radiant:end -->
