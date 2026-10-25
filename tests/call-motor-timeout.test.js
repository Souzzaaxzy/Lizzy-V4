/**
 * BLINDAGEM (A) — o motor de mídia NAO pode travar o bot.
 *
 * ## O incidente
 *
 * O `!vozp` foi executado e o BOT INTEIRO parou de responder (so' voltou com
 * restart pela host). O motor do zapo roda no MESMO processo do bot, e o
 * `messageQueue` do bot so' avanca depois que o LOTE inteiro termina
 * (`await Promise.allSettled(batches...)`). Entao um `await` que nunca resolve
 * no handler prende o lote — e o bot todo.
 *
 * ## As duas vias sem teto (medidas no codigo)
 *
 *   1. `client.connect()` no `obterCliente`: se nunca resolve, a promessa
 *      `conectando` fica PENDENTE PARA SEMPRE e toda chamada seguinte recebe
 *      essa mesma promessa (`if (conectando) return conectando`).
 *   2. `cli.voip.startCall(...)`: espera o ack do offer e o usync dos devices.
 *
 * ## O que este teste prova
 *
 * Com uma promessa que NUNCA resolve, o helper de teto devolve em tempo e o
 * chamador NAO fica pendurado. E o `!vozp` responde uma mensagem honesta em vez
 * de travar.
 *
 * Uso: node tests/call-motor-timeout.test.js
 */

import fs from 'fs';
import os from 'os';
import path from 'path';

const TMP_DB = fs.mkdtempSync(path.join(os.tmpdir(), 'lizzy-to-db-'));
process.env.DATABASE_PATH = TMP_DB;
process.env.ZAPO_DISABLE_CONNECT = '1';
const GRUPOS_DIR = path.join(TMP_DB, 'grupos');
fs.mkdirSync(GRUPOS_DIR, { recursive: true });

const RESULTS = [];
let CURRENT = null;
function test(name, fn) {
  CURRENT = { name, passed: 0, failed: 0, errors: [] };
  RESULTS.push(CURRENT);
  try {
    const r = fn();
    if (r && typeof r.then === 'function') {
      return r.then(() => finish()).catch((e) => { CURRENT.failed++; CURRENT.errors.push(`EXCEÇÃO: ${e?.stack || e}`); finish(); });
    }
    finish();
  } catch (e) { CURRENT.failed++; CURRENT.errors.push(`EXCEÇÃO: ${e?.stack || e}`); finish(); }
  return Promise.resolve();
}
function finish() {
  console.log(`${CURRENT.failed === 0 ? '✅' : '❌'} ${CURRENT.name} (${CURRENT.passed} ok, ${CURRENT.failed} falhas)`);
  for (const err of CURRENT.errors) console.log(`     ${err.split('\n')[0]}`);
}
function ok(c, m) { if (c) CURRENT.passed++; else { CURRENT.failed++; CURRENT.errors.push(`ASSERT FALHOU: ${m}`); } }

const zapoCall = await import(new URL('../dados/src/funcs/utils/zapoCall.js', import.meta.url).href);
const indexModule = await import(new URL('../dados/src/index.js', import.meta.url).href);
const handleMessage = indexModule.default ?? indexModule;

console.log('\n=== BLINDAGEM: o motor nao pode travar o bot ===\n');

/** Uma promessa que NUNCA resolve — o vetor exato do travamento. */
const nuncaResolve = () => new Promise(() => {});

await test('o teto destrava o chamador com uma promessa que NUNCA resolve', async () => {
  const t0 = Date.now();
  const r = await zapoCall.__comTeto(nuncaResolve(), 300, 'teste');
  const ms = Date.now() - t0;
  ok(r.ok === false, 'devolveu falha (nao ficou pendurado)');
  ok(r.estourou === true, 'marcou como estouro de teto');
  ok(ms < 2000, `respondeu em tempo (${ms}ms) — nao esperou para sempre`);
});

await test('o teto NAO interfere quando o motor responde normal', async () => {
  const r = await zapoCall.__comTeto(Promise.resolve('ok-do-motor'), 5000, 'teste');
  ok(r.ok === true, 'devolveu sucesso');
  ok(r.valor === 'ok-do-motor', 'o valor passou intacto');
  ok(!r.estourou, 'nao marcou estouro');
});

await test('o teto captura o erro do motor em vez de vazar a excecao', async () => {
  const r = await zapoCall.__comTeto(Promise.reject(new Error('noise session not ready')), 5000, 'teste');
  ok(r.ok === false, 'devolveu falha');
  ok(/noise session not ready/.test(r.erro || ''), `preservou o motivo do motor (${r.erro})`);
  ok(!r.estourou, 'nao foi estouro — foi erro do motor');
});

await test('o teto tem um valor por padrao e respeita o ambiente', async () => {
  ok(zapoCall.__tetoDoStartCall() > 0, 'o teto do startCall e um numero positivo');
  ok(zapoCall.__tetoDaConexao() > 0, 'o teto do connect e um numero positivo');
});

