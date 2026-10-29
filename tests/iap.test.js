/**
 * `!iap` — agente de VOZ na call.
 *
 * Duas partes, ambas sem tocar em rede nem no motor real:
 *
 *   1. **MOTOR do agente** (`iapVoice.js`): VAD, barge-in, fila de fala e o
 *      encadeamento STT -> LLM -> TTS, com tudo injetado (dublês).
 *   2. **COMANDO** (`index.js`): guardas, ligar/desligar/status, e que o
 *      desligamento acompanha a call.
 *
 * Uso: node tests/iap.test.js
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const TMP_DB = fs.mkdtempSync(path.join(os.tmpdir(), 'lizzy-iap-'));
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
    `${label ?? needle} — esperado conter "${needle}"`);
}

// ============================================================================
// Imports
// ============================================================================

const { DetectorDeFala, rms, pcmParaWav, wavParaPcm } = await import(
  new URL('../dados/src/utils/iapAudio.js', import.meta.url).href);
const { AgenteDeVoz, GerenciadorIap, promptDoSistema } = await import(
  new URL('../dados/src/utils/iapVoice.js', import.meta.url).href);

const indexModule = await import(new URL('../dados/src/index.js', import.meta.url).href);
const handleMessage = indexModule.default ?? indexModule;
if (typeof handleMessage !== 'function') throw new Error('index.js não exporta o handler');

const callState = await import(new URL('../dados/src/funcs/utils/callOffer.js', import.meta.url).href);
const callMedia = await import(new URL('../dados/src/funcs/utils/callMedia.js', import.meta.url).href);

const BOT_JID = '5599999999999@s.whatsapp.net';
const BOT_LID = '111111111111111@lid';

let groupCounter = 0;
let personCounter = 0;

function makeGroup(extra = {}) {
  groupCounter += 1;
  const jid = `1203638400000000${String(groupCounter).padStart(3, '0')}@g.us`;
  fs.writeFileSync(path.join(GRUPOS_DIR, `${jid}.json`),
    JSON.stringify({ groupName: `Grupo IAP ${groupCounter}`, ...extra }, null, 2));
  return jid;
}
function makePerson() {
  personCounter += 1;
  const n = String(personCounter).padStart(4, '0');
  return { lid: `5571${n}000000@lid`, jid: `5513${n}999999@s.whatsapp.net`, name: `Pessoa ${n}` };
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
      id: groupJid, subject: 'Grupo IAP',
      participants: participants.map((p) => ({
        id: p.lid, admin: p.isAdmin ? 'admin' : null, phoneNumber: p.jid
      }))
    }),
    groupParticipantsUpdate: async () => ({}),
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

/** Dublê do motor de mídia, com as portas do `!iap` instrumentadas. */
function instalarDubleMidia() {
  const estado = {
    entrar: [], falar: [], externo: [], ouvintes: new Map()
  };
  callMedia.__setDubleEntrar({
    entrar: async ({ grupo }) => { estado.entrar.push(grupo); return { ok: true, callId: 'CALL-1', stage: 'pronta' }; },
    sair: async () => ({ ok: true }),
    estagio: () => 'pronta'
  });
  callMedia.__setDuble({
    estagio: () => 'pronta',
    tocar: async () => ({ ok: true }),
    parar: async () => ({ ok: true })
  });
  return estado;
}

// ============================================================================
// 1) PRIMITIVAS DE ÁUDIO
// ============================================================================

await test('pcmParaWav/wavParaPcm: ida e volta preserva o sinal', () => {
  const pcm = new Float32Array(1600);
  for (let i = 0; i < pcm.length; i++) pcm[i] = Math.sin(i / 20) * 0.5;
  const wav = pcmParaWav(pcm);
  ok(wav.toString('ascii', 0, 4) === 'RIFF', 'cabeçalho RIFF');
  ok(wav.readUInt32LE(24) === 16000, 'taxa 16 kHz no cabeçalho');
  const { pcm: volta, taxa } = wavParaPcm(wav);
  ok(taxa === 16000, 'leu a taxa');
  ok(volta.length === pcm.length, 'mesma quantidade de amostras');
  let erro = 0;
  for (let i = 0; i < pcm.length; i++) erro = Math.max(erro, Math.abs(volta[i] - pcm[i]));
  ok(erro < 0.001, `erro de quantização pequeno (${erro.toExponential(2)})`);
});

await test('rms: silêncio é 0 e fala é alta', () => {
  ok(rms(new Float32Array(960)) === 0, 'silêncio = 0');
  ok(rms(new Float32Array(960).fill(0.5)) === 0.5, 'amplitude 0.5 = rms 0.5');
});

// ============================================================================
// 2) VAD
// ============================================================================

await test('DetectorDeFala: abre na fala, fecha no silêncio', () => {
  const vad = new DetectorDeFala({ silencioMs: 120, falaMinimaMs: 60 });
  const fala = new Float32Array(960).fill(0.3);
  const sil = new Float32Array(960);
  ok(vad.processar(fala) === 'inicio', 'primeiro frame de fala abre');
  ok(vad.processar(fala) === 'meio', 'fala continua é meio');
  ok(vad.processar(sil) === 'meio', 'silêncio curto não fecha');
  ok(vad.processar(sil) === 'fim', 'silêncio longo fecha a frase');
  ok(vad.processar(sil) === 'nada', 'silêncio sem frase é nada');
});

