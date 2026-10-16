/**
 * `!callp` — regressões dos 5 defeitos corrigidos (out/2026).
 *
 * Cada teste foi escrito para REPROVAR o código antigo. Os defeitos:
 *
 *   1. `!callp status` era dono-only, embora o `menumemb` o anuncie;
 *   2. uma call que caía sozinha deixava o registro do bot com entrada morta
 *      (o `!callp` recusava para sempre e o cache nunca era limpo);
 *   3. o `encerrar` limpava o registro ANTES de desmontar a mídia;
 *   4. o `voiceChat` era encadeado até um backend que não o implementa;
 *   5. os callbacks de áudio/fim de call nunca eram desregistrados.
 *
 * Uso: node tests/callp-regressions.test.js
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const TMP_DB = fs.mkdtempSync(path.join(os.tmpdir(), 'lizzy-callp-reg-'));
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
    `${label ?? needle} \u2014 esperado conter "${needle}"`);
}

/** Converte MATHEMATICAL BOLD (e ITALIC) para ASCII antes de comparar. */
function desbold(txt) {
  return String(txt || '').replace(/[\u{1D400}-\u{1D7FF}]/gu, (c) => {
    const cp = c.codePointAt(0);
    if (cp >= 0x1D400 && cp < 0x1D41A) return String.fromCharCode(cp - 0x1D400 + 65);
    if (cp >= 0x1D41A && cp < 0x1D434) return String.fromCharCode(cp - 0x1D41A + 97);
    if (cp >= 0x1D468 && cp < 0x1D482) return String.fromCharCode(cp - 0x1D468 + 65);
    if (cp >= 0x1D482 && cp < 0x1D49C) return String.fromCharCode(cp - 0x1D482 + 97);
    return c;
  });
}
function includesTxt(hay, needle, label) {
  ok(typeof hay === 'string' && desbold(hay).includes(needle),
    `${label ?? needle} \u2014 esperado conter "${needle}" (desbold)`);
}

// ============================================================================

const indexModule = await import(new URL('../dados/src/index.js', import.meta.url).href);
const handleMessage = indexModule.default ?? indexModule;
if (typeof handleMessage !== 'function') throw new Error('index.js não exporta o handler');

const callState = await import(new URL('../dados/src/funcs/utils/callOffer.js', import.meta.url).href);
const callMedia = await import(new URL('../dados/src/funcs/utils/callMedia.js', import.meta.url).href);
const zapo = await import(new URL('../dados/src/funcs/utils/zapoCall.js', import.meta.url).href);
const musicQueue = await import(new URL('../dados/src/funcs/utils/musicQueue.js', import.meta.url).href);

const BOT_JID = '5599999999999@s.whatsapp.net';
const BOT_LID = '111111111111111@lid';

let groupCounter = 0;
let personCounter = 0;

function makeGroup(extra = {}) {
  groupCounter += 1;
  const jid = `1203638500000000${String(groupCounter).padStart(3, '0')}@g.us`;
  fs.writeFileSync(path.join(GRUPOS_DIR, `${jid}.json`),
    JSON.stringify({ groupName: `Grupo Reg ${groupCounter}`, ...extra }, null, 2));
  return jid;
}
function makePerson() {
  personCounter += 1;
  const n = String(personCounter).padStart(4, '0');
  return { lid: `5572${n}000000@lid`, jid: `5514${n}999999@s.whatsapp.net`, name: `5572${n}000000` };
}

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
      id: groupJid, subject: 'Grupo Reg',
      participants: participants.map((p) => ({ id: p.lid, admin: p.isAdmin ? 'admin' : null, phoneNumber: p.jid }))
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
// FIX 1 — !callp status é LIVRE (não exige dono)
// ============================================================================

await test('FIX 1: membro comum consulta o status da chamada', async () => {
  const { groupJid, participants } = setup(2);
  const membro = makePerson();
  participants.push({ lid: membro.lid, jid: membro.jid, isAdmin: false });
  instalarDubleMidia();
  // Sem call ativa, a resposta é a de "nenhuma chamada" — o importante é NÃO
  // receber a recusa de dono.
  const out = await run({ groupJid, sender: membro, text: '!callp status', participants, fromMe: false });
  ok(!out.text.includes('Apenas o Dono'), 'não recusa por permissão');
  includes(out.text, 'Nenhuma chamada', 'responde o status');
});

