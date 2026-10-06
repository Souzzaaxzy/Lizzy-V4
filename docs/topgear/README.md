# TOPGEAR — como funciona

**Não é preciso fazer nada no servidor.** O jogo é servido pelo **GitHub Pages**
do próprio repositório.

## URL do jogo

```
https://souzzaaxzy.github.io/Lizzy-V4/topgear/index.html
```

Já está no ar. Os arquivos estão em `docs/topgear/` no repositório, e o GitHub
Pages publica a pasta `docs/` automaticamente.

## Como usar

No grupo (só o dono):

```
!topgear
```

O bot manda uma mensagem com o botão **JOGAR**, que abre o jogo no webview do
WhatsApp.

## Como atualizar o jogo

Edite os arquivos em `docs/topgear/` e dê push. O Pages republica sozinho em
~1 minuto.

Os arquivos em `dados/src/topgear/` são a versão "fonte" (usada pelos testes e
pelo servidor local opcional). Se mudar um, copie para `docs/topgear/`.

## Arquivos

```
docs/topgear/
├── index.html
├── style.css
├── app.js
└── engine/
    └── emulator.wasm     (engine homebrew, 114 bytes — nenhuma ROM comercial)
```

## Por que aqui e não no site

O domínio `aleatoryconteudos.com` tem um CSP restritivo (`script-src 'self'`,
sem `wasm-unsafe-eval`), que **bloquearia o WebAssembly**. O GitHub Pages não tem
esse CSP, então o jogo roda completo (canvas + WASM).

## Servidor local (opcional)

Existe também um servidor local (`dados/src/topgear/server.js`) para quem quiser
servir o jogo pela própria máquina do bot (porta 8099). Ele **não é necessário**
— é só uma alternativa para desenvolvimento.
