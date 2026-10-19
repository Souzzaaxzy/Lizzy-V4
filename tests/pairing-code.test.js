/**
 * `!callp`-independent: CÓDIGO DE PAREAMENTO com teto de tempo.
 *
 * Sintoma do dono: *"a bot não está enviando o código de conexão da própria
 * Bailey, eu coloco o número e nada acontece"*.
 *
 * Causa: o `requestPairingCode` da lib só manda o `link_code_companion_reg`
 * DEPOIS de o servidor responder o `pair-device`. Quando essa stanza não chega, a
 * espera interna fica PENDURADA (nunca resolve nem rejeita) e a linha seguinte ao
 * prompt nunca executa — o boot fica mudo.
 *
 * Este teste mede o helper REAL (`utils/pairingCode.js`) contra sockets dublês
 * que reproduzem os três cenários. Importar o `connect.js` NÃO é opção: ele abre
 * conexão de verdade (gera QR e conecta) e travaria a suíte.
 *
 * Uso: node tests/pairing-code.test.js
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const { pedirCodigoDePareamento, PARING_TIMEOUT_MS } = await import(
  new URL('../dados/src/utils/pairingCode.js', import.meta.url).href
);

const RESULTS = [];
let CURRENT = null;

function test(name, fn) {
  CURRENT = { name, passed: 0, failed: 0, errors: [] };
  RESULTS.push(CURRENT);
  try {
    const r = fn();
    if (r && typeof r.then === 'function') {
      return r.then(() => finish(name)).catch((e) => {
        CURRENT.failed += 1; CURRENT.errors.push(`EXCEÇÃO: ${e?.stack || e}`); finish(name);
      });
    }
    finish(name);
  } catch (e) {
    CURRENT.failed += 1; CURRENT.errors.push(`EXCEÇÃO: ${e?.stack || e}`); finish(name);
  }
  return Promise.resolve();
}
function finish(name) {
  console.log(`${CURRENT.failed === 0 ? '✅' : '❌'} ${name} (${CURRENT.passed} ok, ${CURRENT.failed} falhas)`);
  for (const err of CURRENT.errors) console.log(`     ${err.split('\n')[0]}`);
}
function ok(cond, msg) {
  if (cond) CURRENT.passed += 1;
  else { CURRENT.failed += 1; CURRENT.errors.push(`ASSERT FALHOU: ${msg}`); }
}
function includes(hay, needle, label) {
  ok(typeof hay === 'string' && hay.includes(needle),
    `${label ?? needle} — esperado conter "${needle}" (veio: ${hay})`);
}

/** Socket dublê: `ev` de verdade (EventEmitter) e o `requestPairingCode` que o teste quiser. */
function makeSock(requestPairingCode) {
  const ouvintes = new Map();
  return {
    requestPairingCode,
    ev: {
      on(ev, fn) { if (!ouvintes.has(ev)) ouvintes.set(ev, new Set()); ouvintes.get(ev).add(fn); },
      removeListener(ev, fn) { ouvintes.get(ev)?.delete(fn); },
      listenerCount(ev) { return ouvintes.get(ev)?.size ?? 0; },
      emit(ev, ...args) { for (const fn of [...(ouvintes.get(ev) ?? [])]) fn(...args); }
    }
  };
}

// ============================================================================
// 1) O CAMINHO FELIZ
// ============================================================================

await test('resolve com o código quando o servidor responde', async () => {
  const sock = makeSock(async () => 'ABCD1234');
  const codigo = await pedirCodigoDePareamento(sock, '5511999999999');
  ok(codigo === 'ABCD1234', 'devolve o código da lib');
  ok(sock.ev.listenerCount('connection.update') === 0, 'não deixa listener para trás');
});

await test('repassa o número para a lib', async () => {
  let recebido = null;
  const sock = makeSock(async (n) => { recebido = n; return 'ABCD1234'; });
  await pedirCodigoDePareamento(sock, '5511888888888');
  ok(recebido === '5511888888888', 'mandou o número certo');
});

// ============================================================================
// 2) O BUG DO DONO — a promessa PENDURADA
// ============================================================================

