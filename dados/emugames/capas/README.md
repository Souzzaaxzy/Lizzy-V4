# capas/

Capa de cada jogo — a imagem animada que aparece no topo do card do bot.

O card procura o campo **`capa`** do jogo em `jogos.json` (ex.: `"capa":
"topgear.gif"`). Sem esse campo, cai no convencional **`<id>.gif`**.

## Como as capas são geradas (out/2026)

As capas são a **tela de título real** do jogo, composta sobre a boxart
desfocada (1280×720). Fonte das imagens: o repositório público
**libretro-thumbnails** (`Named_Titles` / `Named_Boxarts`).

```bash
# 1. coloque as imagens-fonte em tools/capas-fonte/<id>.png (título) e
#    <id>-box.png (boxart)
# 2. gere as capas:
node tools/gerar-capas-libretro.mjs
```

O `tools/gerar-capas.mjs` (placeholder SVG) continua existindo, mas **não
sobrescreve** capa existente — só preenche o que estiver faltando.

> Por que não capturar a tela rodando o emulador: o Chromium headless **não
> captura o canvas/WebGL** do EmulatorJS (a tela sai preta). A tela de título do
> libretro é o retrato real do jogo, em PNG, sem depender de emulador.

## Por que GIF (e nao PNG)

O card usa o tipo **`gif:`** da fork (`@itsliaaa/baileys`). O WhatsApp **nao
anima** um `.gif` cru enviado como imagem/video — ele exige um **MP4** em loop
com `gifPlayback: true`. A fork faz essa conversao (sharp le os frames + FFmpeg
codifica H.264) e entrega o GIF animado ja no formato certo, dentro do header
interativo do card.

> Ate out/2026 o card pedia `capas/<id>.png` e mandava como `image`. Como so
> existiam `.gif` na pasta, o fetch dava **404**, o card caia para texto puro e
> a capa "nao pegava".

## Sem capa?

Se o GIF nao existir, a mensagem sai **so com o texto e o botao** — nao quebra
nada.

## Tamanho

Prefira arquivos pequenos (idealmente < 500 KB) para carregar rapido no celular.
