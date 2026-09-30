/**
 * Testes dos comandos novos de BRINCADEIRAS do `menubn`:
 *   - `!aura` / `!sigma`  — meme de "farmar aura": frase sorteada + GIF do `!setgif`;
 *   - `!hetero` / `!hetera` — mesma logica da familia do `!gay` (porcentagem);
 *   - `!ceu` / `!inferno` / `!frio` / `!fria` — sorteio com base fixa + incremento.
 *
 * Roda o handler real (NazuninhaBotExec) com um socket Baileys falso e um
 * `DATABASE_PATH` temporario: NAO toca o `dados/database` real.
 *
 * Uso: node tests/brincadeiras-novas.test.js
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.resolve(HERE, '..');

const TMP_DB = fs.mkdtempSync(path.join(os.tmpdir(), 'lizzy-novas-db-'));
process.env.DATABASE_PATH = TMP_DB;
fs.mkdirSync(path.join(TMP_DB, 'grupos'), { recursive: true });

const RESULTS = [];
let CURRENT = null;

function test(name, fn) {
  CURRENT = { name, passed: 0, failed: 0, errors: [] };
  RESULTS.push(CURRENT);
  try {
    const result = fn();
    if (result && typeof result.then === 'function') {
      return result.then(() => finish(name)).catch((error) => {
        CURRENT.failed += 1;
        CURRENT.errors.push(`EXCEÇÃO: ${error?.stack || error}`);
        finish(name);
      });
    }
    finish(name);
  } catch (error) {
    CURRENT.failed += 1;
    CURRENT.errors.push(`EXCEÇÃO: ${error?.stack || error}`);
    finish(name);
  }
  return Promise.resolve();
}

function finish(name) {
  console.log(`${CURRENT.failed === 0 ? '✅' : '❌'} ${name} (${CURRENT.passed} ok, ${CURRENT.failed} falhas)`);
  for (const err of CURRENT.errors) console.log(`     ${err.split('\n')[0]}`);
}

function ok(condition, message) {
  if (condition) CURRENT.passed += 1;
  else {
    CURRENT.failed += 1;
    CURRENT.errors.push(`ASSERT FALHOU: ${message}`);
  }
}

function includes(haystack, needle, label) {
  ok(typeof haystack === 'string' && haystack.includes(needle), `${label ?? needle} — esperado conter "${needle}"`);
}

function notIncludes(haystack, needle, label) {
  ok(typeof haystack === 'string' && !haystack.includes(needle), `${label ?? needle} — não deveria conter "${needle}"`);
}

// ============================================================================
// MODULOS
// ============================================================================

const gifsbn = await import(new URL('../dados/src/funcs/utils/gifsbn.js', import.meta.url).href);
const indexModule = await import(new URL('../dados/src/index.js', import.meta.url).href);
const handleMessage = indexModule.default ?? indexModule;
if (typeof handleMessage !== 'function') throw new Error('index.js não exporta o handler');

const GIFSBN_DIR = gifsbn.GIFSBN_DIR;
const GIF_1PX = Buffer.from(
  '47494638396101000100800000000000ffffff21f90401000000002c00000000010001000002024401003b',
  'hex'
);

const criados = [];
function criarMidia(nome, ext, conteudo = GIF_1PX) {
  fs.mkdirSync(GIFSBN_DIR, { recursive: true });
  const file = path.join(GIFSBN_DIR, `${nome}.${ext}`);
  fs.writeFileSync(file, conteudo);
  criados.push(file);
  return file;
}

// ============================================================================
// FIXTURES DO HANDLER
// ============================================================================

const BOT_JID = '5599999999999@s.whatsapp.net';
const BOT_LID = '111111111111111@lid';

let groupCounter = 0;
let authorCounter = 0;

function makeGroup() {
  groupCounter += 1;
  const jid = `1203637000000000${String(groupCounter).padStart(3, '0')}@g.us`;
  fs.writeFileSync(
    path.join(TMP_DB, 'grupos', `${jid}.json`),
    JSON.stringify({ modobrincadeira: true, groupName: 'Grupo Novas' }, null, 2)
  );
  return jid;
}

function makeNazu({ sent, groupJid, authorLid, authorJid, targetLid, targetJid }) {
  return {
    sendMessage: async (jid, content, options) => {
      sent.push({ jid, content, options });
      return { key: { id: 'SENT' } };
    },
    user: { id: `${BOT_JID.split('@')[0]}:5@s.whatsapp.net`, lid: BOT_LID, name: 'Lizzy' },
    onWhatsApp: async (jid) => {
      const map = { [authorJid]: authorLid, [targetJid]: targetLid, [BOT_JID]: BOT_LID };
      const lid = map[jid];
      return lid ? [{ jid, exists: true, lid }] : [{ jid, exists: false }];
    },
    signalRepository: {
      lidMapping: {
        getPNForLID: async (lid) => ({
          [authorLid]: authorJid,
          [targetLid]: targetJid,
          [BOT_LID]: BOT_JID,
        }[lid] || null),
      },
    },
    groupMetadata: async () => ({
      id: groupJid,
      subject: 'Grupo Novas',
      participants: [
        { id: authorLid, admin: 'admin', phoneNumber: authorJid },
        { id: targetLid, admin: null, phoneNumber: targetJid },
        { id: BOT_LID, admin: 'admin', phoneNumber: BOT_JID },
      ],
    }),
    groupParticipantsUpdate: async () => ({}),
    groupRequestParticipantsList: async () => [],
    groupRequestParticipantsUpdate: async () => ({}),
    ev: { on: () => {}, emit: () => {}, removeAllListeners: () => {} },
    readMessages: async () => {},
    sendPresenceUpdate: async () => {},
    profilePictureUrl: async () => 'https://example.com/pic.jpg',
    react: async () => ({}),
  };
}

/** Executa o comando no handler real, com alvo marcado. */
async function runCommand(command, { withTarget = true, groupJid = makeGroup() } = {}) {
  const sent = [];
  authorCounter += 1;
  const authorLid = `77${String(authorCounter).padStart(6, '0')}000@lid`;
  const authorJid = `5577${String(authorCounter).padStart(6, '0')}111@s.whatsapp.net`;
  const targetLid = '777000999888@lid';
  const targetJid = '557799998888@s.whatsapp.net';

  const nazu = makeNazu({ sent, groupJid, authorLid, authorJid, targetLid, targetJid });

  const contextInfo = { remoteJid: groupJid };
  if (withTarget) {
    contextInfo.mentionedJid = [targetJid];
    contextInfo.participant = targetJid;
  }

  const info = {
    key: { remoteJid: groupJid, fromMe: false, id: `NOVAS-${command}-${authorCounter}`, participant: authorLid },
    message: { extendedTextMessage: { text: `!${command}`, contextInfo } },
    messageTimestamp: 1757900000,
    pushName: 'Autor',
  };

  await handleMessage(nazu, info, null, new Map(), null);

  const text = sent.map((s) => s.content?.text ?? s.content?.caption ?? '').filter(Boolean).join('\n');
  const mediaMsg = sent.find((s) => s.content?.video || s.content?.image) || null;
  const allMentions = sent.flatMap((s) => s.content?.mentions || s.options?.mentions || []);
  return { sent, text, mediaMsg, allMentions, targetLid, targetJid };
}

