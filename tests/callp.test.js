/**
 * `!callp` — sobe uma chamada de VOZ no grupo (sinalizacao apenas).
 *
 * Roda o handler REAL com socket falso. O ponto central: o comando envia a
 * stanza `<call><offer>` de GRUPO — a chamada passa a existir — e **nao** tenta
 * carregar audio (o Baileys nao tem stack de midia). O teste confere a forma da
 * stanza contra a spec (wacrg) e a reconstrucao de grupo (`meowcaller`).
 *
 * Uso: node tests/callp.test.js
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

// Banco temporario ANTES de importar o bot (o `paths.js` le o ambiente no load).
const TMP_DB = fs.mkdtempSync(path.join(os.tmpdir(), 'lizzy-callp-'));
process.env.DATABASE_PATH = TMP_DB;
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
    `${label ?? needle} \u2014 esperado conter "${needle}"`);
}

// ============================================================================

const indexModule = await import(new URL('../dados/src/index.js', import.meta.url).href);
const handleMessage = indexModule.default ?? indexModule;
if (typeof handleMessage !== 'function') throw new Error('index.js não exporta o handler');

const callOffer = await import(new URL('../dados/src/funcs/utils/callOffer.js', import.meta.url).href);

const BOT_JID = '5599999999999@s.whatsapp.net';
const BOT_LID = '111111111111111@lid';

let groupCounter = 0;
let personCounter = 0;

function makeGroup(extra = {}) {
  groupCounter += 1;
  const jid = `1203638200000000${String(groupCounter).padStart(3, '0')}@g.us`;
  fs.writeFileSync(path.join(GRUPOS_DIR, `${jid}.json`),
    JSON.stringify({ groupName: `Grupo Callp ${groupCounter}`, ...extra }, null, 2));
  return jid;
}
function readGroup(jid) {
  return JSON.parse(fs.readFileSync(path.join(GRUPOS_DIR, `${jid}.json`), 'utf-8'));
}

function makePerson() {
  personCounter += 1;
  const n = String(personCounter).padStart(4, '0');
  return { lid: `5571${n}000000@lid`, jid: `5513${n}999999@s.whatsapp.net`, name: `5571${n}000000` };
}

/** Socket falso: captura o que foi enviado e o que foi consultado. */
function makeNazu({ sent, groupJid, participants, queried, failQuery }) {
  const map = {};
  for (const p of participants) { map[p.jid] = p.lid; map[p.lid] = p.jid; }
  return {
    sent,
    queried,
    sendMessage: async (jid, content) => { sent.push({ jid, content }); return { key: { id: 'SENT' } }; },
    user: { id: `${BOT_JID.split('@')[0]}:5@s.whatsapp.net`, lid: BOT_LID, name: 'Lizzy' },
    onWhatsApp: async (jid) => (map[jid] ? [{ jid, exists: true, lid: map[jid] }] : [{ jid, exists: false }]),
    signalRepository: { lidMapping: { getPNForLID: async (lid) => map[lid] || null } },
    groupMetadata: async () => ({
      id: groupJid, subject: 'Grupo Callp',
      participants: participants.map((p) => ({ id: p.lid, admin: p.isAdmin ? 'admin' : null, phoneNumber: p.jid }))
    }),
    // Primitivos que o `callOffer` usa (mesma forma da lib real).
    generateMessageTag: () => `TAG-${Math.random().toString(36).slice(2, 10)}`,
    getUSyncDevices: async (jids) => jids.flatMap((j) => {
      const user = String(j).split('@')[0].split(':')[0];
      return [{ user, server: 's.whatsapp.net', device: 0 }, { user, server: 's.whatsapp.net', device: 1 }];
    }),
    assertSessions: async () => true,
    query: async (node) => {
      queried.push(node);
      if (failQuery) throw new Error('server refused');
      return { tag: 'ack', attrs: { class: 'call', id: node.attrs.id } };
    },
    groupParticipantsUpdate: async () => ({}),
    groupRequestParticipantsList: async () => [],
    groupRequestParticipantsUpdate: async () => ({}),
    ev: { on: () => {}, emit: () => {}, removeAllListeners: () => {} },
    readMessages: async () => {}, sendPresenceUpdate: async () => {},
    profilePictureUrl: async () => null, react: async () => ({})
  };
}

