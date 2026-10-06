# capas/

Capa de cada jogo — a imagem animada que aparece no topo do card do bot.

O nome do arquivo tem que ser o **`id` do jogo** em `jogos.json`, com extensao
**`.gif`** (e o que o card procura):

```
capas/
├── topgear2.gif
├── metalslug.gif
└── kof97.gif
```

## Por que GIF (e nao PNG)

O card usa o tipo **`gif:`** da fork (`@itsliaaa/baileys`). O WhatsApp **nao
anima** um `.gif` cru enviado como imagem/video — ele exige um **MP4** em loop
com `gifPlayback: true`. A fork faz essa conversao (sharp le os frames + FFmpeg
codifica H.264) e entrega o GIF animado ja no formato certo, dentro do header
interativo do card.

> Ate out/2026 o card pedia `capas/<id>.png` e mandava como `image`. Como so
> existiam `.gif` na pasta, o fetch dava **404**, o card caia para texto puro e
> a capa "nao pegava".

## Gerar / trocar

As capas do repositorio foram geradas por:

```bash
node tools/gerar-capas.mjs
```

Ele le o `jogos.json` e escreve `capas/<id>.gif` (1280x720). Para usar uma arte
propria, e so **substituir o GIF** mantendo o nome.

## Sem capa?

Se o GIF nao existir, a mensagem sai **so com o texto e o botao** — nao quebra
nada.

## Tamanho

Prefira arquivos pequenos (idealmente < 500 KB) para carregar rapido no celular.
