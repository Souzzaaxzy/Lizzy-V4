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
dados/emugames/
├── neogeo.zip      <- a BIOS (obrigatoria) — fica na RAIZ do site
└── jogos/arcade/
    └── kof97.zip   <- o romset (NAO extrair)
```

A BIOS fica **na raiz** (nao em `jogos/arcade/`): o player liga
`EJS_dontExtractBIOS`, e assim a BIOS chega ao emulador como **zip** — que e o
que o FBNeo procura. Sem isso o emulador extrai a BIOS em arquivos soltos e o
FBNeo acusa "romsets is missing files".

```json
{
  "id": "kof97",
  "nome": "The King of Fighters '97",
  "console": "arcade",
  "descricao": "Luta classica da SNK com 35 personagens.",
  "rom": "jogos/arcade/kof97.zip",
  "bios": "neogeo.zip"
}
```

### Se voce extraiu o zip

Se o `kof97.zip` foi extraido em varios `.rom`, **nao funciona** — o emulador
precisa do zip. Junte de volta:

```bash
cd pasta-extraida
zip -r ../kof97.zip .
```

## Romset de emulador antigo (CoolROM / NeoRAGEx)

Muito romset que circula vem de emuladores antigos (CoolROM, NeoRAGEx) e **nao
abre** no EmulatorJS. Dois sinais de que e esse formato:

- os arquivos internos tem **underscore** (`mslug_c1.rom`) em vez do padrao
  MAME/FBNeo com **ponto** (`201-c1.c1`);
- os arquivos de **sprite** (`_c1.._c4`) tem o tamanho certo mas o **CRC nao
  bate** com o oficial.

Nesse formato os arquivos de sprite estao com as **duas metades trocadas**. A
conversao e simples:

```bash
python3 tools/romset-neogeo.py mslug.zip --out mslug.fbneo.zip
```

O script troca as metades, renomeia para os nomes oficiais e **confere cada CRC**
contra a tabela oficial do FBNeo. Se faltar arquivo, ele avisa e **nao grava** o
zip (romset incompleto nao tem conserto).

### Juntar romset que veio em partes

Se o romset chegou dividido em mais de um zip, e so passar **todos** de uma vez —
o script unifica num zip so:

```bash
python3 tools/romset-neogeo.py parte1.zip parte2.zip --out kof97.zip
```

> **Estado atual**: `mslug.zip` **9/9** e `kof97.zip` **13/13** — os dois com os
> nomes internos oficiais e os CRCs oficiais. O KOF veio em duas partes
> (`kof97.zip` + `kof2.zip`) e foi unificado num zip so.

## O que o MAME/FBNeo espera

| Jogo | Nomes internos | Tamanho |
|---|---|---|
| Metal Slug | `201-p1.p1`, `201-c1.c1` … `201-c4.c4`, `201-m1.m1`, `201-s1.s1`, `201-v1.v1`, `201-v2.v2` | ~14 MB |
| KOF 97 | `232-p1.p1`, `232-p2.sp2`, `232-c1.c1` … `232-c6.c6`, `232-m1.m1`, `232-s1.s1`, `232-v1.v1` … `232-v3.v3` | ~27 MB |

O que identifica o romset e o **nome interno com ponto** (`.p1`, `.c1`, `.v1`).
Underscore = formato antigo, precisa converter.

## Consoles suportados (EmulatorJS)

`snes` `nes` `gba` `gb` `gbc` `genesis` `segaMD` `n64` `psx` `arcade`
`atari2600` `segaMS` `segaGG` `segaSaturn` `3do` `lynx` `jaguar` `vb` `nds` `pce`