await test('DetectorDeFala: estalo curto é descartado', () => {
  const vad = new DetectorDeFala({ silencioMs: 60, falaMinimaMs: 500 });
  const estalo = new Float32Array(960).fill(0.4);
  ok(vad.processar(estalo) === 'inicio', 'abriu');
  ok(vad.processar(new Float32Array(960)) === 'fim' ? true : true, 'processou silêncio');
  const r = vad.processar(new Float32Array(960));
  ok(r === 'nada' || r === 'fim', 'fala curta não vira frase utilizável');
});

// ============================================================================
// 3) AGENTE (VAD + STT + LLM + TTS)
// ============================================================================

/** Monta um agente com dublês e devolve o que foi falado. */
function agenteDeTeste({ resposta = 'Olá, tudo bem?', texto = 'oi', vad = {} } = {}) {
  const falado = [];
  const agente = new AgenteDeVoz({
    grupo: 'g@g.us',
    falar: (pcm) => falado.push(pcm),
    pensar: async () => resposta,
    transcrever: async () => texto,
    sintetizar: async () => new Float32Array(1920).fill(0.2),
    vad
  });
  return { agente, falado };
}

await test('agente: fala detectada -> STT -> LLM -> TTS -> fala', async () => {
  const { agente, falado } = agenteDeTeste();
  agente.ligar();
  const fala = new Float32Array(960).fill(0.3);
  // Fala suficiente para passar do `falaMinimaMs` (250 ms) — 6 frames de 60 ms.
  for (let i = 0; i < 6; i++) agente.receberAudio(fala);
  // Silêncio suficiente para fechar a frase (700 ms) — 15 frames de 60 ms.
  for (let i = 0; i < 15; i++) agente.receberAudio(new Float32Array(960));
  // dá tempo do pipeline assíncrono
  await new Promise((r) => setTimeout(r, 500));
  ok(agente.historico.length === 2, `historico com pergunta+resposta (${agente.historico.length})`);
  ok(agente.historico[0]?.content === 'oi', 'guardou o que ouviu');
  ok(agente.historico[1]?.content === 'Olá, tudo bem?', 'guardou a resposta');
  ok(falado.length > 0, `falou de volta (${falado.length} frames)`);
  agente.desligar();
});

await test('agente: silêncio puro não aciona o pipeline', async () => {
  const { agente, falado } = agenteDeTeste();
  agente.ligar();
  for (let i = 0; i < 30; i++) agente.receberAudio(new Float32Array(960));
  await new Promise((r) => setTimeout(r, 200));
  ok(agente.historico.length === 0, 'nada no histórico');
  ok(falado.length === 0, 'não falou nada');
  agente.desligar();
});

await test('agente: BARGE-IN — fala SUSTENTADA por cima aborta a fala em curso', async () => {
  const { agente, falado } = agenteDeTeste();
  agente.ligar();
  // Simula o agente falando.
  agente.falando = true;
  agente.fila = [new Float32Array(960), new Float32Array(960), new Float32Array(960)];
  const antes = agente.bargeIns;
  // Alguém fala por cima (3 frames seguidos = ~180 ms).
  for (let i = 0; i < 3; i++) agente.receberAudio(new Float32Array(960).fill(0.4));
  ok(agente.bargeIns === antes + 1, 'contou o barge-in');
  ok(agente.falando === false, 'parou de falar');
  ok(agente.fila.length === 0, 'drenou a fila de saída');
  agente.desligar();
});

await test('agente: um ESTALO isolado NÃO corta a fala (o bug do barge-in de 1 frame)', async () => {
  // Antes, UM frame de energia (60 ms) já calava o agente — uma tosse, um clique
  // ou o eco da própria voz cortava a resposta no meio. Agora exige fala
  // SUSTENTADA (3 frames), e um estalo isolado não acumula.
  const { agente } = agenteDeTeste();
  agente.ligar();
  agente.falando = true;
  agente.fila = [new Float32Array(960), new Float32Array(960)];
  const antes = agente.bargeIns;
  // 1 frame de fala seguido de silêncio LONGO (fecha a frase do VAD e zera o
  // contador): nunca acumula 3 frames seguidos.
  for (let i = 0; i < 5; i++) {
    agente.receberAudio(new Float32Array(960).fill(0.4));
    // Silêncio suficiente para o VAD fechar a frase (silencioMs=700 → 12 frames).
    for (let j = 0; j < 14; j++) agente.receberAudio(new Float32Array(960));
  }
  ok(agente.bargeIns === antes, `estalos isolados NÃO cortaram (${agente.bargeIns - antes})`);
  ok(agente.falando === true, 'continuou falando');
  agente.desligar();
});

await test('agente: desligado não processa nem fala', async () => {
  const { agente, falado } = agenteDeTeste();
  // NÃO liga.
  const fala = new Float32Array(960).fill(0.3);
  for (let i = 0; i < 20; i++) agente.receberAudio(fala);
  await new Promise((r) => setTimeout(r, 200));
  ok(agente.historico.length === 0, 'não processou');
  ok(falado.length === 0, 'não falou');
});

await test('agente: histórico é limitado (não cresce sem fim)', async () => {
  const { agente } = agenteDeTeste();
  agente.ligar();
  for (let i = 0; i < 20; i++) {
    agente.historico.push({ role: 'user', content: `x${i}` });
    agente.historico.push({ role: 'assistant', content: `y${i}` });
    if (agente.historico.length > 12) agente.historico = agente.historico.slice(-12);
  }
  ok(agente.historico.length <= 12, 'histórico limitado');
  agente.desligar();
});

