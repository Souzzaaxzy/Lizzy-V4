# TOPGEAR — o que fazer (passo a passo)

O código já está no repositório. Falta só **publicar os arquivos do jogo** no
seu site `aleatoryconteudos.com`.

Você **não precisa** mexer no nginx nem usar terminal: é só **subir arquivos
pelo gerenciador de arquivos** do site.

---

## Passo 1 — Achar a pasta do site

No gerenciador de arquivos do **site** (o mesmo lugar onde você edita o
`index.html` do aleatoryconteudos.com), descubra qual é a pasta raiz.
Normalmente é uma destas:

```
/var/www/aleatoryconteudos/
/var/www/html/
/public_html/
/home/aleatoryconteudos/public_html/
```

> Dica: é a pasta que tem o `index.html` que aparece quando você abre
> https://aleatoryconteudos.com/

## Passo 2 — Criar a subpasta e enviar os 4 arquivos

Dentro dessa pasta raiz, crie uma pasta chamada **`topgear`** e envie:

| Enviar este arquivo (do repo) | Para |
|---|---|
| `dados/src/topgear/index.html` | `topgear/index.html` |
| `dados/src/topgear/style.css` | `topgear/style.css` |
| `dados/src/topgear/app.js` | `topgear/app.js` |
| `dados/src/topgear/engine/emulator.wasm` | `topgear/engine/emulator.wasm` |

**Atenção à subpasta `engine/`** — crie ela e coloque o `emulator.wasm` dentro.

Deve ficar assim:

```
<pasta do site>/
├── index.html          (o site de vocês, já existe)
├── ...                 (outros arquivos do site)
└── topgear/
    ├── index.html
    ├── style.css
    ├── app.js
    └── engine/
        └── emulator.wasm
```

## Passo 3 — Testar

Abra no navegador:

```
https://aleatoryconteudos.com/topgear/index.html
```

Deve aparecer o **TOP GEAR** com o canvas e os controles.

---

## O que esperar (importante)

O site de vocês tem um **CSP** restritivo (verificado no servidor):

```
script-src 'self' ...   <- sem 'wasm-unsafe-eval'
```

Isso significa:

| Parte | Funciona? |
|---|---|
| Página / HTML / CSS | sim |
| Canvas + controles (o "jogo") | **sim** |
| **WebAssembly** | **não** (o navegador bloqueia) |

Ou seja: **a experiência roda** (canvas, controles, animação) e o WASM cai em
modo degradado — a página avisa "WASM bloqueada pelo CSP".

**Se quiser o WASM rodando**, só é possível de duas formas:

1. **Tirar o `wasm-unsafe-eval` do CSP** — quem cuida do site/Cloudflare ajusta
   o header (no nginx: `add_header Content-Security-Policy "... script-src
   'self' 'wasm-unsafe-eval' ..."`).
2. **Subdomínio próprio** (ex.: `game.aleatoryconteudos.com`) — aí o CSP do site
   principal não se aplica.

---

## Depois de subir

Me avise que eu testo a URL de fora e confirmo se está servindo certo.