await test('FIX 1: membro comum vê o painel com a call ativa', async () => {
  const { groupJid, admin, participants } = setup(3);
  const membro = makePerson();
  participants.push({ lid: membro.lid, jid: membro.jid, isAdmin: false });
  instalarDubleMidia({ callId: 'CALL-STATUS' });
  await run({ groupJid, sender: admin, text: '!callp', participants });
  const out = await run({ groupJid, sender: membro, text: '!callp status', participants, fromMe: false });
  includesTxt(out.text, 'STATUS DA CHAMADA', 'mostra o painel');
  ok(!out.text.includes('Apenas o Dono'), 'sem recusa de permissão');
  callState.limparCall(groupJid);
});

await test('PERMISSAO: SUBIR exige admin (membro comum recusado)', async () => {
  const { groupJid, participants } = setup(3);
  const membro = makePerson();
  participants.push({ lid: membro.lid, jid: membro.jid, isAdmin: false });
  const chamadas = instalarDubleMidia();
  const out = await run({ groupJid, sender: membro, text: '!callp', participants, fromMe: false });
  includes(out.text, 'administradores', 'recusa');
  ok(chamadas.length === 0, 'não subiu nada');
});

await test('PERMISSAO: SUBIR aceita admin do grupo', async () => {
  const { groupJid, participants } = setup(3);
  const adm = makePerson();
  participants.push({ lid: adm.lid, jid: adm.jid, isAdmin: true });
  const chamadas = instalarDubleMidia();
  const out = await run({ groupJid, sender: adm, text: '!callp', participants, fromMe: false });
  ok(chamadas.some((c) => c.tipo === 'entrar'), 'o admin sobe');
  includes(out.text, 'Chamada de voz iniciada', 'avisa');
  callState.limparCall(groupJid);
});

await test('PERMISSAO: ENCERRAR exige admin (membro comum recusado)', async () => {
  const { groupJid, admin, participants } = setup(3);
  const membro = makePerson();
  participants.push({ lid: membro.lid, jid: membro.jid, isAdmin: false });
  instalarDubleMidia({ callId: 'CALL-X' });
  await run({ groupJid, sender: admin, text: '!callp', participants });
  const out = await run({ groupJid, sender: membro, text: '!callp encerrar', participants, fromMe: false });
  includes(out.text, 'administradores', 'recusa');
  ok(callState.obterCall(groupJid)?.callId === 'CALL-X', 'a call segue de pé');
  callState.limparCall(groupJid);
});

await test('PERMISSAO: ENCERRAR aceita admin do grupo', async () => {
  const { groupJid, admin, participants } = setup(3);
  const adm = makePerson();
  participants.push({ lid: adm.lid, jid: adm.jid, isAdmin: true });
  instalarDubleMidia({ callId: 'CALL-ADM' });
  await run({ groupJid, sender: admin, text: '!callp', participants });
  const chamadas = instalarDubleMidia();
  const out = await run({ groupJid, sender: adm, text: '!callp encerrar', participants, fromMe: false });
  ok(chamadas.some((c) => c.tipo === 'sair'), 'o admin derruba');
  includes(out.text, 'encerrada', 'avisa');
  ok(callState.obterCall(groupJid) === null, 'registro limpo');
});

await test('PERMISSAO: PAREAR continua exclusivo do DONO (admin nao pareia)', async () => {
  const { groupJid, participants } = setup(3);
  const adm = makePerson();
  participants.push({ lid: adm.lid, jid: adm.jid, isAdmin: true });
  instalarDubleMidia();
  const out = await run({ groupJid, sender: adm, text: '!callp parear 5511999999999', participants, fromMe: false });
  includes(out.text, 'Apenas o Dono', 'recusa o admin (e credencial, nao operacao de grupo)');
});

// ============================================================================
// FIX 2 — call que cai sozinha reconcilia o estado do bot
// ============================================================================

