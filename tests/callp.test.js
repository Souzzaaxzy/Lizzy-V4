/**
 * `!callp` — sobe uma chamada de VOZ no grupo.
 *
 * Roda o handler REAL com socket falso. Desde a correção do "conectando..."
 * infinito, **quem cria a chamada é o motor de mídia** (medido no pacote
 * `lizzy-call`: `startGroupCall` faz o motor emitir o `<call><offer>`;
 * `joinVoipOngoingCall` é silencioso sem estado de call). Então o que este teste
 * mede é o que é do BOT:
 *
 *   - guardas (grupo, admin, mínimo de membros);
 *   - QUEM é convidado (todos menos o bot, deduplicado);
 *   - que a criação vai para a MÍDIA, não para a sinalização separada;
 *   - o registro da call ativa e o `encerrar`;
 *   - mensagens honestas quando a mídia não está disponível.
 *
 * Uso: node tests/callp.test.js
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const TMP_DB = fs.mkdtempSync(path.join(os.tmpdir(), 'lizzy-callp-'));
process.env.DATABASE_PATH = TMP_DB;
// Nao abre conexao de verdade do backend de midia (zapo): em teste isso
// emitiria QR e parearia um dispositivo. O contrato e medido pelos dubles.
process.env.ZAPO_DISABLE_CONNECT = "1";
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

const callState = await import(new URL('../dados/src/funcs/utils/callOffer.js', import.meta.url).href);
const callMedia = await import(new URL('../dados/src/funcs/utils/callMedia.js', import.meta.url).href);
const zapo = await import(new URL('../dados/src/funcs/utils/zapoCall.js', import.meta.url).href);

const BOT_JID = '5599999999999@s.whatsapp.net';
const BOT_LID = '111111111111111@lid';

let groupCounter = 0;
let personCounter = 0;

function makeGroup(extra = {}) {
  groupCounter += 1;
  const jid = `1203638300000000${String(groupCounter).padStart(3, '0')}@g.us`;
  fs.writeFileSync(path.join(GRUPOS_DIR, `${jid}.json`),
    JSON.stringify({ groupName: `Grupo Callp ${groupCounter}`, ...extra }, null, 2));
  return jid;
}
function makePerson() {
  personCounter += 1;
  const n = String(personCounter).padStart(4, '0');
  return { lid: `5571${n}000000@lid`, jid: `5513${n}999999@s.whatsapp.net`, name: `5571${n}000000` };
}

/**
 * Dublê do motor de mídia: registra a criação/encerramento e permite forçar
 * falha. Assim o teste mede o CONTRATO do bot sem carregar WASM.
 */
function instalarDubleMidia({ ok = true, motivo = null, stage = 'pronta', callId = 'CALL-1' } = {}) {
  const chamadas = [];
  callMedia.__setDubleEntrar({
    entrar: async ({ grupo, participantes }) => {
      chamadas.push({ tipo: 'entrar', grupo, participantes });
      if (!ok) return { ok: false, motivo, stage: 'falhou' };
      return { ok: true, callId, stage };
    },
    sair: async (grupo) => { chamadas.push({ tipo: 'sair', grupo }); return { ok: true }; },
    estagio: () => stage
  });
  return chamadas;
}

