# TOPGEAR — emulador multi-jogo no webview

Roda jogos de console dentro do webview do WhatsApp, via
[EmulatorJS](https://emulatorjs.org) (cores WebAssembly).

## Estrutura

```
docs/emugames/
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

Servido por **Cloudflare Workers** (static assets). Também funciona em GitHub
Pages ou qualquer host estático.

### Limite de 25 MiB por arquivo (importante)

O Cloudflare limita **cada asset a 25 MiB** — e se algum arquivo passar disso,
**o deploy inteiro falha** (não sobe nada). Foi o que aconteceu quando o
`kof97.zip` passou de 25 MiB.

Por isso:

1. o arquivo grande vai para o **`.assetsignore`** (`docs/emugames/.assetsignore`),
   entao ele **nao** sobe para o Cloudflare;
2. ele e servido pelo **espelho** — o mesmo caminho no **GitHub Pages**, que nao
   tem esse limite e manda CORS `*`;
3. no `jogos.json`, o jogo leva **`"mirror": true`**, e o player troca a URL da
   ROM pelo espelho (`window.ROM_MIRROR`).

**Ao adicionar uma ROM grande** (> 25 MiB): ponha `"mirror": true` no jogo, o
caminho no `.assetsignore` e garanta que o arquivo esta no GitHub Pages. Ha teste
que falha se uma ROM acima do limite nao estiver espelhada.

### Cloudflare

*Framework* None, *Build command* **vazio**, *Build output directory*
`docs/emugames`.
