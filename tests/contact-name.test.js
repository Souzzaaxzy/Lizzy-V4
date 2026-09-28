/**
 * Testes do resolvedor ÚNICO de nome de contato (`utils/contactName.js`).
 *
 * Motivo: o nome "bonito" de alguém estava espalhado em cada comando (o `!me`
 * lia `store.contacts`, o `!cf` lia metadata, outros liam o `pushname` do
 * contador), então o mesmo usuário aparecia com nomes diferentes — ou com o
 * LID/número cru. Este módulo é a fonte única e é PURO (deps por parâmetro),
 * então dá para testar sem socket.
 *
 * Uso: node tests/contact-name.test.js
 */

import fs from 'fs';
import os from 'os';
import path from 'path';

// Sem dependência de banco, mas o módulo é importado junto do resto no teste
// de integração; aqui é puro.
const {
  resolverNomeContato,
  resolverNomesContatos,
  acharParticipantePorId,
  numerosDoParticipante,
  nomeInutil,
  baseId,
} = await import(new URL('../dados/src/utils/contactName.js', import.meta.url).href);

const RESULTS = [];
let CURRENT = null;

function test(name, fn) {
  CURRENT = { name, passed: 0, failed: 0, errors: [] };
  RESULTS.push(CURRENT);
  try {
    const result = fn();
    if (result && typeof result.then === 'function') {
      return result.then(() => finish(name)).catch((error) => {
        CURRENT.failed += 1;
        CURRENT.errors.push(`EXCEÇÃO: ${error?.stack || error}`);
        finish(name);
      });
    }
    finish(name);
  } catch (error) {
    CURRENT.failed += 1;
    CURRENT.errors.push(`EXCEÇÃO: ${error?.stack || error}`);
    finish(name);
  }
  return Promise.resolve();
}

function finish(name) {
  console.log(`${CURRENT.failed === 0 ? '✅' : '❌'} ${name} (${CURRENT.passed} ok, ${CURRENT.failed} falhas)`);
  for (const err of CURRENT.errors) console.log(`     ${err.split('\n')[0]}`);
}

function eq(actual, expected, message) {
  if (actual === expected) CURRENT.passed += 1;
  else {
    CURRENT.failed += 1;
    CURRENT.errors.push(`ASSERT FALHOU: ${message} — esperado ${JSON.stringify(expected)}, obtido ${JSON.stringify(actual)}`);
  }
}

function ok(cond, message) {
  if (cond) CURRENT.passed += 1;
  else { CURRENT.failed += 1; CURRENT.errors.push(`ASSERT FALHOU: ${message}`); }
}

// ============================================================================
// FIXTURES
// ============================================================================

const LID = '5551000060000@lid';
const JID = '55110060999999@s.whatsapp.net';
const NUM = '55110060999999';

function metadata(extra = {}) {
  return {
    id: 'g@g.us',
    participants: [
      { id: LID, lid: LID, phoneNumber: JID, notify: extra.notify ?? 'NomeDoGrupo' },
    ],
  };
}

// ============================================================================
// 1) HELPERS PUROS
// ============================================================================

await test('baseId: tira :device e @...', () => {
  eq(baseId('5551000060000:14@lid'), '5551000060000', ':device removido');
  eq(baseId('55110060999999@s.whatsapp.net'), '55110060999999', 'jid -> base');
  eq(baseId(''), '', 'vazio');
  eq(baseId(null), '', 'null');
});

await test('nomeInutil: genérico, número e JID cru são inúteis', () => {
  ok(nomeInutil(''), 'vazio');
  ok(nomeInutil('   '), 'só espaços');
  ok(nomeInutil('Usuário'), 'genérico');
  ok(nomeInutil('user'), 'user');
  ok(nomeInutil('unknown'), 'unknown');
  ok(nomeInutil('55110060999999'), 'número');
  ok(nomeInutil('+55 11 0060 999999'.replace(/\s/g, '')), 'número com +');
  ok(nomeInutil('55110060999999@s.whatsapp.net'), 'JID cru');
  ok(!nomeInutil('João'), 'nome real é útil');
  ok(!nomeInutil('Maria Eduarda'), 'nome composto é útil');
});

await test('acharParticipantePorId: casa por id/lid/phoneNumber/pn', () => {
  const md = metadata();
  ok(acharParticipantePorId(md, LID), 'acha pelo LID');
  ok(acharParticipantePorId(md, JID), 'acha pelo JID/phoneNumber');
  ok(acharParticipantePorId(md, NUM), 'acha pelo número');
  ok(acharParticipantePorId(md, `${JID.split('@')[0]}:3@s.whatsapp.net`), 'acha com :device');
  eq(acharParticipantePorId(md, '000@lid'), null, 'id fora -> null');
  eq(acharParticipantePorId(null, LID), null, 'metadata ausente -> null');
});

await test('numerosDoParticipante: devolve os telefones do membro', () => {
  eq(numerosDoParticipante(metadata(), LID).join(','), NUM, 'pega o número');
});