function makeNazu({ sent, groupJid, participants }) {
  const map = {};
  for (const p of participants) { map[p.jid] = p.lid; map[p.lid] = p.jid; }
  return {
    sent,
    sendMessage: async (jid, content) => { sent.push({ jid, content }); return { key: { id: 'SENT' } }; },
    user: { id: `${BOT_JID.split('@')[0]}:5@s.whatsapp.net`, lid: BOT_LID, name: 'Lizzy' },
    onWhatsApp: async (jid) => (map[jid] ? [{ jid, exists: true, lid: map[jid] }] : [{ jid, exists: false }]),
    signalRepository: { lidMapping: { getPNForLID: async (lid) => map[lid] || null } },
    groupMetadata: async () => ({
      id: groupJid, subject: 'Grupo Callp',
      // `idEhPn`: monta o participante na forma REAL de um grupo que NAO esta'
      // em modo LID — o `id` e' o NUMERO e o LID vive no campo `lid`. A fixture
      // padrao punha o LID no `id` e mascarava o defeito.
      participants: participants.map((p) => ({
        id: p.idEhPn ? p.jid : p.lid,
        lid: p.idEhPn ? p.lid : undefined,
        admin: p.isAdmin ? 'admin' : null,
        phoneNumber: p.jid
      }))
    }),
    groupParticipantsUpdate: async () => ({}),
    groupRequestParticipantsList: async () => [],
    groupRequestParticipantsUpdate: async () => ({}),
    ev: { on: () => {}, emit: () => {}, removeAllListeners: () => {} },
    readMessages: async () => {}, sendPresenceUpdate: async () => {},
    profilePictureUrl: async () => null, react: async () => ({})
  };
}

async function run({ groupJid, sender, text, participants, sent = [], fromMe = true }) {
  const nazu = makeNazu({ sent, groupJid, participants });
  const info = {
    key: { remoteJid: groupJid, fromMe, id: `M-${Math.random().toString(36).slice(2, 10)}`, participant: sender.lid },
    message: { extendedTextMessage: { text, contextInfo: { remoteJid: groupJid, mentionedJid: [] } } },
    messageTimestamp: Math.floor(Date.now() / 1000),
    pushName: sender.name
  };
  await handleMessage(nazu, info, null, new Map(), null);
  return {
    text: sent.map((s) => s.content?.text ?? '').filter(Boolean).join('\n'),
    newsletter: sent.some((s) => s.content?.contextInfo?.forwardedNewsletterMessageInfo?.newsletterJid),
    sent
  };
}

function setup(n = 3) {
  const groupJid = makeGroup();
  const admin = makePerson();
  const outros = [];
  for (let i = 0; i < n; i++) outros.push(makePerson());
  const participants = [
    { lid: admin.lid, jid: admin.jid, isAdmin: true },
    ...outros.map((p) => ({ lid: p.lid, jid: p.jid, isAdmin: false })),
    { lid: BOT_LID, jid: BOT_JID, name: 'Lizzy', isAdmin: true }
  ];
  return { groupJid, admin, participants };
}

// ============================================================================
// 1) ESTADO
// ============================================================================

await test('o registro de calls ativas começa vazio e é isolado por grupo', () => {
  ok(callState.obterCall('a@g.us') === null, 'grupo desconhecido não tem call');
  callState.registrarCall('a@g.us', { callId: 'X' });
  ok(callState.obterCall('a@g.us').callId === 'X', 'registrou');
  ok(callState.obterCall('b@g.us') === null, 'outro grupo não vê a call');
  callState.limparCall('a@g.us');
  ok(callState.obterCall('a@g.us') === null, 'limpou');
});

// ============================================================================
// 2) GUARDAS
// ============================================================================

await test('!callp só em grupo', async () => {
  const { admin, participants } = setup(2);
  const chamadas = instalarDubleMidia();
  const out = await run({ groupJid: admin.jid, sender: admin, text: '!callp', participants });
  ok(chamadas.length === 0, 'não criou call no PV');
  void out;
});

await test('!callp: MEMBRO comum é recusado (subir call é de admin)', async () => {
  const { groupJid, participants } = setup(2);
  const membro = makePerson();
  participants.push({ lid: membro.lid, jid: membro.jid, isAdmin: false });
  const chamadas = instalarDubleMidia();
  const out = await run({ groupJid, sender: membro, text: '!callp', participants, fromMe: false });
  includes(out.text, 'administradores', 'recusa quem não é admin');
  ok(chamadas.length === 0, 'não sobe chamada');
});

