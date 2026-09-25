# ENGINE PROPRIO DO `!akinator`

Este diretorio guarda a **base de conhecimento** do `!akinator` da Lizzy. O jogo
NAO depende do Akinator.com, de `akinator-client`, de API, proxy ou cookie: e um
engine de adivinhacao probabilistico proprio, rodando dentro do bot.

## Arquivos

| Arquivo | Papel |
|---|---|
| `questions.json` | o banco de perguntas (ids estaveis) -- **versionado aqui** |
| `characters.json` | a base **autoral** (curada a mao) -- versionada aqui |
| `characters-imported.json` | base **importada de APIs publicas** -- versionada aqui |

As duas bases somam **249 personagens** e o engine trata igual. Elas ficam
separadas de proposito: assim a **procedencia e a licenca** de cada uma sao
explicitas, e a base autoral nunca e misturada com dado de terceiro.

A base acima e a **autoral**. O que o jogo aprende e o que a comunidade sugere
ficam **fora** dela, no database (para nao sujar a base versionada):

| Arquivo (database/akinator/) | Papel |
|---|---|
| `learned.json` | ajustes aprendidos (peso + amostra por personagem/pergunta) |
| `pending.json` | correcoes aguardando votos (fila de revisao) |

## Como funciona (engine)

1. Cada personagem declara, para cada pergunta, um valor de **0 a 1**:
   `1` sim · `0.75` provavelmente · `0.5` nao sei · `0.25` provavelmente nao · `0` nao.
2. A partida comeca com todos os personagens igualmente provaveis.
3. A cada resposta, a probabilidade de cada personagem e recalculada
   (posterior Bayesiana) com **suavizacao Beta** -- uma resposta ruim penaliza,
   mas nao zera o candidato, entao ele pode se recuperar.
4. A **proxima pergunta** e escolhida pela que mais reduz a **entropia**
   (ganho de informacao esperado), com um pequeno bonus para perguntas pouco
   usadas. Isso evita sequencias de perguntas quase aleatorias.
5. O jogo palpita quando ha confianca alta (>= 85%) **ou** quando a lideranca e
   clara (o lider bem a frente do 2o), **ou** quando restam poucos candidatos.
6. Acerto e errado terminam a partida; errar permite informar o personagem, o
   que vai para a **fila** e so entra na base com votos.

Codigo: `dados/src/funcs/utils/akinator-engine.js` (matematica) e
`dados/src/funcs/utils/akinator-game.js` (sessoes, correcoes, persistencia).

## Como adicionar uma PERGUNTA

1. Abra `questions.json` e adicione um item com um **id unico e curto**
   (ex.: `"tem_asas"`) e o texto.
2. A pergunta passa a ser considerada automaticamente na proxima partida.
3. Se a pergunta for ambigua para o usuario, marque `"imprecise": true` --
   nesse caso o piso de compatibilidade e maior (respostas valem menos).

## Como adicionar um PERSONAGEM

Edite `characters.json` e adicione:

```json
{
  "id": "meu-personagem",
  "name": "Meu Personagem",
  "category": "anime",
  "description": "Uma linha curta.",
  "priorWeight": 1,
  "answers": { "anime": 1, "humano": 1, "masculino": 0.5, "usa_espada": 0 }
}
```

Regras:
- **id** unico, sem espacos (use `-`);
- so cite as perguntas que voce conhece -- o que faltar vale `0.5`
  (desconhecido), o que e melhor do que afirmar algo errado;
- a **descricao** e curta (aparece no palpite);
- a **categoria** alimenta a linha `Categoria:` do palpite.

Depois de editar, valide com:

```bash
node tests/akinator.test.js
```

O teste confere que todo atributo aponta para uma pergunta existente, que nao ha
ids repetidos e que **nenhum personagem ficou indistinguivel** de outro.

> O `answers` usa o **id** da pergunta, nunca a posicao. Se voce reordenar o
> `questions.json`, nada quebra.

## Como revisar CORRECOES

Errar o palpite gera uma correcao em `pending.json`, que precisa de
`MIN_VOTES_TO_PROMOTE` votos (hoje 2) para ser promovida. Para revisar e
promover manualmente, em Node:

```js
const { AkinatorGameManager } = await import('./dados/src/funcs/utils/akinator-game.js');
const gm = new AkinatorGameManager({
  questions: require('./dados/src/funcs/json/akinator/questions.json').questions,
  characters: require('./dados/src/funcs/json/akinator/characters.json').characters,
  pendingFile: './dados/database/akinator/pending.json',
  learnedFile: './dados/database/akinator/learned.json',
});
console.log(gm.pendingCount, gm.pending);   // veja a fila
gm.promoverCorrecoes();                     // promove quem tiver votos
```