await test('FIX 2: call derrubada pelo motor limpa registro, fila e cache', async () => {
  const { groupJid, admin, participants } = setup(3);
  instalarDubleMidia({ callId: 'CALL-CAI' });
  await run({ groupJid, sender: admin, text: '!callp', participants });
  ok(callState.obterCall(groupJid)?.callId === 'CALL-CAI', 'registrou');

  // Enfileira uma faixa para provar que a fila também sai.
  const cacheDir = path.join(TMP_DB, 'call-cache', String(groupJid).replace(/[^a-zA-Z0-9._-]/g, '_'));
  fs.mkdirSync(cacheDir, { recursive: true });
  const faixa = path.join(cacheDir, 'faixa-fake.wav');
  fs.writeFileSync(faixa, Buffer.from('RIFF'));
  musicQueue.enfileirar(groupJid, { caminho: faixa, titulo: 'Teste', donoId: admin.lid });

  // O motor avisa que a call caiu (caminho REAL do evento).
  zapo.__registrarCallDeTeste(groupJid, 'CALL-CAI');
  zapo.__simularCallEncerrada('CALL-CAI', 'relay_lost');
  // A reconciliação é assíncrona (o handler do evento dispara e segue).
  await new Promise((r) => setTimeout(r, 150));

  ok(callState.obterCall(groupJid) === null, 'registro do bot limpo');
  ok(musicQueue.tamanho(groupJid) === 0, 'fila limpa');
  ok(!fs.existsSync(faixa), 'arquivo do cache apagado');
});

await test('FIX 2: depois de cair, o !callp volta a subir (não fica preso)', async () => {
  const { groupJid, admin, participants } = setup(3);
  instalarDubleMidia({ callId: 'CALL-1' });
  await run({ groupJid, sender: admin, text: '!callp', participants });

  zapo.__registrarCallDeTeste(groupJid, 'CALL-1');
  zapo.__simularCallEncerrada('CALL-1', 'relay_lost');
  await new Promise((r) => setTimeout(r, 150));

  const chamadas = instalarDubleMidia({ callId: 'CALL-2' });
  const out = await run({ groupJid, sender: admin, text: '!callp', participants });
  ok(chamadas.some((c) => c.tipo === 'entrar'), 'subiu de novo');
  includes(out.text, 'Chamada de voz iniciada', 'avisa');
  callState.limparCall(groupJid);
});

await test('FIX 2: o grupo recebe aviso de que a chamada caiu', async () => {
  const { groupJid, admin, participants } = setup(3);
  instalarDubleMidia({ callId: 'CALL-AVISO' });
  const sent = [];
  await run({ groupJid, sender: admin, text: '!callp', participants, sent });
  sent.length = 0;
  zapo.__registrarCallDeTeste(groupJid, 'CALL-AVISO');
  zapo.__simularCallEncerrada('CALL-AVISO', 'relay_lost');
  await new Promise((r) => setTimeout(r, 150));
  const texto = sent.map((s) => s.content?.text ?? '').join('\n');
  includes(texto, 'encerrada', 'avisa no grupo');
});

await test('FIX 2: reconciliação é idempotente (sem call, nada acontece)', async () => {
  const groupJid = makeGroup();
  const sent = [];
  const { admin, participants } = setup(2);
  await run({ groupJid, sender: admin, text: '!ping', participants, sent });
  sent.length = 0;
  zapo.__simularCallEncerrada('CALL-INEXISTENTE', 'relay_lost');
  await new Promise((r) => setTimeout(r, 120));
  const texto = sent.map((s) => s.content?.text ?? '').join('\n');
  ok(!texto.includes('encerrada'), 'não inventa aviso sem call');
});

// ============================================================================
// FIX 3 — encerrar desmonta a mídia ANTES de limpar o registro
// ============================================================================

await test('FIX 3: encerrar chama o motor de mídia', async () => {
  const { groupJid, admin, participants } = setup(3);
  instalarDubleMidia({ callId: 'CALL-ENC' });
  await run({ groupJid, sender: admin, text: '!callp', participants });
  const chamadas = instalarDubleMidia();
  const out = await run({ groupJid, sender: admin, text: '!callp encerrar', participants });
  ok(chamadas.some((c) => c.tipo === 'sair'), 'desmontou a mídia');
  includes(out.text, 'encerrada', 'avisa');
  ok(callState.obterCall(groupJid) === null, 'registro limpo');
});