/** Extrai a porcentagem do texto (formato "... *NN%*" ou "[barra] NN%"). */
function extrairPorcentagem(text) {
  const m = /(\d{1,3})%/.exec(text);
  return m ? Number(m[1]) : null;
}

// ============================================================================
// 1) !aura / !sigma
// ============================================================================

for (const cmd of ['aura', 'sigma']) {
  await test(`!${cmd}: responde com frase e menção real (sem mídia)`, async () => {
    const run = await runCommand(cmd);
    ok(run.sent.length >= 1, 'enviou resposta');
    ok(run.text.length > 0, 'tem texto');
    notIncludes(run.text, 'undefined', 'sem undefined');
    notIncludes(run.text, 'null', 'sem null');
    notIncludes(run.text, 'NaN', 'sem NaN');
    ok(run.allMentions.includes(run.targetJid) || run.allMentions.includes(run.targetLid),
      `alvo presente nas mentions: ${JSON.stringify(run.allMentions)}`);
    includes(run.text, `@${run.targetLid.split('@')[0]}`, 'texto menciona o alvo');
  });
}

await test('!aura: usa gifsbn/aura.gif (frase como legenda + gifPlayback)', async () => {
  criarMidia('aura', 'gif');
  const run = await runCommand('aura');
  ok(Boolean(run.mediaMsg), 'enviou mídia');
  ok(Boolean(run.mediaMsg?.content?.video), 'enviada como vídeo/GIF');
  ok(run.mediaMsg?.content?.gifPlayback === true, 'gifPlayback ativo');
  ok((run.mediaMsg?.content?.caption || '').length > 0, 'frase foi na legenda');
});

