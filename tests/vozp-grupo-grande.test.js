/**
 * Testes do `!vozp` em GRUPO GRANDE (+300 membros) — o offer tem de sair com ROSTER.
 *
 * O sintoma do dono: o chat de voz "sobe" (a mensagem de criado sai) e **logo
 * depois** vem a de encerrado.
 *
 * Causa MEDIDA: o comando mandava o grupo INTEIRO de convidados ao motor
 * (`semTeto: true`). Acima de `WA_GROUP_OFFER_MAX_ACCOUNTS` (32) o motor NAO
 * corta — ele troca para o caminho `hashOnly` e manda `<group_info phash="2:...">`
 * SEM roster. Esse caminho e' fragil:
 *   1. resolve os devices do grupo inteiro num UNICO usync (o motor nao fatia);
 *   2. se o usync falha, o phash sai dos jids CRUS, nao dos devices reais ->
 *      diverge do servidor -> NACK -> SetupFailed -> a call cai.
 *
 * A referencia de producao (Cobalt) enumera o roster e valida o teto antes de
 * colocar a call — nunca usa phash no offer de grupo.
 *
 * Este teste roda o BUILDER REAL do motor com o numero de convidados que o
 * comando passa, e verifica a FORMA do offer.
 *
 * Uso: node tests/vozp-grupo-grande.test.js
 */

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

// O subpath NAO e' exportado pelo `exports` do pacote, entao o caminho e' direto
// (o modulo e' puro: nao abre socket nem le disco).
const { buildGroupOfferStanza, WA_GROUP_OFFER_MAX_ACCOUNTS } =
  await import('../node_modules/@zapo-js/voip/dist/esm/signaling/group-call.js');

const ME = '111111111111111@lid';

/** Monta o offer com N convidados (o MESMO builder que o motor usa). */
async function offerCom(nConvidados, { usyncFalha = false } = {}) {
  const participants = [];
  for (let i = 0; i < nConvidados; i++) participants.push({ jid: `${200000000000000 + i}@lid` });
  let usyncLotes = 0;
  const deps = {
    authClient: { getCurrentCredentials: () => ({ meLid: ME }) },
    signalDeviceSync: {
      // DOIS devices por pessoa (celular + web) — e' o realista. Com UM device so',
      // o fallback do usync daria o MESMO phash e o teste nao mediria nada.
      syncDeviceList: async (jids) => {
        usyncLotes += 1;
        if (usyncFalha) throw new Error('usync timeout');
        return jids.map((j) => ({
          jid: j,
          deviceJids: [`${j.split('@')[0]}:0@lid`, `${j.split('@')[0]}:7@lid`]
        }));
      },
      queryLidsByPhoneJids: async (j) => j.map((x) => ({ lidJid: x })),
    },
  };
  const log = { debug: () => {}, trace: () => {}, warn: () => {}, error: () => {} };
  const out = await buildGroupOfferStanza(deps, 'CALL1', '123@g.us', participants, false, true, log);
  const offer = (out.node.content ?? []).find((c) => c.tag === 'offer');
  const gi = (offer?.content ?? []).find((c) => c.tag === 'group_info');
  return { gi, usyncLotes, roster: out.participants.length, offerAttrs: offer?.attrs };
}

console.log('\n=== !vozp em grupo GRANDE: o offer tem de sair com ROSTER ===\n');

await test('o teto do motor é 32 (o mesmo do servidor)', async () => {
  ok(WA_GROUP_OFFER_MAX_ACCOUNTS === 32, `WA_GROUP_OFFER_MAX_ACCOUNTS = 32 (veio ${WA_GROUP_OFFER_MAX_ACCOUNTS})`);
});

await test('31 convidados (o corte do bot) -> roster ENUMERADO', async () => {
  const r = await offerCom(31);
  ok(r.gi?.content !== undefined, 'group_info TEM filhos (roster enumerado)');
  ok(r.gi?.content?.length === 32, `32 contas no roster (o criador incluido), veio ${r.gi?.content?.length}`);
  ok(r.gi?.attrs?.phash === undefined, 'NAO usa phash');
});

await test('300 convidados -> o motor troca para HASH e DESCARTA o roster (a causa)', async () => {
  const r = await offerCom(300);
  ok(r.gi?.content === undefined, 'sem roster enumerado (caminho hashOnly)');
  ok(typeof r.gi?.attrs?.phash === 'string' && r.gi.attrs.phash.startsWith('2:'), `usa phash (${r.gi?.attrs?.phash})`);
  ok(r.usyncLotes === 1, `resolve TUDO num unico usync (veio ${r.usyncLotes}) — sem fatia`);
});

await test('se o usync dos 300 falha, o phash sai dos jids CRUS (diverge do servidor)', async () => {
  // Com devices resolvidos o phash cobre o conjunto real; se o usync falha, o
  // motor cai para `user:0@lid` e o hash deixa de descrever os devices — o
  // servidor calcula outro e recusa o offer (NACK -> SetupFailed -> a call cai).
  const comDevices = await offerCom(300);
  const semDevices = await offerCom(300, { usyncFalha: true });
  ok(comDevices.gi?.attrs?.phash !== semDevices.gi?.attrs?.phash,
    `o phash DIVERGE quando o usync falha (${comDevices.gi?.attrs?.phash} vs ${semDevices.gi?.attrs?.phash})`);
});

await test('o corte do bot usa o MESMO numero que o motor (31 convidados = 32 contas)', async () => {
  // 31 convidados + o bot = 32, exatamente o teto. Um a mais ja' cai no hashOnly.
  const noLimite = await offerCom(31);
  const acima = await offerCom(32);
  ok(noLimite.gi?.content !== undefined, '31 convidados -> roster');
  ok(acima.gi?.content === undefined, '32 convidados -> ja cai no hashOnly (o teto conta o criador)');
});

await test('o handler NAO manda o grupo inteiro ao motor (sem semTeto)', async () => {
  const fs = await import('fs');
  const src = fs.readFileSync(new URL('../dados/src/index.js', import.meta.url), 'utf8');
  const bloco = src.slice(src.indexOf("case 'vozp'"), src.indexOf("case 'vozp'") + 9000);
  ok(!/prepararConvidadosDoGrupo\(\s*\{\s*semTeto:\s*true/.test(bloco),
    'o !vozp nao usa mais semTeto:true (era o que mandava 300)');
  ok(/prepararConvidadosDoGrupo\(\s*\)/.test(bloco), 'usa o corte padrao (31 convidados)');
});

console.log('\n=== RESUMO ===');
const totalOk = RESULTS.reduce((a, r) => a + r.passed, 0);
const totalFail = RESULTS.reduce((a, r) => a + r.failed, 0);
console.log(`${RESULTS.length} testes / ${totalOk} assercoes ok / ${totalFail} falhas`);
process.exit(totalFail === 0 ? 0 : 1);