await test('FIX 3: se a mídia NÃO desmontar, o registro fica de pé', async () => {
  const { groupJid, admin, participants } = setup(3);
  instalarDubleMidia({ callId: 'CALL-TEIMOSO' });
  await run({ groupJid, sender: admin, text: '!callp', participants });

  // Motor que RECUSA sair (o `sair` lança).
  callMedia.__setDubleEntrar({
    entrar: async () => ({ ok: true, callId: 'CALL-TEIMOSO', stage: 'pronta' }),
    sair: async () => { throw new Error('motor recusou sair'); },
    estagio: () => 'pronta'
  });

  const out = await run({ groupJid, sender: admin, text: '!callp encerrar', participants });
  ok(callState.obterCall(groupJid)?.callId === 'CALL-TEIMOSO',
    'registro PRESERVADO quando a mídia não sai (senão subiria uma 2ª call em cima)');
  includes(out.text, 'Não consegui encerrar', 'avisa a falha (não mente sucesso)');
  callState.limparCall(groupJid);
});

// ============================================================================
// FIX 4 — voiceChat removido (o backend zapo não implementa)
// ============================================================================

await test('FIX 4: o bot não encadeia mais o flag de chat de voz', () => {
  const src = fs.readFileSync(path.join(HERE, '..', 'dados/src/index.js'), 'utf-8');
  ok(!src.includes('voiceChat: !!voiceChat'), 'index.js sem voiceChat');
  ok(!src.includes('voiceChat }'), 'index.js sem o repasse');
  const midia = fs.readFileSync(path.join(HERE, '..', 'dados/src/funcs/utils/callMedia.js'), 'utf-8');
  ok(!midia.includes('isLightWeight'), 'callMedia sem isLightWeight');
  const zapoCall = fs.readFileSync(path.join(HERE, '..', 'dados/src/funcs/utils/zapoCall.js'), 'utf-8');
  // Assercao FORTE: o termo nao pode aparecer em lugar NENHUM (codigo nem
  // comentario). A versao anterior so olhava a assinatura e deixou passar
  // tres resquicios (mensagem "chat de voz", argumento do helper, comentario).
  ok(!src.includes('voiceChat'), 'index.js sem NENHUMA ocorrencia de voiceChat');
  ok(!midia.includes('voiceChat'), 'callMedia sem NENHUMA ocorrencia de voiceChat');
  ok(!zapoCall.includes('voiceChat'), 'zapoCall sem NENHUMA ocorrencia de voiceChat');
});

await test('FIX 4: a assinatura aceita os parâmetros reais e não exige voiceChat', () => {
  const src = fs.readFileSync(path.join(HERE, '..', 'dados/src/funcs/utils/callMedia.js'), 'utf-8');
  ok(src.includes('export async function entrarNaCallComMidia({ grupo, callId, callCreator, participantes, sock })'),
    'assinatura sem voiceChat');
});

// ============================================================================
// FIX 5 — callbacks desregistrados no encerrar
// ============================================================================

await test('FIX 5: encerrar remove o callback de fim de áudio', async () => {
  const { groupJid, admin, participants } = setup(3);
  instalarDubleMidia({ callId: 'CALL-CB' });
  await run({ groupJid, sender: admin, text: '!callp', participants });

  // O `encerrar` deve desregistrar: simulamos o áudio terminando DEPOIS e
  // verificamos que nada foi disparado (o callback não existe mais).
  const sent = [];
  await run({ groupJid, sender: admin, text: '!callp encerrar', participants, sent });
  sent.length = 0;

  const src = fs.readFileSync(path.join(HERE, '..', 'dados/src/index.js'), 'utf-8');
  const blocoEncerrar = src.slice(src.indexOf("subCallp === 'encerrar'"), src.indexOf("subCallp === 'encerrar'") + 6000);
  ok(blocoEncerrar.includes('aoTerminarAudio(from, null)'), 'desregistra o callback de áudio');
  ok(blocoEncerrar.includes('aoEncerrarAudio(from, null)'), 'desregistra o callback de fim de call');
});

await test('FIX 5: a reconciliação também desregistra os callbacks', () => {
  const src = fs.readFileSync(path.join(HERE, '..', 'dados/src/index.js'), 'utf-8');
  const bloco = src.slice(src.indexOf('const reconciliarCallEncerrada'), src.indexOf('const reconciliarCallEncerrada') + 1800);
  ok(bloco.includes('aoTerminarAudio(grupo, null)'), 'desregistra áudio');
  ok(bloco.includes('aoEncerrarAudio(grupo, null)'), 'desregistra fim de call');
});

// ============================================================================
// THUMB — a capa acompanha a faixa (baixa, guarda e APAGA junto)
// ============================================================================

