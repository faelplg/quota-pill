<!-- radiant:begin -->
# Orientação do projeto

Este projeto usa Radiant. Localize seu checkout pelo bootstrap global do usuário
e leia nele o README do adapter do harness em uso, em `adapters/<harness>/`,
para validar a revisão e carregar o Core. Se o pointer estiver ausente,
configure-o antes de executar sob Radiant. Em harnesses que leem outro arquivo
de instruções, esse arquivo contém apenas um import deste mapa; no Claude Code,
`CLAUDE.md` com a linha `@AGENTS.md`.

O mapa de estado e o commit escolhido estão em `.radiant.json` nesta raiz.
Leia os artefatos necessários à tarefa e o ponteiro de contrato indicado no
mapa. Regras e comandos deste produto pertencem ao contexto local indicado ali.
Quando houver `engineering_profile` no mapa, leia-o junto com o Baseline do
checkout Radiant antes de iniciar um Build.

Comandos seguros: `bun test`, `bun run typecheck`,
`swift build -c release --package-path app`.
Só no CI ou com rede: `bun install --frozen-lockfile`, `claude plugin validate .`,
`claude plugin test`.
Nunca sem pedido: `bun start`, `bun run install-pill`, `bun run uninstall-pill`.

Regras do projeto estão no README (Development e Contributing): não commitar
LaunchAgent, caches, credenciais ou build; um harness novo é um adapter em
`src/adapters/` com testes em `test/`; rodar `bun test` e `bun run typecheck`
antes de PR.
<!-- radiant:end -->
