# roms/ — só colocar o arquivo aqui

Solte o arquivo da ROM nesta pasta. **O nome pode ser qualquer um** — a página
procura sozinha.

## Passo a passo

1. Coloque o arquivo nesta pasta (`docs/topgear/roms/`).

   Pelo site do GitHub: abra a pasta `docs/topgear/roms` → **Add file** →
   **Upload files** → arraste o arquivo → **Commit changes**.

2. Espere ~1 minuto (o GitHub Pages republica sozinho).

3. Abra e pronto:
   `https://souzzaaxzy.github.io/Lizzy-V4/topgear/index.html`

## Nomes que a página reconhece automaticamente

Qualquer um destes funciona, sem editar nada:

```
topgear.sfc     topgear.smc
topgear2.sfc    topgear2.smc
game.sfc        game.smc
rom.sfc         rom.smc
```

Se o seu arquivo tiver outro nome, use uma das duas opções:

- **Renomeie** para um dos nomes acima, ou
- **Edite** a primeira linha de `window.TOPGEAR_ROM_CANDIDATOS` no
  `docs/topgear/index.html` com o nome do seu arquivo.

## Ou carregue do aparelho (sem subir arquivo nenhum)

Se o arquivo não estiver na pasta, a página mostra um botão para **escolher o
arquivo do celular**. A ROM nunca sai do aparelho.

## Formatos aceitos (snes9x)

`.sfc` `.smc` `.fig` `.swc` `.zip`

## Arquivos grandes

O GitHub tem limite de **100 MB por arquivo** (e avisa acima de 50 MB). Uma ROM
de SNES normalmente tem de 0,5 a 4 MB — não deve dar problema.

Se der, use a opção de carregar do aparelho.
