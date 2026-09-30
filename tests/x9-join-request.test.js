/**
 * Testes do X9 — pedido de entrada: só `created` é pedido novo.
 *
 * O defeito relatado: ao RECUSAR um usuário, o bot reenviava o card de
 * solicitação. A causa: o listener de `group.join-request` filtrava
 * `action === 'revoke' || action === 'reject'` — nomes que o stub NUNCA emite
 * (as actions canônicas são `created` / `revoked` / `rejected`). Então
 * `rejected` e `revoked` passavam pelo filtro e caíam em
 * `processNewJoinRequest`, que reenviava o card como se fosse um pedido novo.
 *
 * O teste cobre:
 *   1. o módulo puro (`x9JoinRequest.js`) — a regra;
 *   2. a INTEGRAÇÃO: os eventos reais passados pelo fluxo do `connect.js`
 *      (o listener é replicado aqui porque importar o connect abre socket);
 *   3. o ator: quem recusou é o PN (a menção `@<lid>` não renderiza).
 *
 * Uso: node tests/x9-join-request.test.js
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const TMP_DB = fs.mkdtempSync(path.join(os.tmpdir(), 'lizzy-x9jr-db-'));
process.env.DATABASE_PATH = TMP_DB;
fs.mkdirSync(path.join(TMP_DB, 'grupos'), { recursive: true });

const RESULTS = [];
let CURRENT = null;

function test(name, fn) {
  CURRENT = { name, passed: 0, failed: 0, errors: [] };
  RESULTS.push(CURRENT);
  const done = (error) => {
    if (error) {
      CURRENT.failed += 1;
      CURRENT.errors.push(`EXCEÇÃO: ${error?.stack || error}`);
    }
    console.log(`${CURRENT.failed === 0 ? '✅' : '❌'} ${name} (${CURRENT.passed} ok, ${CURRENT.failed} falhas)`);
    for (const err of CURRENT.errors) console.log(`     ${err.split('\n')[0]}`);
  };
  try {
    const result = fn();
    if (result && typeof result.then === 'function') return result.then(() => done()).catch(done);
    done();
  } catch (error) {
    done(error);
  }
  return Promise.resolve();
}

function ok(condition, message) {
  if (condition) CURRENT.passed += 1;
  else {
    CURRENT.failed += 1;
    CURRENT.errors.push(`ASSERT FALHOU: ${message}`);
  }
}

function includes(haystack, needle, label) {
  ok(typeof haystack === 'string' && haystack.includes(needle), `${label ?? needle} — esperado conter "${needle}"`);
}

const x9jr = await import(new URL('../dados/src/utils/x9JoinRequest.js', import.meta.url).href);
const x9 = await import(new URL('../dados/src/utils/x9System.js', import.meta.url).href);
const layout = await import(new URL('../dados/src/menus/layout.js', import.meta.url).href);
const BOLD_SOLICITACAO = layout.bold('NOVA SOLICITACAO');
const BOLD_NEGADA = layout.bold('NEGADA');
const BOLD_APROVADA = layout.bold('APROVADA');

// ============================================================================
// FLUXO REAL DO LISTENER (replicado do connect.js)
// ============================================================================

/**
 * Roda o MESMO caminho que o connect.js executa no listener: o corpo vive em
 * `handleJoinRequestEvent` (módulo puro) justamente para o teste não replicar
 * a lógica — replicar foi o que deixou o defeito passar.
 *
 * `ignorado: true` significa que o evento não virou card.
 */
async function fluxoDoListener(sock, inf) {
  const resultado = await x9jr.handleJoinRequestEvent({
    sock,
    inf,
    databaseDir: TMP_DB,
    processNewJoinRequest: (s, i, gs) => x9.processNewJoinRequest(s, i, gs),
    loadGroupSettings: async () => ({ x9: true, card: true }),
  });
  return { processou: !resultado.ignorado, ignorado: resultado.ignorado, motivo: resultado.motivo };
}

let grupoCounter = 0;
function makeGroup() {
  grupoCounter += 1;
  return `1203636000000000${String(grupoCounter).padStart(3, '0')}@g.us`;
}

function makeSock() {
  const sent = [];
  return {
    sent,
    sendMessage: async (jid, content) => {
      sent.push({ jid, content });
      return { key: { id: `SENT-${sent.length}` } };
    },
    profilePictureUrl: async () => { throw new Error('sem foto'); },
  };
}

const SOLICITANTE_LID = '222222222222222@lid';
const SOLICITANTE_PN = '5511888888888@s.whatsapp.net';
const ADMIN_LID = '333333333333333@lid';
const ADMIN_PN = '5511777777777@s.whatsapp.net';

// ============================================================================
// 1) MÓDULO PURO
// ============================================================================

