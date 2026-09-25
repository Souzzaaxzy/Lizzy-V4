#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
IMPORTADOR DE PERSONAGENS para a base do !akinator (Lizzy).

Le APIs publicas de personagens, DERIVA os atributos para as perguntas do
engine e grava um arquivo de base. Roda OFFLINE uma vez; o bot NAO chama API
em runtime (a base fica versionada no repositorio).

## Fontes, licenca e o que foi medido

| Fonte | Licenca | Tamanho | Atributos derivaveis |
|---|---|---|---|
| PokeAPI | BSD-3-Clause | 1351 pokemon | tipo, lendario, cor, habitat, forma, geracao, evolucao |
| SWAPI | BSD-3-Clause | 93 pessoas | genero, cor de cabelo/olho/pele, altura, especie |
| Rick & Morty API | BSD-3-Clause | 826 | status, especie, genero |
| Disney API | sem licenca declarada | ~4824 (9821 paginas/2) | filmes, aliados, inimigos (**nao importado**) |

**Wikidata NAO foi usada**, apesar de ser CC0 e ter ~109 mil personagens: MEDIDO
que ela praticamente nao tem os atributos que o engine precisa (genero em 153 de
109264, cabelo em 84, olho em 89). Sem atributo nao ha pergunta -- a base nao
ajudaria o jogo.

Por que so PokeAPI + SWAPI sao importadas:
  - **BSD-3-Clause** permite redistribuir os DADOS com atribuicao (feita aqui e
    no `meta.sources` do arquivo gerado). Sem copyleft, sem obrigacao de
    relicenciar o bot.
  - **Rick & Morty** so oferece status/especie/genero -- atributos que nao
    separam bem no nosso banco de perguntas; fica de fora para nao encher a base
    de personagens quase indistinguiveis.
  - **Disney** nao tem licenca declarada -- sem licenca clara, nao se
    redistribui. Fica de fora ate o dono decidir.

LIMITE HONESTO: uma API publica de personagens de anime/filmes com atributos
suficientes **nao existe** hoje. Jikan/AniList (anime) tem nome+imagem, mas nao
atributos -- e Jikan recusou durante o teste (HTTP 504). Por isso a base de
anime/filmes continua AUTORAL (curada a mao no `characters.json`), e as APIs
entram onde realmente agregam (pokemon e star wars).

Uso:
    python3 tools/import-characters.py --limit 151 --out /tmp/pokemon.json
    python3 tools/import-characters.py --source swapi --out /tmp/sw.json

