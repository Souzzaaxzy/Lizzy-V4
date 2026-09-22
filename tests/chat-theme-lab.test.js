/**
 * Testes do laboratório experimental `!tema` (chat theme / wallpaper).
 *
 * O que estes testes provam — e o que NÃO provam:
 *   - prova: a INTERPRETAÇÃO dos argumentos, o payload montado (campos e
 *     variante do oneof), o timestamp injetado, o fail-closed em entradas
 *     inválidas, e que o handler chama a via de envio da fork.
 *   - NÃO prova: efeito visual no cliente. Nada aqui afirma "tema alterado".
 *     O teste do HANDLER usa socket falso, então mede a forma que o comando
 *     monta — que é justamente o que a classificação final deixa em aberto.
 *
 * Uso: node tests/chat-theme-lab.test.js
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const TMP_DB = fs.mkdtempSync(path.join(os.tmpdir(), 'lizzy-tema-db-'));
process.env.DATABASE_PATH = TMP_DB;
fs.mkdirSync(path.join(TMP_DB, 'grupos'), { recursive: true });

// ── Mini harness (mesmo estilo das outras suítes do projeto) ──────────────
const RESULTADOS = [];
let ATUAL = null;
function test(name, fn) {
  ATUAL = { name, passed: 0, failed: 0, errors: [] };
  RESULTADOS.push(ATUAL);
  const done = (error) => {
    if (error) { ATUAL.failed += 1; ATUAL.errors.push(`EXCEÇÃO: ${error?.stack || error}`); }
    console.log(`${ATUAL.failed === 0 ? '✅' : '❌'} ${name} (${ATUAL.passed} ok, ${ATUAL.failed} falhas)`);
    for (const e of ATUAL.errors) console.log(`     ${e.split('\n')[0]}`);
  };
  try {
    const r = fn();
    if (r && typeof r.then === 'function') return r.then(() => done()).catch(done);
    done();
  } catch (e) { done(e); }
  return Promise.resolve();
}
function ok(cond, msg) {
  if (cond) ATUAL.passed += 1;
  else { ATUAL.failed += 1; ATUAL.errors.push(`ASSERT FALHOU: ${msg}`); }
}
const includes = (h, n, l) => ok(typeof h === 'string' && h.includes(n), `${l ?? n} — esperado conter "${n}"`);
const notIncludes = (h, n, l) => ok(typeof h === 'string' && !h.includes(n), `${l ?? n} — NÃO deveria conter "${n}"`);

function textoDoEnvio(c) {
  if (!c || typeof c !== 'object') return '';
  const partes = [];
  for (const k of ['text', 'caption']) if (typeof c[k] === 'string') partes.push(c[k]);
  return partes.join('\n');
}

// ── Módulos sob teste ─────────────────────────────────────────────────────
const lab = await import(new URL('../dados/src/utils/chatThemeLab.js', import.meta.url).href);
const { default: handleMessage } = await import(new URL('../dados/src/index.js', import.meta.url).href);

const DONO = '5511999999999@s.whatsapp.net';
const DONO_LID = '111000000000001@lid';

// ============================================================================
// 1) PARSER — argumentos -> campos do ChatThemeSetting
// ============================================================================

await test('parse: cada acao vira a variante correta', () => {
  const t = lab.parseTemaArgs(['teste']);
  ok(t.ok && t.variant === 'defaultWallpaper', 'teste -> defaultWallpaper');
  ok(t.input.wallpaper.defaultWallpaper && Object.keys(t.input.wallpaper).length === 1, 'uma unica variante');

  const s = lab.parseTemaArgs(['stock', 'wall-1', '0.25']);
  ok(s.ok && s.variant === 'stockImage', 'stock -> stockImage');
  ok(s.input.wallpaper.stockImage.stockImageId === 'wall-1', 'id preservado');
  ok(s.input.wallpaper.stockImage.dimLevel === 0.25, 'dim numerico');

  const a = lab.parseTemaArgs(['animated', 'wall-9', '0.3']);
  ok(a.ok && a.variant === 'animatedWallpaper', 'animated -> animatedWallpaper');
  ok(a.input.wallpaper.animatedWallpaper.animatedWallpaperId === 'wall-9', 'id do animated');

  const c = lab.parseTemaArgs(['color', '#FFFFFFFF', '#FF000000']);
  ok(c.ok && c.variant === 'solidColor', 'color -> solidColor');
  ok(c.input.wallpaper.solidColor.colorLight === '#FFFFFFFF', 'cor clara');
  ok(c.input.wallpaper.solidColor.colorDark === '#FF000000', 'cor escura');

  const sc = lab.parseTemaArgs(['scheme', 'Tonal']);
  ok(sc.ok && sc.input.colorSchemeId === 'Tonal', 'scheme -> colorSchemeId');
  ok(sc.variant === null, 'sem variante de wallpaper');

  const r = lab.parseTemaArgs(['reset']);
  ok(r.ok && r.input.clearTheme === true, 'reset -> clearTheme');
  ok(r.variant === null, 'reset nao tem variante');
});

await test('parse: sem argumento assume "teste" (nao explode)', () => {
  const t = lab.parseTemaArgs([]);
  ok(t.ok && t.variant === 'defaultWallpaper', 'default e teste');
});

await test('parse: entradas invalidas falham fechado (sem payload)', () => {
  for (const ruim of [['stock'], ['animated'], ['color', '#fff'], ['scheme'], ['xyz'], ['stock', 'id', 'nao-numero']]) {
    const r = lab.parseTemaArgs(ruim);
    ok(r.ok === false && typeof r.reason === 'string', `recusado: ${JSON.stringify(ruim)}`);
  }
});

await test('parse: dim opcional e 0 e um valor VALIDO', () => {
  const semDim = lab.parseTemaArgs(['stock', 'w']);
  ok(semDim.input.wallpaper.stockImage.dimLevel === undefined, 'sem dim nao inventa campo');
  const comZero = lab.parseTemaArgs(['stock', 'w', '0']);
  ok(comZero.input.wallpaper.stockImage.dimLevel === 0, 'dim 0 e preservado (nao descartado)');
});

// ============================================================================
// 2) runTemaTest — envio via sender injetado (sem socket)
// ============================================================================

await test('run: monta o payload e chama a via da fork', async () => {
  const chamadas = [];
  const sendChatTheme = async (opts) => {
    chamadas.push(opts);
    return { ok: true, messageId: 'ID-1', variant: 'stockImage' };
  };
  const r = await lab.runTemaTest({
    sendChatTheme, jid: '123@g.us', args: ['stock', 'wall-1', '0.5'], now: () => 1757900000000
  });
  ok(r.ok === true, 'sucesso');
  ok(chamadas.length === 1, 'chamou exatamente UMA vez (um teste por execucao)');
  const c = chamadas[0];
  ok(c.jid === '123@g.us', 'jid repassado');
  ok(c.wallpaper?.stockImage?.stockImageId === 'wall-1', 'payload correto');
  ok(c.settingTimestampMs === 1757900000000, 'timestamp injetado');
  includes(r.text, 'CHAT THEME LAB', 'cabecalho');
  includes(r.text, 'stockImage wall-1', 'rotulo da variante');
  includes(r.text, '1757900000000', 'timestamp no relatorio');
});

await test('run: NAO promete efeito visual', async () => {
  const sendChatTheme = async () => ({ ok: true, messageId: 'X', variant: null });
  const r = await lab.runTemaTest({ sendChatTheme, jid: '123@g.us', args: ['teste'], now: () => 1 });
  notIncludes(r.text, 'tema alterado', 'nao afirma alteracao');
  notIncludes(r.text, 'sucesso', 'nao usa a palavra sucesso');
  includes(r.text, 'NAO confirma', 'diz que nao confirma');
  includes(r.text, 'aceito e ignorado', 'cita o caso aceito-e-ignorado');
});

await test('run: fork sem sendChatTheme nao quebra (erro claro)', async () => {
  const r = await lab.runTemaTest({ sendChatTheme: undefined, jid: '123@g.us', args: ['teste'], now: () => 1 });
  ok(r.ok === false && r.reason === 'sem_suporte', 'detecta falta de suporte');
  includes(r.text, 'sendChatTheme', 'diz o que falta');
});

await test('run: erro de transporte e reportado, nao engolido', async () => {
  const sendChatTheme = async () => { throw new Error('relay morreu'); };
  const r = await lab.runTemaTest({ sendChatTheme, jid: '123@g.us', args: ['teste'], now: () => 1 });
  ok(r.ok === false && r.reason === 'excecao', 'captura a excecao');
  includes(r.text, 'relay morreu', 'mostra a causa');
});

await test('run: recusa do sender vira mensagem, nao crash', async () => {
  const sendChatTheme = async () => ({ ok: false, reason: 'payload_invalido', error: 'oneof' });
  const r = await lab.runTemaTest({ sendChatTheme, jid: '123@g.us', args: ['teste'], now: () => 1 });
  ok(r.ok === false && r.reason === 'payload_invalido', 'repassa o motivo');
  includes(r.text, 'nao saiu', 'avisa que nao saiu');
});

await test('run: args invalidos mostram a USAGE, sem chamar o sender', async () => {
  let chamou = false;
  const sendChatTheme = async () => { chamou = true; return { ok: true }; };
  const r = await lab.runTemaTest({ sendChatTheme, jid: '123@g.us', args: ['stock'], now: () => 1 });
  ok(r.ok === false && chamou === false, 'nao chamou nada');
  includes(r.text, 'CHAT THEME LAB', 'mostra a usage');
});

// ============================================================================
// 3) HANDLER REAL — !tema com socket falso
// ============================================================================

function makeNazu({ sent, groupJid, suportaTema = true }) {
  const nazu = {
    sendMessage: async (jid, content, options) => {
      sent.push({ jid, content, options });
      return { key: { id: `SENT-${sent.length}` } };
    },
    user: { id: `${DONO.split('@')[0]}:5@s.whatsapp.net`, lid: DONO_LID, name: 'Lizzy' },
    onWhatsApp: async (jid) => [{ jid, exists: true, lid: jid.replace('@s.whatsapp.net', '@lid') }],
    signalRepository: { lidMapping: { getPNForLID: async () => null } },
    groupMetadata: async () => ({
      id: groupJid, subject: 'G',
      participants: [{ id: DONO_LID, lid: DONO_LID, phoneNumber: DONO, admin: 'admin' }],
    }),
    groupParticipantsUpdate: async () => ({}),
    groupRequestParticipantsList: async () => [],
    groupRequestParticipantsUpdate: async () => ({}),
    ev: { on: () => {}, emit: () => {}, removeAllListeners: () => {} },
    readMessages: async () => {},
    sendPresenceUpdate: async () => {},
    profilePictureUrl: async () => 'x',
    react: async () => ({}),
  };
  if (suportaTema) {
    nazu.chamadasTema = [];
    nazu.sendChatTheme = async (opts) => {
      nazu.chamadasTema.push(opts);
      return { ok: true, messageId: `TEMA-${nazu.chamadasTema.length}`, variant: opts.wallpaper ? Object.keys(opts.wallpaper)[0] : null };
    };
  }
  return nazu;
}

let grupoSeq = 0;
const fazerGrupo = () => {
  grupoSeq += 1;
  const jid = `1203637000000${String(grupoSeq).padStart(5, '0')}@g.us`;
  fs.writeFileSync(path.join(TMP_DB, 'grupos', `${jid}.json`), JSON.stringify({ groupName: 'G' }));
  return jid;
};

/** Roda como o DONO (fromMe) — o comando exige dono. */
async function rodar(text, { suportaTema = true } = {}) {
  const groupJid = fazerGrupo();
  const sent = [];
  const nazu = makeNazu({ sent, groupJid, suportaTema });
  await handleMessage(nazu, {
    key: { remoteJid: groupJid, fromMe: true, id: `M-${Math.random().toString(36).slice(2, 9)}`, participant: DONO },
    message: { extendedTextMessage: { text, contextInfo: { remoteJid: groupJid } } },
    messageTimestamp: 1757900000,
    pushName: 'Dono',
  }, null, new Map(), null);
  const texto = sent.map((s) => textoDoEnvio(s.content)).filter(Boolean).join('\n');
  return { sent, texto, nazu };
}

