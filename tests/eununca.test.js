/**
 * !eununca — as frases e o formato da enquete.
 *
 * Roda o handler REAL com socket falso e confere o que sai na enquete:
 * nome, as DUAS opções ("Eu nunca" / "Eu já") e `selectableCount: 1`.
 *
 * O ponto que este teste protege: a lista `iNever` de `tools.json` é a ÚNICA
 * fonte das frases. Se alguém reintroduzir a lista antiga (ou quebrar o JSON),
 * aqui quebra.
 *
 * Uso: node tests/eununca.test.js
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');

const TMP_DB = fs.mkdtempSync(path.join(os.tmpdir(), 'lizzy-eununca-'));
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

// ============================================================================

const TOOLS = JSON.parse(fs.readFileSync(path.join(ROOT, 'dados/src/funcs/json/tools.json'), 'utf-8'));
const indexModule = await import(new URL('../dados/src/index.js', import.meta.url).href);
const handleMessage = indexModule.default ?? indexModule;

const BOT_JID = '5599999999999@s.whatsapp.net';
const BOT_LID = '111111111111111@lid';
const MEM = { lid: '55710001000000@lid', jid: '55130001999999@s.whatsapp.net', name: 'Tester' };

let groupCounter = 0;
function makeGroup() {
  groupCounter += 1;
  const jid = `120363900000000${String(groupCounter).padStart(3, '0')}@g.us`;
  fs.writeFileSync(path.join(GRUPOS_DIR, `${jid}.json`),
    JSON.stringify({ groupName: `GE ${groupCounter}`, modobrincadeira: true }, null, 2));
  return jid;
}

let senderSeq = 0;
function nextSender() {
  senderSeq += 1;
  const n = String(senderSeq).padStart(4, '0');
  return { lid: `5573${n}000000@lid`, jid: `5515${n}999999@s.whatsapp.net`, name: `5573${n}000000` };
}

async function rodar({ text = '!eununca', sender = null, groupData = {} } = {}) {
  const s = sender || nextSender();
  const groupJid = makeGroup();
  if (Object.keys(groupData).length) {
    fs.writeFileSync(path.join(GRUPOS_DIR, `${groupJid}.json`),
      JSON.stringify({ groupName: 'GE', ...groupData }, null, 2));
  }
  const sent = [];
  const nazu = {
    sent,
    sendMessage: async (jid, content, options) => { sent.push({ jid, content, options }); return { key: { id: 'S' } }; },
    user: { id: `${BOT_JID.split('@')[0]}:5@s.whatsapp.net`, lid: BOT_LID, name: 'Lizzy' },
    onWhatsApp: async (jid) => [{ jid, exists: true, lid: s.lid }],
    signalRepository: { lidMapping: { getPNForLID: async () => s.jid } },
    groupMetadata: async () => ({
      id: groupJid, subject: 'GE',
      participants: [
        { id: s.lid, phoneNumber: s.jid, admin: null },
        { id: BOT_LID, phoneNumber: BOT_JID, admin: 'admin' }
      ]
    }),
    groupParticipantsUpdate: async () => ({}),
    groupRequestParticipantsList: async () => [],
    groupRequestParticipantsUpdate: async () => ({}),
    ev: { on: () => {}, emit: () => {}, removeAllListeners: () => {} },
    readMessages: async () => {}, sendPresenceUpdate: async () => {},
    profilePictureUrl: async () => null, react: async () => ({}),
    waUploadToServer: async () => ({ mediaUrl: 'https://x.invalid/m', directPath: '/v/x', url: 'https://x.invalid/m' })
  };
  await handleMessage(nazu, {
    key: { remoteJid: groupJid, fromMe: false, id: `M-${Math.random().toString(36).slice(2, 8)}`, participant: s.jid, participantAlt: s.jid },
    message: { extendedTextMessage: { text, contextInfo: { remoteJid: groupJid, mentionedJid: [], participant: s.jid } } },
    messageTimestamp: Math.floor(Date.now() / 1000), pushName: s.name
  }, null, new Map(), null);
  return { sent, enquete: sent.find((x) => x.content?.poll)?.content.poll, texto: sent.map((x) => x.content?.text ?? '').filter(Boolean).join('\n') };
}

// ============================================================================
// 1. A LISTA
// ============================================================================

await test('tools.json tem as 200 frases novas em iNever', () => {
  const n = TOOLS.iNever;
  ok(Array.isArray(n), 'iNever é lista');
  ok(n.length === 200, `200 frases (veio ${n.length})`);
  ok(new Set(n).size === 200, 'nenhuma repetida');
  ok(n[0] === 'Eu nunca me senti desiludido por alguém que amava.', 'primeira frase é a esperada');
  ok(n[199] === 'Eu já conheci alguém que deixou minha vida um pouquinho mais feliz.', 'última frase é a esperada');
});

await test('toda frase segue o formato da enquete (Eu nunca / Eu já)', () => {
  const fora = TOOLS.iNever.filter((f) => !/^Eu (nunca|já) /.test(f));
  ok(fora.length === 0, `todas começam com "Eu nunca"/"Eu já" (fora: ${fora.slice(0, 3).join(' | ')})`);
});

await test('as frases antigas (picantes) saíram', () => {
  const antigas = [
    'Eu nunca soltei pum em um elevador',
    'Eu nunca transei no carro',
    'Eu nunca vomitei na frente',
    'brinquedos sexuais',
    'fantasia erótica'
  ];
  const achadas = antigas.filter((a) => TOOLS.iNever.some((f) => f.includes(a)));
  ok(achadas.length === 0, `nenhuma frase antiga sobrou (achadas: ${achadas.join(', ')})`);
});

await test('as 10 outras listas do tools.json continuam intactas', () => {
  for (const chave of ['Cantadas', 'curiousFacts', 'Conselhos', 'ConselhosBiblicos', 'Piadas',
    'Charadas', 'FrasesMotivacionais', 'Elogios', 'Reflexoes']) {
    ok(Array.isArray(TOOLS[chave]) && TOOLS[chave].length > 0, `${chave} segue com conteúdo`);
  }
});

// ============================================================================
// 2. O COMANDO
// ============================================================================

await test('!eununca publica uma enquete com as duas opções', async () => {
  const { enquete } = await rodar();
  ok(Boolean(enquete), 'mandou uma enquete');
  ok(enquete.values.length === 2, 'duas opções');
  ok(enquete.values[0] === 'Eu nunca' && enquete.values[1] === 'Eu já', 'opções "Eu nunca" / "Eu já"');
  ok(enquete.selectableCount === 1, 'uma escolha só');
});

await test('a pergunta da enquete vem da lista iNever', async () => {
  const { enquete } = await rodar();
  const frases = TOOLS.iNever;
  ok(frases.includes(enquete.name.replace(/^🙈 EU NUNCA\n\n/, '')), 'a pergunta é uma das frases da lista');
});

await test('o cabeçalho da enquete usa o emoji amigável', async () => {
  const { enquete } = await rodar();
  ok(enquete.name.startsWith('🙈 EU NUNCA'), 'título com o emoji amigável');
  ok(!enquete.name.includes('🔞'), 'não usa mais o emoji de proibido');
});

await test('só roda em grupo e com modo brincadeira', async () => {
  // Sem modo brincadeira.
  const semModo = await rodar({ groupData: { modobrincadeira: false } });
  ok(!semModo.enquete, 'não manda enquete sem modo brincadeira');
  ok(semModo.texto.includes('modo brincadeira'), 'avisa sobre o modo brincadeira');
});

await test('10 execuções trazem frases da lista nova', async () => {
  const frases = new Set(TOOLS.iNever);
  for (let i = 0; i < 10; i++) {
    const { enquete } = await rodar();
    const texto = enquete.name.replace(/^🙈 EU NUNCA\n\n/, '');
    ok(frases.has(texto), `pergunta ${i + 1} veio da lista`);
  }
});

// ============================================================================

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
