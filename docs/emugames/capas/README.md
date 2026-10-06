# capas/

Capa de cada jogo — a imagem que aparece no topo do card do bot.

O nome do arquivo tem que ser o **`id` do jogo** em `jogos.json`, com extensao
**`.png`** (e o que o card procura):

```
capas/
├── topgear2.png
├── metalslug.png
└── kof97.png
```

## Gerar / trocar

As capas do repositorio foram geradas por:

```bash
node tools/gerar-capas.mjs
```

Ele le o `jogos.json` e escreve `capas/<id>.png` (1280x720). Para usar uma arte
propria, e so **substituir o PNG** mantendo o nome.

## Sem capa?

Se o PNG nao existir, a mensagem sai **so com o texto e o botao** — nao quebra
nada.

## Tamanho

Prefira arquivos pequenos (idealmente < 500 KB) para carregar rapido no celular.
