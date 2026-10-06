# Jogos — como adicionar

Cada jogo tem **uma linha** no catálogo e **um arquivo** de ROM.

## 1. Coloque a ROM

```
jogos/
├── snes/
│   └── topgear2.smc
├── nes/
│   └── meujogo.nes
└── gba/
    └── outro.gba
```

Uma pasta por **console** (`snes`, `nes`, `gba`, `gb`, `genesis`, `n64`...).

## 2. Registre no `jogos.json`

Abra `docs/topgear/jogos.json` e adicione um item:

```json
{
  "jogos": [
    {
      "id": "topgear2",
      "nome": "Top Gear 2",
      "console": "snes",
      "rom": "jogos/snes/topgear2.smc"
    },
    {
      "id": "meujogo",
      "nome": "Meu Jogo",
      "console": "nes",
      "rom": "jogos/nes/meujogo.nes"
    }
  ]
}
```

| Campo | O que é |
|---|---|
| `id` | apelido curto (sem espaço/acento) — usado na URL |
| `nome` | o que aparece na tela |
| `console` | qual emulador (define o core) |
| `rom` | caminho do arquivo, relativo à pasta do site |

## 3. Abrir um jogo específico

```
https://SEU-SITE/index.html?jogo=topgear2
```

Sem `?jogo=`, abre o **primeiro** da lista. Com 2+ jogos aparece o botão
**☰ JOGOS** para trocar.

## Consoles suportados (EmulatorJS)

`snes` `nes` `gba` `gb` `gbc` `genesis` `n64` `psx` `arcade` `atari2600`
`segaMD` `segaMS` `segaGG` `segaSaturn` `3do` `lynx` `jaguar` `vb` `nds`

O nome do console é o mesmo do core do EmulatorJS.
