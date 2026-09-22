/**
 * Testes do LAYOUT de envio do MENU (dados/src/index.js).
 *
 * Pedido do dono: o menu deve sair SEM citação (`quoted`) e COM o cabeçalho de
 * canal (newsletter) — o mesmo tratamento dado à resposta do prefixo.
 *
 * Roda o handler REAL com socket falso e `DATABASE_PATH`/`CONFIG_PATH`
 * temporários. Cobre o `!menu` (case 'menu') e o `sendMenuWithMedia` (usado por
 * todos os menus temáticos: alteradores, ia, logotipos, downloads, admin...).
 *
 * Uso: node tests/menu-layout.test.js
 */

import fs from 'fs';
import os from 'os';
import path from 'path';

const RESULTS = [];
let CURRENT = null;

function test(name, fn) {
  CURRENT = { name, passed: 0, failed: 0, errors: [] };
  RESULTS.push(CURRENT);
  try {
    const r = fn();
    if (r && typeof r.then === 'function') {
      return r.then(() => finish(name)).catch((e) => { CURRENT.failed += 1; CURRENT.errors.push(`EXCEÇÃO: ${e?.stack || e}`); finish(name); });
    }
    finish(name);
  } catch (e) {
    CURRENT.failed += 1;
    CURRENT.errors.push(`EXCEÇÃO: ${e?.stack || e}`);
    finish(name);
  }
  return Promise.resolve();
}
function finish(name) {
  console.log(`${CURRENT.failed === 0 ? '✅' : '❌'} ${name} (${CURRENT.passed} ok, ${CURRENT.failed} falhas)`);
  for (const e of CURRENT.errors) console.log(`     ${e.split('\n')[0]}`);
}
function ok(c, m) { if (c) CURRENT.passed += 1; else { CURRENT.failed += 1; CURRENT.errors.push(`ASSERT FALHOU: ${m}`); } }
function eq(a, b, m) { ok(a === b, `${m} — esperado ${JSON.stringify(b)}, veio ${JSON.stringify(a)}`); }
function contem(h, n, l) { ok(typeof h === 'string' && h.includes(n), `${l || n} — esperado conter "${n}"`); }

// ============================================================================
// CARGA DO HANDLER REAL
// ============================================================================

const TMP_DB = fs.mkdtempSync(path.join(os.tmpdir(), 'lizzy-menu-db-'));
process.env.DATABASE_PATH = TMP_DB;
process.env.CONFIG_PATH = path.join(TMP_DB, 'config.json');
fs.mkdirSync(path.join(TMP_DB, 'grupos'), { recursive: true });
fs.mkdirSync(path.join(TMP_DB, 'dono'), { recursive: true });
fs.writeFileSync(process.env.CONFIG_PATH, JSON.stringify({ prefixo: '!', nomebot: 'Abyss', nomedono: 'Dono', numerodono: '5511000000000', debug: false }, null, 2));

const indexModule = await import(new URL('../dados/src/index.js', import.meta.url).href);
const handleMessage = indexModule.default ?? indexModule;
if (typeof handleMessage !== 'function') throw new Error('index.js não exporta o handler');

// ============================================================================
// SOCKET FALSO
// ============================================================================

const BOT_JID = '5599999999999@s.whatsapp.net';
const BOT_LID = '111111111111111@lid';
const DONO = '5511000000000@s.whatsapp.net';

let groupCounter = 0;
const newGroupJid = () => { groupCounter += 1; return `1203638200000000${String(groupCounter).padStart(3, '0')}@g.us`; };

function makeNazu({ sent, groupJid }) {
  return {
    sendMessage: async (jid, content, options) => { sent.push({ jid, content, options }); return { key: { id: 'SENT' } }; },
    user: { id: `${BOT_JID.split('@')[0]}:5@s.whatsapp.net`, lid: BOT_LID, name: 'Abyss' },
    onWhatsApp: async (jid) => [{ jid, exists: true, lid: '999000000000001@lid' }],
    signalRepository: { lidMapping: { getPNForLID: async () => null } },
    groupMetadata: async () => ({
      id: groupJid, subject: 'Grupo Teste',
      participants: [
        { id: BOT_LID, admin: 'admin', phoneNumber: BOT_JID },
        { id: '5511000000000@lid', admin: 'admin', phoneNumber: DONO },
      ],
    }),
    groupParticipantsUpdate: async () => ({}),
    groupRequestParticipantsList: async () => [],
    groupRequestParticipantsUpdate: async () => ({}),
    ev: { on: () => {}, emit: () => {}, removeAllListeners: () => {} },
    readMessages: async () => {},
    sendPresenceUpdate: async () => {},
    profilePictureUrl: async () => null,
    react: async () => ({}),
  };
}

let n = 0;
/**
 * Executa um comando no handler real.
 * `fromMe: true` pula o throttle por remetente (o dono é o próprio bot aqui) —
 * sem isso o 4º comando responde "calma aí" e o teste mede a coisa errada.
 */
async function rodar(comando) {
  const sent = [];
  const groupJid = newGroupJid();
  const nazu = makeNazu({ sent, groupJid });
  n += 1;
  await handleMessage(nazu, {
    key: { remoteJid: groupJid, fromMe: true, id: `M${n}`, participant: '5511000000000@lid' },
    message: { extendedTextMessage: { text: comando } },
    messageTimestamp: 1757900000,
    pushName: 'Tester',
  }, null, new Map(), null);
  return { sent };
}

const temNewsletter = (content) => Boolean(content?.contextInfo?.forwardedNewsletterMessageInfo?.newsletterJid);

// ============================================================================
// TESTES
// ============================================================================

