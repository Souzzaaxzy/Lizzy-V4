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
// O CHAT DE VOZ tem a PROPRIA ponte (`vozpMedia.js`), separada da do `!callp`.
const vozpMedia = await import(new URL('../dados/src/funcs/utils/vozpMedia.js', import.meta.url).href);
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
    entrar: async ({ grupo, participantes, voiceChat }) => {
      chamadas.push({ tipo: 'entrar', grupo, participantes, voiceChat: !!voiceChat });
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

// Grupo GRANDE: reproduz o caso em que o servidor recusa o offer (teto de
// participantes da call de grupo).
function setupGrande(n) {
  const groupJid = makeGroup();
  const admin = makePerson();
  const participantes = [{ lid: admin.lid, jid: admin.jid, isAdmin: true }];
  for (let i = 0; i < n; i++) {
    const p = makePerson();
    participantes.push({ lid: p.lid, jid: p.jid, isAdmin: false });
  }
  participantes.push({ lid: BOT_LID, jid: BOT_JID, name: 'Lizzy', isAdmin: true });
  return { groupJid, admin, participants: participantes };
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

// ============================================================================
// 3a-ter) CHAT DE VOZ (!vozp) — um sistema SEPARADO do !callp
// ============================================================================
//
// O `!vozp` tem a propria ponte (`vozpMedia.js`), o proprio motor e o proprio
// registro. Estes testes conferem justamente a INDEPENDENCIA: o `!callp` e o
// `!vozp` nao compartilham estado, e cada um sobe/derruba o seu.

/** Dublê da ponte do CHAT DE VOZ (via o seam próprio; nao toca no do !callp). */
function instalarDubleVozp({ ok = true, motivo = null, callId = 'VC-1', stage = 'aguardando_roster', precisaPareamento = false } = {}) {
  const chamadas = [];
  vozpMedia.__setDubleVozp({
    subir: async ({ grupo, participantes }) => {
      chamadas.push({ tipo: 'subir', grupo, participantes });
      if (!ok) return { ok: false, motivo, stage: 'falhou' };
      return { ok: true, callId, stage };
    },
    sair: async (grupo) => { chamadas.push({ tipo: 'sair', grupo }); return { ok: true }; },
    estagio: () => stage,
    precisaPareamento: () => precisaPareamento
  });
  return chamadas;
}

/** Remove o duble do chat de voz. */
function desinstalarDubleVozp() {
  vozpMedia.__setDubleVozp(null);
}

await test('!vozp sobe o chat de voz pela ponte PROPRIA (nao pela do !callp)', async () => {
  const { groupJid, admin, participants } = setup(3);
  const daChamada = instalarDubleMidia();   // ponte do !callp
  const doVoz = instalarDubleVozp();        // ponte do !vozp
  const out = await run({ groupJid, sender: admin, text: '!vozp', participants });
  ok(doVoz.some((c) => c.tipo === 'subir'), 'o chat de voz subiu pela ponte dele');
  ok(daChamada.length === 0, 'a ponte do !callp NAO foi usada (sistemas separados)');
  includes(out.text, 'Chat de voz iniciado', 'avisa');
  includes(out.text, 'Não toca', 'deixa claro que nao toca');
  desinstalarDubleVozp();
});

await test('PARECIMENTO COMPARTILHADO: o vozp usa o mesmo motor/banco do callp', () => {
  const semComentarios = (t) => t.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  const voz = semComentarios(fs.readFileSync(path.join(HERE, '..', 'dados/src/funcs/utils/vozpMedia.js'), 'utf-8'));
  const zapo = fs.readFileSync(path.join(HERE, '..', 'dados/src/funcs/utils/zapoCall.js'), 'utf-8');
  // O vozp NAO tem store/sessao proprios: ele pergunta ao MESMO motor.
  ok(voz.includes('zapoCall.estaPareado'), 'o vozp pergunta o pareamento ao motor do callp');
  ok(!voz.includes('zapo-auth'), 'o vozp NAO aponta um banco proprio');
  ok(!voz.includes('createStore'), 'o vozp NAO cria store proprio (usa o do motor)');
  // O motor tem UM so banco de credenciais.
  ok(zapo.includes('zapo-auth'), 'o motor guarda as credenciais em um so banco');
});

await test('!vozp sem pareamento: orienta a usar o MESMO pareamento do !callp e NAO sobe', async () => {
  const { groupJid, admin, participants } = setup(3);
  const doVoz = instalarDubleVozp({ precisaPareamento: true });
  const out = await run({ groupJid, sender: admin, text: '!vozp', participants });
  includes(out.text, 'pareado', 'avisa que falta parear');
  includes(out.text, '!callp parear', 'aponta o pareamento do !callp (e o MESMO)');
  includes(out.text, 'os dois comandos', 'deixa claro que um pareamento serve para os dois');
  ok(doVoz.length === 0, 'NAO tentou subir sem pareamento (nao mente)');
  ok(callState.obterCall(groupJid) === null, 'nao deixou registro pendurado');
  desinstalarDubleVozp();
});

await test('!callp e !vozp NAO compartilham registro', async () => {
  const { groupJid, admin, participants } = setup(3);
  instalarDubleMidia({ callId: 'CALL-X' });
  const doVoz = instalarDubleVozp({ callId: 'VC-X' });
  // sobe a chamada
  await run({ groupJid, sender: admin, text: '!callp', participants });
  // o chat de voz NAO ve a chamada do callp: sobe o dele
  const out = await run({ groupJid, sender: admin, text: '!vozp', participants });
  includes(out.text, 'Chat de voz iniciado', 'o vozp subiu mesmo com a chamada do callp de pe');
  ok(doVoz.some((c) => c.tipo === 'subir'), 'subiu pela ponte dele');
  callState.limparCall(groupJid);
  desinstalarDubleVozp();
});

await test('!vozp encerrar derruba pela ponte PROPRIA e limpa o registro dele', async () => {
  const { groupJid, admin, participants } = setup(3);
  instalarDubleVozp({ callId: 'VC-2' });
  await run({ groupJid, sender: admin, text: '!vozp', participants });
  const doVoz = instalarDubleVozp({ callId: 'VC-2' });
  const out = await run({ groupJid, sender: admin, text: '!vozp encerrar', participants });
  ok(doVoz.some((c) => c.tipo === 'sair'), 'saiu pela ponte do vozp');
  includes(out.text, 'Chat de voz encerrado', 'avisa');
  desinstalarDubleVozp();
});

await test('!vozp status usa o estagio do MOTOR do vozp', async () => {
  const { groupJid, admin, participants } = setup(3);
  instalarDubleVozp({ callId: 'VC-3', stage: 'pronta' });
  await run({ groupJid, sender: admin, text: '!vozp', participants });
  const out = await run({ groupJid, sender: admin, text: '!vozp status', participants });
  includes(out.text, 'Chat de voz ativo', 'mostra o status');
  includes(out.text, 'pronta', 'traz o estagio do motor do vozp');
  desinstalarDubleVozp();
});

await test('!vozp: MEMBRO comum e recusado', async () => {
  const { groupJid, participants } = setup(2);
  const membro = makePerson();
  participants.push({ lid: membro.lid, jid: membro.jid, isAdmin: false });
  const doVoz = instalarDubleVozp();
  const out = await run({ groupJid, sender: membro, text: '!vozp', participants, fromMe: false });
  includes(out.text, 'administradores', 'recusa quem nao e admin');
  ok(doVoz.length === 0, 'nao sobe');
  desinstalarDubleVozp();
});

await test('!vozp so em grupo', async () => {
  const { admin, participants } = setup(2);
  const doVoz = instalarDubleVozp();
  const out = await run({ groupJid: admin.jid, sender: admin, text: '!vozp', participants });
  includes(out.text, 'só pode ser usado em grupo', 'recusa no PV');
  ok(doVoz.length === 0, 'nao sobe no PV');
  desinstalarDubleVozp();
});

await test('a ponte do vozp e um modulo SEPARADO (isLightweight isolado)', () => {
  const voz = fs.readFileSync(path.join(HERE, '..', 'dados/src/funcs/utils/vozpMedia.js'), 'utf-8');
  // Sem os comentarios: o callMedia CITA o vozp para explicar que nao o usa.
  const midia = fs.readFileSync(path.join(HERE, '..', 'dados/src/funcs/utils/callMedia.js'), 'utf-8')
    .replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  ok(voz.includes('isLightweight: true'), 'o vozp usa a opcao REAL do motor (zapo)');
  ok(!midia.includes('isLightweight'), 'o callMedia NAO conhece voice chat');
  ok(!midia.includes('voiceChat'), 'o callMedia NAO conhece voice chat');
  ok(!midia.includes('vozp'), 'o callMedia NAO referencia o vozp');
});

// ============================================================================
// 3b-bis) TETO DE PARTICIPANTES — o servidor recusa o offer (setup_failed)
// ============================================================================

await test('grupo GRANDE: limita os convidados ao teto do servidor', async () => {
  // O motor documenta o limite ("32 connected participants") e o WhatsApp expoe
  // a prop `group_call_max_participants`. Criar a call com o grupo inteiro faz o
  // servidor recusar o offer -> handleCallAck ve `error` -> SetupFailed -> a
  // mensagem de "chamada encerrada" logo depois de subir.
  // 120 membros: o caso relatado pelo dono ("+100 membros").
  const { groupJid, admin, participants } = setupGrande(120);
  const chamadas = instalarDubleMidia();
  await run({ groupJid, sender: admin, text: '!callp', participants });
  const criou = chamadas.find((c) => c.tipo === 'entrar');
  ok(Boolean(criou), 'subiu a chamada');
  ok(criou.participantes.length <= 31,
    `no maximo 31 convidados (o criador conta; veio ${criou.participantes.length})`);
  ok(criou.participantes.length === 31, `usou o teto inteiro (veio ${criou.participantes.length})`);
  callState.limparCall(groupJid);
});

await test('grupo pequeno: NAO corta ninguem', async () => {
  const { groupJid, admin, participants } = setup(5);
  const chamadas = instalarDubleMidia();
  await run({ groupJid, sender: admin, text: '!callp', participants });
  const criou = chamadas.find((c) => c.tipo === 'entrar');
  ok(criou.participantes.length === 6, `convidou os 6 (veio ${criou.participantes.length})`);
  callState.limparCall(groupJid);
});

await test('grupo grande: o aviso no grupo diz o ALCANCE (tocados de total)', async () => {
  // O dono precisa saber que o bot tocou so' uma parte — sem isso o silencio
  // parece defeito.
  const { groupJid, admin, participants } = setupGrande(120);
  instalarDubleMidia();
  const out = await run({ groupJid, sender: admin, text: '!callp', participants });
  // 31 convidados + o bot = 32 tocados, num grupo de 122 membros.
  includes(out.text, 'Toquei em 32 de 122 membros', 'diz quantos foram tocados de quantos');
  includes(out.text, '32 participantes', 'explica o limite do WhatsApp');
  includes(out.text, 'Chamada de voz iniciada', 'e ainda confirma que subiu');
  callState.limparCall(groupJid);
});

await test('grupo pequeno: o aviso NAO fala de alcance (toca em todos)', async () => {
  const { groupJid, admin, participants } = setup(5);
  instalarDubleMidia();
  const out = await run({ groupJid, sender: admin, text: '!callp', participants });
  ok(!out.text.includes('Toquei em'), 'sem aviso de corte quando nao ha corte');
  callState.limparCall(groupJid);
});

await test('o teto e configuravel por CALL_MAX_PARTICIPANTS', async () => {
  const salvo = process.env.CALL_MAX_PARTICIPANTS;
  try {
    process.env.CALL_MAX_PARTICIPANTS = '5';
    const { groupJid, admin, participants } = setupGrande(20);
    const chamadas = instalarDubleMidia();
    await run({ groupJid, sender: admin, text: '!callp', participants });
    const criou = chamadas.find((c) => c.tipo === 'entrar');
    ok(criou.participantes.length === 5, `respeitou o teto de 5 (veio ${criou.participantes.length})`);
    callState.limparCall(groupJid);
  } finally {
    if (salvo === undefined) delete process.env.CALL_MAX_PARTICIPANTS;
    else process.env.CALL_MAX_PARTICIPANTS = salvo;
  }
});

await test('CHAT DE VOZ em grupo GRANDE: nomeia o grupo INTEIRO (nao toca, entao nao tem teto)', async () => {
  // O teto de 32 e' do TOQUE. Um chat de voz NAO toca (`lightweight='1'`): ele so'
  // NOTIFICA. E o WhatsApp lancou o recurso para grupos de 33 a 128+ -- se o teto
  // valesse, o recurso nao existiria nesses grupos.
  //
  // O offer CONTINUA nomeando o grupo (medido: um offer SEM lista e' recusado com
  // `error: '404'`). O que sai e' so' o CORTE.
  // 234 membros + quem pediu = 235 convidados (o bot nao entra na lista dele).
  const { groupJid, admin, participants } = setupGrande(234);
  const doVoz = instalarDubleVozp();
  const out = await run({ groupJid, sender: admin, text: '!vozp', participants });
  const subiu = doVoz.find((c) => c.tipo === 'subir');
  ok(Boolean(subiu), 'subiu o chat de voz');
  ok(subiu.participantes.length === 235,
    `nomeou o grupo INTEIRO, sem corte (veio ${subiu.participantes.length})`);
  ok(subiu.participantes.length > 32, 'passou do teto do TOQUE (nao ha toque aqui)');
  ok(!out.text.includes('Toquei em'), 'sem aviso de corte (nao ha corte)');
  includes(out.text, 'Todo o grupo foi convidado', 'diz que convidou todo o grupo');
  includes(out.text, 'Chat de voz iniciado', 'confirma que subiu');
  callState.limparCall(groupJid);
  desinstalarDubleVozp();
});

await test('CHAMADA (!callp) em grupo GRANDE: mantem o teto (essa TOCA)', async () => {
  // O contraste: o `!callp` toca o grupo, entao o teto de 32 contas vale.
  const { groupJid, admin, participants } = setupGrande(120);
  const chamadas = instalarDubleMidia();
  await run({ groupJid, sender: admin, text: '!callp', participants });
  const criou = chamadas.find((c) => c.tipo === 'entrar');
  ok(criou.participantes.length === 31, `respeitou o teto (veio ${criou.participantes.length})`);
  callState.limparCall(groupJid);
});

await test('o log diz quantos membros e quantos convidados (diagnostico)', () => {
  const src = fs.readFileSync(path.join(HERE, '..', 'dados/src/index.js'), 'utf-8');
  const bloco = src.slice(src.indexOf('const tetoConvidados'), src.indexOf('const tetoConvidados') + 1400);
  ok(bloco.includes('[CALLP] grupo'), 'registra a linha de diagnostico');
  ok(bloco.includes('membro(s)'), 'mostra o tamanho do grupo');
  ok(bloco.includes('teto'), 'mostra o teto aplicado');
});

await test('CHAT DE VOZ que cai sozinho: o registro NAO fica morto (reconciliacao)', () => {
  const src = fs.readFileSync(path.join(HERE, '..', 'dados/src/index.js'), 'utf-8');
  // O motor derruba a call por conta propria e isso NAO passa por comando: sem
  // a reconciliacao, o `registroVozp` ficava com entrada MORTA e o `!vozp`
  // respondia "ja existe um chat de voz" para sempre.
  const bloco = src.slice(src.indexOf('const reconciliarVozpEncerrado'), src.indexOf('const reconciliarVozpEncerrado') + 1800);
  ok(bloco.includes('registroVozp.obter(grupo)'), 'so age se ha chat de voz registrado (idempotente)');
  ok(bloco.includes('registroVozp.limpar(grupo)'), 'LIMPA o registro do vozp');
  ok(bloco.includes('aoEncerrarAudio(grupo, null)'), 'desregistra o callback (nao deixa closure)');
  // E o handler LIGA o callback ao subir (senao a funcao nunca roda).
  const handler = src.slice(src.indexOf("case 'vozp':"), src.indexOf("case 'vozp':") + 9000);
  ok(handler.includes('aoEncerrarAudio(from, (grupo, motivo) => reconciliarVozpEncerrado(grupo, motivo))'),
    'o !vozp registra a reconciliacao ao subir');
  // Independencia: a reconciliacao do vozp NAO toca a fila/cache do callp.
  ok(!bloco.includes('musicQueue.limpar'), 'nao mexe na fila (isso e do !musicap)');
  ok(!bloco.includes('callCache.limparGrupo'), 'nao mexe no cache de audio (isso e do !callp)');
});

await test('quando o servidor RECUSA (setup_failed), o aviso explica', () => {
  const src = fs.readFileSync(path.join(HERE, '..', 'dados/src/index.js'), 'utf-8');
  const bloco = src.slice(src.indexOf('const reconciliarCallEncerrada'), src.indexOf('const reconciliarCallEncerrada') + 2600);
  ok(bloco.includes("motivo === 'setup_failed'"), 'trata o motivo setup_failed');
  ok(bloco.includes('recusou a chamada'), 'diz que foi o servidor (nao o bot)');
  ok(bloco.includes('32 participantes'), 'diz o numero exato do limite do WhatsApp');
  ok(bloco.includes('não do bot'), 'deixa claro que e limite da plataforma');
  ok(bloco.includes('não existe ilimitado'), 'nao promete o que a plataforma nao permite');
});

// ============================================================================
// 3c) PORTA DO RELAY — a causa do "sobe e cai na hora"
// ============================================================================

await test('PORTA DO RELAY: a opcao e SEMPRE passada ao motor (nao deixamos o motor decidir)', () => {
  // Sem a opcao, `WaCallManager.createMediaLink` faz
  // `useOriginalRelayPort ?? !isMobilePrimary()` — o valor passa a depender da
  // identidade da sessao. No modo `original` (3478) a leg nao fecha, o motor
  // chama `onRelayLost -> endCall(RelayLost)` e a call cai logo depois de subir.
  const src = fs.readFileSync(path.join(HERE, '..', 'dados/src/funcs/utils/zapoCall.js'), 'utf-8');
  ok(src.includes('useOriginalRelayPort: usarPortaOriginalDoRelay()'),
    'a opcao vai EXPLICITA na config do plugin');
});

await test('PORTA DO RELAY: o padrao e a porta do WhatsApp Web (3480)', () => {
  const salvo = process.env.CALL_RELAY_PORT_MODE;
  try {
    delete process.env.CALL_RELAY_PORT_MODE;
    ok(zapo.__usarPortaOriginalDoRelay() === false, 'sem env -> modo web (3480)');
    process.env.CALL_RELAY_PORT_MODE = 'web';
    ok(zapo.__usarPortaOriginalDoRelay() === false, "'web' -> modo web");
    process.env.CALL_RELAY_PORT_MODE = 'WEB';
    ok(zapo.__usarPortaOriginalDoRelay() === false, 'aceita caixa alta');
    process.env.CALL_RELAY_PORT_MODE = 'lixo';
    ok(zapo.__usarPortaOriginalDoRelay() === false, 'valor desconhecido cai no padrao seguro');
    process.env.CALL_RELAY_PORT_MODE = 'original';
    ok(zapo.__usarPortaOriginalDoRelay() === true, "'original' -> modo antigo (opt-in)");
  } finally {
    if (salvo === undefined) delete process.env.CALL_RELAY_PORT_MODE;
    else process.env.CALL_RELAY_PORT_MODE = salvo;
  }
});

await test('PORTA DO RELAY: a opcao MUDA a porta discada (3480 x 3478)', async () => {
  // Mede o caminho REAL do pacote de midia: `toRelayConfigs`.
  const { toRelayConfigs } = await import(
    new URL('../node_modules/@zapo-js/voip-media/dist/esm/call/relay-plan.js', import.meta.url).href
  );
  const endpoints = [{ ip: '157.240.1.1', port: 3478, token: 't', authToken: 'a', key: 'k', rawToken: 'rt', protocol: 0 }];
  const web = toRelayConfigs(endpoints, false);
  const original = toRelayConfigs(endpoints, true);
  ok(web[0].port === 3480, `modo web disca 3480 (veio ${web[0].port})`);
  ok(original[0].port === 3478, `modo original disca a anunciada (veio ${original[0].port})`);
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
  includes(out.text, 'zapo', 'diz o que falta');
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