await test('NAO fica pendurado quando o servidor nao responde (o bug relatado)', async () => {
  // Reproduz o defeito: a lib devolve uma promessa que NUNCA resolve nem rejeita
  // (o `pair-device` não chegou). Antes, o boot ficava mudo aqui para sempre.
  const sock = makeSock(() => new Promise(() => {}));
  const t0 = Date.now();
  let erro = null;
  try {
    await pedirCodigoDePareamento(sock, '5511999999999', { timeoutMs: 150 });
  } catch (e) { erro = e; }
  const dt = Date.now() - t0;
  ok(erro !== null, 'FALHA em vez de pendurar (o boot deixa de ficar mudo)');
  includes(String(erro?.message), 'não respondeu', 'diz que o servidor não respondeu');
  ok(dt < 3000, `respeitou o teto (levou ${dt} ms)`);
  ok(sock.ev.listenerCount('connection.update') === 0, 'não deixa listener para trás');
});

await test('o teto padrao e 30s', () => {
  ok(PARING_TIMEOUT_MS === 30000, `teto padrão de 30s (veio ${PARING_TIMEOUT_MS})`);
});

// ============================================================================
// 3) FALHA CEDO quando a conexão cai
// ============================================================================

await test('rejeita NA HORA se a conexao fechar (nao espera o teto inteiro)', async () => {
  let disparar = null;
  const sock = makeSock(() => new Promise(() => {}));
  const t0 = Date.now();
  const p = pedirCodigoDePareamento(sock, '5511999999999', { timeoutMs: 30000 })
    .then(() => null, (e) => e);
  // A conexão cai logo depois do pedido.
  setTimeout(() => sock.ev.emit('connection.update', {
    connection: 'close',
    lastDisconnect: { error: { message: 'Connection Terminated' } }
  }), 40);
  const erro = await p;
  const dt = Date.now() - t0;
  ok(erro !== null, 'rejeitou');
  includes(String(erro?.message), 'fechou antes da resposta', 'explica que a conexão caiu');
  includes(String(erro?.message), 'Connection Terminated', 'inclui o motivo do socket');
  ok(dt < 5000, `falhou cedo, sem esperar os 30s (levou ${dt} ms)`);
  void disparar;
});

await test('um evento que NAO e close nao derruba o pedido', async () => {
  const sock = makeSock(() => new Promise((resolve) => {
    setTimeout(() => resolve('WXYZ9876'), 60);
  }));
  const p = pedirCodigoDePareamento(sock, '5511999999999', { timeoutMs: 5000 });
  setTimeout(() => sock.ev.emit('connection.update', { connection: 'open' }), 10);
  const codigo = await p;
  ok(codigo === 'WXYZ9876', 'ignorou o evento que não é close');
});

// ============================================================================
// 4) ERRO DA PROPRIA LIB
// ============================================================================

await test('propaga o erro da lib (ex.: pedido concorrente)', async () => {
  const sock = makeSock(async () => { throw new Error('A pairing request is already in progress'); });
  let erro = null;
  try { await pedirCodigoDePareamento(sock, '5511999999999'); } catch (e) { erro = e; }
  includes(String(erro?.message), 'already in progress', 'o erro da lib chega inteiro');
});

await test('socket sem `ev` nao quebra (degradacao segura)', async () => {
  const sock = { requestPairingCode: async () => 'ABCD1234' };
  const codigo = await pedirCodigoDePareamento(sock, '5511999999999');
  ok(codigo === 'ABCD1234', 'funciona sem o emitter');
});

// ============================================================================
// 5) INTEGRACAO — o boot usa o helper (nao chama a lib direto)
// ============================================================================

await test('o connect.js usa o helper e trata o erro (nao fica mudo)', () => {
  const src = fs.readFileSync(path.join(HERE, '..', 'dados/src/connect.js'), 'utf-8');
  ok(src.includes("import { pedirCodigoDePareamento } from './utils/pairingCode.js'"),
    'importa o helper');
  ok(src.includes('await pedirCodigoDePareamento(AbyssSock, phoneNumber)'),
    'chama o helper com o socket e o número');
  ok(!src.includes('await AbyssSock.requestPairingCode('),
    'NÃO chama a lib direto (era o caminho que pendurava)');
  const bloco = src.slice(src.indexOf('await pedirCodigoDePareamento(AbyssSock'), src.indexOf('await pedirCodigoDePareamento(AbyssSock') + 1200);
  ok(bloco.includes('catch'), 'tem tratamento de erro');
  ok(bloco.includes('Não consegui gerar o código'), 'mostra o motivo ao usuário');
});

// ============================================================================

const totalOk = RESULTS.reduce((a, r) => a + r.passed, 0);
const totalFail = RESULTS.reduce((a, r) => a + r.failed, 0);
console.log('\n' + '='.repeat(40));
console.log(`RESULTADO: ${RESULTS.length} testes | ${totalOk} asserções ok | ${totalFail} falhas`);
console.log('='.repeat(40));
process.exit(totalFail > 0 ? 1 : 0);