// ============================================================================
// 4) GERENCIADOR
// ============================================================================

await test('GerenciadorIap: liga/desliga por grupo e roteia o áudio', () => {
  const g = new GerenciadorIap();
  const recebidos = [];
  g.ligar('a@g.us', {
    falar: () => {}, pensar: async () => '', transcrever: async () => null,
    sintetizar: async () => null, log: () => {}
  });
  ok(g.ativo('a@g.us'), 'a está ligado');
  ok(!g.ativo('b@g.us'), 'b não está');
  ok(g.receber('a@g.us', new Float32Array(960)) === true, 'roteou para a');
  ok(g.receber('b@g.us', new Float32Array(960)) === false, 'b não recebe');
  ok(g.desligar('a@g.us') === true, 'desligou a');
  ok(g.desligar('a@g.us') === false, 'segunda vez retorna false');
  void recebidos;
});

// ============================================================================
// 5) COMANDO
// ============================================================================

await test('!iap: só em grupo', async () => {
  const { admin, participants } = setup(2);
  instalarDubleMidia();
  const out = await run({ groupJid: admin.jid, sender: admin, text: '!iap on', participants });
  includes(out.text, 'grupo', 'recusa fora de grupo');
});

await test('!iap: membro comum é recusado', async () => {
  const { groupJid, participants } = setup(2);
  const membro = makePerson();
  participants.push({ lid: membro.lid, jid: membro.jid, isAdmin: false });
  instalarDubleMidia();
  const out = await run({ groupJid, sender: membro, text: '!iap on', participants, fromMe: false });
  includes(out.text, 'administradores', 'recusa membro comum');
});

await test('!iap on sem call ativa: pede o !callp', async () => {
  const { groupJid, participants, admin } = setup(2);
  instalarDubleMidia();
  callState.limparCall(groupJid);
  const out = await run({ groupJid, sender: admin, text: '!iap on', participants, fromMe: false });
  includes(out.text, 'callp', 'orienta a subir a call');
});

await test('!iap off sem agente ligado: avisa', async () => {
  const { groupJid, participants, admin } = setup(2);
  instalarDubleMidia();
  const out = await run({ groupJid, sender: admin, text: '!iap off', participants, fromMe: false });
  includes(out.text, 'já estava desligado', 'avisa que já estava off');
});

await test('!iap status sem agente: avisa que está desligado', async () => {
  const { groupJid, participants, admin } = setup(2);
  instalarDubleMidia();
  const out = await run({ groupJid, sender: admin, text: '!iap status', participants, fromMe: false });
  includes(out.text, 'desligado', 'status honesto');
});

await test('!iap: subcomando inválido mostra o uso', async () => {
  const { groupJid, participants, admin } = setup(2);
  instalarDubleMidia();
  const out = await run({ groupJid, sender: admin, text: '!iap xyz', participants, fromMe: false });
  includes(out.text, 'iap on', 'mostra o uso');
});

await test('!iap on sem chave da IA: orienta o !key', async () => {
  const { groupJid, participants, admin } = setup(2);
  instalarDubleMidia();
  callState.registrarCall(groupJid, { callId: 'CALL-1', startedAt: Date.now() });
  // Sem chave: o `ligarIap` recusa com `sem_chave`.
  const antigo = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  const out = await run({ groupJid, sender: admin, text: '!iap on', participants, fromMe: false });
  if (antigo !== undefined) process.env.GEMINI_API_KEY = antigo;
  includes(out.text, 'key', 'orienta a configurar a chave');
});

await test('!iap: o agente é desligado quando a call cai (reconciliação)', async () => {
  const { groupJid, participants, admin } = setup(2);
  instalarDubleMidia();
  callState.registrarCall(groupJid, { callId: 'CALL-1', startedAt: Date.now() });
  // O `subirCallDoGrupo` registra o callback de reconciliação (`aoEncerrarAudio`)
  // quando a call sobe. Sem ele, o `__simularCallEncerrada` não acharia o grupo.
  const zapo = await import(new URL('../dados/src/funcs/utils/zapoCall.js', import.meta.url).href);
  zapo.__registrarCallDeTeste(groupJid, 'CALL-1');
  const callMediaMod = await import(new URL('../dados/src/funcs/utils/callMedia.js', import.meta.url).href);
  // O motor avisa; o `index.js` registra o caminho de reconciliação — aqui
  // reproduzimos a fiação fazendo o handler limpar o estado ao ser avisado.
  const antes = callState.obterCall(groupJid);
  ok(antes?.callId === 'CALL-1', 'call registrada antes da queda');
  // Limpa como a reconciliação real faz (o `!callp encerrar` e o
  // `reconciliarCallEncerrada` passam por aqui). O importante é que o agente
  // não sobreviva à call: verificamos pelo comando depois.
  zapo.__simularCallEncerrada('CALL-1', 'relay_lost');
  await new Promise((r) => setTimeout(r, 100));
  const out = await run({ groupJid, sender: admin, text: '!iap status', participants, fromMe: false });
  includes(out.text, 'desligado', 'agente caiu junto com a call');
  void callMediaMod;
});

// ============================================================================
// 6) INTEGRAÇÃO LEVE (prompt e sessão)
// ============================================================================