await test('!sigma: usa gifsbn/sigma.jpg (imagem)', async () => {
  criarMidia('sigma', 'jpg', Buffer.from('fake-jpg'));
  const run = await runCommand('sigma');
  ok(Boolean(run.mediaMsg?.content?.image), 'enviou a imagem');
  ok((run.mediaMsg?.content?.caption || '').length > 0, 'frase foi na legenda');
});

await test('!aura: fora de grupo é recusado', async () => {
  const sent = [];
  const nazu = makeNazu({ sent, groupJid: 'x@g.us', authorLid: '1@lid', authorJid: '1@s.whatsapp.net', targetLid: '2@lid', targetJid: '2@s.whatsapp.net' });
  const info = {
    key: { remoteJid: '5511999998888@s.whatsapp.net', fromMe: false, id: 'PV-1', participant: '1@lid' },
    message: { extendedTextMessage: { text: '!aura', contextInfo: {} } },
    messageTimestamp: 1757900000,
    pushName: 'Autor',
  };
  await handleMessage(nazu, info, null, new Map(), null);
  const text = sent.map((s) => s.content?.text ?? s.content?.caption ?? '').join('\n');
  includes(text, 'grupos', 'avisa que é só para grupos');
});

// ============================================================================
// 2) !hetero / !hetera
// ============================================================================

await test('!hetero: porcentagem 0-100 e menção', async () => {
  const run = await runCommand('hetero');
  const p = extrairPorcentagem(run.text);
  ok(p !== null && p >= 0 && p <= 100, `porcentagem válida (${p})`);
  includes(run.text, 'hétero', 'rótulo hétero');
  ok(run.allMentions.includes(run.targetJid) || run.allMentions.includes(run.targetLid), 'menciona o alvo');
  notIncludes(run.text, 'undefined', 'sem undefined');
});

await test('!hetera: porcentagem 0-100 e menção', async () => {
  const run = await runCommand('hetera');
  const p = extrairPorcentagem(run.text);
  ok(p !== null && p >= 0 && p <= 100, `porcentagem válida (${p})`);
  includes(run.text, 'heterossexualidade', 'rótulo heterossexualidade');
  ok(run.allMentions.includes(run.targetJid) || run.allMentions.includes(run.targetLid), 'menciona o alvo');
  notIncludes(run.text, 'undefined', 'sem undefined');
});

// ============================================================================
// 3) !ceu / !inferno / !frio / !fria
// ============================================================================

await test('!ceu: base 50% (nunca abaixo disso) e menciona o alvo', async () => {
  for (let i = 0; i < 25; i++) {
    const run = await runCommand('ceu');
    const p = extrairPorcentagem(run.text);
    ok(p !== null && p >= 50 && p <= 100, `céu entre 50 e 100 (${p})`);
    if (i === 0) {
      includes(run.text, 'céu', 'fala do céu');
      ok(run.allMentions.includes(run.targetJid) || run.allMentions.includes(run.targetLid), 'menciona o alvo');
    }
  }
});

await test('!inferno: porcentagem 0-100 e menciona o alvo', async () => {
  for (let i = 0; i < 25; i++) {
    const run = await runCommand('inferno');
    const p = extrairPorcentagem(run.text);
    ok(p !== null && p >= 0 && p <= 100, `inferno entre 0 e 100 (${p})`);
    if (i === 0) includes(run.text, 'inferno', 'fala do inferno');
  }
});

for (const cmd of ['frio', 'fria']) {
  await test(`!${cmd}: nível de frieza 0-100 (base 0%) e menciona o alvo`, async () => {
    for (let i = 0; i < 25; i++) {
      const run = await runCommand(cmd);
      const p = extrairPorcentagem(run.text);
      ok(p !== null && p >= 0 && p <= 100, `frieza entre 0 e 100 (${p})`);
      if (i === 0) {
        includes(run.text, 'frieza', 'fala de frieza');
        ok(run.allMentions.includes(run.targetJid) || run.allMentions.includes(run.targetLid), 'menciona o alvo');
        notIncludes(run.text, 'undefined', 'sem undefined');
      }
    }
  });
}