await test('!callp: ADMIN do grupo sobe a chamada', async () => {
  const { groupJid, participants } = setup(2);
  const adm = makePerson();
  // Admin do grupo, mas NÃO é o dono do bot: e' exatamente o caso que passou a
  // ser permitido (antes o comando era dono-only).
  participants.push({ lid: adm.lid, jid: adm.jid, isAdmin: true });
  const chamadas = instalarDubleMidia();
  const out = await run({ groupJid, sender: adm, text: '!callp', participants, fromMe: false });
  ok(chamadas.some((c) => c.tipo === 'entrar'), 'o admin subiu a chamada');
  ok(!out.text.includes('Apenas o Dono'), 'nao recusa o admin');
});

await test('!callp encerrar: MEMBRO comum é recusado', async () => {
  const { groupJid, participants } = setup(2);
  const membro = makePerson();
  participants.push({ lid: membro.lid, jid: membro.jid, isAdmin: false });
  const chamadas = instalarDubleMidia();
  const out = await run({ groupJid, sender: membro, text: '!callp encerrar', participants, fromMe: false });
  includes(out.text, 'administradores', 'recusa quem não é admin');
  ok(!chamadas.some((c) => c.tipo === 'sair'), 'não derruba a chamada');
});

await test('!callp parear: SEGUE exclusivo do dono (admin é recusado)', async () => {
  const { groupJid, participants } = setup(2);
  const adm = makePerson();
  participants.push({ lid: adm.lid, jid: adm.jid, isAdmin: true });
  instalarDubleMidia();
  const out = await run({ groupJid, sender: adm, text: '!callp parear 5511999999999', participants, fromMe: false });
  includes(out.text, 'Apenas o Dono', 'o pareamento nao vai para admin');
});

await test('!callp status: qualquer MEMBRO pode ver', async () => {
  const { groupJid, participants } = setup(2);
  const membro = makePerson();
  participants.push({ lid: membro.lid, jid: membro.jid, isAdmin: false });
  instalarDubleMidia();
  const out = await run({ groupJid, sender: membro, text: '!callp status', participants, fromMe: false });
  ok(out.text.includes('Nenhuma chamada ativa') || out.text.includes('Nenhuma chamada'),
     'o membro comum ve o status');
  ok(!out.text.includes('Apenas'), 'nao recusa o membro no status');
});

await test('grupo pequeno (só o bot + quem pediu): recusa', async () => {
  const groupJid = makeGroup();
  const admin = makePerson();
  const participants = [
    { lid: admin.lid, jid: admin.jid, isAdmin: true },
    { lid: BOT_LID, jid: BOT_JID, name: 'Lizzy', isAdmin: true }
  ];
  const chamadas = instalarDubleMidia();
  const out = await run({ groupJid, sender: admin, text: '!callp', participants });
  ok(chamadas.length === 0, 'não criou call');
  includes(out.text, 'pelo menos 2 outros membros', 'explica a regra');
});

// ============================================================================
// 3) CRIAÇÃO — pelo MOTOR, não pela sinalização
// ============================================================================

await test('!callp cria a chamada pelo MOTOR de mídia', async () => {
  const { groupJid, admin, participants } = setup(3);
  const chamadas = instalarDubleMidia();
  const out = await run({ groupJid, sender: admin, text: '!callp', participants });
  const criou = chamadas.find((c) => c.tipo === 'entrar');
  ok(Boolean(criou), 'chamou o motor para criar a call');
  ok(criou.grupo === groupJid, 'passou o grupo certo');
  includes(out.text, 'Chamada de voz iniciada', 'avisa no grupo');
});

await test('!callp convida todos os membros menos o bot', async () => {
  const { groupJid, admin, participants } = setup(3);
  const chamadas = instalarDubleMidia();
  await run({ groupJid, sender: admin, text: '!callp', participants });
  const criou = chamadas.find((c) => c.tipo === 'entrar');
  const jids = criou.participantes;
  // admin + 3 outros = 4 humanos; o bot não entra na lista de convidados.
  ok(jids.length === 4, `convidou os 4 membros humanos (veio ${jids.length})`);
  ok(!jids.some((j) => String(j).startsWith(BOT_LID.split('@')[0])), 'não convidou a si mesmo');
  ok(new Set(jids.map((j) => String(j).split('@')[0])).size === jids.length, 'sem convidado repetido');
});

