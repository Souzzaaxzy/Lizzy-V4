# Multiplayer do EmuGames (netplay) — HISTÓRICO

> **Status: REMOVIDO.** Este arquivo existe só como registro do que o sistema
> era, de como ele funcionava e de **por que** ele saiu. O código **não existe
> mais** no repositório — não há nada a reativar nem a manter.

## Por que foi removido

O dono pediu a remoção depois de usar: **gastava muita memória do bot** para o
que entregava. O netplay do EmulatorJS é **experimental** (o próprio código da
lib marca `//control syncing - broken`) e, para funcionar, exigia manter no
host do bot um servidor Socket.IO inteiro + um túnel Cloudflare — só para duas
pessoas jogarem. O custo não se justificava.

O jogo em si **continua funcionando normalmente**: `!kof`, `!metalslug`,
`!topgear`, `!mariokart` e os outros 12 abrem o card e rodam em **single-player**,
exatamente como antes.

## O que o sistema era

Um convite de sala dentro do grupo:

1. `!kof @fulano` (ou respondendo à mensagem da pessoa) mandava um **convite**
   em vez do card solo;
2. o convidado respondia **`sim`** / **`nao`** (mensagem normal, não comando);
3. ao aceitar, o bot subia o servidor de netplay **sob demanda** e mandava um
   **card de entrada** para cada jogador (com botão que abre dentro do
   WhatsApp, via `nativeFlow` + `useWebview`);
4. quem entrava primeiro virava **P1**, quem entrava depois **P2**.

O servidor **não ficava ligado o tempo todo**: subia quando alguém aceitava uma
sala e se desligava sozinho quando todas fechavam.

## Arquitetura (para referência)

```
bot (dados/src/)
  utils/arcadeRooms.js            estado das salas (em MEMÓRIA)
  funcs/utils/netplayServer.js    sobe/derruba o servidor + resolve a URL
  topgear/index.js                enviarCardSala() — o card de entrada
  index.js                        convite + aceite (sim/nao) + os 2 cards

servidor (tools/netplay-server/)
  server.js                       Express + Socket.IO (salas, auto-desligamento)
  baixar-cloudflared.mjs          baixa o túnel (o binário NÃO ia para o git)

player (dados/emugames/index.html)
  modo sala via ?sala=CODIGO&host=1&netplay=<url>
```

### Como o jogador chegava ao servidor (o problema do TLS)

O site do emulador mora no **Cloudflare (HTTPS)**; o servidor de netplay subia
**no host do bot**. O navegador bloqueia `ws://` a partir de página segura, então
o servidor precisava ser publicado com HTTPS. A URL era resolvida em 3 degraus:

1. `EMUGAMES_NETPLAY_URL` (domínio próprio / proxy TLS);
2. **porta publicada** do host (no runtime da OpenHands, `WORKER_1`=12000 e
   `WORKER_2`=12001 respondem em `https://work-N-<runtime>/`);
3. **túnel Cloudflare** (`cloudflared`, quick tunnel) — sem abrir porta, sem IP
   público e sem conta. Era o que funcionava em Pterodactyl/Bronxys.

## Os defeitos que custaram rodadas (registro honesto)

Vale guardar porque **nenhum deles era óbvio**, e todos foram medidos com o
player real (Chromium headless + CDP, dois navegadores):

| # | Sintoma | Causa |
|---|---|---|
| 1 | Os dois "jogando sozinhos" | `EJS_emulator.netplay` só existe **depois** de `openNetplayMenu()`; o código chamava `np.openRoom` onde `np` era `undefined`, e o `if (!np) return;` engolia tudo |
| 2 | `Cannot set properties of undefined (setting 'postMainLoop')` | `defineNetplayFunctions` escreve em `this.Module.postMainLoop`, e o `Module` só existe **depois do wasm**. No evento `ready` ainda é `undefined` |
| 3 | O convidado não achava a sala | O `openRoom` da lib gera um `sessionId` **próprio (GUID)**; o `joinRoom` procura por esse id. O link levava o código **nosso** |
| 4 | Quem entrava depois derrubava quem já estava | `openRoom`/`joinRoom` **desconectam** o socket no fim; o certo era `startSocketIO` uma vez e emitir o evento à mão |
| 5 | Input descartado | `netplay.simulateInput` faz `getUserIndex(this.netplay.playerID)` e descarta se `player !== 0`. Sem `playerID`, `getUserIndex` = **-1** → zero input |
| 6 | P2 não mexia em nada | O EmulatorJS preenche **só** o mapa do jogador 0 (`1: {}, 2: {}, 3: {}`); o mapa vazio cai no mesmo `player !== 0` |
| 7 | O jogo ficava sem toque | O menu de netplay é um **overlay com `z-index: 9999` por cima** do canvas (não é o pai dele) |
| 8 | "Só entra no jogo" | Se o wasm demora, o `onGameStart` (que entrava na sala) nunca disparava |

O item **7** é o mais instrutivo: numa rodada eu removi o `display: none` do
menu acreditando que o canvas morava dentro dele; medir a cadeia do DOM
(`#game.ejs_parent` → `.ejs_canvas_parent` → `.ejs_canvas`) provou o contrário e
eu voltei atrás. **Medir venceu supor** — de novo.

## O que ficou (conhecimento reaproveitável)

- **Card que abre dentro do WhatsApp**: `nativeFlow: [{ text, url, useWebview: true }]`
  → a fork monta um `cta_url` com `webview_interaction: true`. Link em **texto
  cru** o cliente manda para o navegador de fora.
- **O servidor público do EmulatorJS está fora do ar** (`netplay.emulatorjs.org`
  responde **525**) — medido. Não é alternativa.
- **`spawn` que falha emite `'error'`, e `'error'` sem listener derruba o
  processo** (foi o que matava o bot no meio da call; ver a seção de CALL no
  `AGENTS.md`).
- **Quick tunnel do Cloudflare**: o subdomínio muda a cada vez e o DNS leva
  **~30–90 s** para propagar (os primeiros fetches dão `ENOTFOUND`). Esperar por
  TEMPO, não por número de tentativas.

## Se algum dia quiser voltar

O caminho seria **não** usar o servidor próprio: ou o netplay público do
EmulatorJS (hoje fora do ar), ou um serviço externo. Reimplementar o servidor
local + túnel é justamente o que trazia o custo de memória que motivou a
remoção.

## Arquivos que existiam e foram apagados

```
dados/src/utils/arcadeRooms.js
dados/src/funcs/utils/netplayServer.js
dados/emugames/netplay.json
tools/netplay-server/            (inteiro: server.js, baixar-cloudflared.mjs, package*.json)
tests/arcade-room.test.js
tests/arcade-netplay.test.js
tests/netplay-server.test.js
tests/netplay-server-module.test.js
tests/netplay-installer.test.js
```

Também saíram: os imports e os helpers de sala no `index.js`, o `enviarCardSala`
no `topgear/index.js`, o bloco `NETPLAY` e as funções `entrarNaSala` /
`acompanharSala` / `habilitarControleDoJogador` no player, o instalador do
servidor em `config.js`/`update.js`, as envs `EMUGAMES_NETPLAY_*` /
`NETPLAY_*` / `CLOUDFLARED_PATH` do `.env.example` e a entrada do `cloudflared`
no `.gitignore`.