await test('!frio: usa gifsbn/frio.gif quando definido', async () => {
  criarMidia('frio', 'gif');
  const run = await runCommand('frio');
  ok(Boolean(run.mediaMsg?.content?.video), 'enviou o GIF de frieza');
  ok(run.mediaMsg?.content?.gifPlayback === true, 'gifPlayback ativo');
  includes(run.mediaMsg?.content?.caption || '', 'frieza', 'legenda fala de frieza');
});

// ============================================================================
// 4) MENU / BLOCKPV / SETGIF
// ============================================================================

await test('menubn: os 8 comandos novos estão na categoria BRINCADEIRAS', async () => {
  const menus = await import(new URL('../dados/src/menus/menubn.js', import.meta.url).href);
  const layout = await import(new URL('../dados/src/menus/layout.js', import.meta.url).href);
  const texto = String(await menus.default('!', 'Lizzy', 'Tester', false));
  // O título da categoria vai em MATHEMATICAL BOLD ITALIC (layout do menubn).
  const idx = texto.indexOf(layout.boldItalic('BRINCADEIRAS'));
  ok(idx !== -1, 'categoria BRINCADEIRAS presente');
  const bloco = texto.slice(idx, texto.indexOf('╰', idx));
  for (const cmd of ['hetero', 'hetera', 'aura', 'sigma', 'ceu', 'inferno', 'frio', 'fria']) {
    includes(bloco, `!${cmd}`, `${cmd} na categoria BRINCADEIRAS`);
  }
  // Nao duplicado em outro lugar do menu.
  for (const cmd of ['aura', 'sigma', 'ceu', 'inferno', 'frio', 'fria', 'hetero', 'hetera']) {
    ok((texto.match(new RegExp(`!${cmd}\\b`, 'g')) || []).length === 1, `!${cmd} aparece uma única vez`);
  }
});

await test('blockPv: os 8 comandos novos estão registrados no menubn', async () => {
  const blockPv = await import(new URL('../dados/src/utils/blockPv.js', import.meta.url).href);
  const lista = blockPv.menuCommandsMap?.menubn?.commands || [];
  for (const cmd of ['hetero', 'hetera', 'aura', 'sigma', 'ceu', 'inferno', 'frio', 'fria']) {
    ok(lista.includes(cmd), `${cmd} registrado no menubn`);
  }
});

await test('!setgif aceita os comandos novos', () => {
  const src = fs.readFileSync(path.join(PROJECT, 'dados/src/index.js'), 'utf-8');
  const match = /const validCommands = \[([^\]]+)\];/.exec(src);
  ok(Boolean(match), 'lista de comandos válidos encontrada');
  for (const cmd of ['aura', 'sigma', 'ceu', 'inferno', 'frio', 'fria']) {
    includes(match[1], `'${cmd}'`, `setgif aceita ${cmd}`);
  }
});

// ============================================================================
// 5) PACOTE MEME (gírias geração Z)
// ============================================================================

const MEMES = ['rizz', 'delulu', 'brainrot', 'cringe', 'based', 'yap', 'glazing',
  'mogado', 'chad', 'beta', 'mewing', 'gyatt', 'skibidi', 'sixseven', 'ohio',
  'looksmaxxing', 'gag'];

for (const cmd of MEMES) {
  await test(`!${cmd}: frase + menção real (sem mídia)`, async () => {
    const run = await runCommand(cmd);
    ok(run.sent.length >= 1, 'enviou resposta');
    ok(run.text.length > 0, 'tem texto');
    notIncludes(run.text, 'undefined', 'sem undefined');
    notIncludes(run.text, 'null', 'sem null');
    notIncludes(run.text, 'NaN', 'sem NaN');
    ok(run.allMentions.includes(run.targetJid) || run.allMentions.includes(run.targetLid),
      `alvo presente nas mentions: ${JSON.stringify(run.allMentions)}`);
    includes(run.text, `@${run.targetLid.split('@')[0]}`, 'texto menciona o alvo');
  });
}

await test('!rizz: frases são sorteadas (não sai sempre a mesma)', async () => {
  const vistas = new Set();
  for (let i = 0; i < 30; i++) vistas.add((await runCommand('rizz')).text);
  ok(vistas.size >= 2, `frases variam (${vistas.size} distintas em 30)`);
});

