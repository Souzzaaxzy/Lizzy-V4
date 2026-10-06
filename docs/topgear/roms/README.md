# roms/

Coloque aqui a ROM que você tem **direito de usar**.

O arquivo esperado por padrão é:

```
roms/topgear.sfc
```

Se usar outro nome, ajuste `window.TOPGEAR_ROM` no topo de
`docs/topgear/index.html`.

## Formatos aceitos (snes9x)

`.sfc` `.smc` `.fig` `.swc` `.gd3` `.gd7` `.dx2` `.bsx`

## Importante

Nenhuma ROM comercial está versionada neste repositório — por direito autoral,
o arquivo **não** pode ir para o Git.

Como o GitHub Pages não serve arquivos que não estão no repositório, para
funcionar no ar a ROM precisa estar em um destes lugares:

1. **No repositório** (só se você tiver direito de redistribuir — ex.: uma ROM
   homebrew). Nesse caso, comite `roms/topgear.sfc` normalmente.
2. **Em outra URL pública HTTPS** — mude `window.TOPGEAR_ROM` para a URL.
3. **No aparelho** — o EmulatorJS também aceita o usuário escolher o arquivo
   (arrastar/soltar) quando não há `gameUrl`.
