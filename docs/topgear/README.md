# TOPGEAR — emulador multi-jogo no webview

Roda jogos de console dentro do webview do WhatsApp, via
[EmulatorJS](https://emulatorjs.org) (cores WebAssembly).

## Estrutura

```
docs/topgear/
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
- **Controles de toque** — embaixo da tela (não cobrem o jogo)
- **Cores por console** — a cor do tema muda conforme o console

## Hospedagem

Servido por **Cloudflare Pages** (funciona com repositório privado).
Também funciona em GitHub Pages ou qualquer host estático.

**Importante**: é site **estático** — no build do Cloudflare deixe o
*Build command* vazio e o *Build output directory* como `docs/topgear`.