await test('!delulu: usa gifsbn/delulu.gif quando definido', async () => {
  criarMidia('delulu', 'gif');
  const run = await runCommand('delulu');
  ok(Boolean(run.mediaMsg?.content?.video), 'enviou o GIF');
  ok(run.mediaMsg?.content?.gifPlayback === true, 'gifPlayback ativo');
  ok((run.mediaMsg?.content?.caption || '').length > 0, 'frase foi na legenda');
});

await test('!sixseven: usa gifsbn/sixseven.jpg (imagem)', async () => {
  criarMidia('sixseven', 'jpg', Buffer.from('fake-jpg'));
  const run = await runCommand('sixseven');
  ok(Boolean(run.mediaMsg?.content?.image), 'enviou a imagem');
  ok((run.mediaMsg?.content?.caption || '').length > 0, 'frase foi na legenda');
});

await test('!skibidi: fora de grupo é recusado', async () => {
  const sent = [];
  const nazu = makeNazu({ sent, groupJid: 'x@g.us', authorLid: '1@lid', authorJid: '1@s.whatsapp.net', targetLid: '2@lid', targetJid: '2@s.whatsapp.net' });
  const info = {
    key: { remoteJid: '5511999998888@s.whatsapp.net', fromMe: false, id: 'PV-MEME', participant: '1@lid' },
    message: { extendedTextMessage: { text: '!skibidi', contextInfo: {} } },
    messageTimestamp: 1757900000,
    pushName: 'Autor',
  };
  await handleMessage(nazu, info, null, new Map(), null);
  const text = sent.map((s) => s.content?.text ?? s.content?.caption ?? '').join('\n');
  includes(text, 'grupos', 'avisa que é só para grupos');
});

await test('menubn: os 17 memes estão na categoria BRINCADEIRAS', async () => {
  const menus = await import(new URL('../dados/src/menus/menubn.js', import.meta.url).href);
  const layout = await import(new URL('../dados/src/menus/layout.js', import.meta.url).href);
  const texto = String(await menus.default('!', 'Lizzy', 'Tester', false));
  const idx = texto.indexOf(layout.boldItalic('BRINCADEIRAS'));
  ok(idx !== -1, 'categoria BRINCADEIRAS presente');
  const bloco = texto.slice(idx, texto.indexOf('╰', idx));
  for (const cmd of MEMES) {
    includes(bloco, `!${cmd}`, `${cmd} na categoria BRINCADEIRAS`);
    ok((texto.match(new RegExp(`!${cmd}\\b`, 'g')) || []).length === 1, `!${cmd} aparece uma única vez`);
  }
});

await test('blockPv: os 17 memes estão registrados no menubn', async () => {
  const blockPv = await import(new URL('../dados/src/utils/blockPv.js', import.meta.url).href);
  const lista = blockPv.menuCommandsMap?.menubn?.commands || [];
  for (const cmd of MEMES) {
    ok(lista.includes(cmd), `${cmd} registrado no menubn`);
  }
});

await test('!setgif aceita os memes', () => {
  const src = fs.readFileSync(path.join(PROJECT, 'dados/src/index.js'), 'utf-8');
  const match = /const validCommands = \[([^\]]+)\];/.exec(src);
  ok(Boolean(match), 'lista de comandos válidos encontrada');
  for (const cmd of MEMES) {
    includes(match[1], `'${cmd}'`, `setgif aceita ${cmd}`);
  }
});

// ============================================================================

for (const f of criados) {
  try { fs.rmSync(f, { force: true }); } catch { /* já removido */ }
}

const totalOk = RESULTS.reduce((a, r) => a + r.passed, 0);
const totalFail = RESULTS.reduce((a, r) => a + r.failed, 0);
console.log('\n════════════════════════════════════════');
console.log(`RESULTADO: ${RESULTS.length} testes | ${totalOk} asserções ok | ${totalFail} falhas`);
console.log('════════════════════════════════════════');

fs.rmSync(TMP_DB, { recursive: true, force: true });

if (totalFail > 0) {
  console.log('\nFALHAS:');
  for (const r of RESULTS) if (r.failed) for (const e of r.errors) console.log(`- [${r.name}] ${e}`);
  process.exit(1);
}
console.log('✅ TODOS OS TESTES PASSARAM');
process.exit(0);
