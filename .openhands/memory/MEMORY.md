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

## A VOZ da conversa (`!assistente` / "Lizzy, manda um áudio aí")

- **A forma da bolha é decidida pelo CONTAINER do áudio, não pelo `ptt`**
  (medido em 3 projetos que usam Baileys):
  - **MP3** → bolha de **música** (a "laranja", com a notinha) — é o `!play`;
  - **OGG/Opus** → **nota de voz** (o desenho da ONDA).
  - Só `ptt: true` **não** basta: com MP3 o cliente ainda desenha como música.
- O dono escolheu a **nota de voz** (a "Opção A"). Cadeia:
  `sintetizarFala` (PCM 16 kHz) → `pcmParaWav` → `toOggOpus` → envio
  `{ audio: voz.ogg, mimetype: 'audio/ogg; codecs=opus', ptt: true }`.
- **O `contextInfo` (newsletter) fica FORA** deste envio — nas rodadas em que o
  dono testou, era ele que atrapalhava a renderização. Custo aceito: este áudio
  não leva o cabeçalho "Ver canal".
- Exige **ffmpeg** no servidor (a cadeia OGG passa por ele). O ffmpeg já está na
  lista de dependências do `config.js`/`update.js`.
- Módulo `dados/src/utils/vozDaConversa.js` (`gerarNotaDeVoz`); handler em
  `index.js` (~7705). Teste: `tests/voz-conversa.test.js` (10/59).
- **✅ CONFIRMADO no aparelho (out/2026)**: o dono testou e saiu a nota de voz
  com a onda. Era o único ponto fora do alcance dos testes.
- **VOZ ESPONTÂNEA (25%)**: ela também manda voz por conta própria
  (`LIZZY_VOZ_ESPONTANEA`, padrão 0.25). O **pedido explícito é 100% áudio** e
  não passa pelo sorteio. Se a voz falhar, o **texto vai** (nunca silêncio).
  Teto de 400 chars **só no espontâneo** (`LIZZY_VOZ_MAX_CARACTERES`).
- **Armadilha**: a constante é lida no **load** do módulo — setar
  `LIZZY_VOZ_ESPONTANEA` **depois** do import não tem efeito. Os testes de TEXTO
  (`assistente-contexto`/`-identidade`/`-acoes`) setam a env **antes do import**,
  senão ficam flaky (1 em ~6 rodadas).
- **QUALIDADE**: a voz vai pelo **MP3 do TTS (24 kHz) direto ao Opus**. O
  caminho antigo (PCM 16 kHz no meio, herdado do motor da call) perdia **10 dB**
  na banda de 10-12 kHz — o som "de telefone". Nunca reamostrar para 16 kHz no
  caminho do CHAT (16 kHz é o formato do motor da CALL, não da voz do chat).
- **Prosódia**: `LIZZY_TTS_RATE` (padrão `+10%`; medido 6,72s → 6,09s na mesma
  frase), `LIZZY_TTS_PITCH`/`_VOLUME` (vazio = natural), `LIZZY_TTS_BITRATE`
  (`64k`). O Opus sempre codifica em 48 kHz — subir a taxa de entrada não muda
  nada; o bitrate da fonte (48k vs 96k) também não (medido).

## Assistente — comandos por texto, falas e menção (out/2026)

- **`utils/falasLizzy.js`** — frases **sorteadas** por evento (link, foto, play,
  pin, figurinha, stickerBusca, mencao, mencaoNaoAchou, mencaoAmbiguo). Ficam
  **fora da IA**: é confirmação de ação, precisa ser rápida e certa.
- **`utils/mencaoUsuario.js`** — `identificarPedidoDeMencao` + `acharUsuarioPorNome`
  (nome exato > pedaço > **apelido do contador** > prefixo). Nome **ambíguo não
  escolhe no chute** (`{ambiguo:true}` + candidatos).
- **`utils/assistenteAcoes.js`** — `identificarAcaoDoBot` (link/foto/play/pin/
  figurinha/stickerBusca). O play/pin **reusa** o `identificarComando` do
  `iapComandos.js` — não criar um segundo reconhecedor.
- **🚨 `mentions` ≠ `@` do texto**: o `mentions` quer o **JID completo**
  (`numero@s.whatsapp.com`), o `@` do texto quer **só o número**. Remover o
  `:device` com `replace(/:(\d+)@/, '@')` — `split(':')[0]` **corta o domínio**.
- **🚨 ORDEM no handler**: o bloco do **ÁUDIO vem ANTES** das ações, senão "manda
  um áudio" cai no `play` ("audio" está na lista de música).
- **As respostas do `!assistente` NÃO levam o `contextInfo` (newsletter)** — o
  dono pediu para tirar: o cabeçalho de canal faz a mensagem parecer card de
  canal, e a fala tem de soar como conversa. O resto do bot mantém.
- **"foto de X" = `!pin`** (o dono: *"o `!pin` é foto"*). Só "foto **do grupo**"
  continua sendo a foto do grupo; a distinção é o termo (`grupo/gp/aqui`).
- Teste: `tests/assistente-comandos.test.js` (24/145).

## Testes

- Suíte de contexto: **`tests/assistente-contexto.test.js`** (19 testes / 90
  asserções). Baseline sem as mudanças: **27 asserções falham**.
- Harness do repo: funções `test/ok/contem/naoContem` locais, `DATABASE_PATH`
  temporário, Groq dublado por `groq.setGroqHttpForTest(fn)`.
- **`groqClient.setGroqHttpForTest`** e `ia.setGeminiHttpForTest` são os seams
  para testar sem rede.
- Falhas **pré-existentes** (confirmadas com `git stash`): `menu-layout`
  (`menufig` 18 vs 17). `testcall` é flaky (corrida com `persistGroupData`).
- **O sandbox não tem ffmpeg.** Para rodar os testes que dependem dele
  (`statusgrupo`, `togif`, `midiaprefix`, `voz-conversa`), baixe o estático:
  `curl -sL https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz`
  → `FFMPEG_PATH=/tmp/ffmpeg-7.0.2-amd64-static/ffmpeg node tests/<x>.test.js`.
- **Publicar**: `git push` com `$GITHUB_TOKEN` dá **403** (só leitura). Use
  **`$GITHUB_PERSONAL_ACCESS_TOKEN`** — ele tem escrita no `Lizzy-V4` e nos forks.

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