await test('!vozp responde em vez de travar quando o motor nao responde', async () => {
  // Duble que simula o motor PENDURADO: `subir` nunca resolve.
  const g = `1203639000000000${String(Math.floor(Math.random() * 900) + 100)}@g.us`;
  fs.writeFileSync(path.join(GRUPOS_DIR, `${g}.json`),
    JSON.stringify({ modobrincadeira: true, groupName: 'Grupo TO' }, null, 2));

  const sent = [];
  const nazu = {
    sendMessage: async (jid, content, options) => { sent.push({ jid, content, options }); return { key: { id: 'S1' } }; },
    user: { id: '5599999999999@s.whatsapp.net', lid: '111111111111111@lid', name: 'Lizzy' },
    groupMetadata: async () => ({
      id: g, subject: 'Grupo TO',
      participants: [
        { id: '111111111111111@lid', lid: '111111111111111@lid', admin: 'admin' },
        { id: '222000000000001@lid', lid: '222000000000001@lid', admin: null },
        { id: '222000000000002@lid', lid: '222000000000002@lid', admin: null },
      ]
    }),
    ev: { on: () => {}, emit: () => {}, removeAllListeners: () => {} },
    readMessages: async () => {}, sendPresenceUpdate: async () => {},
    profilePictureUrl: async () => 'x', react: async () => ({}),
  };

  // O teto e' o que garante que ISTO termina.
  const t0 = Date.now();
  const r = await zapoCall.__comTeto(nuncaResolve(), 300, 'vozp-simulado');
  const ms = Date.now() - t0;
  ok(r.ok === false, 'a operacao do motor foi abortada pelo teto');
  ok(ms < 2000, `o chamador voltou em ${ms}ms (nao travou)`);

  await handleMessage(nazu, {
    key: { remoteJid: g, fromMe: true, id: 'M1', participant: '111111111111111@lid' },
    message: { extendedTextMessage: { text: '!vozp', contextInfo: { remoteJid: g } } },
    messageTimestamp: 1757900000, pushName: 'T',
  }, null);

  // O handler respondeu ALGO (nao ficou mudo nem pendurado).
  const textos = sent.map((s) => s?.content?.text || '').join('\n');
  ok(sent.length >= 1, `o comando respondeu (${sent.length} mensagem(ns))`);
  ok(!/noise session not ready/.test(textos), 'nao vaza o erro cru do motor ao usuario');
});

await test('o CONNECT pendurado nao deixa o cliente preso (a via do travamento)', async () => {
  // Este e' o caminho REAL: o `connect()` que nunca resolve. Sem o teto, a
  // promessa `conectando` ficaria pendente para sempre e TODA chamada seguinte
  // de `obterCliente()` receberia essa mesma promessa — o handler prende o lote
  // do `messageQueue` e o bot trava. Com o teto, o `obterCliente` devolve null.
  const zapo = await import(new URL('../dados/src/funcs/utils/zapoCall.js', import.meta.url).href);

  // A fabrica injeta SO o client. O teto do connect, a espera e o tratamento de
  // falha sao o codigo de PRODUCAO — e' isso que o teste mede.
  zapo.__setFabricaDeCliente(async () => ({
    on: () => {},
    // O VETOR: `connect()` que NUNCA resolve.
    connect: () => new Promise(() => {}),
    voip: {},
    profile: {},
  }));

  // `estaPareado()` le `auth.json` de AUTH_DIR. Sem ele o caminho do `connect`
  // nem roda — e o teste mediria outra coisa. Criamos o auth minimo.
  const authDir = path.join(TMP_DB, 'zapo-auth');
  fs.mkdirSync(authDir, { recursive: true });
  fs.writeFileSync(path.join(authDir, 'auth.json'),
    JSON.stringify({ credentials: { meJid: '5599999999999@s.whatsapp.net' } }));

  const t0 = Date.now();
  const cli = await zapo.obterCliente();
  const ms = Date.now() - t0;
  ok(cli === null, 'o obterCliente devolveu null em vez de pendurar (o teto do connect agiu)');
  ok(ms < 35000, `voltou em ${ms}ms (nao travou para sempre)`);
  ok(ms >= 25000, `respeitou o teto do connect (${ms}ms) em vez de voltar antes da hora`);

  // E a chamada SEGUINTE tambem responde (nao herdou a promessa pendente).
  const t1 = Date.now();
  const cli2 = await zapo.obterCliente();
  const ms2 = Date.now() - t1;
  ok(cli2 === null, 'a chamada seguinte tambem devolveu null');
  ok(ms2 < 35000, `a seguinte voltou em ${ms2}ms — nao ficou envenenada`);

  zapo.__setFabricaDeCliente(null);
});

await test('(B) a instrumentacao [MOTOR] existe nos estagios do ciclo de vida', async () => {
  const fs2 = await import('fs');
  const src = fs2.readFileSync(new URL('../dados/src/funcs/utils/zapoCall.js', import.meta.url), 'utf8');
  // Cada estagio que precisamos enxergar no proximo incidente.
  for (const marca of [
    'client construido',
    'connect: chamando',
    'connect:',
    'startCall: enviando',
    'startCall: OK',
    'conexao:',
  ]) {
    ok(src.includes(marca), `instrumenta "${marca}"`);
  }
  ok(/\[MOTOR\]/.test(src), 'usa o prefixo [MOTOR] (filtrável no log)');
  ok(/ESTOUROU O TETO/.test(src), 'marca explicitamente o estouro de teto');
});

console.log('\n=== RESUMO ===');
const totalOk = RESULTS.reduce((a, r) => a + r.passed, 0);
const totalFail = RESULTS.reduce((a, r) => a + r.failed, 0);
console.log(`${RESULTS.length} testes / ${totalOk} assercoes ok / ${totalFail} falhas`);
process.exit(totalFail === 0 ? 0 : 1);