await test('convida por LID (a forma que o motor exige)', async () => {
  const { groupJid, admin, participants } = setup(3);
  const chamadas = instalarDubleMidia();
  await run({ groupJid, sender: admin, text: '!callp', participants });
  const criou = chamadas.find((c) => c.tipo === 'entrar');
  ok(criou.participantes.every((j) => String(j).endsWith('@lid')),
    `todos os convidados vao em LID (vieram ${JSON.stringify(criou.participantes)})`);
  callState.limparCall(groupJid);
});

await test('convida por LID MESMO com o id do metadata sendo NUMERO', async () => {
  // O grupo que NAO esta' em modo LID: o `id` do participante e' o numero.
  // Mandar o numero faz o servidor recusar o offer e o motor encerrar a call
  // na hora ("sobe e logo em seguida e' encerrada"). Era a diferenca entre os
  // grupos que funcionavam e os que nao.
  const groupJid = makeGroup();
  const admin = makePerson();
  const outros = [makePerson(), makePerson(), makePerson()];
  const participants = [
    { lid: admin.lid, jid: admin.jid, isAdmin: true, idEhPn: true },
    ...outros.map((p) => ({ lid: p.lid, jid: p.jid, isAdmin: false, idEhPn: true })),
    { lid: BOT_LID, jid: BOT_JID, name: 'Lizzy', isAdmin: true, idEhPn: true }
  ];
  const chamadas = instalarDubleMidia();
  await run({ groupJid, sender: admin, text: '!callp', participants });
  const criou = chamadas.find((c) => c.tipo === 'entrar');
  ok(Boolean(criou), 'subiu a chamada');
  ok(criou.participantes.every((j) => String(j).endsWith('@lid')),
    `os convidados vao em LID, nao no numero (vieram ${JSON.stringify(criou.participantes)})`);
  callState.limparCall(groupJid);
});

await test('nao convida o BOT quando os convidados vao por numero', async () => {
  // `getBotNumber` devolve o LID, mas com o metadata em PN a comparacao por uma
  // forma so' nao casava e o bot entrava na propria lista de convidados.
  const groupJid = makeGroup();
  const admin = makePerson();
  const outros = [makePerson(), makePerson(), makePerson()];
  const participants = [
    { lid: admin.lid, jid: admin.jid, isAdmin: true, idEhPn: true },
    ...outros.map((p) => ({ lid: p.lid, jid: p.jid, isAdmin: false, idEhPn: true })),
    { lid: BOT_LID, jid: BOT_JID, name: 'Lizzy', isAdmin: true, idEhPn: true }
  ];
  const chamadas = instalarDubleMidia();
  await run({ groupJid, sender: admin, text: '!callp', participants });
  const criou = chamadas.find((c) => c.tipo === 'entrar');
  const baseBot = BOT_JID.split('@')[0];
  ok(!criou.participantes.some((j) => String(j).split('@')[0].split(':')[0] === baseBot),
    'o bot nao entra na propria lista de convidados');
  ok(criou.participantes.length === 4, `convidou os 4 humanos (veio ${criou.participantes.length})`);
  callState.limparCall(groupJid);
});

// ============================================================================
// 3b) CONVERSAO PN -> LID pelo PROPRIO zapo
// ============================================================================

