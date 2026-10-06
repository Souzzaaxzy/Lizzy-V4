# capas/

Coloque aqui a **capa de cada jogo** — uma imagem ou um vídeo curto.

O nome do arquivo tem que ser o **`id` do jogo** em `jogos.json`.

```
capas/
├── topgear2.mp4     <- video (animado, estilo GIF)
├── topgear2.jpg     <- ou imagem
├── meujogo.png
└── outro.gif
```

## Extensoes aceitas

`mp4` `webm` `gif` `jpg` `jpeg` `png` `webp`

Se for video, o bot manda o video no topo da mensagem (com `gifPlayback`,
igual GIF animado). Se for imagem, manda a imagem.

## Sem capa?

Se nao existir arquivo com o id do jogo, a mensagem sai **so com o texto e o
botao** — nao quebra nada.

## Tamanho

Prefira arquivos pequenos (idealmente < 2 MB) para carregar rapido no celular.