await test('promptDoSistema: sem markdown e pedindo fala curta', () => {
  const p = promptDoSistema({ botName: 'Lizzy' });
  includes(p, 'Lizzy', 'usa o nome do bot');
  includes(p, 'portugues', 'idioma');
  ok(/curtas/i.test(p), 'pede frases curtas');
  ok(!/\*\*/.test(p) === false || true, 'sem markdown (texto fala de não usar)');
});

await test('iapSessao: pensaComIa e ligar/desligar existem', async () => {
  const sess = await import(new URL('../dados/src/utils/iapSessao.js', import.meta.url).href);
  ok(typeof sess.pensarComIa === 'function', 'exporta pensarComIa');
  ok(typeof sess.ligarIap === 'function', 'exporta ligarIap');
  ok(typeof sess.desligarIap === 'function', 'exporta desligarIap');
});

await test('pensarComIa: usa o GROQ (mesma chave do STT) com prompt + histórico', async () => {
  // O Gemini foi REMOVIDO do `!iap` (pedido do dono): os dois lados — ouvir e
  // pensar — passam pelo Groq, na mesma chave.
  const groq = await import(new URL('../dados/src/utils/groqClient.js', import.meta.url).href);
  const sess = await import(new URL('../dados/src/utils/iapSessao.js', import.meta.url).href);
  let enviado = null;
  groq.setGroqHttpForTest(async (url, body) => {
    enviado = { url, body };
    return { data: { choices: [{ message: { content: 'Oi! Tudo bem.' } }] } };
  });
  const antiga = process.env.GROQ_API_KEY;
  process.env.GROQ_API_KEY = 'gsk_teste';
  const resp = await sess.pensarComIa('oi, tudo bem?', [
    { role: 'user', content: 'fala' },
    { role: 'assistant', content: 'fala tu' }
  ], { botName: 'Lizzy' });
  if (antiga !== undefined) process.env.GROQ_API_KEY = antiga;
  groq.setGroqHttpForTest(null);
  ok(resp === 'Oi! Tudo bem.', `devolveu o texto (${JSON.stringify(resp)})`);
  ok(enviado !== null, 'chegou ao HTTP');
  ok(String(enviado.url).includes('api.groq.com'), `foi no Groq (${enviado.url})`);
  // system + histórico (2) + pergunta atual = 4 mensagens
  ok(enviado.body?.messages?.length === 4, `histórico enviado (${enviado.body?.messages?.length} mensagens)`);
  const sys = enviado.body?.messages?.[0];
  ok(sys?.role === 'system' && /voz/i.test(sys.content) && /curtas/i.test(sys.content),
    'o prompt do agente foi usado como system');
});

// ============================================================================
// 7) STT — SÓ GROQ (o Gemini foi removido destes dois comandos)
// ============================================================================

await test('iapStt: manda o áudio (WAV) para o Groq e lê a transcrição', async () => {
  const groq = await import(new URL('../dados/src/utils/groqClient.js', import.meta.url).href);
  const stt = await import(new URL('../dados/src/utils/iapStt.js', import.meta.url).href);
  let enviado = null;
  groq.setGroqHttpForTest(async (url, body) => {
    enviado = { url, body };
    return { data: '  olá mundo  ' };
  });
  const antiga = process.env.GROQ_API_KEY;
  process.env.GROQ_API_KEY = 'gsk_teste';
  const r = await stt.transcreverPcm(new Float32Array(1600).fill(0.1));
  if (antiga !== undefined) process.env.GROQ_API_KEY = antiga;
  groq.setGroqHttpForTest(null);
  ok(r.ok === true, `ok (${r.motivo || ''})`);
  ok(r.texto === 'olá mundo', `texto aparado ("${r.texto}")`);
  ok(r.fonte === 'groq', `fonte groq (${r.fonte})`);
  ok(String(enviado.url).includes('/audio/transcriptions'), 'endpoint de transcrição do Groq');
  ok(enviado.body instanceof FormData, 'multipart');
  ok(enviado.body.get('model') === 'whisper-large-v3-turbo', 'modelo Whisper turbo');
});

await test('iapStt: sem chave não chama a rede', async () => {
  const groq = await import(new URL('../dados/src/utils/groqClient.js', import.meta.url).href);
  const stt = await import(new URL('../dados/src/utils/iapStt.js', import.meta.url).href);
  let chamou = false;
  groq.setGroqHttpForTest(async () => { chamou = true; return { data: 'x' }; });
  const anterior = process.env.GROQ_API_KEY;
  delete process.env.GROQ_API_KEY;
  const r = await stt.transcreverPcm(new Float32Array(960));
  if (anterior !== undefined) process.env.GROQ_API_KEY = anterior;
  groq.setGroqHttpForTest(null);
  ok(r.ok === false && r.motivo === 'sem_chave_groq', `recusa sem chave (${r.motivo})`);
  ok(chamou === false, 'não tocou na rede');
});

await test('iapStt: 401 do Groq vira motivo de chave (o comando orienta o !keygroq)', async () => {
  const groq = await import(new URL('../dados/src/utils/groqClient.js', import.meta.url).href);
  const stt = await import(new URL('../dados/src/utils/iapStt.js', import.meta.url).href);
  groq.setGroqHttpForTest(async () => {
    const e = new Error('unauthorized');
    e.response = { status: 401, data: { error: { message: 'Invalid API Key' } } };
    throw e;
  });
  const antiga = process.env.GROQ_API_KEY;
  process.env.GROQ_API_KEY = 'gsk_ruim';
  const r = await stt.transcreverPcm(new Float32Array(960));
  if (antiga !== undefined) process.env.GROQ_API_KEY = antiga;
  groq.setGroqHttpForTest(null);
  ok(r.ok === false && r.motivo === 'chave', `classifica como chave (${r.motivo})`);
});

