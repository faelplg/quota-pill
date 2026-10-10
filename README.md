# AI quota

Mostra na barra de menu do macOS quanto você já usou das quotas do GitHub Copilot, Codex, Claude Code e Antigravity.

```
CP 47  CX 6  CC 69  AG 0
```

Cada número é a janela mais cheia daquele harness, em %. `–` quer dizer que a fonte não está disponível agora, e `!` quer dizer que deu erro. O título fica azul, passa a laranja a partir de 80% e a vermelho a partir de 95%. Ao cruzar esses limites, o macOS mostra uma notificação, uma vez por limite em cada ciclo de reset.

## Instalação

Requer [Bun](https://bun.sh) e [SwiftBar](https://swiftbar.app).

```sh
bun install
bun run install-plugin
```

O instalador faz um symlink de `plugin/ai-quota.2m.sh` na pasta de plugins do SwiftBar e define essa pasta se ela ainda não existir. O plugin atualiza a cada 2 minutos.

## Fontes

Todas são lidas sem guardar credenciais. Nenhuma delas é uma API pública, então qualquer uma pode mudar sem aviso. Cada adapter falha de forma isolada e mostra no menu o que aconteceu.

| Harness | De onde vem | Observações |
| --- | --- | --- |
| Copilot | `gh api /copilot_internal/user` | Precisa de `gh auth login`. |
| Codex | Último evento `rate_limits` em `~/.codex/sessions` (ou `$CODEX_HOME`) | Só atualiza quando você usa o Codex. Janelas cujo reset já passou aparecem zeradas. |
| Claude Code | `api.anthropic.com/api/oauth/usage` com o token OAuth do Keychain | O token nunca é renovado aqui, porque isso invalidaria a cópia do Claude Code. Se expirar, abra o Claude Code. |
| Antigravity | `GetUserStatus` no language server local do app | Só funciona com o Antigravity aberto. |

## Desenvolvimento

```sh
bun run json        # relatório normalizado, sem alertas
bun start           # saída do plugin
bun test
bun run typecheck
```

`src/adapters/` tem um arquivo por harness, e todos devolvem o mesmo formato (`HarnessReport` em `src/types.ts`). `src/render.ts` gera a saída do SwiftBar, e `src/alerts.ts` guarda em `~/Library/Caches/ai-quota/alerts.json` o que já foi notificado.

## Janela flutuante

Uma pílula sempre visível com os mesmos indicadores, inclusive sobre apps em tela cheia. Ao passar o mouse, ela expande com o detalhe de cada janela. Dá para arrastá-la, e a posição fica salva. O clique direito oferece "Atualizar agora" e "Sair".

```sh
bun run pill
```

É um app SwiftUI em `app/` (requer macOS 26 e Xcode ou Command Line Tools). Ele roda `bun src/cli.ts json --no-alerts` a cada 2 minutos e ao acordar o Mac, então os alertas continuam vindo só do plugin. Se o app não estiver dentro do checkout, aponte `AI_QUOTA_ROOT` para a raiz do projeto.
