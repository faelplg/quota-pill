# AI quota

Uma pílula flutuante no macOS que mostra quanto você já usou das quotas do GitHub Copilot, Codex, Claude Code e Antigravity.

```
CP 47  CX 6  CC 69  AG 0
```

Cada número é a janela mais cheia daquele harness, em %. `–` quer dizer que a fonte não está disponível agora, e `!` quer dizer que deu erro. Os números ficam azuis, passam a laranja a partir de 80% e a vermelho a partir de 95%. Ao cruzar esses limites, o macOS mostra uma notificação, uma vez por limite em cada ciclo de reset.

A pílula fica visível inclusive sobre apps em tela cheia. Ao passar o mouse, ela expande com o detalhe de cada janela. Dá para arrastá-la, e a posição fica salva. O clique direito oferece "Atualizar agora" e "Sair".

## Instalação

Requer [Bun](https://bun.sh), macOS 26 e Xcode ou Command Line Tools.

```sh
bun install
bun run install-pill    # compila e inicia no login (LaunchAgent)
bun run uninstall-pill
```

O LaunchAgent (`~/Library/LaunchAgents/dev.faelplg.quota-pill.plist`) reinicia a pílula se ela travar, mas respeita o "Sair". Depois de mudar o código Swift, rode `bun run install-pill` de novo para recompilar e reiniciar.

## Fontes

Todas são lidas sem guardar credenciais. Nenhuma delas é uma API pública, então qualquer uma pode mudar sem aviso. Cada adapter falha de forma isolada e mostra na pílula o que aconteceu.

| Harness | De onde vem | Observações |
| --- | --- | --- |
| Copilot | `gh api /copilot_internal/user` | Precisa de `gh auth login`. |
| Codex | Último evento `rate_limits` em `~/.codex/sessions` (ou `$CODEX_HOME`) | Só atualiza quando você usa o Codex. Janelas cujo reset já passou aparecem zeradas. |
| Claude Code | `api.anthropic.com/api/oauth/usage` com o token OAuth do Keychain | O token nunca é renovado aqui, porque isso invalidaria a cópia do Claude Code. Se expirar, abra o Claude Code. |
| Antigravity | `GetUserStatus` no language server local do app | Só funciona com o Antigravity aberto. |

## Desenvolvimento

```sh
bun start           # relatório em JSON, sem alertas
bun run pill        # roda a pílula uma vez, em primeiro plano
bun test
bun run typecheck
```

`src/adapters/` tem um arquivo por harness, e todos devolvem o mesmo formato (`HarnessReport` em `src/types.ts`). `src/cli.ts` junta tudo em JSON e dispara os alertas, e `src/alerts.ts` guarda em `~/Library/Caches/ai-quota/alerts.json` o que já foi notificado.

A pílula é um app SwiftUI em `app/`. Ela roda `bun src/cli.ts` a cada 2 minutos e ao acordar o Mac. Se o app não estiver dentro do checkout, aponte `AI_QUOTA_ROOT` para a raiz do projeto.