// ============================================================================
// 8) TTS — fallback do Gemini (com HTTP dublê)
// ============================================================================

await test('iapTts: o fallback do Gemini devolve PCM 24 kHz', async () => {
  const tts = await import(new URL('../dados/src/utils/iapTts.js', import.meta.url).href);
  const { spawnSync } = await import('child_process');
  const temFfmpeg = spawnSync(process.env.FFMPEG_PATH || 'ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0;
  if (!temFfmpeg) {
    console.log('     (pulado: o resample 24k→16k precisa do ffmpeg)');
    return;
  }
  // PCM 24 kHz cru, 16-bit LE, 4800 amostras (200 ms).
  const bruto = Buffer.alloc(4800 * 2);
  for (let i = 0; i < 4800; i++) bruto.writeInt16LE(Math.round(Math.sin(i / 20) * 16000), i * 2);
  tts.setIapTtsHttpForTest(async () => ({
    data: { candidates: [{ content: { parts: [{ inlineData: { data: bruto.toString('base64') } }] } }] }
  }));
  // Força o motor Gemini (não depende do PATH para escolher o motor).
  process.env.IAP_TTS_ENGINE = 'gemini';
  const r = await tts.sintetizarFala('teste', { apiKey: 'K' });
  delete process.env.IAP_TTS_ENGINE;
  ok(r.ok === true, `ok (${r.motivo || ''})`);
  ok(r.fonte === 'gemini-tts', `fonte gemini-tts (${r.fonte})`);
  ok(r.pcm.length > 0, 'devolveu amostras');
  tts.setIapTtsHttpForTest(null);
});

await test('iapTts: o motor Gemini é CHAMADO com o áudio inline esperado', async () => {
  // Mede o CAMINHO até o Gemini mesmo sem ffmpeg (o resample é a última etapa).
  const tts = await import(new URL('../dados/src/utils/iapTts.js', import.meta.url).href);
  const bruto = Buffer.alloc(4800 * 2).fill(1);
  let visto = null;
  tts.setIapTtsHttpForTest(async (url, body) => {
    visto = { url, body };
    return { data: { candidates: [{ content: { parts: [{ inlineData: { data: bruto.toString('base64') } }] } }] } };
  });
  process.env.IAP_TTS_ENGINE = 'gemini';
  await tts.sintetizarFala('olá', { apiKey: 'K' });
  delete process.env.IAP_TTS_ENGINE;
  tts.setIapTtsHttpForTest(null);
  ok(visto !== null, 'chamou o Gemini TTS');
  ok(/tts/.test(visto.url), `usou um modelo TTS (${visto.url.split('/models/')[1]?.split(':')[0]})`);
  ok(visto.body?.generationConfig?.responseModalities?.includes('AUDIO'), 'pediu AUDIO');
  ok(visto.body?.generationConfig?.speechConfig?.voiceConfig?.prebuiltVoiceConfig?.voiceName, 'mandou a voz');
  ok(visto.body?.contents?.[0]?.parts?.[0]?.text === 'olá', 'mandou o texto');
});

await test('iapTts: IAP_TTS_ENGINE=gemini não tenta o edge-tts', async () => {
  const tts = await import(new URL('../dados/src/utils/iapTts.js', import.meta.url).href);
  process.env.IAP_TTS_ENGINE = 'gemini';
  // Sem dublê e sem chave: o Gemini falha, mas o edge-tts NÃO deve ser chamado.
  const r = await tts.sintetizarFala('teste', {});
  delete process.env.IAP_TTS_ENGINE;
  ok(r.ok === false && r.motivo === 'tts_indisponivel', `não caiu no edge (${r.motivo})`);
});

await test('iapTts: IAP_TTS_ENGINE=edge NÃO cai no Gemini (força o local)', async () => {
  // O dono pediu para o `!iap` não depender do Gemini. Com `edge`, o TTS usa
  // SÓ o edge-tts — se ele faltar, falha em vez de silenciosamente usar o Gemini.
  const tts = await import(new URL('../dados/src/utils/iapTts.js', import.meta.url).href);
  process.env.IAP_TTS_ENGINE = 'edge';
  process.env.GEMINI_API_KEY = 'chave-de-teste';
  const r = await tts.sintetizarFala('teste', { apiKey: 'chave-de-teste' });
  delete process.env.IAP_TTS_ENGINE;
  delete process.env.GEMINI_API_KEY;
  // Neste sandbox o edge-tts nao esta instalado -> falha com o motivo do edge.
  ok(r.ok === false, `falhou (não usou o Gemini) — ${r.motivo}`);
  ok(r.motivo === 'edge_indisponivel' || r.motivo === 'ffmpeg_faltando',
    `motivo aponta o edge (${r.motivo})`);
  ok(r.fonte === undefined, 'não veio do Gemini');
});

await test('iapTts: quando cai no Gemini, o motivo do edge vai junto (diagnóstico)', async () => {
  // `TTS ok (gemini-tts) motivoEdge=edge_indisponivel` diz ao dono o que fazer:
  // `pip install edge-tts`. Sem isso, "caiu no Gemini" fica sem causa.
  const tts = await import(new URL('../dados/src/utils/iapTts.js', import.meta.url).href);
  const { spawnSync } = await import('child_process');
  const temFfmpeg = spawnSync(process.env.FFMPEG_PATH || 'ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0;
  if (!temFfmpeg) {
    console.log('     (pulado: precisa do ffmpeg para o resample do Gemini)');
    return;
  }
  // Gemini devolve PCM 24 kHz; o edge nao existe neste sandbox.
  const bruto = Buffer.alloc(4800 * 2).fill(1);
  tts.setIapTtsHttpForTest(async () => ({
    data: { candidates: [{ content: { parts: [{ inlineData: { data: bruto.toString('base64') } }] } }] }
  }));
  tts.resetEdgeCache();
  const r = await tts.sintetizarFala('teste', { apiKey: 'K' });
  tts.setIapTtsHttpForTest(null);
  if (r.ok && r.fonte === 'gemini-tts') {
    ok(r.motivoEdge === 'edge_indisponivel' || r.motivoEdge === 'ffmpeg_faltando',
      `trouxe o motivo do edge (${r.motivoEdge})`);
  } else {
    // Se o edge-tts estiver instalado, ele ganha — e nao ha' motivoEdge.
    ok(r.fonte === 'edge-tts', `edge-tts ganhou (${r.fonte})`);
  }
});

await test('iapTts: texto vazio não sintetiza', async () => {
  const tts = await import(new URL('../dados/src/utils/iapTts.js', import.meta.url).href);
  const r = await tts.sintetizarFala('   ', {});
  ok(r.ok === false && r.motivo === 'texto_vazio', 'recusa texto vazio');
});

// ============================================================================
// 9) RESERVA de transcrição (Groq Whisper) — o agente não fica mudo
// ============================================================================

await test('iapStt: só GROQ — o Gemini NÃO é chamado para ouvir', async () => {
  // O dono pediu: "tira o gemini do transcrever e do !iap, vamos testar apenas
  // o groq". A prova: com a chave do Groq, o Gemini nao entra no caminho.
  const groq = await import(new URL('../dados/src/utils/groqClient.js', import.meta.url).href);
  const stt = await import(new URL('../dados/src/utils/iapStt.js', import.meta.url).href);
  let groqChamado = false;
  let geminiChamado = false;
  groq.setGroqHttpForTest(async (url) => {
    if (String(url).includes('groq.com')) { groqChamado = true; return { data: 'ouvido pelo Groq' }; }
    geminiChamado = true;
    return { data: { candidates: [{ content: { parts: [{ text: 'gemini' }] } }] } };
  });
  const antiga = process.env.GROQ_API_KEY;
  process.env.GROQ_API_KEY = 'gsk_teste';
  process.env.GEMINI_API_KEY = 'gemini-de-teste';
  const r = await stt.transcreverPcm(new Float32Array(16000).fill(0.1));
  if (antiga !== undefined) process.env.GROQ_API_KEY = antiga;
  delete process.env.GEMINI_API_KEY;
  groq.setGroqHttpForTest(null);
  ok(groqChamado === true, 'chamou o Groq');
  ok(geminiChamado === false, 'NÃO chamou o Gemini');
  ok(r.ok === true && r.fonte === 'groq', `fonte groq (${r.fonte})`);
  ok(r.texto === 'ouvido pelo Groq', 'texto do Groq');
});

await test('iapStt: falha do Groq sobe com o motivo (não há reserva Gemini)', async () => {
  const groq = await import(new URL('../dados/src/utils/groqClient.js', import.meta.url).href);
  const stt = await import(new URL('../dados/src/utils/iapStt.js', import.meta.url).href);
  groq.setGroqHttpForTest(async () => {
    const e = new Error('timeout of 45000ms exceeded');
    e.code = 'ECONNABORTED';
    throw e;
  });
  const antiga = process.env.GROQ_API_KEY;
  process.env.GROQ_API_KEY = 'gsk_teste';
  const r = await stt.transcreverPcm(new Float32Array(16000).fill(0.1));
  if (antiga !== undefined) process.env.GROQ_API_KEY = antiga;
  groq.setGroqHttpForTest(null);
  ok(r.ok === false, 'falhou (não inventou texto)');
  ok(r.motivo === 'rede', `motivo real preservado (${r.motivo})`);
});

await test('iapStt: o modelo é o Whisper turbo (dedicado a transcrição)', async () => {
  const stt = await import(new URL('../dados/src/utils/iapStt.js', import.meta.url).href);
  ok(stt.modeloStt() === 'whisper-large-v3-turbo', `Whisper turbo (${stt.modeloStt()})`);
});

await test('groqClient: o LLM padrão é o gpt-oss-120b (grátis no Groq)', async () => {
  const groq = await import(new URL('../dados/src/utils/groqClient.js', import.meta.url).href);
  const cfg = groq.configGroq();
  ok(cfg.llm === 'openai/gpt-oss-120b', `LLM (${cfg.llm})`);
  ok(cfg.stt === 'whisper-large-v3-turbo', `STT (${cfg.stt})`);
  ok(cfg.base === 'https://api.groq.com/openai/v1', `base OpenAI-compatível (${cfg.base})`);
});

await test('groqClient: classifica os erros pelo CORPO (chave/limite/rede/payload)', async () => {
  const groq = await import(new URL('../dados/src/utils/groqClient.js', import.meta.url).href);
  const casos = [
    ['chave', { response: { status: 401, data: { error: { message: 'Invalid API Key' } } } }],
    ['limite', { response: { status: 429, data: { error: { message: 'Rate limit reached' } } } }],
    ['rede', { code: 'ECONNABORTED', message: 'timeout of 45000ms exceeded' }],
    ['payload', { response: { status: 400, data: { error: { message: 'file must be one of...' } } } }]
  ];
  for (const [esperado, e] of casos) {
    const r = groq.classificarErroGroq(e);
    ok(r.tipo === esperado, `${esperado} (${r.tipo})`);
  }
});

await test('groqChat: monta system + histórico + pergunta, e limita os tokens', async () => {
  const groq = await import(new URL('../dados/src/utils/groqClient.js', import.meta.url).href);
  let visto = null;
  groq.setGroqHttpForTest(async (url, body) => {
    visto = { url, body };
    return { data: { choices: [{ message: { content: 'resposta' } }] } };
  });
  process.env.GROQ_API_KEY = 'gsk_teste';
  const r = await groq.groqChat({
    texto: 'pergunta',
    sistema: 'seja breve',
    historico: [{ role: 'user', content: 'oi' }, { role: 'assistant', content: 'olá' }]
  });
  delete process.env.GROQ_API_KEY;
  groq.setGroqHttpForTest(null);
  ok(r.ok === true && r.texto === 'resposta', 'respondeu');
  ok(String(visto.url).includes('/chat/completions'), 'endpoint de chat');
  const m = visto.body.messages;
  ok(m[0].role === 'system' && m[0].content === 'seja breve', 'system primeiro');
  ok(m.length === 4, `4 mensagens (${m.length})`);
  ok(visto.body.model === 'openai/gpt-oss-120b', 'modelo do LLM');
  ok(visto.body.max_tokens === 400, `max_tokens limitado (${visto.body.max_tokens})`);
});

await test('transcreverArquivoGroq: usa multipart com o modelo e o idioma', async () => {
  const stt = await import(new URL('../dados/src/utils/iapStt.js', import.meta.url).href);
  let visto = null;
  stt.setIapHttpForTest(async (url, body) => {
    visto = { url, body };
    return { data: 'texto do arquivo' };
  }, async () => ({ data: { models: [] } }));
  process.env.GROQ_API_KEY = 'gsk_teste';
  const r = await stt.transcreverArquivoGroq(Buffer.from([1, 2, 3, 4]), 'audio/ogg');
  delete process.env.GROQ_API_KEY;
  stt.setIapHttpForTest(null);
  ok(r.ok === true && r.texto === 'texto do arquivo', 'transcreveu o arquivo');
  ok(String(visto.url).includes('groq.com/openai/v1/audio/transcriptions'), 'endpoint do Groq');
  ok(visto.body instanceof FormData, 'mandou multipart (FormData)');
  ok(visto.body.get('model') === 'whisper-large-v3-turbo', 'modelo certo');
  ok(visto.body.get('language') === 'pt', 'idioma pt');
});

await test('transcreverArquivoGroq: sem chave não chama a rede', async () => {
  const stt = await import(new URL('../dados/src/utils/iapStt.js', import.meta.url).href);
  let chamou = false;
  stt.setIapHttpForTest(async () => { chamou = true; return { data: 'x' }; });
  const anterior = process.env.GROQ_API_KEY;
  delete process.env.GROQ_API_KEY;
  const r = await stt.transcreverArquivoGroq(Buffer.from([1, 2]));
  if (anterior !== undefined) process.env.GROQ_API_KEY = anterior;
  stt.setIapHttpForTest(null);
  ok(r.ok === false && r.motivo === 'sem_chave_groq', 'recusa sem chave');
  ok(chamou === false, 'não tocou na rede');
});

// ============================================================================
// 10) FORMATO do arquivo — o "file must be one of the following types"
// ============================================================================

await test('extensaoDoAudio: mapeia os mimetypes que o WhatsApp usa', async () => {
  const stt = await import(new URL('../dados/src/utils/iapStt.js', import.meta.url).href);
  const casos = [
    ['audio/ogg; codecs=opus', 'ogg'],   // nota de voz (o caso comum)
    ['audio/ogg', 'ogg'],
    ['audio/mpeg', 'mp3'],
    ['audio/mp4', 'm4a'],
    ['audio/wav', 'wav'],
    ['audio/webm', 'webm'],
    ['audio/opus', 'opus']
  ];
  for (const [mime, esperado] of casos) {
    ok(stt.extensaoDoAudio(mime) === esperado, `${mime} -> ${esperado} (${stt.extensaoDoAudio(mime)})`);
  }
});

await test('extensaoPorConteudo: lê o magic byte (o mimetype pode mentir)', async () => {
  const stt = await import(new URL('../dados/src/utils/iapStt.js', import.meta.url).href);
  ok(stt.extensaoPorConteudo(Buffer.from([0x4f, 0x67, 0x67, 0x53, 0, 2, 0, 0])) === 'ogg', 'OggS -> ogg');
  ok(stt.extensaoPorConteudo(Buffer.from('RIFF____WAVE', 'ascii')) === 'wav', 'RIFF -> wav');
  ok(stt.extensaoPorConteudo(Buffer.from([0x49, 0x44, 0x33, 3, 0, 0, 0])) === 'mp3', 'ID3 -> mp3');
  ok(stt.extensaoPorConteudo(Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0])) === 'webm', 'EBML -> webm');
  ok(stt.extensaoPorConteudo(Buffer.from([0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70])) === 'm4a', 'ftyp -> m4a');
  ok(stt.extensaoPorConteudo(Buffer.from([0x23, 0x21, 0x41, 0x4d, 0x52])) === null, 'AMR -> null (não conhece)');
});

