/**
 * Testes do comparador de respostas dos jogos (`funcs/utils/answerMatch.js`).
 *
 * Cobre o bug relatado: o nome de exibição pode trazer ponto e maiúscula
 * ("Batman.") enquanto o chute vem limpo ("batman") — e o chute precisa ser
 * aceito. Também barra o falso positivo do `includes` (resposta "it" dentro de
 * "disso").
 *
 * Uso: node tests/answer-match.test.js
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.resolve(HERE, '..');

const { respostaCorreta, canonizarResposta, normalizarResposta } =
  await import(new URL('../dados/src/funcs/utils/answerMatch.js', import.meta.url).href);

const RESULTS = [];
let CURRENT = null;

function test(name, fn) {
  CURRENT = { name, passed: 0, failed: 0, errors: [] };
  RESULTS.push(CURRENT);
  try {
    fn();
  } catch (error) {
    CURRENT.failed += 1;
    CURRENT.errors.push(`EXCEÇÃO: ${error?.stack || error}`);
  }
  console.log(`${CURRENT.failed === 0 ? '✅' : '❌'} ${name} (${CURRENT.passed} ok, ${CURRENT.failed} falhas)`);
  for (const err of CURRENT.errors) console.log(`     ${err.split('\n')[0]}`);
}

function ok(condition, message) {
  if (condition) CURRENT.passed += 1;
  else {
    CURRENT.failed += 1;
    CURRENT.errors.push(`ASSERT FALHOU: ${message}`);
  }
}

// ============================================================================
// 1) NORMALIZAÇÃO
// ============================================================================

test('canonizarResposta: tira caixa, acento, pontuação e espaço', () => {
  ok(canonizarResposta('Batman.') === 'batman', 'ponto sai');
  ok(canonizarResposta('BATMAN') === 'batman', 'caixa baixa');
  ok(canonizarResposta('Coração') === 'coracao', 'acento sai');
  ok(canonizarResposta('Homem-Aranha') === 'homemaranha', 'hífen sai');
  ok(canonizarResposta('  Up: Altas Aventuras  ') === 'up altas aventuras', 'espaços/dois-pontos saem');
  ok(canonizarResposta('') === '', 'vazio devolve vazio');
  ok(canonizarResposta(null) === '', 'null não explode');
});

test('normalizarResposta: mantém o espaço (base da comparação)', () => {
  ok(normalizarResposta('  O Rei  Leão ') === 'o rei leao', 'colapsa espaços e tira acento');
});

// ============================================================================
// 2) O BUG RELATADO — ponto e maiúscula não podem invalidar
// ============================================================================

test('BUG: display "Batman." aceita o chute "batman"', () => {
  ok(respostaCorreta('batman', ['batman']), 'chute limpo contra resposta limpa');
  ok(respostaCorreta('Batman', ['batman']), 'chute com maiúscula');
  ok(respostaCorreta('BATMAN', ['batman']), 'chute todo maiúsculo');
  ok(respostaCorreta('batman.', ['batman']), 'chute com ponto');
  ok(respostaCorreta('batman ', ['batman']), 'chute com espaço no fim');
});

test('BUG: a RESPOSTA com ponto/maiúscula também é aceita', () => {
  // É o caso do dono: a lista de respostas pode ter vindo com pontuação.
  ok(respostaCorreta('batman', ['Batman.']), 'resposta "Batman." aceita chute "batman"');
  ok(respostaCorreta('batman', ['Batman']), 'resposta "Batman" aceita chute "batman"');
  ok(respostaCorreta('o rei leao', ['O Rei Leão.']), 'acento+ponto na resposta');
});

test('BUG: hífen e espaço são a mesma coisa', () => {
  ok(respostaCorreta('homem aranha', ['homem-aranha']), 'chute com espaço');
  ok(respostaCorreta('homem-aranha', ['homem aranha']), 'chute com hífen');
  ok(respostaCorreta('mulher maravilha', ['mulher-maravilha']), 'mulher-maravilha');
});

// ============================================================================
// 3) FALSO POSITIVO — o `includes` antigo aceitava "disso" por causa do "it"
// ============================================================================

test('não dá falso positivo: "it" não casa dentro de "disso"', () => {
  ok(!respostaCorreta('acho que nao e nada disso', ['it']), '"disso" NÃO contém "it" como palavra');
  ok(!respostaCorreta('nao faço ideia', ['it']), 'sem "it" solto');
  ok(!respostaCorreta('sim', ['it']), 'chute curto sem relação');
});

test('mas aceita a palavra inteira e a frase que a contém', () => {
  ok(respostaCorreta('it', ['it']), 'chute exato');
  ok(respostaCorreta('é o filme it a coisa', ['it']), 'palavra inteira no meio da frase');
  ok(respostaCorreta('acho que é batman', ['batman']), 'resposta de uma palavra no meio');
  ok(respostaCorreta('o rei leao', ['rei leao']), 'resposta multi-palavra');
  ok(respostaCorreta('acho que é o rei leao', ['rei leao']), 'multi-palavra dentro da frase');
});

test('não aceita resposta parcial/errada', () => {
  ok(!respostaCorreta('batma', ['batman']), 'palavra incompleta não vale');
  ok(!respostaCorreta('rei', ['rei leao']), 'só parte da resposta multi-palavra não vale');
  ok(!respostaCorreta('leao', ['rei leao']), 'outra parte isolada não vale');
  ok(!respostaCorreta('', ['batman']), 'chute vazio');
  ok(!respostaCorreta('batman', []), 'sem respostas');
  ok(!respostaCorreta('batman', null), 'respostas null');
});

// ============================================================================
// 4) O BANCO REAL — todo display deve casar consigo mesmo
// ============================================================================

test('filmes.json: o display de cada filme é aceito como chute', () => {
  const data = JSON.parse(fs.readFileSync(path.join(PROJECT, 'dados/src/funcs/json/filmes.json'), 'utf-8'));
  const lista = data.filmes;
  ok(lista.length >= 260, `banco ampliado (${lista.length})`);
  let falhas = 0;
  for (const x of lista) {
    // Chute = display "cru" (com ponto, maiúscula e hífen, como o usuário digitaria)
    if (!respostaCorreta(x.d, x.r)) falhas += 1;
    // Chute = display canonizado (só letras/números/espaço)
    if (!respostaCorreta(canonizarResposta(x.d), x.r)) falhas += 1;
  }
  ok(falhas === 0, `todos os displays casam com suas respostas (falhas: ${falhas})`);
});

test('filmes.json: sem respostas ambíguas nem emojis repetidos', () => {
  const data = JSON.parse(fs.readFileSync(path.join(PROJECT, 'dados/src/funcs/json/filmes.json'), 'utf-8'));
  const lista = data.filmes;
  const emojis = new Map();
  const respostas = new Map();
  for (const x of lista) {
    emojis.set(x.e, (emojis.get(x.e) || []).concat(x.d));
    for (const r of x.r) respostas.set(r, (respostas.get(r) || []).concat(x.d));
  }
  const dupE = [...emojis.entries()].filter(([, v]) => v.length > 1);
  ok(dupE.length === 0, `nenhum emoji repetido (${JSON.stringify(dupE)})`);
  // "batman" pode apontar para Batman e Batman: O Cavaleiro das Trevas (mesmo herói);
  // qualquer OUTRA sobreposição é erro de dados.
  const ambiguas = [...respostas.entries()].filter(([k, v]) => new Set(v).size > 1 && k !== 'batman' && k !== 'o cavaleiro das trevas');
  ok(ambiguas.length === 0, `sem respostas ambíguas (${JSON.stringify(ambiguas)})`);
});

// ============================================================================

const totalOk = RESULTS.reduce((a, r) => a + r.passed, 0);
const totalFail = RESULTS.reduce((a, r) => a + r.failed, 0);
console.log('\n════════════════════════════════════════');
console.log(`RESULTADO: ${RESULTS.length} testes | ${totalOk} asserções ok | ${totalFail} falhas`);
console.log('════════════════════════════════════════');

if (totalFail > 0) {
  console.log('\nFALHAS:');
  for (const r of RESULTS) if (r.failed) for (const e of r.errors) console.log(`- [${r.name}] ${e}`);
  process.exit(1);
}
console.log('✅ TODOS OS TESTES PASSARAM');
process.exit(0);