/** Executa uma mensagem no handler (remetente novo por chamada, throttle 3/5s). */
async function run({ groupJid, sender, text, participants, sent = [], queried = [], failQuery = false }) {
  const nazu = makeNazu({ sent, groupJid, participants, queried, failQuery });
  const info = {
    key: { remoteJid: groupJid, fromMe: false, id: `M-${Math.random().toString(36).slice(2, 10)}`, participant: sender.lid },
    message: { extendedTextMessage: { text, contextInfo: { remoteJid: groupJid, mentionedJid: [] } } },
    messageTimestamp: Math.floor(Date.now() / 1000),
    pushName: sender.name
  };
  await handleMessage(nazu, info, null, new Map(), null);
  return {
    text: sent.map((s) => s.content?.text ?? '').filter(Boolean).join('\n'),
    newsletter: sent.some((s) => s.content?.contextInfo?.forwardedNewsletterMessageInfo?.newsletterJid),
    queried,
    sent
  };
}

function setup(n = 3) {
  const groupJid = makeGroup();
  const admin = makePerson();
  const membro = makePerson();
  const outros = [];
  for (let i = 0; i < n; i++) outros.push(makePerson());
  const participants = [
    { lid: admin.lid, jid: admin.jid, isAdmin: true },
    { lid: membro.lid, jid: membro.jid, isAdmin: false },
    ...outros.map((p) => ({ lid: p.lid, jid: p.jid, isAdmin: false })),
    { lid: BOT_LID, jid: BOT_JID, name: 'Lizzy', isAdmin: true }
  ];
  return { groupJid, admin, membro, participants };
}

/** Acha o filho `<offer>` dentro do `<call>` enviado. */
const acharOffer = (node) => (node?.content || []).find((c) => c.tag === 'offer');
const tagsDe = (node) => (node?.content || []).map((c) => c.tag);

// ============================================================================
// 1) MODULO: forma da stanza
// ============================================================================

await test('monta o `<call><offer>` de grupo na forma da spec', () => {
  const node = callOffer.montarOfferGrupo({
    callId: 'ABC', callCreator: 'me@lid', groupJid: 'g@g.us',
    roster: [{ jid: 'me@lid', devices: ['me@lid'], self: true }],
    stanzaId: 'S1'
  });
  ok(node.tag === 'call', 'envelope e <call>');
  // O wrapper endereça o OBJETO da call, nao o peer (spec wacrg / meowcaller).
  ok(node.attrs.to === 'ABC@call', `to = <call-id>@call (veio ${node.attrs.to})`);
  ok(node.attrs.id === 'S1', 'leva o id do wrapper (correlaciona o ack)');
  const offer = acharOffer(node);
  ok(Boolean(offer), 'tem o filho <offer>');
  ok(offer.attrs['call-id'] === 'ABC', 'offer leva call-id');
  ok(offer.attrs['call-creator'] === 'me@lid', 'offer leva call-creator');
  ok(offer.attrs['group-jid'] === 'g@g.us', 'offer leva group-jid (call amarrada ao grupo)');
});

await test('a ORDEM dos filhos do offer e obrigatoria (audio,audio,net,group_info)', () => {
  const node = callOffer.montarOfferGrupo({
    callId: 'ABC', callCreator: 'me@lid', groupJid: 'g@g.us',
    roster: [{ jid: 'me@lid', devices: ['me@lid'], self: true }]
  });
  const offer = acharOffer(node);
  const esperado = ['audio', 'audio', 'net', 'group_info'];
  ok(JSON.stringify(tagsDe(offer)) === JSON.stringify(esperado),
    `ordem ${esperado.join(' > ')} (veio ${tagsDe(offer).join(' > ')})`);
  ok(offer.content[0].attrs.rate === '8000' && offer.content[1].attrs.rate === '16000',
    'os dois <audio> sao 8000 e 16000');
  ok(offer.content[2].attrs.medium === '3', 'net medium=3');
});

await test('NAO leva chave de midia (enc/destination): e so sinalizacao', () => {
  const node = callOffer.montarOfferGrupo({
    callId: 'ABC', callCreator: 'me@lid', groupJid: 'g@g.us',
    roster: [{ jid: 'me@lid', devices: ['me@lid'], self: true }]
  });
  const tags = tagsDe(acharOffer(node));
  // No offer de GRUPO a chave vem por `enc_rekey` (epoch do grupo), nao aqui.
  // Se `enc`/`destination` aparecessem, seria o caminho 1:1 (errado p/ grupo).
  ok(!tags.includes('enc'), 'sem <enc>');
  ok(!tags.includes('destination'), 'sem <destination>');
});