await test('1. !menu sai SEM citação (quoted) e COM newsletter', async () => {
  const { sent } = await rodar('!menu');
  ok(sent.length > 0, `enviou algo (${sent.length})`);
  ok(sent.every((x) => !x.options?.quoted), 'nenhuma mensagem cita o usuário');
  ok(sent.every((x) => temNewsletter(x.content)), 'todas têm cabeçalho de canal');
});

await test('2. !menu com mídia: a mídia também vai sem quoted e com newsletter', async () => {
  // `dados/midias/menu.jpg` é versionado, então o caminho de mídia é exercitado.
  const menuImg = new URL('../dados/midias/menu.jpg', import.meta.url);
  if (!fs.existsSync(menuImg)) { console.log('     ⏭  pulado (sem dados/midias/menu.jpg)'); eq(1, 1, 'pulado'); return; }
  const { sent } = await rodar('!menu');
  const comMidia = sent.find((x) => x.content?.image || x.content?.video);
  ok(comMidia, 'enviou o menu com mídia');
  ok(!comMidia.options?.quoted, 'a mídia não cita o usuário');
  ok(temNewsletter(comMidia.content), 'a mídia tem cabeçalho de canal');
});

await test('3. menus temáticos (sendMenuWithMedia) também: sem quoted + newsletter', async () => {
  for (const cmd of ['!menudono', '!menuadm', '!menumemb', '!menurpg', '!menudown', '!menulogos']) {
    const { sent } = await rodar(cmd);
    if (!sent.length) { console.log(`     ⏭  ${cmd}: não enviou (talvez sem permissão)`); continue; }
    ok(sent.every((x) => !x.options?.quoted), `${cmd}: sem quoted`);
    ok(sent.every((x) => temNewsletter(x.content)), `${cmd}: com newsletter`);
  }
});

await test('4. o CONTEÚDO do menu continua saindo (não quebrou no caminho)', async () => {
  const { sent } = await rodar('!menu');
  const texto = sent.map((x) => x.content?.text || x.content?.caption || '').join('\n');
  ok(texto.length > 0, 'tem conteúdo');
  contem(texto, 'Abyss', 'traz o nome do bot');
  // O menu tem o cabeçalho com saudação/cargo.
  contem(texto, 'Olá', 'traz a saudação');
});

await test('5. o newsletter traz o canal esperado (não é só um objeto vazio)', async () => {
  const { sent } = await rodar('!menu');
  const comCtx = sent.find((x) => temNewsletter(x.content));
  ok(comCtx, 'achou mensagem com newsletter');
  const info = comCtx.content.contextInfo.forwardedNewsletterMessageInfo;
  eq(typeof info.newsletterJid, 'string', 'newsletterJid é string');
  ok(info.newsletterJid.includes('@newsletter'), 'jid é de newsletter');
  eq(comCtx.content.contextInfo.isForwarded, true, 'isForwarded ligado');
});

await test('6. NENHUM envio de menu no código usa `quoted: info`', () => {
  // Guarda estrutural: se alguém reintroduzir `quoted` num envio de menu, este
  // teste falha. Varre os dois blocos que enviam menu.
  const src = fs.readFileSync(new URL('../dados/src/index.js', import.meta.url), 'utf8');
  const linhas = src.split('\n');
  const inicios = [linhas.findIndex((l) => /^\s*case 'menu':/.test(l)), linhas.findIndex((l) => /async function sendMenuWithMedia/.test(l))];
  const problemas = [];
  for (const ini of inicios) {
    if (ini < 0) continue;
    // janela generosa: o case 'menu' termina antes de `case 'alteradores'`
    for (let i = ini; i < ini + 200 && i < linhas.length; i++) {
      if (/^\s*case '/.test(linhas[i]) && i > ini) break;
      if (/quoted: info/.test(linhas[i])) problemas.push(i + 1);
    }
  }
  eq(problemas.length, 0, `nenhum \`quoted: info\` nos blocos de menu (achados nas linhas ${problemas.join(', ')})`);
});

await test('7. TODOS os envios de menu carregam contextInfo (nenhum ficou sem)', () => {
  const src = fs.readFileSync(new URL('../dados/src/index.js', import.meta.url), 'utf8');
  const linhas = src.split('\n');
  const ini = linhas.findIndex((l) => /^\s*case 'menu':/.test(l));
  const semCtx = [];
  for (let i = ini; i < ini + 200 && i < linhas.length; i++) {
    if (/^\s*case '/.test(linhas[i]) && i > ini) break;
    if (/await nazu\.sendMessage/.test(linhas[i])) {
      const bloco = linhas.slice(i, i + 14).join('\n');
      if (!bloco.includes('newsletterContext')) semCtx.push(i + 1);
    }
  }
  eq(semCtx.length, 0, `todo envio do menu tem newsletter (faltou nas linhas ${semCtx.join(', ')})`);
});

// ============================================================================
// FINAL
// ============================================================================

try { fs.rmSync(TMP_DB, { recursive: true, force: true }); } catch { /* ignore */ }

const totalOk = RESULTS.reduce((a, r) => a + r.passed, 0);
const totalFail = RESULTS.reduce((a, r) => a + r.failed, 0);
console.log('\n════════════════════════════════════════');
console.log(`RESULTADO: ${RESULTS.length} testes | ${totalOk} asserções ok | ${totalFail} falhas`);
console.log('════════════════════════════════════════');
if (totalFail > 0) {
  console.log('\nFALHAS:');
  for (const r of RESULTS) if (r.failed) for (const e of r.errors) console.log(`- [${r.name}] ${e}`);
  process.exit(1);
}
console.log('✅ TODOS OS TESTES PASSARAM');
process.exit(0);