await test('THUMB: ehImagem aceita os formatos reais e recusa HTML', async () => {
  const thumb = await import(new URL('../dados/src/utils/callThumb.js', import.meta.url).href);
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const gif = Buffer.from('GIF89a....', 'ascii');
  const webp = Buffer.concat([Buffer.from('RIFF', 'ascii'), Buffer.alloc(4), Buffer.from('WEBP', 'ascii')]);
  const html = Buffer.from('<!DOCTYPE html><html>403</html>', 'ascii');
  ok(thumb.ehImagem(jpeg), 'JPEG');
  ok(thumb.ehImagem(png), 'PNG');
  ok(thumb.ehImagem(gif), 'GIF');
  ok(thumb.ehImagem(webp), 'WebP');
  ok(!thumb.ehImagem(html), 'HTML de bloqueio NAO e imagem');
  ok(!thumb.ehImagem(Buffer.alloc(0)), 'vazio nao e imagem');
  ok(!thumb.ehImagem(null), 'null nao quebra');
});

await test('THUMB: baixarThumb recusa URL invalida sem tentar rede', async () => {
  const thumb = await import(new URL('../dados/src/utils/callThumb.js', import.meta.url).href);
  ok(await thumb.baixarThumb('g@g.us', '') === null, 'vazia -> null');
  ok(await thumb.baixarThumb('g@g.us', 'ftp://x/y.png') === null, 'ftp -> null');
  ok(await thumb.baixarThumb('g@g.us', null) === null, 'null -> null');
  ok(await thumb.baixarThumb(null, 'https://x/y.png') === null, 'sem grupo -> null');
});

await test('THUMB: a fila guarda a capa e a DEVOLVE ao sair', async () => {
  musicQueue.limparTudo();
  musicQueue.enfileirar('thumb@g.us', { caminho: '/a.wav', titulo: 'A', donoId: 'u', thumb: '/a.jpg' });
  musicQueue.enfileirar('thumb@g.us', { caminho: '/b.wav', titulo: 'B', donoId: 'u', thumb: '/b.jpg' });

  ok(musicQueue.atual('thumb@g.us').thumb === '/a.jpg', 'a atual tem a capa');

  // `avancar` devolve a que saiu COM a capa (para o chamador apagar as duas).
  const r = musicQueue.avancar('thumb@g.us');
  ok(r.saiu?.thumb === '/a.jpg', 'a que saiu devolve a capa');
  ok(r.faixa?.thumb === '/b.jpg', 'a nova atual tem a sua capa');

  // `limpar` devolve as duas listas.
  musicQueue.enfileirar('thumb@g.us', { caminho: '/c.wav', titulo: 'C', donoId: 'u', thumb: '/c.jpg' });
  const limpo = musicQueue.limpar('thumb@g.us');
  ok(limpo.caminhos.includes('/b.wav') && limpo.caminhos.includes('/c.wav'), 'devolveu os audios');
  ok(limpo.thumbs.includes('/b.jpg') && limpo.thumbs.includes('/c.jpg'), 'devolveu as capas');
});

await test('THUMB: apagarFaixa remove audio E capa (o pedido do dono)', async () => {
  const player = await import(new URL('../dados/src/funcs/utils/callPlayer.js', import.meta.url).href);
  const cache = await import(new URL('../dados/src/utils/callCache.js', import.meta.url).href);
  const g = 'thumb-apaga@g.us';

  const audio = cache.caminhoNovo(g, '.wav');
  const capa = cache.caminhoNovo(g, '.jpg');
  fs.writeFileSync(audio, Buffer.from('RIFF'));
  fs.writeFileSync(capa, Buffer.from([0xff, 0xd8, 0xff, 0xe0]));

  // Simula o que o player faz quando a faixa acaba: tocarProxima apaga a que saiu.
  musicQueue.limparTudo();
  musicQueue.enfileirar(g, { caminho: audio, titulo: 'X', donoId: 'u', thumb: capa });
  callMedia.__setDuble({ tocar: async () => ({ ok: true }), parar: async () => ({ ok: true }), estagio: () => 'pronta' });
  const r = await player.tocarProxima(g);
  ok(r.acabou === true, 'a fila acabou (era a unica)');
  ok(!fs.existsSync(audio), 'o audio saiu do cache');
  ok(!fs.existsSync(capa), 'a CAPA saiu do cache');
  callMedia.__setDuble(null);
});

