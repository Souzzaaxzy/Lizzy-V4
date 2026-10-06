# TOPGEAR — emulador multi-jogo no webview

Roda jogos de console dentro do webview do WhatsApp, via
[EmulatorJS](https://emulatorjs.org) (cores WebAssembly).

## Estrutura

```
dados/emugames/
├── index.html      ← player (lê o catálogo)
├── style.css
├── jogos.json      ← CATÁLOGO: onde se adiciona jogo
└── jogos/
    ├── snes/
    │   └── topgear2.smc
    └── README.md   ← como adicionar jogos
```

## Adicionar um jogo

1. Coloque a ROM em `jogos/<console>/`
2. Adicione uma linha no `jogos.json`

Pronto — aparece na lista automaticamente. Detalhes em `jogos/README.md`.

## Abrir

```
index.html              → primeiro jogo do catálogo
index.html?jogo=topgear2 → jogo específico
```

Com 2+ jogos, o botão **☰ JOGOS** troca de jogo sem recarregar.

## Recursos

- **PARAR** — desliga o emulador
- **Inatividade** — 3 min sem toque desliga sozinho
- **Fechar/voltar** — sai da aba e volta, o jogo reinicia sozinho
- **Controles de toque** — embaixo da tela (não cobrem o jogo), com dpad/botões maiores
- **Paisagem** — com o celular deitado o jogo ocupa a **tela cheia** e os controles
  ficam **+40px** maiores, flutuando sobre o jogo (o cabeçalho some e o PARAR vira
  um botão flutuante no canto)
- **Cores por console** — a cor do tema muda conforme o console

## Hospedagem

Servido por **Cloudflare Workers** (static assets) — é o único host usado.
Config em `wrangler.jsonc` (`assets.directory` = `./dados/emugames`); deploy com
`wrangler deploy`.

### Limite de 25 MiB por arquivo (importante)

O Cloudflare limita **cada asset a 25 MiB** — e se algum arquivo passar disso,
**o deploy inteiro falha**. Foi o que acontecia com o `kof97.zip` (27,6 MiB).

Por isso a ROM grande vai em **PARTES** (`kof97.zip.p1/.p2`, ~13,8 MiB cada):

1. o **zip inteiro** fica no `.assetsignore` e **nao** sobe;
2. as **partes** sobem normalmente e o player as baixa e **remonta num Blob**;
3. no `jogos.json`, o jogo leva o campo **`"partes": ["kof97.zip.p1", ...]`**.

Assim tudo sai do **mesmo host** do site. Ha teste que falha se uma ROM acima do
limite nao estiver dividida, se alguma parte passar de 25 MiB, ou se as partes
nao somarem o zip inteiro.

### Cloudflare

`wrangler.jsonc` (`assets.directory` = `./dados/emugames`) + `wrangler deploy`.
No painel: *Framework* None, *Build command* **vazio**.