await test('resolverLids: converte numero em LID pela API do proprio zapo', async () => {
  const visto = [];
  const cli = {
    profile: {
      getLidsByPhoneNumbers: async (numeros) => {
        visto.push(numeros);
        return numeros.map((n) => ({
          queriedJid: `${n}@s.whatsapp.net`,
          phoneJid: `${n}@s.whatsapp.net`,
          lidJid: `${n}@lid`,
          exists: true,
          invalid: false
        }));
      }
    }
  };
  const res = await zapo.__resolverLids(cli, ['5511999999999@s.whatsapp.net', '5511888888888@s.whatsapp.net']);
  ok(res.every((j) => j.endsWith('@lid')), `todos viram LID (${JSON.stringify(res)})`);
  ok(visto[0].length === 2, 'consultou os dois numeros de uma vez');
});

await test('resolverLids: quem ja e LID passa direto (sem chamar a API)', async () => {
  let chamou = 0;
  const cli = { profile: { getLidsByPhoneNumbers: async () => { chamou += 1; return []; } } };
  const res = await zapo.__resolverLids(cli, ['111111111111111@lid', '222222222222222@lid']);
  ok(chamou === 0, 'nao consulta quando todos ja sao LID');
  ok(res.length === 2 && res.every((j) => j.endsWith('@lid')), 'mantem os LIDs');
});

await test('resolverLids: o servidor corrige o numero (casa por queriedJid)', async () => {
  // O nono digito: pedimos 551199999999 e o servidor responde 5511999999999.
  const cli = {
    profile: {
      getLidsByPhoneNumbers: async () => ([{
        queriedJid: '551199999999@s.whatsapp.net',
        phoneJid: '5511999999999@s.whatsapp.net',
        lidJid: '999999999999999@lid',
        exists: true,
        invalid: false
      }])
    }
  };
  const res = await zapo.__resolverLids(cli, ['551199999999@s.whatsapp.net']);
  ok(res[0] === '999999999999999@lid', `casa por queriedJid (veio ${res[0]})`);
});

await test('resolverLids: o que nao resolver fica como veio (best-effort)', async () => {
  const cli = { profile: { getLidsByPhoneNumbers: async () => ([]) } };
  const res = await zapo.__resolverLids(cli, ['5511999999999@s.whatsapp.net']);
  ok(res[0] === '5511999999999@s.whatsapp.net', 'mantem o numero quando nao ha LID');
});

await test('resolverLids: falha da API NAO derruba a chamada', async () => {
  const cli = { profile: { getLidsByPhoneNumbers: async () => { throw new Error('usync fora'); } } };
  const res = await zapo.__resolverLids(cli, ['5511999999999@s.whatsapp.net']);
  ok(res[0] === '5511999999999@s.whatsapp.net', 'devolve o jid original');
});

await test('resolverLids: consulta lenta nao prende (tem teto de tempo)', async () => {
  const cli = { profile: { getLidsByPhoneNumbers: () => new Promise(() => {}) } };
  const t0 = Date.now();
  const res = await zapo.__resolverLids(cli, ['5511999999999@s.whatsapp.net'], 120);
  const dt = Date.now() - t0;
  ok(dt < 2000, `respeitou o teto (levou ${dt} ms)`);
  ok(res[0] === '5511999999999@s.whatsapp.net', 'segue com o numero');
});

await test('resolverLids: sem o coordinator devolve a lista sem quebrar', async () => {
  const res = await zapo.__resolverLids({}, ['5511999999999@s.whatsapp.net']);
  ok(Array.isArray(res) && res.length === 1, 'nao quebra sem a API');
});

await test('o motivo do fim da call e registrado (diagnostico)', () => {
  const src = fs.readFileSync(path.join(HERE, '..', 'dados/src/funcs/utils/zapoCall.js'), 'utf-8');
  const bloco = src.slice(src.indexOf("client.on('voip_call_ended'"), src.indexOf("client.on('voip_call_ended'") + 700);
  ok(bloco.includes('endReason'), 'le o motivo do motor');
  ok(bloco.includes('[CALLP]'), 'registra uma linha com o motivo (sem isso a causa se perde)');
});