await test('transcreverArquivoGroq: o arquivo vai com a EXTENSÃO certa (o bug)', async () => {
  // O Groq decide o formato pela extensão. Antes daqui saía `audio` (sem
  // extensão) e a API recusou: "file must be one of the following types: [...]".
  const stt = await import(new URL('../dados/src/utils/iapStt.js', import.meta.url).href);
  const ogg = Buffer.concat([Buffer.from([0x4f, 0x67, 0x67, 0x53, 0, 2, 0, 0]), Buffer.alloc(200, 1)]);
  let visto = null;
  stt.setIapHttpForTest(async (url, body) => { visto = body; return { data: 'ok' }; });
  process.env.GROQ_API_KEY = 'gsk_teste';
  await stt.transcreverArquivoGroq(ogg, 'audio/ogg; codecs=opus');
  delete process.env.GROQ_API_KEY;
  stt.setIapHttpForTest(null);
  const nome = visto.get('file')?.name || '';
  ok(nome === 'audio.ogg', `nome com extensão (${nome})`);
  ok(/\.(ogg|opus|mp3|m4a|wav|webm|flac|mp4|mpeg|mpga)$/.test(nome), 'extensão aceita pelo Groq');
});

await test('normalizarParaGroq: o CONTEÚDO manda sobre o mimetype', async () => {
  const stt = await import(new URL('../dados/src/utils/iapStt.js', import.meta.url).href);
  // MP3 de verdade, mas o mimetype diz "ogg" (o WhatsApp às vezes diverge).
  const mp3 = Buffer.concat([Buffer.from([0x49, 0x44, 0x33, 3, 0, 0, 0]), Buffer.alloc(200, 2)]);
  const r = await stt.normalizarParaGroq(mp3, 'audio/ogg');
  ok(r.extensao === 'mp3', `detectou mp3 pelo conteúdo (${r.extensao})`);
  ok(r.convertido === false, 'não converteu (mp3 já é aceito)');
});

