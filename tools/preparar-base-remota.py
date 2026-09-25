#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Prepara a BASE DE PERSONAGENS para o dono hospedar no PROPRIO repositorio.

Ideia: o dono cria um repositorio (publico) so com a base, e o bot puxa de la
por URL. Este script:

  1. monta o arquivo `characters.json` (base autoral + o que foi importado, se
     houver) no formato que o engine le;
  2. valida (ids unicos, sem pergunta orfa, sem personagem indistinguivel);
  3. imprime o passo a passo e a URL exata para colocar no `.env` do bot.

NAO faz push nem cria repositorio sozinho (isso e decisao sua, com a sua conta).
Ele deixa a pasta pronta para voce subir.

Uso:
    # monta a pasta ./akinator-base com a base do bot atual
    python3 tools/preparar-base-remota.py --out ./akinator-base

    # junta tambem um arquivo importado
    python3 tools/preparar-base-remota.py --out ./akinator-base \\
        --importar /tmp/pokemon.json

    # so valida o que vai sair, sem escrever
    python3 tools/preparar-base-remota.py --dry
"""

import argparse
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LOCAL_AUTORAL = os.path.join(ROOT, 'dados/src/funcs/json/akinator/characters.json')
QUESTIONS = os.path.join(ROOT, 'dados/src/funcs/json/akinator/questions.json')


def carregar_personagens(caminho):
    with open(caminho, encoding='utf-8') as f:
        d = json.load(f)
    lista = d if isinstance(d, list) else d.get('characters', [])
    return list(lista or [])


def main():
    ap = argparse.ArgumentParser(description='Prepara a base de personagens para hospedar num repositorio.')
    ap.add_argument('--out', default='./akinator-base', help='pasta de saida (padrao: ./akinator-base)')
    ap.add_argument('--importar', action='append', default=[], help='arquivo(s) extra(s) para juntar (pode repetir)')
    ap.add_argument('--sem-autoral', action='store_true', help='nao incluir a base autoral do bot')
    ap.add_argument('--dry', action='store_true', help='so validar, sem escrever')
    args = ap.parse_args()

    with open(QUESTIONS, encoding='utf-8') as f:
        qids = {q['id'] for q in json.load(f)['questions']}

    personagens = []
    if not args.sem_autoral:
        personagens += carregar_personagens(LOCAL_AUTORAL)
    for extra in args.importar:
        personagens += carregar_personagens(extra)

    # --- validacao ---
    erros = []
    ids = set()
    unicos = []
    assinaturas = {}
    descartados = 0
    for c in personagens:
        if not c.get('id') or not c.get('name'):
            erros.append(f'personagem sem id/name: {c!r:.60}')
            continue
        if c['id'] in ids:
            continue  # id repetido: ignora silenciosamente (merge)
        ruins = [q for q in (c.get('answers') or {}) if q not in qids]
        if ruins:
            erros.append(f'{c["id"]}: pergunta inexistente {ruins[:3]}')
            continue
        sig = json.dumps(sorted((c.get('answers') or {}).items()), sort_keys=True)
        if sig in assinaturas:
            descartados += 1  # indistinguivel de outro: nao serve ao engine
            continue
        assinaturas[sig] = c['id']
        ids.add(c['id'])
        unicos.append(c)

    if erros:
        print('ERROS na base (corrija antes de publicar):')
        for e in erros[:10]:
            print('  -', e)
        sys.exit(1)

    # quantas perguntas realmente dividem a base
    dividem = 0
    for q in qids:
        vals = [c['answers'][q] for c in unicos if q in c['answers']]
        if any(v >= 0.75 for v in vals) and any(v <= 0.25 for v in vals):
            dividem += 1

    print(f'personagens: {len(unicos)}')
    print(f'perguntas que dividem a base: {dividem}')
    if descartados:
        print(f'descartados por serem indistinguiveis: {descartados}')
    print('validacao: OK (ids unicos, sem pergunta orfa, sem indistinguivel)')

    if args.dry:
        print('(--dry: nada escrito)')
        return

    os.makedirs(args.out, exist_ok=True)
    destino = os.path.join(args.out, 'characters.json')
    base = {
        'meta': {
            'version': 1,
            'descricao': 'Base de personagens do !akinator (Lizzy). answers: id da pergunta -> 0..1.',
            'fontes': 'Autoral + PokeAPI/SWAPI (BSD-3-Clause) quando importados.',
        },
        'characters': unicos,
    }
    with open(destino, 'w', encoding='utf-8') as f:
        json.dump(base, f, ensure_ascii=False, indent=2)

    tamanho = os.path.getsize(destino) / 1024
    print(f'\ngravado: {destino} ({tamanho:.0f} KB)')

    print(f"""
=====================================================================
COMO PUBLICAR (passo a passo)
=====================================================================
1) crie um repositorio PUBLICO no GitHub (ex.: "lizzy-akinator-base")

2) suba o arquivo (na raiz do repositorio, com o nome characters.json):
   cd {args.out}
   git init
   git add characters.json
   git commit -m "base de personagens do akinator"
   git branch -M main
   git remote add origin https://github.com/SEU_USUARIO/lizzy-akinator-base.git
   git push -u origin main

3) a URL que o bot usa e a "raw" do arquivo:
   https://raw.githubusercontent.com/SEU_USUARIO/lizzy-akinator-base/main/characters.json

   (confira abrindo no navegador: tem que mostrar o JSON)

4) no .env do bot, aponte para ela:
   AKINATOR_BASE_URL=https://raw.githubusercontent.com/SEU_USUARIO/lizzy-akinator-base/main/characters.json

   Para usar o SEU repositorio E o padrao ao mesmo tempo, separe por virgula:
   AKINATOR_BASE_URL=https://.../seu-repo/main/characters.json,https://raw.githubusercontent.com/Souzzaaxzy/Lizzy-V4/akinator-data/akinator/characters.json

5) reinicie o bot. No boot ele loga:
   [AKINATOR] base remota: origem=remoto (fontes: N) | +N personagens | total=N

OBSERVACOES
- o repositorio PRECISA ser publico: a URL raw de repo privado nao funciona sem
  token (a Lizzy nao carrega credencial para isso, de proposito).
- o bot guarda um CACHE local (1 dia), entao ele nao baixa a cada partida.
- se a rede falhar, ele usa o cache e, sem cache, a base local do bot.
- trocar a base depois: basta subir o characters.json novo e reiniciar (ou
  esperar o cache vencer).
=====================================================================
""")


if __name__ == '__main__':
    main()