await test('o aviso carrega o cabeçalho de canal e o estado do áudio', async () => {
  const { groupJid, admin, participants } = setup(3);
  instalarDubleMidia({ stage: 'pronta' });
  const out = await run({ groupJid, sender: admin, text: '!callp', participants });
  ok(out.newsletter, 'tem o cabeçalho de newsletter');
  includes(out.text, 'Áudio: pronto', 'diz que o áudio está pronto');
  includes(out.text, '!musicap', 'ensina o comando');
});

await test('quando a mídia ainda está conectando, o aviso diz o estágio', async () => {
  const { groupJid, admin, participants } = setup(3);
  instalarDubleMidia({ stage: 'aguardando_roster' });
  const out = await run({ groupJid, sender: admin, text: '!callp', participants });
  includes(out.text, 'conectando', 'avisa que está conectando');
  includes(out.text, 'aguardando_roster', 'mostra o estágio');
});

await test('guarda a call ativa em memória', async () => {
  const { groupJid, admin, participants } = setup(3);
  instalarDubleMidia({ callId: 'CALL-ABC' });
  await run({ groupJid, sender: admin, text: '!callp', participants });
  const ativa = callState.obterCall(groupJid);
  ok(ativa && ativa.callId === 'CALL-ABC', 'registrou o id do motor');
  ok(!('callpCall' in JSON.parse(fs.readFileSync(path.join(GRUPOS_DIR, `${groupJid}.json`), 'utf-8'))),
    'não persistiu no JSON do grupo');
  callState.limparCall(groupJid);
});

await test('não sobe duas ao mesmo tempo', async () => {
  const { groupJid, admin, participants } = setup(3);
  instalarDubleMidia();
  await run({ groupJid, sender: admin, text: '!callp', participants });
  const chamadas2 = instalarDubleMidia();
  const out2 = await run({ groupJid, sender: admin, text: '!callp', participants });
  includes(out2.text, 'Já existe', 'avisa que já tem uma');
  ok(chamadas2.length === 0, 'não criou de novo');
  callState.limparCall(groupJid);
});

// ============================================================================
// 4) FALHAS E ENCERRAR
// ============================================================================

await test('mídia ausente: avisa e NÃO registra call', async () => {
  const { groupJid, admin, participants } = setup(3);
  instalarDubleMidia({ ok: false, motivo: 'pacote_de_midia_ausente' });
  const out = await run({ groupJid, sender: admin, text: '!callp', participants });
  includes(out.text, 'Não consegui subir', 'avisa');
  includes(out.text, 'lizzy-call', 'diz o que falta');
  ok(callState.obterCall(groupJid) === null, 'não deixou call pendurada');
});

await test('!callp encerrar derruba a mídia e limpa o estado', async () => {
  const { groupJid, admin, participants } = setup(3);
  instalarDubleMidia();
  await run({ groupJid, sender: admin, text: '!callp', participants });
  const chamadas2 = instalarDubleMidia();
  const out = await run({ groupJid, sender: admin, text: '!callp encerrar', participants });
  ok(chamadas2.some((c) => c.tipo === 'sair'), 'derrubou a pilha de mídia');
  includes(out.text, 'encerrada', 'avisa');
  ok(callState.obterCall(groupJid) === null, 'limpou o registro');
});

await test('!callp encerrar sem call ativa não inventa', async () => {
  const { groupJid, admin, participants } = setup(2);
  instalarDubleMidia();
  const out = await run({ groupJid, sender: admin, text: '!callp encerrar', participants });
  includes(out.text, 'Não há chamada', 'avisa');
});

// ============================================================================

callMedia.__setDubleEntrar(null);
callMedia.__setDuble(null);

const totalOk = RESULTS.reduce((a, r) => a + r.passed, 0);
const totalFail = RESULTS.reduce((a, r) => a + r.failed, 0);
console.log('\n' + '='.repeat(40));
console.log(`RESULTADO: ${RESULTS.length} testes | ${totalOk} asserções ok | ${totalFail} falhas`);
console.log('='.repeat(40));
if (totalFail > 0) process.exit(1);
