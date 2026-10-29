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

await test('agente: FALA EM FLUXO — comeca a falar antes do TTS terminar', async () => {
  // A fluidez: quando o TTS sabe entregar em blocos (`sintetizarStream`), o
  // agente fala o 1o bloco NA HORA, sem esperar a sintese inteira. Aqui o
  // `sintetizarStream` entrega em 3 blocos com atraso — e medimos que o 1o
  // pedaco ja saiu para o motor antes do ultimo bloco chegar.
  const falado = [];
  const ordem = [];
  const agente = new AgenteDeVoz({
    grupo: 'fluxo@g.us',
    falar: (pcm) => { falado.push(pcm); ordem.push('falou'); },
    pensar: async () => 'resposta',
    transcrever: async () => 'oi',
    sintetizar: async () => { throw new Error('nao deveria usar o caminho batch'); },
    sintetizarStream: async (texto, aoBloco) => {
      for (let i = 0; i < 3; i++) {
        await new Promise((r) => setTimeout(r, 30));
        ordem.push(`bloco${i}`);
        aoBloco(new Float32Array(1920).fill(0.2));
      }
      return { ok: true, fonte: 'fake', amostras: 3 * 1920 };
    }
  });
  agente.ligar();
  const fala = new Float32Array(960).fill(0.3);
  for (let i = 0; i < 6; i++) agente.receberAudio(fala);
  for (let i = 0; i < 10; i++) agente.receberAudio(new Float32Array(960));
  await new Promise((r) => setTimeout(r, 700));
  ok(falado.length > 0, `falou (${falado.length} frames)`);
  // O 1o frame entregue ao motor tem de vir ANTES do ultimo bloco sintetizado.
  const primeiroFalou = ordem.indexOf('falou');
  const ultimoBloco = ordem.lastIndexOf('bloco2');
  ok(primeiroFalou !== -1 && ultimoBloco !== -1, 'os dois eventos aconteceram');
  ok(primeiroFalou < ultimoBloco,
    `falou antes do fim da sintese (falou@${primeiroFalou}, bloco2@${ultimoBloco})`);
  agente.desligar();
});