await test('isNewJoinRequest: SÓ "created" é pedido novo', () => {
  ok(x9jr.isNewJoinRequest('created') === true, 'created é pedido novo');
  ok(x9jr.isNewJoinRequest('rejected') === false, 'rejected NÃO é pedido novo');
  ok(x9jr.isNewJoinRequest('revoked') === false, 'revoked NÃO é pedido novo');
  ok(x9jr.isNewJoinRequest(undefined) === false, 'undefined NÃO é pedido novo');
  ok(x9jr.isNewJoinRequest('revoke') === false, 'nome antigo "revoke" NÃO é pedido novo');
  ok(x9jr.isNewJoinRequest('reject') === false, 'nome antigo "reject" NÃO é pedido novo');
  ok(x9jr.isNewJoinRequest('qualquer_coisa') === false, 'valor desconhecido NÃO é pedido novo');
});

await test('isResolvedJoinRequest: revoked e rejected são pedidos resolvidos', () => {
  ok(x9jr.isResolvedJoinRequest('rejected') === true, 'rejected é resolvido');
  ok(x9jr.isResolvedJoinRequest('revoked') === true, 'revoked é resolvido');
  ok(x9jr.isResolvedJoinRequest('created') === false, 'created NÃO é resolvido');
  ok(x9jr.isResolvedJoinRequest(undefined) === false, 'undefined NÃO é resolvido');
});

await test('resolveJoinActor: quem recusou usa o PN (o LID não renderiza menção)', () => {
  ok(x9jr.resolveJoinActor({ author: ADMIN_LID, authorPn: ADMIN_PN }) === ADMIN_PN, 'prefere o PN');
  ok(x9jr.resolveJoinActor({ author: ADMIN_LID }) === ADMIN_LID, 'sem PN cai no LID');
  ok(x9jr.resolveJoinActor({ authorPn: ADMIN_PN }) === ADMIN_PN, 'só PN');
  ok(x9jr.resolveJoinActor({}) === null, 'sem nada -> null');
  ok(x9jr.resolveJoinActor() === null, 'sem argumento -> null');
});

await test('resolveJoinRequester: o solicitante também usa o PN', () => {
  ok(x9jr.resolveJoinRequester({ participant: SOLICITANTE_LID, participantPn: SOLICITANTE_PN }) === SOLICITANTE_PN, 'prefere o PN');
  ok(x9jr.resolveJoinRequester({ participant: SOLICITANTE_LID }) === SOLICITANTE_LID, 'sem PN cai no LID');
  ok(x9jr.resolveJoinRequester({}) === null, 'sem nada -> null');
});

await test('o connect.js DELEGA ao módulo (não tem cópia da regra)', () => {
  const src = fs.readFileSync(new URL('../dados/src/connect.js', import.meta.url), 'utf8');
  includes(src, "from './utils/x9JoinRequest.js'", 'importa o módulo');
  includes(src, 'handleJoinRequestEvent({', 'o listener chama o corpo do módulo');
  includes(src, 'resultado.ignorado', 'usa o resultado para decidir');
  includes(src, 'resolveJoinActor(', 'usa o helper para o ator');

  // A condição antiga (nomes que o stub nunca emite) não pode voltar.
  ok(
    !src.includes("action === 'revoke' || action === 'reject'"),
    'a condição antiga (revoke/reject) foi removida'
  );
});

// ============================================================================
// 2) INTEGRAÇÃO — O DEFEITO RELATADO
// ============================================================================

await test('RECUSA (rejected): NÃO reenvia o card de solicitação', async () => {
  const groupId = makeGroup();
  const sock = makeSock();

  const { processou } = await fluxoDoListener(sock, {
    id: groupId,
    action: 'rejected',
    author: ADMIN_LID,
    authorPn: ADMIN_PN,
    participant: SOLICITANTE_LID,
    participantPn: SOLICITANTE_PN,
  });

  ok(processou === false, 'o evento não foi tratado como pedido novo');
  ok(sock.sent.length === 0, `nenhuma mensagem enviada (${sock.sent.length})`);
  ok(!sock.sent.some((s) => s.content?.text?.includes(BOLD_SOLICITACAO)), 'o card de solicitação NÃO foi reenviado');
});

await test('CANCELAMENTO (revoked): NÃO reenvia o card de solicitação', async () => {
  const groupId = makeGroup();
  const sock = makeSock();

  const { processou } = await fluxoDoListener(sock, {
    id: groupId,
    action: 'revoked',
    author: SOLICITANTE_LID,
    authorPn: SOLICITANTE_PN,
    participant: SOLICITANTE_LID,
    participantPn: SOLICITANTE_PN,
  });

  ok(processou === false, 'não tratado como pedido novo');
  ok(sock.sent.length === 0, 'nada enviado');
});