await test('o group_info lista os participantes e seus devices', () => {
  const node = callOffer.montarOfferGrupo({
    callId: 'ABC', callCreator: 'me@lid', groupJid: 'g@g.us',
    roster: [
      { jid: 'me@lid', devices: ['me@lid'], self: true },
      { jid: 'outro@s.whatsapp.net', devices: ['outro:0@s.whatsapp.net', 'outro:1@s.whatsapp.net'] }
    ]
  });
  const gi = acharOffer(node).content.find((c) => c.tag === 'group_info');
  ok(gi.content.length === 2, 'dois <user>');
  const outro = gi.content.find((u) => u.attrs.jid === 'outro@s.whatsapp.net');
  ok(outro.content.length === 2, 'o outro membro tem 2 <device>');
  ok(outro.content.every((d) => d.tag === 'device'), 'os filhos sao <device>');
});

await test('o device de quem cria leva o blob de capability', () => {
  const node = callOffer.montarOfferGrupo({
    callId: 'ABC', callCreator: 'me@lid', groupJid: 'g@g.us',
    roster: [{ jid: 'me@lid', devices: ['me@lid'], self: true }]
  });
  const gi = acharOffer(node).content.find((c) => c.tag === 'group_info');
  const dev = gi.content[0].content[0];
  const cap = dev.content.find((c) => c.tag === 'capability');
  ok(Boolean(cap), 'o device do criador tem <capability>');
  ok(cap.attrs.ver === '1', 'capability ver=1');
  ok(Array.from(cap.content).join(',') === '1,5,247,9,224,187,19',
    `blob 01 05 f7 09 e0 bb 13 (veio ${Array.from(cap.content).join(',')})`);
});

await test('separarParticipantes deduplica LID/PN da MESMA pessoa', () => {
  const meta = {
    participants: [
      { id: '111@lid', phoneNumber: '5511@s.whatsapp.net' },
      { id: '222@lid', phoneNumber: '5522@s.whatsapp.net' }
    ]
  };
  const { self, outros } = callOffer.separarParticipantes(meta, '111@lid');
  ok(self === '111@lid', 'reconhece o proprio bot');
  ok(outros.length === 1 && outros[0] === '222@lid', 'so o outro membro, uma vez');
});

await test('monta o <terminate> com call-id e call-creator', () => {
  const node = callOffer.montarTerminate({ callId: 'ABC', callCreator: 'me@lid' });
  ok(node.tag === 'call', 'envelope e <call>');
  ok(node.attrs.to === 'ABC@call', 'endereça o objeto da call');
  ok(node.content[0].tag === 'terminate', 'tem <terminate>');
  ok(node.content[0].attrs['call-id'] === 'ABC', 'leva call-id');
  ok(node.content[0].attrs['call-creator'] === 'me@lid', 'leva call-creator');
});

await test('o call-id e aleatorio, 32 hex maiusculo (formato do offerCall)', () => {
  const a = callOffer.gerarCallId();
  const b = callOffer.gerarCallId();
  ok(/^[0-9A-F]{32}$/.test(a), `formato (veio ${a})`);
  ok(a !== b, 'dois ids diferentes');
});

// ============================================================================
// 2) HANDLER: guardas
// ============================================================================

await test('!callp so em grupo', async () => {
  const { admin, participants } = setup(3);
  const out = await run({ groupJid: admin.jid, sender: admin, text: '!callp', participants });
  ok(out.queried.length === 0, 'nao tentou subir chamada no PV');
});

await test('!callp so para admins', async () => {
  const { groupJid, membro, participants } = setup(3);
  const out = await run({ groupJid, sender: membro, text: '!callp', participants });
  includes(out.text, 'adm', 'avisa que precisa ser adm');
  ok(out.queried.length === 0, 'membro comum nao sobe chamada');
});

// ============================================================================
// 3) HANDLER: sobe a chamada
// ============================================================================

