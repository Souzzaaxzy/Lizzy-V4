#!/usr/bin/env python3
"""
Converte um romset Neo Geo no formato de emuladores antigos (CoolROM/NeoRAGEx,
arquivos `*_c1.rom`) para o formato MAME/FBNeo que o EmulatorJS usa.

A conversao e a classica do NeoRAGEx: **trocar as duas metades** de cada
arquivo de sprite (metade de tras + metade da frente). Medido: os 4 arquivos de
sprite do Metal Slug (`mslug_c1..c4.rom`) batem com os CRCs oficiais depois do
swap; os demais arquivos (p1/s1/m1/v1/v2) ja estao corretos.

O script NAO baixa nada: so reorganiza o que ja esta no zip e confere os CRCs
contra a tabela oficial do FBNeo embutida aqui.

Uso:
    python3 tools/romset-neogeo.py <romset.zip> [--out <saida.zip>]

Se nenhum arquivo bater, o zip de saida nao e gravado (exit 1).
"""

import argparse
import sys
import zipfile
import zlib

# CRC32 oficiais (FBNeo, d_neogeo.cpp) — por jogo: {arquivo_interno: crc}
OFICIAIS = {
    "mslug": {
        "201-p1.p1": "08d8daa5",
        "201-s1.s1": "2f55958d",
        "201-c1.c1": "72813676",
        "201-c2.c2": "96f62574",
        "201-c3.c3": "5121456a",
        "201-c4.c4": "f4ad59a3",
        "201-m1.m1": "c28b3253",
        "201-v1.v1": "23d22ed1",
        "201-v2.v2": "472cf9db",
    },
    "kof97": {
        "232-p1.p1": "7db81ad9",
        "232-p2.sp2": "158b23f6",
        "232-s1.s1": "8514ecf5",
        "232-c1.c1": "5f8bf0a1",
        "232-c2.c2": "e4d45c81",
        "232-c3.c3": "581d6618",
        "232-c4.c4": "49bb1e68",
        "232-c5.c5": "34fc4e51",
        "232-c6.c6": "4ff4d47b",
        "232-m1.m1": "45348747",
        "232-v1.v1": "22a2b5b5",
        "232-v2.v2": "2304e744",
        "232-v3.v3": "759eb954",
    },
}


def crc32(data: bytes) -> str:
    return format(zlib.crc32(data) & 0xFFFFFFFF, "08x")


def trocar_metades(data: bytes) -> bytes:
    """Conversao NeoRAGEx: segunda metade na frente, primeira atras."""
    meio = len(data) // 2
    return data[meio:] + data[:meio]


def montar(romset_zips, saida: str) -> int:
    # mapa crc -> arquivo interno oficial (de todos os jogos)
    por_crc = {v: k for tabela in OFICIAIS.values() for k, v in tabela.items()}

    encontrados = {}  # nome_oficial -> bytes
    for caminho in romset_zips:
        print(f"-- {caminho}")
        zf = zipfile.ZipFile(caminho)
        for nome in zf.namelist():
            if nome.endswith(".html") or nome.endswith("/"):
                continue
            dados = zf.read(nome)
            for candidato, rotulo in ((dados, "identidade"), (trocar_metades(dados), "metades")):
                alvo = por_crc.get(crc32(candidato))
                if alvo:
                    if alvo not in encontrados:
                        encontrados[alvo] = candidato
                        print(f"  {nome:16} -> {alvo:12} ({rotulo})")
                    else:
                        print(f"  {nome:16} -> {alvo:12} (ja tinha, ignorado)")
                    break
            else:
                print(f"  {nome:16} -> sem correspondencia oficial (ignorado)")

    if not encontrados:
        print("Nenhum arquivo bateu com a tabela oficial.")
        return 1

    # qual jogo? o que tiver mais arquivos reconhecidos
    jogo = max(
        OFICIAIS,
        key=lambda j: sum(1 for k in OFICIAIS[j] if k in encontrados),
    )
    tabela = OFICIAIS[jogo]
    faltando = [k for k in tabela if k not in encontrados]
    presentes = [k for k in tabela if k in encontrados]

    print(f"\njogo: {jogo} | {len(presentes)}/{len(tabela)} arquivos oficiais presentes")
    if faltando:
        print(f"FALTANDO ({len(faltando)}): {', '.join(faltando)}")
        print("Romset incompleto — o zip de saida NAO foi gravado.")
        return 1

    with zipfile.ZipFile(saida, "w", zipfile.ZIP_DEFLATED) as z:
        for nome, dados in encontrados.items():
            z.writestr(nome, dados)
    print(f"gravado: {saida}")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(
        description="Romset Neo Geo -> MAME/FBNeo (aceita varios zips e unifica)"
    )
    ap.add_argument("zips", nargs="+", help="um ou mais romsets de entrada")
    ap.add_argument("--out", help="zip de saida (padrao: <primeiro>.fbneo.zip)")
    args = ap.parse_args()
    saida = args.out or args.zips[0].rsplit(".", 1)[0] + ".fbneo.zip"
    return montar(args.zips, saida)


if __name__ == "__main__":
    sys.exit(main())