Sessoes marcadas como **adversariais** (respostas contraditorias em serie) nao
geram correcao nem treinam a base -- e a defesa contra troll.

## Importar personagens de APIs publicas

O script `tools/import-characters.py` (na raiz do projeto) le APIs publicas,
DERIVA os atributos para as perguntas do engine e grava a base. Roda **offline
uma vez** -- o bot nao chama API em runtime (a base fica versionada).

```bash
# amostra das duas fontes, sem gravar
python3 tools/import-characters.py

# gen 1 (151 pokemon) + star wars
python3 tools/import-characters.py --source all --limit 151 \
  --out dados/src/funcs/json/akinator/characters-imported.json

# so pokemon
python3 tools/import-characters.py --source pokemon --limit 151 --out /tmp/pk.json
```

### Fontes e licenca (medido)

| Fonte | Licenca | Tamanho | Importada? |
|---|---|---|---|
| PokeAPI | **BSD-3-Clause** | 1351 | sim (a melhor: tipo, cor, habitat, forma, evolucao, geracao, raridade) |
| SWAPI | **BSD-3-Clause** | 93 | sim (genero, cabelo, olho, altura, peso, nascimento) |
| Rick & Morty API | BSD-3-Clause | 826 | nao (so status/especie/genero -- separa mal) |
| Disney API | **sem licenca** | ~4824 | nao (sem licenca clara, nao se redistribui) |
| **Wikidata** | CC0 | **109.264** | nao (MEDIDO: genero em 153, cabelo em 84, olho em 89 -- quase sem atributo) |
| Jikan/AniList (anime) | -- | grande | nao (nome+imagem, sem atributo; Jikan deu HTTP 504) |

**Por que nao usar uma API "com todos os personagens"**: ela nao existe com
atributos. As grandes bases de anime/filme dao nome e imagem, mas o engine vive
de **atributo** (e humano? e loiro? usa espada?) -- sem isso a pergunta nao tem
como ser feita. A base de anime/filmes continua **autoral** por esse motivo; as
APIs entram onde realmente agregam (pokemon e star wars).

### Garantias do importador

- descarta personagem que ficasse **indistinguivel** de outro (sem atributo que
  os separe, o engine nunca acertaria);
- confere que todo atributo aponta para pergunta **existente**;
- registra `meta.sources` com nome, URL e **licenca** de cada fonte no arquivo.

## Como rodar os testes

```bash
node tests/akinator.test.js
```

Cobre a base, a matematica do engine, as sessoes (isolamento, expiracao,
cancelamento), a correcao com votos e a partida inteira pelo handler real.

## Atualizar o engine

O engine nao tem passo de build: e JavaScript puro. Mexeu no algoritmo, rode os
testes. Se mudar a **escala** das respostas, atualize o `meta.escala` em
`questions.json` e o `ANSWER_VALUE` em `akinator-engine.js`.

---

## Origem e licenca

A **referencia arquitetural** e o projeto **"Sensei Knows" / Aaklon/akinator**
(https://github.com/Aaklon/akinator): um engine de 20 perguntas em Go, sob
**AGPL-3.0**. Ele foi estudado para entender as tecnicas (posterior Bayesiana,
entropia/ganho de informacao, suavizacao Beta, deteccao de resposta adversarial
e correcoes com votos).

**Nenhum codigo foi copiado ou traduzido, e nenhum dado foi reutilizado**:

- o AGPL-3.0 e copyleft forte com **clausula de rede** -- incorporar ou traduzir
  aquele codigo obrigaria a relicenciar o bot inteiro sob AGPL e oferecer o
  fonte a quem usa o bot pela rede. Para nao impor essa obrigacao, foi feita uma
  **implementacao independente** em JavaScript, escrita do zero a partir das
  tecnicas publicas descritas na documentacao do projeto;
- o `data/` do repositorio original esta **vazio** (so `.gitkeep`), entao nao
  havia dataset a reutilizar;
- a base de personagens e o banco de perguntas deste diretorio sao **autorais da
  Lizzy** (texto e atributos escritos aqui).

Se um dia o projeto de referencia ou outro material AGPL for reaproveitado de
fato, a decisao de licenca precisa ser tomada pelo dono do bot -- nao e uma
escolha tecnica que se toma de passagem.