await test('PEDIDO NOVO (created): envia o card e registra o histórico', async () => {
  const groupId = makeGroup();
  const sock = makeSock();

  const { processou } = await fluxoDoListener(sock, {
    id: groupId,
    action: 'created',
    participant: SOLICITANTE_LID,
    participantPn: SOLICITANTE_PN,
    method: 'invite_link',
  });

  ok(processou === true, 'tratado como pedido novo');
  ok(sock.sent.length === 1, `uma mensagem enviada (${sock.sent.length})`);
  includes(sock.sent[0]?.content?.text || '', BOLD_SOLICITACAO, 'é o card de solicitação');

  const historico = JSON.parse(fs.readFileSync(path.join(TMP_DB, 'grupos', `${groupId}.json`), 'utf-8'));
  ok(historico.joinRequests?.length === 1, 'registrou 1 no histórico');
  ok(historico.joinRequests[0].acao === 'created', 'histórico com action=created');
});

await test('o nome antigo ("revoke"/"reject") também não dispara o card', async () => {
  const sock = makeSock();
  const r1 = await fluxoDoListener(sock, { id: makeGroup(), action: 'revoke', participant: SOLICITANTE_LID });
  const r2 = await fluxoDoListener(sock, { id: makeGroup(), action: 'reject', participant: SOLICITANTE_LID });

  ok(r1.processou === false && r2.processou === false, 'nenhum tratado como pedido novo');
  ok(sock.sent.length === 0, 'nada enviado');
});

// ============================================================================
// 3) O CARD DE RECUSA USA O ATOR CERTO
// ============================================================================

await test('card de recusa mostra QUEM RECUSOU (via PN, não o LID)', async () => {
  const groupId = makeGroup();
  const sock = makeSock();

  // Registra o pedido (o card original) para que a recusa encontre no store.
  await x9.processNewJoinRequest(sock, {
    id: groupId,
    participant: SOLICITANTE_LID,
    participantPn: SOLICITANTE_PN,
    method: 'invite_link',
  }, { x9: true, card: true });

  sock.sent.length = 0;

  // O ator resolvido pelo helper do connect.js.
  const ator = x9jr.resolveJoinActor({ author: ADMIN_LID, authorPn: ADMIN_PN });
  ok(ator === ADMIN_PN, 'o ator é o PN do admin');

  await x9.updateCardOnReject(sock, groupId, SOLICITANTE_PN, ator);

  const recusa = sock.sent.find((s) => (s.content?.text || s.content?.caption || '').includes(BOLD_NEGADA));
  ok(Boolean(recusa), 'mandou o card de recusa');
  const texto = recusa?.content?.text || recusa?.content?.caption || '';
  includes(texto, ADMIN_PN.split('@')[0], 'mostra o número de quem recusou');
  ok(!texto.includes(ADMIN_LID.split('@')[0]), 'não mostra o LID interno');
  ok(recusa?.content?.mentions?.includes(ADMIN_PN), 'menciona quem recusou (pelo PN)');
  ok(!texto.includes(BOLD_SOLICITACAO), 'a recusa não é o card de solicitação');
});

await test('card de aprovação mostra quem aprovou (via PN)', async () => {
  const groupId = makeGroup();
  const sock = makeSock();

  await x9.processNewJoinRequest(sock, {
    id: groupId,
    participant: SOLICITANTE_LID,
    participantPn: SOLICITANTE_PN,
    method: 'invite_link',
  }, { x9: true, card: true });

  sock.sent.length = 0;
  await x9.updateCardOnApprove(sock, groupId, SOLICITANTE_PN, ADMIN_PN);

  const aprov = sock.sent.find((s) => (s.content?.text || '').includes(BOLD_APROVADA));
  ok(Boolean(aprov), 'mandou o card de aprovação');
  includes(aprov?.content?.text || '', ADMIN_PN.split('@')[0], 'mostra quem aprovou');
  ok(aprov?.content?.mentions?.includes(ADMIN_PN), 'menciona quem aprovou');
});

// ============================================================================

const totalOk = RESULTS.reduce((a, r) => a + r.passed, 0);
const totalFail = RESULTS.reduce((a, r) => a + r.failed, 0);
console.log('\n════════════════════════════════════════');
console.log(`RESULTADO: ${RESULTS.length} testes | ${totalOk} asserções ok | ${totalFail} falhas`);
console.log('════════════════════════════════════════');

fs.rmSync(TMP_DB, { recursive: true, force: true });

if (totalFail > 0) {
  console.log('\nFALHAS:');
  for (const r of RESULTS) if (r.failed) for (const e of r.errors) console.log(`- [${r.name}] ${e}`);
  process.exit(1);
}
console.log('✅ TODOS OS TESTES PASSARAM');
process.exit(0);