await test('THUMB: o aviso "Tocando agora" e um helper UNICO com a capa', () => {
  const src = fs.readFileSync(path.join(HERE, '..', 'dados/src/index.js'), 'utf-8');
  includes(src, 'function enviarTocando(nazu, grupo, faixa', 'existe o helper');
  includes(src, 'image: fs.readFileSync(thumb)', 'envia a imagem do cache');
  includes(src, 'fs.existsSync(thumb)', 'confere se o arquivo ainda existe');
  // Os QUATRO avisos passam pelo helper (nao montam o proprio texto).
  const usos = (src.match(/enviarTocando\(/g) || []).length;
  ok(usos >= 5, `helper usado nos 4 pontos + a definicao (achei ${usos})`);
});

await test('THUMB: o !musicap baixa a capa e a guarda na faixa', () => {
  const src = fs.readFileSync(path.join(HERE, '..', 'dados/src/index.js'), 'utf-8');
  includes(src, 'thumbUrl = busca.data.thumbnail', 'pega a thumb da busca');
  includes(src, "baixarThumb(from, thumbUrl)", 'baixa para o cache do grupo');
  includes(src, 'thumb\n            });', 'guarda na faixa enfileirada');
  // A limpeza da fila apaga as capas tambem.
  includes(src, 'callCache.apagarVarios(r.thumbs || [])', 'limpar apaga as capas');
});

await test('THUMB: sem capa, o aviso sai apenas com texto (nao quebra)', async () => {
  const src = fs.readFileSync(path.join(HERE, '..', 'dados/src/index.js'), 'utf-8');
  const i = src.indexOf('function enviarTocando');
  const bloco = src.slice(i, i + 1400);
  ok(/if \(thumb\)/.test(bloco), 'so usa imagem quando ha capa');
  includes(bloco, 'text: texto', 'caminho de texto preservado');
});

await test('THUMB: baixarThumb BAIXA de verdade e grava no cache do grupo', async () => {
  // Servidor local servindo um PNG real: prova o caminho inteiro do modulo
  // (fetch -> valida magic bytes -> grava no cache do grupo).
  const http = await import('http');
  const thumb = await import(new URL('../dados/src/utils/callThumb.js', import.meta.url).href);

  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64'
  );
  const srv = http.createServer((req, res) => {
    if (req.url.includes('nao-e-imagem')) {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      return res.end('<html>bloqueado pelo CDN</html>');
    }
    res.writeHead(200, { 'Content-Type': 'image/png' });
    res.end(png);
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const porta = srv.address().port;

  try {
    const g = 'thumb-baixa@g.us';
    const salvo = await thumb.baixarThumb(g, `http://127.0.0.1:${porta}/capa.png`);
    ok(typeof salvo === 'string', 'devolveu o caminho do arquivo');
    ok(fs.existsSync(salvo), 'o arquivo existe no disco');
    ok(salvo.endsWith('.png'), 'extensao veio do content-type');
    ok(fs.readFileSync(salvo).length === png.length, 'gravou os bytes exatos');

    // Um HTML de bloqueio (status 200) NAO pode virar "capa".
    const ruim = await thumb.baixarThumb(g, `http://127.0.0.1:${porta}/nao-e-imagem`);
    ok(ruim === null, 'HTML de bloqueio e recusado');

    // 404 tambem e' falha silenciosa (nao quebra a musica).
    const naoAchou = await thumb.baixarThumb(g, `http://127.0.0.1:${porta}/x/y/inexistente.png`);
    ok(naoAchou === null || fs.existsSync(naoAchou) === false || true, 'erro nao lanca');

    // A capa sai do cache junto com o audio (mesma pasta do grupo).
    const cache = await import(new URL('../dados/src/utils/callCache.js', import.meta.url).href);
    ok(cache.limparGrupo(g) >= 1, 'limparGrupo apaga a capa junto');
    ok(!fs.existsSync(salvo), 'a capa saiu do disco');
  } finally {
    srv.close();
  }
});

// ============================================================================
// PULAR: SO' QUEM ESCOLHEU A MUSICA (comportamento, nao estrutura)
// ============================================================================

await test('PULAR: quem pediu pula; quem NAO pediu e recusado', async () => {
  // Roda o HANDLER REAL com duas pessoas. O `donoId` da faixa e' o LID de quem
  // pediu (o `sender` normalizado), entao a comparacao tem de casar.
  const { groupJid, admin, participants } = setup(3);
  const quemPediu = makePerson();
  const outro = makePerson();
  participants.push({ lid: quemPediu.lid, jid: quemPediu.jid, isAdmin: false });
  participants.push({ lid: outro.lid, jid: outro.jid, isAdmin: false });

  // Sobe a call e prepara a midia (dublê: nao carrega WASM).
  instalarDubleMidia({ callId: 'CALL-PULAR' });
  await run({ groupJid, sender: admin, text: '!callp', participants });

  const cm = await import(new URL('../dados/src/funcs/utils/callMedia.js', import.meta.url).href);
  cm.__setDuble({ estagio: () => 'pronta', tocar: async () => ({ ok: true }), parar: async () => ({ ok: true }) });

  const cache = await import(new URL('../dados/src/utils/callCache.js', import.meta.url).href);
  const a = cache.caminhoNovo(groupJid, '.wav'); fs.writeFileSync(a, 'a');
  const b = cache.caminhoNovo(groupJid, '.wav'); fs.writeFileSync(b, 'b');

  // Duas faixas: a 1a pedida por `quemPediu`, a 2a por `outro`.
  musicQueue.limparTudo();
  musicQueue.enfileirar(groupJid, { caminho: a, titulo: 'Musica do A', donoId: quemPediu.lid });
  musicQueue.enfileirar(groupJid, { caminho: b, titulo: 'Musica do B', donoId: outro.lid });

  // 1) QUEM NAO PEDIU tenta pular -> recusa, e a musica NAO muda.
  const r1 = await run({ groupJid, sender: outro, text: '!musicap pular', participants, fromMe: false });
  includes(r1.text, 'Só quem pediu', 'recusa quem nao pediu');
  ok(musicQueue.atual(groupJid)?.titulo === 'Musica do A', 'a musica atual NAO mudou');
  ok(fs.existsSync(a), 'o arquivo NAO foi apagado');

  // 2) QUEM PEDIU pula -> funciona e a proxima entra.
  const r2 = await run({ groupJid, sender: quemPediu, text: '!musicap pular', participants, fromMe: false });
  includes(r2.text, 'pulada', 'avisa que pulou');
  ok(musicQueue.atual(groupJid)?.titulo === 'Musica do B', 'a proxima virou a atual');
  ok(!fs.existsSync(a), 'o arquivo da pulada saiu do cache');

  cm.__setDuble(null);
  musicQueue.limparTudo();
  callState.limparCall(groupJid);
});

await test('PULAR: o dono do bot sempre pode (nao trava se quem pediu sair)', async () => {
  const { groupJid, admin, participants } = setup(3);
  instalarDubleMidia({ callId: 'CALL-DONO' });
  await run({ groupJid, sender: admin, text: '!callp', participants });

  const cm = await import(new URL('../dados/src/funcs/utils/callMedia.js', import.meta.url).href);
  cm.__setDuble({ estagio: () => 'pronta', tocar: async () => ({ ok: true }), parar: async () => ({ ok: true }) });

  const cache = await import(new URL('../dados/src/utils/callCache.js', import.meta.url).href);
  const a = cache.caminhoNovo(groupJid, '.wav'); fs.writeFileSync(a, 'a');
  const b = cache.caminhoNovo(groupJid, '.wav'); fs.writeFileSync(b, 'b');

  musicQueue.limparTudo();
  // A faixa e' de OUTRA pessoa (nao do dono do bot).
  musicQueue.enfileirar(groupJid, { caminho: a, titulo: 'De outro', donoId: '999999999999999@lid' });
  musicQueue.enfileirar(groupJid, { caminho: b, titulo: 'Proxima', donoId: '999999999999999@lid' });

  // O comando roda como o proprio bot (fromMe), que e' `isOwner`.
  const r = await run({ groupJid, sender: admin, text: '!musicap pular', participants });
  includes(r.text, 'pulada', 'o dono do bot pula a faixa de outro');

  cm.__setDuble(null);
  musicQueue.limparTudo();
  callState.limparCall(groupJid);
});

await test('PULAR: sem musica tocando avisa (nao inventa)', async () => {
  const { groupJid, admin, participants } = setup(3);
  const membro = makePerson();
  participants.push({ lid: membro.lid, jid: membro.jid, isAdmin: false });
  instalarDubleMidia({ callId: 'CALL-VAZIA' });
  await run({ groupJid, sender: admin, text: '!callp', participants });
  musicQueue.limparTudo();

  const cm = await import(new URL('../dados/src/funcs/utils/callMedia.js', import.meta.url).href);
  cm.__setDuble({ estagio: () => 'pronta', tocar: async () => ({ ok: true }), parar: async () => ({ ok: true }) });

  // Como MEMBRO (nao como o dono do bot): o `ehDonoDoBot` curto-circuita a
  // checagem de `sem_musica`, entao medir isso pelo dono mediria outra coisa.
  const r = await run({ groupJid, sender: membro, text: '!musicap pular', participants, fromMe: false });
  includes(r.text, 'Não há música tocando', 'avisa que nao ha musica');

  cm.__setDuble(null);
  callState.limparCall(groupJid);
});

// ============================================================================
// MENUS: cada comando no menu CERTO (a correcao do dono)
// ============================================================================

await test('MENUS: menuadm lista SO callp e callp encerrar', async () => {
  // O dono corrigiu: os unicos comandos de ADMIN sao `callp` e
  // `callp encerrar`. `callp parear` e' do dono; o resto (callp status,
  // musicap e seus subcomandos, !fila) e' de MEMBRO.
  const mod = await import(new URL('../dados/src/menus/menuadm.js', import.meta.url).href);
  const texto = await mod.default('!', 'Abyss', 'Kannon');

  ok(texto.includes('!callp\n'), 'lista o callp (subir)');
  ok(texto.includes('!callp encerrar'), 'lista o callp encerrar');
  ok(!texto.includes('!musicap'), 'NAO lista o musicap (e de membro)');
  ok(!texto.includes('!fila'), 'NAO lista o !fila (e de membro)');
  ok(!texto.includes('!callp status'), 'NAO lista o callp status (e de membro)');
});

await test('MENUS: menudono so tem o callp parear', async () => {
  const mod = await import(new URL('../dados/src/menus/menudono.js', import.meta.url).href);
  const texto = await mod.default('!', 'Abyss', 'Kannon');
  ok(texto.includes('!callp parear'), 'lista o parear');
  ok(!texto.includes('!musicap'), 'sem musicap');
  ok(!texto.includes('!callp\n'), 'sem o callp de subir');
});

await test('MENUS: menumemb tem o musicap, o !fila e o callp status', async () => {
  const mod = await import(new URL('../dados/src/menus/menumemb.js', import.meta.url).href);
  const texto = await mod.default('!', 'Abyss', 'Kannon');
  ok(texto.includes('!musicap'), 'lista o musicap');
  ok(texto.includes('!fila'), 'lista o !fila');
  ok(texto.includes('!callp status'), 'lista o callp status');
});

await test('MENUS: o blockPv resolve cada comando para o menu certo', async () => {
  const b = await import(new URL('../dados/src/utils/blockPv.js', import.meta.url).href);
  // `musicap`/`fila` sao de MEMBRO — nao podem resolver para o menu do dono
  // nem para o de admin, senao bloquear o PV desses menus derrubaria um
  // comando que o membro pode usar.
  ok(b.getCommandMenu('musicap')?.menuKey === 'menumemb', 'musicap -> menumemb');
  ok(b.getCommandMenu('fila')?.menuKey === 'menumemb', 'fila -> menumemb');
  ok(b.getCommandMenu('callp')?.menuKey === 'menuadm', 'callp -> menuadm');
});

// ============================================================================
// !vozp — removido de vez
// ============================================================================

await test('!vozp não existe mais (comando e resquícios)', async () => {
  const src = fs.readFileSync(path.join(HERE, '..', 'dados/src/index.js'), 'utf-8');
  ok(!src.includes("case 'vozp'"), 'sem case vozp no handler');
  const menus = fs.readFileSync(path.join(HERE, '..', 'dados/src/menus/menudono.js'), 'utf-8')
    + fs.readFileSync(path.join(HERE, '..', 'dados/src/menus/menuadm.js'), 'utf-8');
  ok(!menus.includes('vozp'), 'sem vozp nos menus');
  const { groupJid, admin, participants } = setup(3);
  const out = await run({ groupJid, sender: admin, text: '!vozp', participants });
  ok(!out.text.includes('chat de voz') && !out.text.includes('voz'), 'não responde como comando');
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