// ============================================================================
// 2) RESOLUÇÃO — ORDEM
// ============================================================================

await test('1º: usa o `getName` (nome do contato da agenda)', async () => {
  const nome = await resolverNomeContato(LID, {
    nazu: { getName: async () => 'Nome Da Agenda' },
    metadata: metadata({ notify: 'NomeDoGrupo' }),
    from: 'g@g.us',
  });
  eq(nome, 'Nome Da Agenda', 'preferiu o getName ao metadata');
});

await test('`getName` genérico/número é DESCARTADO (não vira Nick)', async () => {
  const g = await resolverNomeContato(LID, {
    nazu: { getName: async () => 'Usuário' },
    metadata: metadata({ notify: 'NomeDoGrupo' }),
  });
  eq(g, 'NomeDoGrupo', 'pulou o getName genérico');

  const n = await resolverNomeContato(LID, {
    nazu: { getName: async () => NUM },
    metadata: metadata({ notify: 'NomeDoGrupo' }),
  });
  eq(n, 'NomeDoGrupo', 'pulou o getName=numero');
});

await test('2º: store.contacts quando o getName não serve', async () => {
  const nome = await resolverNomeContato(LID, {
    nazu: {
      getName: async () => '',
      store: { contacts: { [JID]: { notify: 'Contato Salvo' } } },
    },
    metadata: metadata({ notify: 'NomeDoGrupo' }),
  });
  eq(nome, 'Contato Salvo', 'usou o contato da sessão');
});

await test('3º: metadata do grupo quando não há getName/contato', async () => {
  const nome = await resolverNomeContato(LID, { metadata: metadata({ notify: 'NomeDoGrupo' }) });
  eq(nome, 'NomeDoGrupo', 'usou o notify do metadata');
});

await test('4º: fallback do chamador (ex.: pushname do contador)', async () => {
  const nome = await resolverNomeContato(LID, {
    metadata: metadata({ notify: '' }),
    fallback: 'PushnameDoContador',
  });
  eq(nome, 'PushnameDoContador', 'usou o fallback');
});

await test('4º: fallback que é o PRÓPRIO número é descartado', async () => {
  const nome = await resolverNomeContato(LID, {
    metadata: metadata({ notify: '' }), // sem nome
    fallback: NUM,                     // contador guardou o número
  });
  eq(nome, NUM, 'cai no número pelo passo 5 (não pelo fallback) — e NUNCA no LID');
  ok(nome !== LID && nome !== LID.split('@')[0], 'não devolveu o LID');
});

await test('5º/6º: sem nome nenhum cai no número; nunca no LID', async () => {
  const nome = await resolverNomeContato(LID, { metadata: metadata({ notify: '' }) });
  eq(nome, NUM, 'caiu no número do membro');
  ok(nome !== LID && nome !== LID.split('@')[0], 'nunca o LID');
});

await test('sem metadata: último recurso é o próprio id (não quebra)', async () => {
  const nome = await resolverNomeContato('999-xl@lid', {});
  eq(nome, '999-xl', 'devolveu a base do id');
});

await test('getIdName que LANÇA não derruba a resolução', async () => {
  const nome = await resolverNomeContato(LID, {
    nazu: { getName: async () => { throw new Error('boom'); } },
    metadata: metadata({ notify: 'NomeDoGrupo' }),
  });
  eq(nome, 'NomeDoGrupo', 'seguiu para o metadata');
});

// ============================================================================
// 3) LISTA
// ============================================================================

await test('resolverNomesContatos: mapa id->nome, com fallbackPorId', async () => {
  const md = metadata({ notify: '' });
  // ids: um com metadata sem nome, outro fora do metadata.
  const OUTRO = '7000@lid';
  const mapa = await resolverNomesContatos([LID, OUTRO], {
    metadata: md,
    fallbackPorId: (id) => (id === LID ? 'Nick do contador' : 'Nome do outro'),
  });
  eq(mapa.get(LID), 'Nick do contador', 'usou o fallback por id');
  eq(mapa.get(OUTRO), 'Nome do outro', 'usou o fallback por id (2)');
});

await test('resolverNomesContatos: nome real vence o fallback', async () => {
  const mapa = await resolverNomesContatos([LID], {
    nazu: { getName: async () => 'Nome Real' },
    metadata: metadata(),
    fallbackPorId: () => 'fallback',
  });
  eq(mapa.get(LID), 'Nome Real', 'preferiu o nome real');
});

// ============================================================================
// RESUMO
// ============================================================================

const totalOk = RESULTS.reduce((a, r) => a + r.passed, 0);
const totalFail = RESULTS.reduce((a, r) => a + r.failed, 0);
console.log(`\n${totalFail === 0 ? '✅' : '❌'} ${RESULTS.length} testes / ${totalOk} asserções (${totalFail} falhas)`);
process.exit(totalFail === 0 ? 0 : 1);