await test('handler: !tema stock envia o payload pela via da fork', async () => {
  const r = await rodar('!tema stock wall-1 0.5');
  ok(r.nazu.chamadasTema.length === 1, 'chamou sendChatTheme uma vez');
  ok(r.nazu.chamadasTema[0].wallpaper.stockImage.stockImageId === 'wall-1', 'payload correto');
  includes(r.texto, 'CHAT THEME LAB', 'responde com o relatorio');
  includes(r.texto, 'stockImage wall-1', 'variante no relatorio');
});

await test('handler: !tema sem argumento faz o teste default', async () => {
  const r = await rodar('!tema');
  ok(r.nazu.chamadasTema.length === 1, 'chamou uma vez');
  ok(r.nazu.chamadasTema[0].wallpaper.defaultWallpaper, 'defaultWallpaper');
});

await test('handler: !tema args invalidos NAO chama o sender', async () => {
  const r = await rodar('!tema stock');
  ok(r.nazu.chamadasTema.length === 0, 'nada enviado');
  includes(r.texto, 'CHAT THEME LAB', 'explica o uso');
});

await test('handler: NÃO-dono e barrado', async () => {
  const groupJid = fazerGrupo();
  const sent = [];
  const intruso = '333000000000009@lid';
  const nazu = makeNazu({ sent, groupJid });
  nazu.groupMetadata = async () => ({
    id: groupJid, subject: 'G',
    participants: [
      { id: DONO_LID, lid: DONO_LID, phoneNumber: DONO, admin: 'admin' },
      { id: intruso, lid: intruso, phoneNumber: '5511888888888@s.whatsapp.net', admin: null },
    ],
  });
  await handleMessage(nazu, {
    key: { remoteJid: groupJid, fromMe: false, id: `M-${Math.random().toString(36).slice(2, 9)}`, participant: intruso },
    message: { extendedTextMessage: { text: '!tema stock x' } },
    messageTimestamp: 1757900000,
    pushName: 'Intruso',
  }, null, new Map(), null);
  const texto = sent.map((s) => textoDoEnvio(s.content)).filter(Boolean).join('\n');
  ok(nazu.chamadasTema.length === 0, 'nao disparou o laboratorio');
  includes(texto, 'permissão', 'avisa a falta de permissao');
});

await test('handler: fork sem sendChatTheme responde erro claro (nao crasha)', async () => {
  const r = await rodar('!tema stock w', { suportaTema: false });
  includes(r.texto, 'sendChatTheme', 'aponta o que falta');
  includes(r.texto, 'Atualize a fork', 'diz o que fazer');
});

// ============================================================================
// Resumo
// ============================================================================
const totalOk = RESULTADOS.reduce((a, r) => a + r.passed, 0);
const totalFail = RESULTADOS.reduce((a, r) => a + r.failed, 0);
console.log(`\n${'='.repeat(60)}`);
console.log(`Testes: ${RESULTADOS.length}  |  Asserções OK: ${totalOk}  |  Falhas: ${totalFail}`);
console.log('='.repeat(60));
try { fs.rmSync(TMP_DB, { recursive: true, force: true }); } catch { /* ignore */ }
process.exit(totalFail === 0 ? 0 : 1);