Sem argumentos: importa uma amostra das duas fontes e imprime um resumo.
"""

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
QUESTIONS = os.path.join(ROOT, 'dados/src/funcs/json/akinator/questions.json')

UA = 'LizzyAkinatorImporter/1.0 (+https://github.com/Souzzaaxzy/Lizzy-V4)'
TIMEOUT = 25


def http_json(url, tentativas=3):
    """GET JSON com retry simples. Nunca lanca para o chamador: devolve None."""
    for t in range(tentativas):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': UA, 'Accept': 'application/json'})
            with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
                return json.loads(r.read().decode('utf-8'))
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, json.JSONDecodeError) as e:
            if t == tentativas - 1:
                print(f'  ! falhou {url}: {e}', file=sys.stderr)
                return None
            time.sleep(1.5 * (t + 1))
    return None


def load_question_ids():
    with open(QUESTIONS, encoding='utf-8') as f:
        return {q['id'] for q in json.load(f)['questions']}


# --- PokeAPI -------------------------------------------------------------

# tipo do pokemon -> pergunta do engine
TIPO_PARA_PERGUNTA = {
    'fire': 'fogo',
    'water': 'aquatico',
    'electric': 'eletrico',
    'fighting': 'lutador',
    'ghost': 'fantasma',
    'dragon': 'dragao',
    'bug': 'inseto',
    'ground': 'pedra',
    'rock': 'pedra',
    'ice': 'gelo',
    'psychic': 'psiquico',
    'dark': 'noturno',
    'fairy': 'fada',
    'poison': 'venenoso',
    'grass': 'planta',
    'steel': 'metalico',
    'flying': 'voador',
}

# habitat -> pergunta
HABITAT_PARA_PERGUNTA = {
    'sea': 'aquatico',
    'waters-edge': 'aquatico',
}

# forma (shape) -> perguntas. E o que separa os pokemon "parecidos".
FORMA_PARA_PERGUNTA = {
    'ball': {'pequeno': 1, 'forma_humanoide': 0, 'cauda': 0},
    'squiggle': {'pequeno': 1, 'forma_humanoide': 0, 'cauda': 0.5},
    'fish': {'peixe': 1, 'aquatico': 1, 'forma_humanoide': 0, 'cauda': 1, 'asa': 0},
    'arms': {'forma_humanoide': 1, 'cauda': 1, 'asa': 0},
    'quadruped': {'mamifero': 1, 'forma_humanoide': 0, 'cauda': 1, 'asa': 0},
    'wings': {'asa': 1, 'ave': 1, 'forma_humanoide': 0, 'cauda': 0.5},
    'tentacles': {'aquatico': 1, 'forma_humanoide': 0, 'cauda': 0},
    'upright': {'forma_humanoide': 1, 'cauda': 0.5},
    'armor': {'forma_humanoide': 0, 'crab': 1, 'cauda': 0},
    'blob': {'forma_humanoide': 0, 'cauda': 0},
    'bug-wings': {'asa': 1, 'inseto': 1, 'forma_humanoide': 0},
    'humanoid': {'forma_humanoide': 1, 'mamifero': 0.5},
    'legs': {'forma_humanoide': 0, 'cauda': 0.5},
}

# cor -> pergunta
COR_PARA_PERGUNTA = {
    'blue': 'cor_azul',
    'red': 'cor_vermelha',
    'green': 'cor_verde',
    'yellow': 'cor_amarela',
    'pink': 'cor_rosa',
    'purple': 'cor_roxa',
    'brown': 'cor_marrom',
    'gray': 'cor_cinza',
    'orange': 'cor_laranja',
    'black': 'roupa_preta',
    'white': 'roupa_branca',
}


def estagio_evolutivo(species, cache):
    """
    Descobre em que posicao da cadeia evolutiva o pokemon esta (0 = base).
    Segue `evolves_from_species` ate' o inicio. Usa cache por URL.
    """
    passo = 0
    atual = species
    vistos = set()
    while True:
        # usa o campo 'evolution_chain' quando disponivel
        cadeia = (atual.get('evolution_chain') or {}).get('url')
        if cadeia:
            d = cache.get(cadeia) or http_json(cadeia)
            if d:
                cache[cadeia] = d
                # acha este pokemon na cadeia e conta a profundidade
                alvo = atual.get('name')
                pilha = [(d.get('chain'), 0)]
                while pilha:
                    no, prof = pilha.pop()
                    if not no:
                        continue
                    if (no.get('species') or {}).get('name') == alvo:
                        return prof
                    for evo in no.get('evolves_to', []) or []:
                        pilha.append((evo, prof + 1))
                return None
        anterior = (atual.get('evolves_from_species') or {}).get('url')
        if not anterior or anterior in vistos or passo > 3:
            return passo
        vistos.add(anterior)
        atual = http_json(anterior)
        if not atual:
            return passo
        passo += 1


def pokemon_para_personagem(species, question_ids, detalhes=None, cache=None):
    """
    Monta um personagem a partir do /pokemon-species + alguns campos do /pokemon.
    So emite perguntas que EXISTEM no banco (protege contra id orfao).
    """
    nome_en = species.get('name', '')
    nome = (species.get('names') or [{}])
    label = nome_en.replace('-', ' ').title()
    for n in species.get('names', []):
        if n.get('language', {}).get('name') == 'pt':
            label = n['name']
            break

    answers = {}

    def set_(qid, valor):
        if qid in question_ids:
            answers[qid] = valor

    # shape/habitat ficam disponiveis antes das heuristics que os usam
    forma = (species.get('shape') or {}).get('name')
    habitat = (species.get('habitat') or {}).get('name')

    # todo pokemon
    set_('pokemon', 1)
    set_('game', 1)
    set_('anime', 1 if species.get('id', 0) <= 890 else 0.5)
    set_('animal', 1)
    set_('fala', 0)
    set_('humano', 0)
    set_('real', 0)
    set_('monstro', 1 if species.get('shape', {}).get('name') in ('squiggle', 'tentacles', 'armor') else 0.5)
    set_('japones', 1)
    set_('traje_vermelho', 0)
    set_('cor_azul', 0)

    # cor predominante (uma pergunta por cor; a que casar fica 1, o resto 0)
    cor = (species.get('color') or {}).get('name')
    for cor_nome, qid in COR_PARA_PERGUNTA.items():
        set_(qid, 1 if cor == cor_nome else 0)

    # lendario / mitico / bebe
    lendario = bool(species.get('is_legendary')) or bool(species.get('is_mythical'))
    set_('lendario', 1 if lendario else 0)
    set_('deus', 1 if species.get('is_mythical') else 0)
    set_('bebe', 1 if species.get('is_baby') else 0)
    set_('imortal', 1 if lendario else 0.5)
    set_('crianca', 1 if species.get('is_baby') else 0)

    # forma / tamanho
    set_('pequeno', 1 if forma in ('ball', 'armor') else 0.5)
    set_('grande', 1 if forma in ('quadruped',) else 0.5)

    # habitat
    if habitat in HABITAT_PARA_PERGUNTA:
        set_(HABITAT_PARA_PERGUNTA[habitat], 1)

    # geracao
    ger = (species.get('generation') or {}).get('name', '')
    set_('geracao_antiga', 1 if ger in ('generation-i', 'generation-ii', 'generation-iii') else 0)
    set_('primeira_geracao', 1 if ger == 'generation-i' else 0)

    # evolucao: forma final / se evolui / ESTAGIO. O estagio e o que separa
    # linhas evolutivas que compartilham tipo/cor/forma (ex.: Ivysaur x Venusaur).
    estagio = estagio_evolutivo(species, cache if cache is not None else {})
    set_('starter', 0 if species.get('evolves_from_species') else 1)
    set_('evolui', 1 if species.get('evolves_from_species') else 0.5)
    if estagio is not None:
        set_('primeira_forma', 1 if estagio == 0 else 0)
        set_('segunda_forma', 1 if estagio == 1 else 0)
        set_('terceira_forma', 1 if estagio >= 2 else 0)
        set_('evolucao_final', 1 if estagio >= 2 else 0)
    # altura/peso reais (do /pokemon, injetados em `detalhes`)
    altura = (detalhes or {}).get('height')
    peso = (detalhes or {}).get('weight')
    if isinstance(altura, int):
        set_('alto', 1 if altura >= 15 else 0)
        set_('tamanho_medio', 1 if 8 <= altura < 15 else 0)
        set_('pequeno', 1 if altura < 8 else 0)
    if isinstance(peso, int):
        set_('pesado', 1 if peso >= 500 else 0)

    # forma -> detalhes que separam pokemon de mesma cor/tipo
    for qid, v in FORMA_PARA_PERGUNTA.get(forma, {}).items():
        set_(qid, v)

    # habitat selvagem / raridade
    set_('habitat_selvagem', 0 if not habitat else 1)
    taxa = species.get('capture_rate')
    if isinstance(taxa, int):
        set_('raro', 1 if taxa <= 45 else 0)
        set_('popular', 1 if taxa >= 120 else 0)
    set_('amigavel', 0.5)

    # chifres/cauda/olhos por heuristica da forma
    set_('chifre', 1 if forma in ('quadruped', 'upright') and 'nidoran' in nome_en else 0)
    set_('olhos_grandes', 1 if forma in ('ball', 'fish') else 0.5)
    set_('tamanho_medio', 0.5)

    # genero: a species nao traz; fica como desconhecido.
    set_('masculino', 0.5)

    categoria = 'pokemon'
    descricao = 'Pokemon. '
    for g in species.get('genera', []) or []:
        if g.get('language', {}).get('name') == 'pt':
            descricao = g['genus'] + ' Pokemon.'
            break

    return {
        'id': 'pk-' + nome_en,
        'name': label,
        'category': categoria,
        'description': descricao,
        'priorWeight': 1,
        'answers': answers,
        'source': 'PokeAPI',
    }


def importar_pokemon(limite, question_ids):
    print(f'PokeAPI: importando {limite} pokemon...')
    out = []
    cache = {}
    for i in range(1, limite + 1):
        sp = http_json(f'https://pokeapi.co/api/v2/pokemon-species/{i}/')
        if not sp:
            continue
        pk = http_json(f'https://pokeapi.co/api/v2/pokemon/{i}/') or {}
        out.append(pokemon_para_personagem(sp, question_ids, detalhes=pk, cache=cache))
        if i % 25 == 0:
            print(f'  ... {i}')
    return out


# --- SWAPI ---------------------------------------------------------------

def swapi_para_personagem(p, question_ids):
    answers = {}

    def set_(qid, valor):
        if qid in question_ids:
            answers[qid] = valor

    genero = (p.get('gender') or '').lower()
    cabelo = (p.get('hair_color') or '').lower()
    olhos = (p.get('eye_color') or '').lower()
    try:
        altura = float(p.get('height') or 0)
    except ValueError:
        altura = 0

    # SO afirmamos o que a SWAPI realmente informa. Antes eu marcava valores
    # genericos iguais para todos ("arma": 1, "guerra": 1, "equipe": 1...) e o
    # resultado foi 14 personagens com assinatura IDENTICA -- o engine nunca
    # conseguiria separa-los. Campo ausente fica "nao sei" (0.5).
    set_('star_wars', 1)
    set_('movie', 1)
    set_('real', 0)
    set_('espaco', 1)
    set_('fala', 1)

    # genero
    set_('masculino', 1 if genero == 'male' else (0 if genero == 'female' else 0.5))
    set_('mulher_luta', 1 if genero == 'female' else 0)
    set_('heroi', 1 if genero == 'male' else 0.5)

    # cabelo: so afirmamos quando a API traz um valor conhecido
    if cabelo in ('none', 'n/a'):
        set_('careca', 1)
    elif cabelo in ('blond', 'brown', 'black', 'grey', 'white', 'auburn', 'red'):
        set_('careca', 0)
        set_('loiro', 1 if cabelo == 'blond' else 0)
        set_('ruivo', 1 if cabelo in ('auburn', 'red') else 0)
        set_('cabelo_preto', 1 if cabelo == 'black' else 0)
        set_('cabelo_branco', 1 if cabelo in ('grey', 'white') else 0)
        set_('barba', 1 if cabelo in ('brown', 'grey', 'white') else 0)
    # olhos: idem
    if olhos in ('blue', 'green', 'brown', 'black', 'yellow', 'red', 'orange', 'hazel', 'pink'):
        set_('cor_azul', 1 if olhos == 'blue' else 0)
        set_('cor_verde', 1 if olhos == 'green' else 0)

    # altura/peso reais -> separa os "grandes" entre si
    if altura > 0:
        set_('alto', 1 if altura >= 190 else 0)
        set_('grande', 1 if altura >= 190 else 0)
        set_('pequeno', 1 if altura <= 150 else 0)
        set_('tamanho_medio', 1 if 150 < altura < 190 else 0)
        set_('forte', 1 if altura >= 180 else 0)
    try:
        massa = float(p.get('mass') or 0)
    except ValueError:
        massa = 0
    if massa > 0:
        set_('pesado', 1 if massa >= 90 else 0)
    # ano de nascimento -> "idoso"
    nasc = (p.get('birth_year') or '').strip().lower()
    if nasc.endswith('bby'):
        try:
            set_('idoso', 1 if float(nasc.split()[0]) >= 60 else 0)
        except (ValueError, IndexError):
            pass
    set_('oculos', 0)

    return {
        'id': 'sw-' + (p.get('name', '').lower().replace(' ', '-')),
        'name': p.get('name', 'Desconhecido'),
        'category': 'star_wars',
        'description': 'Personagem de Star Wars.',
        'priorWeight': 1,
        'answers': answers,
        'source': 'SWAPI',
    }


def importar_swapi(limite, question_ids):
    print(f'SWAPI: importando ate {limite} pessoas...')
    out = []
    url = 'https://swapi.dev/api/people/'
    while url and len(out) < limite:
        d = http_json(url)
        if not d:
            break
        for p in d.get('results', []):
            if len(out) >= limite:
                break
            out.append(swapi_para_personagem(p, question_ids))
        url = d.get('next')
    return out


def main():
    ap = argparse.ArgumentParser(description='Importa personagens para a base do !akinator.')
    ap.add_argument('--source', choices=['pokemon', 'swapi', 'all'], default='all')
    ap.add_argument('--limit', type=int, default=151, help='quantos importar (pokemon: id maximo; swapi: total)')
    ap.add_argument('--out', default=None, help='arquivo de saida (JSON). Sem isso, so imprime o resumo.')
    args = ap.parse_args()

    qids = load_question_ids()
    print(f'perguntas no banco: {len(qids)}')

    personagens = []
    if args.source in ('pokemon', 'all'):
        personagens += importar_pokemon(args.limit, qids)
    if args.source in ('swapi', 'all'):
        n = args.limit if args.source == 'swapi' else 93
        personagens += importar_swapi(n, qids)

    # valida ids e remove personagens sem nenhuma resposta util
    usados = set()
    uteis = []
    for c in personagens:
        ruins = [q for q in c['answers'] if q not in qids]
        if ruins:
            print(f'  ! {c["id"]}: perguntas invalidas {ruins}', file=sys.stderr)
            continue
        if len(c['answers']) < 5:
            continue
        uteis.append(c)
        usados.update(c['answers'].keys())

    # GARANTIA: nenhum personagem pode ter assinatura IDENTICA a outro, senao o
    # engine nunca separa os dois (nao ha pergunta que os distinga). Removemos os
    # repetidos e informamos quantos cairam -- melhor uma base menor e honesta do
    # que uma cheia de personagens indistinguiveis.
    vistos = {}
    unicos = []
    descartados = []
    for c in uteis:
        sig = json.dumps(sorted(c['answers'].items()), sort_keys=True)
        if sig in vistos:
            descartados.append((c['name'], vistos[sig]))
            continue
        vistos[sig] = c['name']
        unicos.append(c)
    if descartados:
        print(f'descartados por serem indistinguiveis: {len(descartados)}')
        for nome, igual in descartados[:5]:
            print(f'  - {nome} (igual a {igual})')
    uteis = unicos

    print(f'importados: {len(uteis)} personagens')
    print(f'perguntas usadas: {len(usados)}')

    # quantas perguntas realmente DIVIDEM a base importada
    dividem = 0
    for q in usados:
        vals = [c['answers'][q] for c in uteis if q in c['answers']]
        if any(v >= 0.75 for v in vals) and any(v <= 0.25 for v in vals):
            dividem += 1
    print(f'perguntas que dividem a base: {dividem}')

    if args.out:
        base = {
            'meta': {
                'version': 1,
                'descricao': 'Base importada de APIs publicas. answers: id da pergunta -> 0..1.',
                'sources': [
                    {'name': 'PokeAPI', 'url': 'https://pokeapi.co', 'license': 'BSD-3-Clause'},
                    {'name': 'SWAPI', 'url': 'https://swapi.dev', 'license': 'BSD-3-Clause'},
                ],
            },
            'characters': uteis,
        }
        with open(args.out, 'w', encoding='utf-8') as f:
            json.dump(base, f, ensure_ascii=False, indent=2)
        print(f'gravado: {args.out}')
    else:
        print('(sem --out: nada gravado)')
        for c in uteis[:5]:
            print('  exemplo:', c['id'], '|', c['name'], '|', len(c['answers']), 'atributos')


if __name__ == '__main__':
    main()