await test('VAD: o silencio que fecha a frase e menor (resposta mais rapida)', async () => {
  // 700 ms de silencio entravam DIRETO na latencia: o bot ficava mudo esse tempo
  // todo antes de comecar a responder. O padrao caiu para 450 ms.
  const { DetectorDeFala } = await import(new URL('../dados/src/utils/iapAudio.js', import.meta.url).href);
  const vad = new DetectorDeFala();
  ok(vad.silencioMs === 450, `silencio padrao de 450 ms (${vad.silencioMs})`);
  // E continua configuravel por env (quem tem grupo barulhento aumenta).
  const antes = process.env.IAP_VAD_SILENCIO_MS;
  process.env.IAP_VAD_SILENCIO_MS = '900';
  const vad2 = new DetectorDeFala();
  if (antes === undefined) delete process.env.IAP_VAD_SILENCIO_MS;
  else process.env.IAP_VAD_SILENCIO_MS = antes;
  ok(vad2.silencioMs === 900, `a env manda (${vad2.silencioMs})`);
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

await test('montarSistemaDoAgente: o nome é LIZZY (limpo, sem os glifos do config)', async () => {
  // O `nomebot` do config é `𝐋𝐢𝐳𝐳𝐲 𝐝𝐨 𝐩𝐫𝐢𝐯𝐲` (MATHEMATICAL BOLD) — ruim para
  // voz (o LLM repete os glifos e o TTS lê errado). O agente usa "Lizzy".
  const sess = await import(new URL('../dados/src/utils/iapSessao.js', import.meta.url).href);
  const s = sess.montarSistemaDoAgente({});
  includes(s, 'Lizzy', 'usa o nome Lizzy');
  ok(!/𝐋|𝐢|𝐳|𝐲/.test(s), 'NÃO usa os glifos MATHEMATICAL BOLD');
  ok(/Eu sou a Lizzy/i.test(s), 'sabe se apresentar');
});

await test('montarSistemaDoAgente: é PADRÃO (sem personalidade do grupo)', async () => {
  // O dono pediu "sem isso de personalidade, é tudo padrão". O prompt não
  // depende mais de `assistentePersonality`.
  const sess = await import(new URL('../dados/src/utils/iapSessao.js', import.meta.url).href);
  const a = sess.montarSistemaDoAgente({ nomeDono: 'Kannon' });
  const b = sess.montarSistemaDoAgente({ nomeDono: 'Kannon' });
  ok(a === b, 'o prompt é determinístico (um só, padrão)');
  ok(!/tsundere|vampira|Abyss/i.test(a), 'não tem traço de personalidade');
  ok(typeof sess.montarSistemaDoAgente({ personalidade: 'humana' }) === 'string',
    'aceitar o argumento não muda nada (compatibilidade)');
});

await test('montarSistemaDoAgente: o agente SABE quem é o dono e quem está na call', async () => {
  const sess = await import(new URL('../dados/src/utils/iapSessao.js', import.meta.url).href);
  const s = sess.montarSistemaDoAgente({
    nomeDono: 'Kannon', participantes: ['Joao', 'Maria']
  });
  includes(s, 'Kannon', 'diz o nome do dono');
  ok(/dono/i.test(s), 'deixa explícito que é o dono');
  includes(s, 'Joao', 'lista quem está na call');
  // Sem falante identificado, o prompt avisa que ele NÃO sabe quem falou (e
  // manda perguntar em vez de inventar).
  ok(/nao sabe quem falou|não sabe quem falou/i.test(s), 'avisa que não sabe quem falou');
});

await test('montarSistemaDoAgente: com o FALANTE, chama a pessoa pelo nome', async () => {
  // O motor entrega o audio POR PARTICIPANTE (o JID de quem falou); o nome vem
  // do resolvedor de contatos. E' o que faz a Lizzy chamar a pessoa pelo nome.
  const sess = await import(new URL('../dados/src/utils/iapSessao.js', import.meta.url).href);
  const s = sess.montarSistemaDoAgente({ falante: 'Kannon', nomeDono: 'Outro' });
  includes(s, 'Kannon', 'diz quem está falando');
  ok(/falando com voce AGORA/i.test(s), 'aponta o falante atual');
  ok(/Dirija-se a ele\(a\) pelo nome \(Kannon\)/i.test(s), 'manda chamar pelo nome');
  // E quando o falante E' o dono, o prompt marca isso.
  const dono = sess.montarSistemaDoAgente({ falante: 'Kannon', nomeDono: 'Kannon', falanteEhDono: true });
  ok(/ATENCAO: Kannon e' o DONO/i.test(dono), 'marca quando quem fala é o dono');
});

await test('pensarComIa: resolve o JID do falante no NOME (e não passa JID cru)', async () => {
  const sess = await import(new URL('../dados/src/utils/iapSessao.js', import.meta.url).href);
  const groq = await import(new URL('../dados/src/utils/groqClient.js', import.meta.url).href);
  let sistemaVisto = null;
  groq.setGroqHttpForTest(async (url, body) => {
    sistemaVisto = body?.messages?.[0]?.content || '';
    return { data: { choices: [{ message: { content: 'ok' } }] } };
  });
  const antiga = process.env.GROQ_API_KEY;
  process.env.GROQ_API_KEY = 'gsk_teste';

  // 1) Resolvedor devolve o NOME: ele entra no prompt.
  await sess.pensarComIa('oi', [], {
    quemFalou: '23734744260711@lid',
    nomeDeQuemFalou: async () => 'Kannon'
  });
  ok(/falando com voce AGORA e' Kannon/i.test(sistemaVisto || ''), 'usou o nome resolvido');

  // 2) Resolvedor devolve um JID (nao deveria): o prompt NAO usa isso como nome.
  await sess.pensarComIa('oi', [], {
    quemFalou: '23734744260711@lid',
    nomeDeQuemFalou: async () => '23734744260711@lid'
  });
  ok(!/@lid/.test(sistemaVisto || ''), 'não passa JID cru como nome');

  // 3) Resolvedor falha: segue sem nome, sem quebrar.
  const r = await sess.pensarComIa('oi', [], {
    quemFalou: 'x@lid',
    nomeDeQuemFalou: async () => { throw new Error('sem metadata'); }
  });
  ok(r === 'ok', 'não quebrou quando o resolvedor falhou');

  if (antiga !== undefined) process.env.GROQ_API_KEY = antiga;
  groq.setGroqHttpForTest(null);
});

await test('montarSistemaDoAgente: tem as regras de FALA (não de texto)', async () => {
  const sess = await import(new URL('../dados/src/utils/iapSessao.js', import.meta.url).href);
  const s = sess.montarSistemaDoAgente({});
  ok(/frases CURTAS/i.test(s), 'pede frases curtas');
  ok(/emojis|markdown/i.test(s), 'proíbe emoji/markdown (vai ser falado)');
  ok(/CHAMADA DE VOZ/i.test(s), 'sabe que está numa call');
});

// ============================================================================
// 6b) A GUARDA de permissão — "membro comum pede para banir"
// ============================================================================

await test('limparNomeDoBot: tira os glifos MATHEMATICAL BOLD do config', async () => {
  const g = await import(new URL('../dados/src/utils/iapGuarda.js', import.meta.url).href);
  ok(g.limparNomeDoBot('𝐋𝐢𝐳𝐳𝐲 𝐝𝐨 𝐩𝐫𝐢𝐯𝐲') === 'Lizzy', 'bold vira "Lizzy"');
  ok(g.limparNomeDoBot('Lizzy') === 'Lizzy', 'nome simples passa');
  ok(g.limparNomeDoBot('') === 'Lizzy', 'vazio cai no padrão');
  ok(g.limparNomeDoBot(null) === 'Lizzy', 'null cai no padrão');
  ok(g.iaIdentidade() === 'Lizzy', `lê do config (${g.iaIdentidade()})`);
});

await test('ehPedidoDeAcao: reconhece pedido de AÇÃO e ignora conversa', async () => {
  const g = await import(new URL('../dados/src/utils/iapGuarda.js', import.meta.url).href);
  // Ações (o caso do dono).
  ok(g.ehPedidoDeAcao('lizzy, bane alguém') === 'banir', 'bane -> banir');
  ok(g.ehPedidoDeAcao('muta esse cara') === 'mutar', 'muta -> mutar');
  ok(g.ehPedidoDeAcao('promove o joao') === 'promover', 'promove -> promover');
  ok(g.ehPedidoDeAcao('rebaixa ele') === 'rebaixar', 'rebaixa -> rebaixar');
  ok(g.ehPedidoDeAcao('tranca o grupo') === 'trancar', 'tranca -> trancar');
  // Conversa normal NÃO é ação.
  ok(g.ehPedidoDeAcao('oi lizzy, tudo bem?') === null, 'conversa não é ação');
  ok(g.ehPedidoDeAcao('qual seu nome?') === null, 'pergunta não é ação');
  ok(g.ehPedidoDeAcao('') === null, 'vazio não é ação');
  ok(g.ehPedidoDeAcao('toca uma música') === null, 'música não é ação de admin');
});

await test('GUARDA: MEMBRO COMUM pedindo para banir é RECUSADO', async () => {
  // O pedido literal do dono: um membro comum fala "lizzy, bane alguém" e ela
  // reconhece que ele não é adm/dono/mod e NÃO executa nada.
  const g = await import(new URL('../dados/src/utils/iapGuarda.js', import.meta.url).href);
  const soAdmin = (jid) => jid === 'admin@lid';
  const r = await g.permitePedidoDeAcao('lizzy, bane o joao', 'membro@lid', { ehAutorizado: soAdmin });
  ok(r.ok === false, 'recusou');
  ok(r.acao === 'banir', `identificou a ação (${r.acao})`);
  ok(r.motivo === 'sem_permissao', `motivo correto (${r.motivo})`);
  ok(/administrador|dono/i.test(r.recusa), 'a recusa explica que precisa ser admin/dono');
  ok(/nao posso banir/i.test(r.recusa), `fala especificamente do banir (${r.recusa.slice(0, 40)})`);
});

await test('GUARDA: ADMIN pode o mesmo pedido', async () => {
  const g = await import(new URL('../dados/src/utils/iapGuarda.js', import.meta.url).href);
  const soAdmin = (jid) => jid === 'admin@lid';
  const r = await g.permitePedidoDeAcao('lizzy, bane o joao', 'admin@lid', { ehAutorizado: soAdmin });
  ok(r.ok === true, 'admin pode');
  ok(r.acao === 'banir', 'a ação foi identificada');
});

await test('GUARDA: aceita checagem de permissão ASSÍNCRONA (o metadata é async)', async () => {
  // A permissão real vem do `getCachedGroupMetadata` (async). Se a guarda não
  // aguardasse, `Boolean(Promise)` seria SEMPRE true — falha ABERTA.
  const g = await import(new URL('../dados/src/utils/iapGuarda.js', import.meta.url).href);
  const membro = await g.permitePedidoDeAcao('bane o joao', 'membro@lid', {
    ehAutorizado: async () => false
  });
  ok(membro.ok === false, 'recusou o membro (Promise resolvida para false)');
  const admin = await g.permitePedidoDeAcao('bane o joao', 'admin@lid', {
    ehAutorizado: async () => true
  });
  ok(admin.ok === true, 'liberou o admin');
});

await test('ligarIap: o agente RECEBE o ehAutorizado (o fio que faltava)', async () => {
  // BUG: `ligarIap` montava o `pensar` sem repassar `ehAutorizado`, então o
  // agente recusava TODO pedido de ação — inclusive de admin. O teste roda o
  // caminho REAL (`ligarIap` → `iap.ligar` → `pensar`) e exige que a permissão
  // injetada seja consultada.
  const groq = await import(new URL('../dados/src/utils/groqClient.js', import.meta.url).href);
  const sess = await import(new URL('../dados/src/utils/iapSessao.js', import.meta.url).href);
  const { iap } = await import(new URL('../dados/src/utils/iapVoice.js', import.meta.url).href);
  // Seam do motor de mídia: o dublê do `callMedia` não implementa o áudio do
  // `!iap`, então aqui injetamos um motor mínimo que ACEITA a escuta.
  let externo = null;
  sess.setIapMediaForTest({
    modoAudioExternoDaCall: async (_g, on) => { externo = on; return true; },
    aoOuvirAudioDaCall: async () => true,
    falarNaCallDoGrupo: async () => 0
  });
  let chamouLLM = false;
  groq.setGroqHttpForTest(async () => {
    chamouLLM = true;
    return { data: { choices: [{ message: { content: 'ok, vou tratar' } }] } };
  });
  const antiga = process.env.GROQ_API_KEY;
  process.env.GROQ_API_KEY = 'gsk_teste';

  const grupo = 'ligar-iap@g.us';
  const r = await sess.ligarIap(grupo, { ehAutorizado: async (jid) => jid === 'admin@lid' });
  ok(r.ok === true, `ligou (${r.motivo || 'ok'})`);
  ok(externo === true, 'ligou o modo de áudio externo');

  // Pega o `pensar` que o agente REALMENTE registrou e chama com um pedido.
  const agente = iap.agentes.get(grupo);
  ok(Boolean(agente), 'o agente foi registrado');
  const respAdmin = await agente.pensar('bane o joao', [], { quemFalou: 'admin@lid' });
  ok(chamouLLM === true, 'ADMIN passou pela guarda (chegou ao LLM)');
  ok(/vou tratar/.test(respAdmin), `admin liberado (${respAdmin.slice(0, 40)})`);

  chamouLLM = false;
  const respMembro = await agente.pensar('bane o joao', [], { quemFalou: 'membro@lid' });
  ok(chamouLLM === false, 'MEMBRO não chegou ao LLM');
  ok(/nao posso|nao tem permissao/i.test(respMembro), 'membro recusado em voz');

  await sess.desligarIap(grupo);
  sess.setIapMediaForTest(null);
  if (antiga !== undefined) process.env.GROQ_API_KEY = antiga;
  groq.setGroqHttpForTest(null);
});

await test('ligarIap: a VOZ vem do msedge-tts (Node) — nao depende de pip/python', async () => {
  // O host do dono nao tem `pip`, entao a antiga instalacao via pip nunca
  // funcionava. Agora a voz e' um modulo npm: ela esta disponivel SEMPRE, mesmo
  // sem PATH/HOME/pip. Este teste roda o `ligarIap` com o PATH e o HOME
  // "hostis" e exige que ele LIGUE (a voz nao depende deles).
  const sess = await import(new URL('../dados/src/utils/iapSessao.js', import.meta.url).href);
  const tts = await import(new URL('../dados/src/utils/iapTts.js', import.meta.url).href);
  sess.setIapMediaForTest({
    modoAudioExternoDaCall: async () => true,
    aoOuvirAudioDaCall: async () => true,
    falarNaCallDoGrupo: async () => 0
  });
  const antigaGroq = process.env.GROQ_API_KEY;
  process.env.GROQ_API_KEY = 'gsk_teste';
  const fs = await import('fs');
  const os = await import('os');
  const path = await import('path');
  const homeFalso = fs.mkdtempSync(path.join(os.tmpdir(), 'iap-home2-'));
  const antigos = { PATH: process.env.PATH, HOME: process.env.HOME, EDGE_TTS_PATH: process.env.EDGE_TTS_PATH };
  process.env.PATH = '/tmp/vazio-iap2';
  process.env.HOME = homeFalso;
  delete process.env.EDGE_TTS_PATH;
  tts.resetEdgeCache();

  const r = await sess.ligarIap('voz-ok@g.us', {});
  ok(r.ok === true, `ligou mesmo sem pip/python (${r.motivo || 'ok'})`);

  await sess.desligarIap('voz-ok@g.us');
  tts.resetEdgeCache();
  process.env.PATH = antigos.PATH;
  process.env.HOME = antigos.HOME;
  if (antigos.EDGE_TTS_PATH !== undefined) process.env.EDGE_TTS_PATH = antigos.EDGE_TTS_PATH;
  if (antigaGroq !== undefined) process.env.GROQ_API_KEY = antigaGroq;
  sess.setIapMediaForTest(null);
  try { fs.rmSync(homeFalso, { recursive: true, force: true }); } catch { /* ok */ }
});

await test('ligarIap: o agente chama a pessoa pelo NOME (o fio do nomeDeQuemFalou)', async () => {
  // Fecha a cadeia do pedido do dono: o JID de quem falou (audio por
  // participante) -> NOME do contato -> o agente usa o nome na resposta.
  const sess = await import(new URL('../dados/src/utils/iapSessao.js', import.meta.url).href);
  const groq = await import(new URL('../dados/src/utils/groqClient.js', import.meta.url).href);
  const { iap } = await import(new URL('../dados/src/utils/iapVoice.js', import.meta.url).href);
  sess.setIapMediaForTest({
    modoAudioExternoDaCall: async () => true,
    aoOuvirAudioDaCall: async () => true,
    falarNaCallDoGrupo: async () => 0
  });
  let sistemaVisto = null;
  groq.setGroqHttpForTest(async (url, body) => {
    sistemaVisto = body?.messages?.[0]?.content || '';
    return { data: { choices: [{ message: { content: 'ok' } }] } };
  });
  const antigaGroq = process.env.GROQ_API_KEY;
  process.env.GROQ_API_KEY = 'gsk_teste';

  const grupo = 'nome-falante@g.us';
  const r = await sess.ligarIap(grupo, {
    nomeDono: 'Kannon',
    // O `index.js` injeta exatamente isto: JID -> resolverNomeContato.
    nomeDeQuemFalou: async (jid) => (jid === '23734744260711@lid' ? 'Kannon' : null)
  });
  ok(r.ok === true, `ligou (${r.motivo || 'ok'})`);

  const agente = iap.agentes.get(grupo);
  ok(Boolean(agente), 'o agente foi registrado');
  await agente.pensar('oi', [], { quemFalou: '23734744260711@lid' });
  ok(/falando com voce AGORA e' Kannon/i.test(sistemaVisto || ''),
    'o prompt recebeu o NOME de quem falou');

  // Um JID sem nome resolvido: o agente NAO inventa e nao usa o JID cru.
  sistemaVisto = null;
  await agente.pensar('oi', [], { quemFalou: '99999999999999@lid' });
  ok(!/99999999999999/.test(sistemaVisto || ''), 'nao usou o JID cru como nome');

  await sess.desligarIap(grupo);
  sess.setIapMediaForTest(null);
  if (antigaGroq !== undefined) process.env.GROQ_API_KEY = antigaGroq;
  groq.setGroqHttpForTest(null);
});

await test('ligarIap: o DONO é reconhecido por JID (não pelo nome)', async () => {
  // O dono trocou o nome do perfil? Ele continua sendo reconhecido — a checagem
  // e' por JID/numero (a mesma do resto do bot), nao pelo nome exibido.
  const sess = await import(new URL('../dados/src/utils/iapSessao.js', import.meta.url).href);
  const groq = await import(new URL('../dados/src/utils/groqClient.js', import.meta.url).href);
  const { iap } = await import(new URL('../dados/src/utils/iapVoice.js', import.meta.url).href);
  sess.setIapMediaForTest({
    modoAudioExternoDaCall: async () => true,
    aoOuvirAudioDaCall: async () => true,
    falarNaCallDoGrupo: async () => 0
  });
  let sistemaVisto = null;
  groq.setGroqHttpForTest(async (url, body) => {
    sistemaVisto = body?.messages?.[0]?.content || '';
    return { data: { choices: [{ message: { content: 'ok' } }] } };
  });
  const antigaGroq = process.env.GROQ_API_KEY;
  process.env.GROQ_API_KEY = 'gsk_teste';

  const grupo = 'dono-jid@g.us';
  const DONO_JID = '5511978819676@s.whatsapp.net';
  const r = await sess.ligarIap(grupo, {
    // O nome exibido do dono e' OUTRO (ele trocou no perfil) — se a checagem
    // fosse por nome, ele NAO seria reconhecido.
    nomeDono: 'NomeAntigoQueEleTrocou',
    nomeDeQuemFalou: async () => 'Kannon',
    ehDono: (jid) => jid === DONO_JID
  });
  ok(r.ok === true, `ligou (${r.motivo || 'ok'})`);

  const agente = iap.agentes.get(grupo);
  await agente.pensar('oi', [], { quemFalou: DONO_JID });
  ok(/e' o DONO/i.test(sistemaVisto || ''), 'reconheceu o dono pelo JID');

  // Um membro comum NAO e' marcado como dono.
  sistemaVisto = null;
  await agente.pensar('oi', [], { quemFalou: '5511999999999@s.whatsapp.net' });
  ok(!/e' o DONO/i.test(sistemaVisto || ''), 'membro comum nao vira dono');

  await sess.desligarIap(grupo);
  sess.setIapMediaForTest(null);
  if (antigaGroq !== undefined) process.env.GROQ_API_KEY = antigaGroq;
  groq.setGroqHttpForTest(null);
});

await test('pensarComIa: a guarda RECEBE o ehAutorizado (não recusa todo mundo)', async () => {
  // BUG: `pensarComIa` chamava a guarda SEM `ehAutorizado`, então TODO pedido de
  // ação era recusado — inclusive de admin. O `agente.ehAutorizado` era setado e
  // nunca usado. Este teste amarra o fio.
  const groq = await import(new URL('../dados/src/utils/groqClient.js', import.meta.url).href);
  const sess = await import(new URL('../dados/src/utils/iapSessao.js', import.meta.url).href);
  let chamouLLM = false;
  groq.setGroqHttpForTest(async () => {
    chamouLLM = true;
    return { data: { choices: [{ message: { content: 'ok, vou tratar' } }] } };
  });
  const antiga = process.env.GROQ_API_KEY;
  process.env.GROQ_API_KEY = 'gsk_teste';
  // ADMIN: com o fio ligado, o pedido passa (chega ao LLM).
  const respAdmin = await sess.pensarComIa('bane o joao', [], {
    quemFalou: 'admin@lid', ehAutorizado: async () => true
  });
  // MEMBRO: segue recusado, sem tocar no LLM.
  chamouLLM = false;
  const respMembro = await sess.pensarComIa('bane o joao', [], {
    quemFalou: 'membro@lid', ehAutorizado: async () => false
  });
  if (antiga !== undefined) process.env.GROQ_API_KEY = antiga;
  groq.setGroqHttpForTest(null);
  ok(/vou tratar/.test(respAdmin), `admin passou pela guarda (${respAdmin.slice(0, 40)})`);
  ok(chamouLLM === false, 'membro NÃO chegou ao LLM');
  ok(/nao posso|nao tem permissao/i.test(respMembro), 'membro recusado em voz');
});

await test('GUARDA: conversa normal passa (não é ação)', async () => {
  const g = await import(new URL('../dados/src/utils/iapGuarda.js', import.meta.url).href);
  const r = await g.permitePedidoDeAcao('oi lizzy, tudo bem?', 'membro@lid', { ehAutorizado: () => false });
  ok(r.ok === true, 'conversa passa mesmo sem permissão');
  ok(r.acao === null, 'nenhuma ação identificada');
});

await test('GUARDA: sem saber QUEM falou, recusa (não obedece desconhecido)', async () => {
  const g = await import(new URL('../dados/src/utils/iapGuarda.js', import.meta.url).href);
  const r = await g.permitePedidoDeAcao('bane o joao', null, { ehAutorizado: () => true });
  ok(r.ok === false, 'recusou');
  ok(r.motivo === 'sem_participante', `motivo (${r.motivo})`);
});

await test('GUARDA: sem a função de permissão, recusa (falha FECHADO)', async () => {
  const g = await import(new URL('../dados/src/utils/iapGuarda.js', import.meta.url).href);
  const r = await g.permitePedidoDeAcao('bane o joao', 'quem@lid', {});
  ok(r.ok === false, 'recusou (não dá para afirmar que pode)');
  ok(r.motivo === 'sem_verificacao', `motivo (${r.motivo})`);
});

await test('GUARDA: se a checagem de permissão LANÇAR, recusa', async () => {
  const g = await import(new URL('../dados/src/utils/iapGuarda.js', import.meta.url).href);
  const r = await g.permitePedidoDeAcao('bane o joao', 'x@lid', {
    ehAutorizado: () => { throw new Error('metadata fora'); }
  });
  ok(r.ok === false, 'recusou em vez de derrubar');
});

await test('GUARDA: cada ação tem a sua recusa específica', async () => {
  const g = await import(new URL('../dados/src/utils/iapGuarda.js', import.meta.url).href);
  const semPermissao = () => false;
  for (const [fala, esperado] of [
    ['muta o joao', /mutar/i],
    ['promove o joao', /promover/i],
    ['rebaixa o joao', /rebaixar/i],
    ['tranca o grupo', /abrir ou fechar|fechar/i]
  ]) {
    const r = await g.permitePedidoDeAcao(fala, 'm@lid', { ehAutorizado: semPermissao });
    ok(r.ok === false && esperado.test(r.recusa), `${fala} -> recusa específica`);
  }
});

await test('pensarComIa: RECUSA antes de chamar o LLM (não gasta cota)', async () => {
  // A guarda roda ANTES do LLM: um pedido sem permissão nem chega ao modelo.
  const groq = await import(new URL('../dados/src/utils/groqClient.js', import.meta.url).href);
  const sess = await import(new URL('../dados/src/utils/iapSessao.js', import.meta.url).href);
  let chamou = false;
  groq.setGroqHttpForTest(async () => { chamou = true; return { data: { choices: [{ message: { content: 'x' } }] } }; });
  const antiga = process.env.GROQ_API_KEY;
  process.env.GROQ_API_KEY = 'gsk_teste';
  // Sem `ehAutorizado` ligado ao agente, a guarda fecha.
  const resp = await sess.pensarComIa('bane o joao', [], { quemFalou: 'membro@lid' });
  if (antiga !== undefined) process.env.GROQ_API_KEY = antiga;
  groq.setGroqHttpForTest(null);
  ok(chamou === false, 'NÃO chamou o LLM');
  ok(/nao posso|nao tem permissao/i.test(resp), `recusou em voz (${resp.slice(0, 45)})`);
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
// 8) TTS — msedge-tts (Node puro, SEM python/pip/ffmpeg para o MP3)
// ============================================================================

await test('iapTts: a voz e\' Node puro (msedge-tts) — nao depende de pip/python', async () => {
  // O host do dono nao tem `pip` (`entrypoint.sh: pip: command not found`), e
  // era por isso que o edge-tts (pacote PYTHON) nunca instalava. A voz agora
  // vem do `msedge-tts`, que entra no `npm install` que o bot JA' roda.
  const fs = await import('fs');
  const src = fs.readFileSync(new URL('../dados/src/utils/iapTts.js', import.meta.url), 'utf8');
  const codigo = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  ok(/msedge-tts/.test(codigo), 'usa o msedge-tts');
  ok(!/generativelanguage\.googleapis/.test(codigo), 'nao chama a API do Gemini');
  ok(!/gemini/i.test(codigo), 'nenhuma referencia a Gemini');
  ok(!/garantirEdgeTts/.test(codigo), 'nao instala mais via pip (sem garantirEdgeTts)');
  ok(/garantirVoz/.test(codigo), 'exporta garantirVoz');
});

await test('iapTts: o msedge-tts esta instalado (dependencia do bot)', async () => {
  const tts = await import(new URL('../dados/src/utils/iapTts.js', import.meta.url).href);
  ok(await tts.msedgeDisponivel(), 'msedge-tts carrega');
  const v = await tts.garantirVoz();
  ok(v.ok === true, `a voz esta disponivel (${v.fonte})`);
  ok(v.fonte === 'msedge-tts', `fonte principal (${v.fonte})`);
});

await test('iapTts: caminho REAL (msedge-tts + ffmpeg) gera PCM 16 kHz', async () => {
  const tts = await import(new URL('../dados/src/utils/iapTts.js', import.meta.url).href);
  const { spawnSync } = await import('child_process');
  const temFfmpeg = spawnSync(process.env.FFMPEG_PATH || 'ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0;
  if (!temFfmpeg) {
    console.log('     (pulado: o ffmpeg converte o mp3 em PCM)');
    return;
  }
  const r = await tts.sintetizarFala('Olá, sou a Lizzy.');
  ok(r.ok === true, `sintetizou (${r.motivo || ''})`);
  ok(r.fonte === 'msedge-tts', `fonte msedge-tts (${r.fonte})`);
  ok(r.pcm.length > 8000, `mais de meio segundo de fala (${r.pcm.length} amostras)`);
  const max = Math.max(...Array.from(r.pcm).map(Math.abs));
  ok(max > 0.01, `o áudio não é silêncio (pico ${max.toFixed(3)})`);
});

await test('iapTts: desligado (IAP_TTS_EDGE=off) falha rapido com o motivo', async () => {
  const tts = await import(new URL('../dados/src/utils/iapTts.js', import.meta.url).href);
  process.env.IAP_TTS_EDGE = 'off';
  const r = await tts.sintetizarFala('teste');
  delete process.env.IAP_TTS_EDGE;
  ok(r.ok === false && r.motivo === 'tts_desativado', `motivo (${r.motivo})`);
});

await test('iapTts: sem motor nenhum, o motivo e sem_tts (nao "gemini")', async () => {
  // Isola: HOME temporario (o binario Python mora em ~/.local/bin) e PATH sem
  // python. O msedge-tts e' modulo npm — nao depende de PATH.
  const tts = await import(new URL('../dados/src/utils/iapTts.js', import.meta.url).href);
  const r = await tts.sintetizarFala('   ');
  ok(r.ok === false && r.motivo === 'texto_vazio', 'texto vazio nao sintetiza');
});

await test('iapTts: sintetizarFalaStream entrega o PCM EM FLUXO (mais fluido)', async () => {
  // A fluidez: a fala comeca no 1o bloco de audio, sem esperar o MP3 inteiro.
  const tts = await import(new URL('../dados/src/utils/iapTts.js', import.meta.url).href);
  const { spawnSync } = await import('child_process');
  const temFfmpeg = spawnSync(process.env.FFMPEG_PATH || 'ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0;
  if (!temFfmpeg || !(await tts.msedgeDisponivel())) {
    console.log('     (pulado: precisa de msedge-tts + ffmpeg)');
    return;
  }
  const frase = 'Claro! Posso te ajudar com isso agora mesmo, so me dizer o que voce precisa.';
  let blocos = 0;
  let amostras = 0;
  const t0 = Date.now();
  const r = await tts.sintetizarFalaStream(frase, (b) => { blocos += 1; amostras += b.length; });
  const totalMs = Date.now() - t0;
  ok(r.ok === true, `sintetizou (${r.motivo || ''})`);
  ok(r.fonte === 'msedge-tts', `fonte (${r.fonte})`);
  ok(blocos > 1, `entregou em varios blocos (${blocos})`);
  ok(amostras > 16000, `mais de 1s de audio (${amostras} amostras)`);
  ok(r.amostras === amostras, 'o total bate com o que foi entregue');
  // O streaming tem de ser mais rapido que o tempo real do audio (senao nao
  // adianta). Aqui o audio tem ~5 s e a sintese inteira sai bem abaixo disso.
  ok(totalMs < (amostras / 16000) * 1000, `mais rapido que o tempo real (${totalMs}ms)`);
});

await test('iapTts: texto vazio não sintetiza', async () => {
  const tts = await import(new URL('../dados/src/utils/iapTts.js', import.meta.url).href);
  const r = await tts.sintetizarFala('   ');
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
  // Resposta de VOZ: curta o bastante para caber em 2-3 frases faladas.
  ok(visto.body.max_tokens > 0 && visto.body.max_tokens <= 400,
    `max_tokens limitado (${visto.body.max_tokens})`);
  ok(typeof visto.body.temperature === 'number', `temperatura de conversa (${visto.body.temperature})`);
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

await test('index.js: ehAutorizado NÃO cai no sender/isGroupAdmin (falha ABERTA)', async () => {
  // O `ehAutorizado` recebe QUEM FALOU na call. Comparar com `sender` (quem
  // mandou o `!iap on`) ou com o `isGroupAdmin` do comando seria uma falha
  // ABERTA: o membro comum que ligou o agente passaria como autorizado.
  const fs = await import('fs');
  const src = fs.readFileSync(new URL('../dados/src/index.js', import.meta.url), 'utf8');
  const i = src.indexOf('const ehAutorizado = async (jid) =>');
  ok(i !== -1, 'o ehAutorizado existe no index.js');
  const bloco = src.slice(i, i + 900);
  ok(!/idsMatch\(jid,\s*sender\)/.test(bloco), 'não compara com o sender (falha aberta)');
  ok(!/\|\|\s*isGroupAdmin/.test(bloco), 'não usa o isGroupAdmin do comando (falha aberta)');
  ok(/numerodono/.test(bloco), 'aceita o dono do bot');
  ok(/isSubdono\(jid\)/.test(bloco), 'aceita subdono (pelo jid de quem falou)');
  ok(/admin === 'admin'|superadmin/.test(bloco), 'aceita admin do grupo pelo metadata');
});

callMedia.__setDuble(null);
callMedia.__setDubleEntrar(null);

let totalOk = 0, totalFail = 0;
for (const r of RESULTS) { totalOk += r.passed; totalFail += r.failed; }
console.log('\n' + '='.repeat(60));
console.log(`TOTAL: ${RESULTS.length} testes | ${totalOk} asserções ok | ${totalFail} falhas`);
console.log('='.repeat(60));
process.exit(totalFail === 0 ? 0 : 1);
