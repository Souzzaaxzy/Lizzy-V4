# jogos/ — como adicionar um jogo

Cada jogo tem **uma linha** no catalogo (`jogos.json`) e o **arquivo da ROM**.

## 1. Coloque o arquivo

```
jogos/
├── snes/
│   └── topgear2.smc
├── genesis/
│   └── sonic.rom
└── arcade/
    ├── kof97.zip
    └── neogeo.zip
```

## 2. Registre no `jogos.json`

```json
{
  "jogos": [
    {
      "id": "topgear2",
      "nome": "Top Gear 2",
      "console": "snes",
      "descricao": "Corrida classica de SNES...",
      "rom": "jogos/snes/topgear2.smc"
    }
  ]
}
```

| Campo | O que e |
|---|---|
| `id` | apelido curto (sem espaco/acento) — usado na URL e na capa |
| `nome` | o que aparece na tela |
| `console` | qual emulador (define o core) |
| `descricao` | mini texto que aparece na mensagem |
| `rom` | caminho do arquivo |
| `bios` | **(opcional)** caminho da BIOS — obrigatorio em arcade |

## Extensoes — o que funciona

O EmulatorJS **nao valida a extensao**: quem manda e o `console` (o core).
Entao `.rom` funciona quando o conteudo e daquele console:

| Console | Extensoes | `.rom` funciona? |
|---|---|---|
| `snes` | `.sfc` `.smc` `.fig` `.swc` | sim (mesmo conteudo) |
| `genesis` | `.md` `.bin` `.gen` | **sim** |
| `nes` | `.nes` `.fds` | as vezes |
| `gba` | `.gba` | nao (use `.gba`) |
| `n64` | `.z64` `.n64` `.v64` | nao |
| `psx` | `.bin` + `.cue` `.pbp` | nao |
| **`arcade`** | **`.zip` (romset)** | **NAO** — ver abaixo |

## ARCADE (Neo Geo, CPS, MAME) — caso especial

Jogo de fliperama **nao e um arquivo so**. E um **romset**: um `.zip` com
varios arquivos internos (`232-p1.p1`, `232-c1.c1`, `232-v1.v1`...).

**Regras:**

1. **NAO extraia o `.zip`.** O emulador precisa do zip inteiro.
2. **A BIOS e obrigatoria.** Sem ela o jogo nao abre.
3. Use a **mesma versao** de romset do core (fbneo vs mame sao diferentes).

### Exemplo: KOF 97 (Neo Geo)

```
jogos/arcade/
├── kof97.zip       <- o romset (NAO extrair)
└── neogeo.zip      <- a BIOS (obrigatoria)
```

```json
{
  "id": "kof97",
  "nome": "The King of Fighters '97",
  "console": "arcade",
  "descricao": "Luta classica da SNK com 35 personagens.",
  "rom": "jogos/arcade/kof97.zip",
  "bios": "jogos/arcade/neogeo.zip"
}
```

### Se voce extraiu o zip

Se o `kof97.zip` foi extraido em varios `.rom`, **nao funciona** — o emulador
precisa do zip. Junte de volta:

```bash
cd pasta-extraida
zip -r ../kof97.zip .
```

> Os arquivos dentro tem nomes como `232-p1.rom`, `232-c1.rom` — isso e normal,
> e assim mesmo que o MAME/FBNeo espera. O que importa e **estarem no zip**,
> com os nomes exatos, e a BIOS `neogeo.zip` ao lado.

## Consoles suportados (EmulatorJS)

`snes` `nes` `gba` `gb` `gbc` `genesis` `segaMD` `n64` `psx` `arcade`
`atari2600` `segaMS` `segaGG` `segaSaturn` `3do` `lynx` `jaguar` `vb` `nds` `pce`