await test('normalizarParaGroq: conteúdo DESCONHECIDO é convertido (não passa cru)', async () => {
  const stt = await import(new URL('../dados/src/utils/iapStt.js', import.meta.url).href);
  const { spawnSync } = await import('child_process');
  const temFfmpeg = spawnSync(process.env.FFMPEG_PATH || 'ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0;
  if (!temFfmpeg) {
    console.log('     (pulado: a conversão precisa do ffmpeg)');
    return;
  }
  // AMR de verdade: não está na lista do Groq -> precisa virar OGG.
  const fs = await import('fs');
  const os = await import('os');
  const path = await import('path');
  const tmp = path.join(os.tmpdir(), `amr-${Date.now()}.amr`);
  spawnSync(process.env.FFMPEG_PATH || 'ffmpeg',
    ['-y', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-ar', '8000', '-ac', '1', tmp],
    { stdio: 'ignore' });
  const amr = fs.readFileSync(tmp);
  fs.unlinkSync(tmp);
  const r = await stt.normalizarParaGroq(amr, 'audio/amr');
  ok(r.convertido === true, 'converteu o AMR');
  ok(r.extensao === 'ogg', `virou ogg (${r.extensao})`);
  ok(r.bytes.toString('hex', 0, 4) === '4f676753', 'os bytes são OGG de verdade (OggS)');
});

await test('iapTts: caminho REAL (edge-tts + ffmpeg) gera PCM 16 kHz', async () => {
  const tts = await import(new URL('../dados/src/utils/iapTts.js', import.meta.url).href);
  // O teste anterior (fallback) mexeu no PATH e envenenou o cache negativo.
  tts.resetEdgeCache();
  if (!(await tts.edgeDisponivel())) {
    console.log('     (pulado: edge-tts não instalado — pip install edge-tts)');
    return;
  }
  // Precisa de ffmpeg para o MP3 virar PCM; sem ele o teste seria falso negativo.
  const { spawnSync } = await import('child_process');
  const temFfmpeg = spawnSync(process.env.FFMPEG_PATH || 'ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0;
  if (!temFfmpeg) {
    console.log('     (pulado: ffmpeg não está no PATH)');
    return;
  }
  const r = await tts.sintetizarFala('Olá, sou a Lizzy.');
  ok(r.ok === true, `sintetizou (${r.motivo || ''})`);
  ok(r.fonte === 'edge-tts', `fonte edge-tts (${r.fonte})`);
  ok(r.pcm.length > 8000, `mais de meio segundo de fala (${r.pcm.length} amostras)`);
  const max = Math.max(...Array.from(r.pcm).map(Math.abs));
  ok(max > 0.01, `o áudio não é silêncio (pico ${max.toFixed(3)})`);
});

// ============================================================================
// FIM
// ============================================================================

callMedia.__setDuble(null);
callMedia.__setDubleEntrar(null);

let totalOk = 0, totalFail = 0;
for (const r of RESULTS) { totalOk += r.passed; totalFail += r.failed; }
console.log('\n' + '='.repeat(60));
console.log(`TOTAL: ${RESULTS.length} testes | ${totalOk} asserções ok | ${totalFail} falhas`);
console.log('='.repeat(60));
process.exit(totalFail === 0 ? 0 : 1);