await test('!callp envia o <call><offer> de grupo e avisa no chat', async () => {
  const { groupJid, admin, participants } = setup(3);
  const out = await run({ groupJid, sender: admin, text: '!callp', participants });
  ok(out.queried.length === 1, 'enviou UMA stanza de call');
  const node = out.queried[0];
  ok(node.tag === 'call', 'a stanza e <call>');
  const offer = acharOffer(node);
  ok(Boolean(offer), 'com <offer>');
  ok(offer.attrs['group-jid'] === groupJid, 'amarrada ao grupo certo');
  ok(String(node.attrs.to).endsWith('@call'), 'roteada pelo objeto da call');
  includes(out.text, 'Chamada de voz iniciada', 'avisa no grupo');
  includes(out.text, offer.attrs['call-id'], 'mostra o id da chamada');
});

await test('o aviso de sucesso carrega o cabecalho de canal', async () => {
  const { groupJid, admin, participants } = setup(3);
  const out = await run({ groupJid, sender: admin, text: '!callp', participants });
  ok(out.newsletter, 'tem o cabecalho de newsletter (Ver canal)');
});

await test('guarda a call ATIVA em memoria (para o encerrar)', async () => {
  const { groupJid, admin, participants } = setup(3);
  const out = await run({ groupJid, sender: admin, text: '!callp', participants });
  const ativa = callOffer.obterCall(groupJid);
  ok(ativa && ativa.callId, 'registrou a call ativa');
  ok(ativa.callId === acharOffer(out.queried[0]).attrs['call-id'], 'o id registrado e o enviado');
  // Nao vai para o JSON: a call vive na sessao, nao no grupo.
  ok(!('callpCall' in readGroup(groupJid)), 'nao persistiu no JSON do grupo');
});

await test('nao sobe duas ao mesmo tempo', async () => {
  const { groupJid, admin, participants } = setup(3);
  await run({ groupJid, sender: admin, text: '!callp', participants });
  const out2 = await run({ groupJid, sender: admin, text: '!callp', participants });
  includes(out2.text, 'Já existe', 'avisa que ja tem uma');
  ok(out2.queried.length === 0, 'nao mandou uma segunda stanza');
});

await test('!callp encerrar manda o <terminate> e limpa o estado', async () => {
  const { groupJid, admin, participants } = setup(3);
  await run({ groupJid, sender: admin, text: '!callp', participants });
  const out = await run({ groupJid, sender: admin, text: '!callp encerrar', participants });
  ok(out.queried.length === 1, 'enviou a stanza de terminate');
  ok(out.queried[0].content[0].tag === 'terminate', 'e <terminate>');
  includes(out.text, 'encerrada', 'avisa que encerrou');
  ok(callOffer.obterCall(groupJid) === null, 'limpou a call ativa');
});

await test('!callp encerrar sem call ativa nao inventa', async () => {
  const { groupJid, admin, participants } = setup(3);
  const out = await run({ groupJid, sender: admin, text: '!callp encerrar', participants });
  includes(out.text, 'Não há chamada', 'avisa que nao ha chamada');
  ok(out.queried.length === 0, 'nao mandou stanza');
});

await test('falha do servidor: avisa e NAO registra estado', async () => {
  const { groupJid, admin, participants } = setup(3);
  const out = await run({ groupJid, sender: admin, text: '!callp', participants, failQuery: true });
  includes(out.text, 'Não consegui subir', 'avisa a falha');
  ok(callOffer.obterCall(groupJid) === null, 'nao deixou call pendurada');
});

await test('grupo pequeno (so o bot + quem pediu): recusa (grupo exige 2+)', async () => {
  // Um admin que digita o comando E' membro do grupo, entao o roster nunca fica
  // vazio pelo handler: o minimo real e' 1 outro membro (ele proprio) — abaixo
  // dos 2 que a call de grupo exige. E' este caminho que o teste cobre.
  const groupJid = makeGroup();
  const admin = makePerson();
  const participants = [
    { lid: admin.lid, jid: admin.jid, isAdmin: true },
    { lid: BOT_LID, jid: BOT_JID, name: 'Lizzy', isAdmin: true }
  ];
  const out = await run({ groupJid, sender: admin, text: '!callp', participants });
  ok(out.queried.length === 0, 'nao mandou stanza para o servidor');
  includes(out.text, 'pelo menos 2 outros membros', 'explica a regra');
});

// ============================================================================

const totalOk = RESULTS.reduce((a, r) => a + r.passed, 0);
const totalFail = RESULTS.reduce((a, r) => a + r.failed, 0);
console.log('\n' + '='.repeat(40));
console.log(`RESULTADO: ${RESULTS.length} testes | ${totalOk} asserções ok | ${totalFail} falhas`);
console.log('='.repeat(40));
if (totalFail > 0) process.exit(1);
