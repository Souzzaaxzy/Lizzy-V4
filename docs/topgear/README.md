# TOPGEAR — Top Gear (SNES, 1992) no webview

**Top Gear** é o jogo de corrida de 1992 da **Gremlin Graphics** publicado pela
**Kemco** para o **Super Nintendo** (no Japão se chama *Top Racer*). Ficou
famoso no Brasil pela locadora.

Esta pasta publica esse jogo dentro do webview do WhatsApp, usando um emulador
de SNES real.

## Como funciona

```
!topgear (bot)
    -> botão webview aponta para o GitHub Pages
        -> index.html carrega o EmulatorJS (core snes9x, WebAssembly)
            -> a ROM roda no aparelho
```

A emulação é feita pelo [EmulatorJS](https://emulatorjs.org) — open-source, core
**snes9x** em WebAssembly, carregado do CDN oficial. Não há nada de emulação
neste repositório; só a página que inicializa o player.

## URL

```
https://souzzaaxzy.github.io/Lizzy-V4/topgear/index.html
```

## A ROM

Nenhuma ROM comercial está no repositório (direito autoral). Coloque o arquivo
em `roms/` — veja `roms/README.md`.

Se o arquivo não existir, a página mostra um aviso em vez de um player vazio.

## Arquivos

```
docs/topgear/
├── index.html      (inicializa o EmulatorJS)
├── style.css
└── roms/
    └── README.md   (onde colocar a ROM)
```

## Controles

O EmulatorJS já traz controle na tela (touch), suporte a gamepad e teclado.
No celular, dentro do webview, aparece o D-pad virtual automaticamente.
