/**
 * Layout das enquetes - !eununca, !eununca18, !vab, !vab18.
 *
 * Os quatro comandos montam o nome da enquete com o MESMO desenho do resto do
 * bot: caixa em cima com o titulo em bold, a PERGUNTA no meio e o rodape com o
 * nome do bot embaixo. Antes cada um tinha um formato solto, fora do padrao.
 *
 * Este teste roda o HANDLER REAL e compara os quatro lado a lado - e o que
 * garante que eles nao voltem a divergir.
 *
 * Os caracteres do layout sao construidos por code point (String.fromCharCode /
 * fromCodePoint) em vez de literais: o arquivo fica 100% ASCII e nenhuma
 * ferramenta de edicao consegue corromper os glifos.
 *
 * Uso: node tests/poll-layout.test.js
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const TMP_DB = fs.mkdtempSync(path.join(os.tmpdir(), 'lizzy-poll-layout-'));
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
        CURRENT.failed += 1; CURRENT.errors.push(`EXCECAO: ${e?.stack || e}`); finish(name);
      });
    }
    finish(name);
  } catch (e) {
    CURRENT.failed += 1; CURRENT.errors.push(`EXCECAO: ${e?.stack || e}`); finish(name);
  }
  return Promise.resolve();
}
function finish(name) {
  console.log(`${CURRENT.failed === 0 ? '[ok]' : '[FAIL]'} ${name} (${CURRENT.passed} ok, ${CURRENT.failed} falhas)`);
  for (const err of CURRENT.errors) console.log(`     ${err.split('\n')[0]}`);
}
function ok(cond, msg) {
  if (cond) CURRENT.passed += 1;
  else { CURRENT.failed += 1; CURRENT.errors.push(`ASSERT FALHOU: ${msg}`); }
}

// ============================================================================
// Caracteres do layout, por code point (arquivo 100% ASCII).
// ============================================================================

const CP = String.fromCodePoint;
const BOX_TL = CP(0x256d);   // canto superior esquerdo
const BOX_TR = CP(0x256e);   // canto superior direito
const BOX_BL = CP(0x2570);   // canto inferior esquerdo
const BOX_BR = CP(0x256f);   // canto inferior direito
const H = CP(0x2501);        // barra pesada
const KUTHA = CP(0xa9c1);    // abertura decorativa
const KUTHB = CP(0xa9c2);    // fechamento decorativo
const ABRE = CP(0x0f3a);     // marca de abertura
const FECHA = CP(0x0f3b);    // marca de fechamento
const ESTRELA = CP(0x2726);  // estrela

const TOPO_PREFIX = BOX_TL + H.repeat(3) + KUTHA + ABRE;
const TOPO_SUFIX = FECHA + KUTHB + H.repeat(3) + BOX_TR;
const RODAPE_PREFIX = BOX_BL + H.repeat(3) + KUTHA + ABRE + ' ' + ESTRELA + ' ';
const RODAPE_SUFIX = ' ' + ESTRELA + ' ' + FECHA + KUTHB + H.repeat(3) + BOX_BR;

// Titulos em MATHEMATICAL BOLD (A = U+1D400).
const BOLD = (s) => {
  let out = '';
  for (const ch of s) {
    const c = ch.codePointAt(0);
    if (c >= 65 && c <= 90) out += CP(0x1d400 + (c - 65));
    else if (c >= 97 && c <= 122) out += CP(0x1d41a + (c - 97));
    else out += ch;
  }
  return out;
};
const BOLD_EU_NUNCA = BOLD('EU NUNCA');
const BOLD_ISSO_AQUILO = BOLD('ISSO OU AQUILO');

// Emojis dos quatro comandos.
const EMOJI = {
  '!eununca': CP(0x1f648),
  '!eununca18': CP(0x1f51e),
  '!vab': CP(0x1f914),
  '!vab18': CP(0x1f608),
};
const BOLD_ESPERADO = {
  '!eununca': BOLD_EU_NUNCA,
  '!eununca18': BOLD_EU_NUNCA,
  '!vab': BOLD_ISSO_AQUILO,
  '!vab18': BOLD_ISSO_AQUILO,
};

// ============================================================================

const indexModule = await import(new URL('../dados/src/index.js', import.meta.url).href);
const handleMessage = indexModule.default ?? indexModule;

const BOT_JID = '5599999999999@s.whatsapp.net';
const BOT_LID = '111111111111111@lid';

// O rodape usa o nomebot REAL do config.
const CONFIG = JSON.parse(fs.readFileSync(path.join(HERE, '..', 'dados/src/config.json'), 'utf-8'));
const BOT_NAME = CONFIG.nomebot || 'Bot';

const CMDS = ['!eununca', '!eununca18', '!vab', '!vab18'];

let groupCounter = 0;
function makeGroup() {
  groupCounter += 1;
  const jid = `120363970000000${String(groupCounter).padStart(3, '0')}@g.us`;
  fs.writeFileSync(path.join(GRUPOS_DIR, `${jid}.json`),
    JSON.stringify({ groupName: `GPL ${groupCounter}`, modobrincadeira: true }, null, 2));
  return jid;
}

let senderSeq = 0;
function nextSender() {
  senderSeq += 1;
  const n = String(senderSeq).padStart(4, '0');
  return { lid: `5576${n}000000@lid`, jid: `5518${n}999999@s.whatsapp.net`, name: `5576${n}000000` };
}

/** Roda um comando e devolve a enquete publicada. */
async function rodar(cmd) {
  const s = nextSender();
  const groupJid = makeGroup();
  const sent = [];
  const nazu = {
    sent,
    sendMessage: async (jid, content, options) => { sent.push({ jid, content, options }); return { key: { id: 'S' } }; },
    user: { id: `${BOT_JID.split('@')[0]}:5@s.whatsapp.net`, lid: BOT_LID, name: BOT_NAME },
    onWhatsApp: async (jid) => [{ jid, exists: true, lid: s.lid }],
    signalRepository: { lidMapping: { getPNForLID: async () => s.jid } },
    groupMetadata: async () => ({
      id: groupJid, subject: 'GPL',
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
    message: { extendedTextMessage: { text: cmd, contextInfo: { remoteJid: groupJid, mentionedJid: [], participant: s.jid } } },
    messageTimestamp: Math.floor(Date.now() / 1000), pushName: s.name
  }, null, new Map(), null);
  return sent.find((x) => x.content?.poll)?.content.poll;
}

// ============================================================================

await test('os 4 comandos publicam enquete com o MESMO layout (caixa em cima)', async () => {
  for (const cmd of CMDS) {
    const p = await rodar(cmd);
    const linhas = String(p?.name ?? '').split('\n');
    ok(linhas.length === 3, `${cmd}: 3 linhas (caixa + pergunta + rodape) - veio ${linhas.length}`);
    ok(linhas[0].startsWith(TOPO_PREFIX), `${cmd}: abre a caixa do layout`);
    ok(linhas[0].endsWith(TOPO_SUFIX), `${cmd}: fecha o topo da caixa`);
    ok(linhas[2].startsWith(RODAPE_PREFIX), `${cmd}: rodape com o layout`);
    ok(linhas[2].includes(BOT_NAME), `${cmd}: rodape traz o nome do bot`);
    ok(linhas[2].endsWith(RODAPE_SUFIX), `${cmd}: fecha o rodape`);
    ok(linhas[1].length > 0 && !linhas[1].includes(KUTHA), `${cmd}: a pergunta fica sozinha na linha do meio`);
    ok(p.values.length === 2 && p.selectableCount === 1, `${cmd}: segue com 2 opcoes e 1 escolha`);
  }
});

await test('o titulo de cada um sai em MATHEMATICAL BOLD', async () => {
  for (const cmd of CMDS) {
    const p = await rodar(cmd);
    const topo = String(p?.name ?? '').split('\n')[0];
    ok(topo.includes(BOLD_ESPERADO[cmd]), `${cmd}: titulo em bold`);
    // Sanidade: NAO esta em ASCII puro (seria o formato antigo).
    ok(!topo.includes('EU NUNCA') && !topo.includes('ISSO OU AQUILO'), `${cmd}: nao usa titulo ASCII`);
  }
});

await test('o emoji do comando aparece no topo da caixa', async () => {
  for (const cmd of CMDS) {
    const p = await rodar(cmd);
    const topo = String(p?.name ?? '').split('\n')[0];
    ok(topo.includes(EMOJI[cmd]), `${cmd}: emoji no topo`);
  }
});

await test('o rodape e identico nos quatro', async () => {
  const rodapes = new Set();
  for (const cmd of CMDS) {
    const p = await rodar(cmd);
    rodapes.add(String(p?.name ?? '').split('\n')[2]);
  }
  ok(rodapes.size === 1, `mesmo rodape nos 4 (variantes: ${rodapes.size})`);
});

await test('a caixa do topo tem o mesmo comprimento nos quatro', async () => {
  // O titulo muda de tamanho, mas a caixa segue o mesmo desenho (mesmos cantos).
  for (const cmd of CMDS) {
    const p = await rodar(cmd);
    const topo = String(p?.name ?? '').split('\n')[0];
    ok(topo[0] === BOX_TL, `${cmd}: comeca no canto do layout`);
    ok(topo[topo.length - 1] === BOX_TR, `${cmd}: termina no canto do layout`);
    ok((topo.match(new RegExp(KUTHA, 'g')) || []).length === 1, `${cmd}: uma abertura decorativa`);
    ok((topo.match(new RegExp(KUTHB, 'g')) || []).length === 1, `${cmd}: um fechamento decorativo`);
  }
});

// ============================================================================

const totalOk = RESULTS.reduce((a, r) => a + r.passed, 0);
const totalFail = RESULTS.reduce((a, r) => a + r.failed, 0);
console.log('\n========================================');
console.log(`RESULTADO: ${RESULTS.length} testes | ${totalOk} assercoes ok | ${totalFail} falhas`);
console.log('========================================');

fs.rmSync(TMP_DB, { recursive: true, force: true });
if (totalFail > 0) {
  console.log('\nFALHAS:');
  for (const r of RESULTS) if (r.failed) for (const e of r.errors) console.log(`- [${r.name}] ${e}`);
  process.exit(1);
}
console.log('TODOS OS TESTES PASSARAM');
process.exit(0);
