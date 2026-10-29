# Memória do projeto — Lizzy-V4 / Abyss Bot

Índice de fatos duráveis aprendidos neste repositório. O detalhe longo fica nos
logs diários (`YYYY-MM-DD.md`).

## Ambiente / método

- **NÃO há `node_modules` no clone inicial.** O primeiro passo de qualquer sessão
  que precise rodar testes é `npm install --legacy-peer-deps --allow-git=all`
  (~2 min, 224 MB, 229 pacotes). Sem isso nenhum teste roda.
- **`npm install` REBAIXA o `yarn.lock` para v1** (formato do yarn clássico) e
  toca `dados/database/*.json`. Depois de instalar: `git checkout -- yarn.lock`
  (conferir `head -2` = `__metadata:` / `version: 8`) e conferir `git status`.
- **`index.js` tem ~36.800 linhas e glifos de caixa.** Editar SEMPRE por
  `open(rb) → decode('utf-8') → replace → encode('utf-8')` em Python, com
  `assert s.count(alvo) == 1` e contagem de mojibake (`Г`, `в”`) == 0 antes e
  depois. O `file_editor`/heredoc corrompem a codificação — e `node --check`
  PASSA mesmo com o arquivo corrompido; o estrago só aparece nos testes de texto.
- **Importar `dados/src/index.js` é caro mas funciona** (~30-60 s; abre timers).
  Os testes usam `DATABASE_PATH`/`CONFIG_PATH` temporários **antes** do import
  (o `paths.js` resolve no load). Sempre `process.exit(0)` no fim, senão o
  processo fica pendurado.
- **`node --check` em todo arquivo tocado** antes de rodar teste.

## Assistente (`!assistente`) — contexto da conversa (out/2026)

- **`dados/src/utils/contextoConversa.js`** é a **fonte única** do contexto da
  Lizzy, usada pelos DOIS canais (chat `!assistente` e voz `!iap`):
  - `coletarDadosDoGrupo()` (async, precisa de socket/metadata) — dono do bot
    (número + LID, `matchId` = `idsMatch`), dados do grupo (nome, dono, admins,
    `creation` em **segundos**, total de membros);
  - `montarContextoDaConversa()` — bloco do **chat** (multi-linha);
  - `montarBlocoDoGrupo()` / `linhasDoGrupo()` — bloco da **voz** (uma frase).
- **Divisão de propósito**: o handler **coleta** (tem `nazu`/metadata), o módulo
  **formata** (puro, testável sem conexão). Não duplicar: o repo já pagou caro
  por duas personalidades/duas cadeias de modelo/dois resolvedores de nome.
- `ia.js` **importa** `montarContextoDaConversa` (não tem mais cópia local);
  `promptDaPersonalidade(extraContext)` recebe o contexto e o anexa ao prompt.
- **Nunca vaza JID/LID cru** como nome — o resolvedor é `utils/contactName.js`
  (agenda > notify > verifiedName > metadata > número). Teste 9 trava isso.
- Nome do bot vem com MATHEMATICAL BOLD (`𝐋𝐢𝐳𝐳𝐲 𝐝𝐨 𝐩𝐫𝐢𝐯𝐲`) → usar
  `limparNomeDoBot` (NFKC → "Lizzy") para comparação e fala.

## Testes

- Suíte de contexto: **`tests/assistente-contexto.test.js`** (19 testes / 90
  asserções). Baseline sem as mudanças: **27 asserções falham**.
- Harness do repo: funções `test/ok/contem/naoContem` locais, `DATABASE_PATH`
  temporário, Groq dublado por `groq.setGroqHttpForTest(fn)`.
- **`groqClient.setGroqHttpForTest`** e `ia.setGeminiHttpForTest` são os seams
  para testar sem rede.
- Falhas **pré-existentes** (confirmadas com `git stash`): `menu-layout`
  (`menufig` 18 vs 17) e `statusgrupo`/`togif`/`midiaprefix` (GIF) por **falta de
  ffmpeg** no sandbox. `testcall` é flaky (corrida com `persistGroupData`).

## Canais de IA (estado atual)

| canal | ouvir | pensar | falar |
|---|---|---|---|
| `!assistente` (chat) | — | Groq (`gpt-oss-120b`) | — |
| `!iap` (voz) | Groq Whisper | Groq | `msedge-tts` (Node, sem pip) |
| `!transcrever` | Groq Whisper | — | — |
| `!gemma`/`!phi`/`!qwen`/`!llama` | — | Gemini (`!key`) | — |

- **Gemini saiu do `!iap`/`!transcrever`** (cota estourada). O TTS era `edge-tts`
  (Python/pip) e virou **`msedge-tts`** porque o painel **não tem `pip`**.
- O `.env` é lido por **caminho do projeto** (não CWD) — o painel pode iniciar de
  outro diretório e a chave "sumia".
