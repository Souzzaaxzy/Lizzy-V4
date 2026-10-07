# Servidor de netplay (salas multiplayer do arcade)

Servidor de netplay do **EmulatorJS** com **desligamento automático**.

Base: [`EmulatorJS/EmulatorJS-Netplay`](https://github.com/EmulatorJS/EmulatorJS-Netplay)
(branch `main`, `server.js`, MIT). O `server.js` daqui é o oficial **mais** o
auto-desligamento e a rota `/status`.

## Como ele liga e desliga

O servidor **não fica ligado o tempo todo**:

1. **Sobe** no instante em que alguém aceita uma sala de jogo
   (`!kof @fulano` → o convidado responde `sim`). Quem sobe é o bot
   (`dados/src/funcs/utils/netplayServer.js`).
2. **Desliga sozinho** quando todas as salas fecham
   (`NETPLAY_IDLE_SHUTDOWN_MS`, padrão 60s).
3. Se **ninguém** criar sala depois de subir, ele sai no
   `NETPLAY_GRACE_MS` (padrão 120s).

Se chegar sala nova dentro da janela de desligamento, ele **cancela** a saída.

## Instalação

As dependências ficam **neste pacote** (não inflam as do bot):

```bash
cd tools/netplay-server
npm install
```

## Rodar à mão (para testar)

```bash
cd tools/netplay-server
PORT=3000 node server.js
```

- `GET /list?game_id=kof97` — salas abertas (oficial).
- `GET /status` — diagnóstico leve (salas, jogadores, uptime, config).

## Configuração

| variável | padrão | o que faz |
|---|---|---|
| `PORT` | `3000` | porta do servidor |
| `NETPLAY_IDLE_SHUTDOWN_MS` | `60000` | tempo sem **nenhuma** sala antes de sair |
| `NETPLAY_GRACE_MS` | `120000` | tempo inicial sem sala antes de sair |
| `NETPLAY_SELF_SHUTDOWN` | ligado | `0` desliga o auto-desligamento (servidor fixo) |

## TLS — resolvido pelo TÚNEL CLOUDFLARE (sem configurar nada)

O site do emulador é **https**, e o navegador **bloqueia `ws://`** a partir de
uma página segura. O servidor é **http puro**.

A solução é o **Cloudflare Tunnel**: o bot sobe o `cloudflared` junto com o
servidor e ganha um endereço **HTTPS público** — **sem abrir porta, sem IP
público e sem conta** (quick tunnel). Medido: HTTP 200 **e WebSocket**
funcionando através do túnel.

```bash
# baixa o binário oficial (~40 MB, não vai para o git)
node tools/netplay-server/baixar-cloudflared.mjs
```

O bot sobe o túnel **só quando alguém pede uma sala** e o derruba quando todas
fecham — igual ao servidor. `EMUGAMES_NETPLAY_TUNNEL=0` desliga o túnel.

> O subdomínio do quick tunnel **muda a cada vez** e leva ~30 s para o DNS
> propagar — o bot espera (até `NETPLAY_TUNNEL_READY_MS`, padrão 90 s) antes de
> mandar os links, então os jogadores não pegam um endereço que ainda não
> resolve.

Alternativa (domínio próprio ou proxy TLS): defina `EMUGAMES_NETPLAY_URL`.

## Integração com o bot

No `.env` (ou no `dados/emugames/netplay.json`):

```env
# URL PUBLICA (o que o navegador do jogador usa)
EMUGAMES_NETPLAY_URL=http://localhost:3000
# porta local do processo
EMUGAMES_NETPLAY_PORT=3000
```

Com `EMUGAMES_NETPLAY_URL` apontando para **localhost**, o bot sobe o processo
sozinho ao criar a sala. Com uma URL **externa**, o bot **não** sobe nada — ele
apenas entrega a URL no link da sala, e quem mantém o servidor no ar é você.

O link da sala já carrega a URL (`?netplay=`), então o site (que mora no
Cloudflare) não precisa saber onde o servidor está.
