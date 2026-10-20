/**
 * O DESTINO da sinalização numa CALL DE GRUPO: o OBJETO da call.
 *
 * ## O defeito que este teste trava (o "só sai beeem depois")
 *
 * O dono: *"o !vozp encerrar nao derruba direto, so tira o usuario do chat de voz
 * e a bot fica la, so sai beeem depois"*.
 *
 * Numa call de GRUPO **tudo** é endereçado a `<call-id>@call`. A referência que
 * funciona (`zapo`, `call-stanza.js`) diz isso numa linha:
 *
 *   return isGroupCall ? toCallServerJid(callId) : peerJid;
 *
 * O lizzy-call mandava o `<terminate>` para o **device do participante**. O
 * servidor então não tirava este lado da call: o usuário saía, o bot continuava
 * no chat de voz, e só saía quando o servidor o derrubava por tempo.
 *
 * Roda o caminho REAL (`SignalingBridge.sendSignalingChecked`) com um socket
 * falso, no bot (onde o peer `@itsliaaa/baileys` existe).
 *
 * Uso: node tests/vozp-terminate-target.test.js
 */

import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const { SignalingBridge } = await import(
  new URL('../node_modules/lizzy-call/dist/signaling.mjs', import.meta.url).href
);
const { encodeBinaryNode } = await import('@itsliaaa/baileys');

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

/** Socket falso: registra para onde cada stanza saiu. */
function makeSock(enviados) {
  return {
    generateMessageTag: () => 'TAG1',
    waitForMessage: async () => undefined,
    sendNode: async (n) => { enviados.push(n); },
    query: async (n) => { enviados.push(n); return undefined; },
    getPrivacyTokens: async () => undefined,
    getUSyncDevices: async () => [],
    authState: {
      creds: { me: { id: 'bot@s.whatsapp.net', lid: '111@lid' }, registered: true },
      keys: { set: async () => {} }
    },
    ws: { isOpen: true, on: () => {} }
  };
}

/** Manda um `terminate` e devolve o `to` do wrapper `<call>`. */
async function destinoDoTerminate(isGroupCall) {
  const enviados = [];
  const bridge = new SignalingBridge({ sock: makeSock(enviados) });
  // `init()` só precisa de `authState.keys.set` (o socket falso tem).
  await bridge.init();
  bridge.attachEngine({
    handleSignalingMessage: () => {},
    handleSignalingAck: () => {},
    handleSignalingReceipt: () => {}
  });

  const node = { tag: 'terminate', attrs: { 'call-id': 'CALL1', 'call-creator': '111@lid' } };
  const payload = new Uint8Array(Buffer.from(encodeBinaryNode(node)));
  await bridge.sendSignalingChecked('222222222222222@lid', 'CALL1', payload, isGroupCall);

  const wrapper = enviados.find((n) => n.tag === 'call');
  return wrapper?.attrs?.to ?? null;
}

// ============================================================================

await test('grupo: o terminate vai para <call-id>@call (o OBJETO da call)', async () => {
  const destino = await destinoDoTerminate(true);
  ok(destino === 'CALL1@call',
    `terminate de grupo -> <call-id>@call (veio ${destino})`);
});

await test('grupo: NAO vai para o device de um participante', async () => {
  const destino = await destinoDoTerminate(true);
  ok(!String(destino).includes('@lid'),
    `nao endereça o device do peer (veio ${destino})`);
});

await test('1:1: continua indo para o peer (nada mudou nesse caminho)', async () => {
  const destino = await destinoDoTerminate(false);
  ok(destino && destino !== 'CALL1@call',
    `no 1:1 o destino e' o peer (veio ${destino})`);
});

await test('o group-media marca a sessao como grupo (isGroupCall=true)', async () => {
  const fs = await import('fs');
  const src = fs.readFileSync(
    path.join(HERE, '..', 'node_modules/lizzy-call/dist/group-media.mjs'), 'utf-8'
  );
  ok(src.includes('xmlPayload, true)'),
    'a sinalizacao da sessao de grupo passa isGroupCall=true');
});

await test('a leg UDP cru NAO faz churn (recuperacao por PORTA DE FALLBACK)', async () => {
  const fs = await import('fs');
  const src = fs.readFileSync(
    path.join(HERE, '..', 'node_modules/lizzy-call/dist/relay-transport.mjs'), 'utf-8'
  );
  // A re-dial em loop (ideia minha, nao da referencia) fechava e reabria o socket
  // a cada ~5 s: o motor via o caminho de midia cair junto e vinha o bipe de
  // reconexao + a call derrubada. A recuperacao certa e a PORTA DE FALLBACK.
  ok(src.includes('tentando a outra porta'), 'migra para a outra porta (uma vez)');
  ok(!src.includes('RAW_UDP_REDIAL_LONGO_MS'), 'a re-dial em loop SAIU');
  ok(!src.includes('this.#fail("raw_udp_no_return_path")'),
    'o caminho de retorno NAO falha a leg (sem midia de volta e o estado normal)');
});

// ============================================================================

const totalOk = RESULTS.reduce((a, r) => a + r.passed, 0);
const totalFail = RESULTS.reduce((a, r) => a + r.failed, 0);
console.log('\n' + '='.repeat(40));
console.log(`RESULTADO: ${RESULTS.length} testes | ${totalOk} asserções ok | ${totalFail} falhas`);
console.log('='.repeat(40));
process.exit(totalFail > 0 ? 1 : 0);
