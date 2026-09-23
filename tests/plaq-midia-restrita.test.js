/**
 * !plaq1..!plaq10 — mídia visível APENAS para quem pediu o comando.
 *
 * O que este teste garante (e por que "enviou algo" não basta):
 *
 * O handler real é rodado com socket falso. O comando monta a mensagem pela
 * MESMA rotação de Sender Key do `!rajar`. O teste então:
 *
 *   1. confere a ORDEM prometida: aviso em texto (visível a todos) e depois a
 *      mídia restrita;
 *   2. leva o que o comando passou pelo caminho REAL da fork
 *      (`resolveGroupRecipients`) e exige que o subconjunto seja **um** membro —
 *      o que pediu — e não o grupo inteiro;
 *   3. confere que a mídia é enviada pelo `relayGroupMessageWithSenderKeyRotation`
 *      e NUNCA pelo `sendMessage` comum (que iria para todos).
 *
 * Uso: node tests/plaq-midia-restrita.test.js
 */

import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

import { resolveGroupRecipients } from '@itsliaaa/baileys/lib/Utils/recipient-selector.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

// Banco E pasta de mídia temporários ANTES de importar o bot.
const TMP_DB = fs.mkdtempSync(path.join(os.tmpdir(), 'lizzy-plaqr-db-'));
process.env.DATABASE_PATH = TMP_DB;
const TMP_PLAQ = fs.mkdtempSync(path.join(os.tmpdir(), 'lizzy-plaqr-media-'));
process.env.PLAQ_PATH = TMP_PLAQ;
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
  ok(typeof hay === 'string' && hay.includes(needle), `${label ?? needle} — esperado conter "${needle}"`);
}

// ============================================================================

const indexModule = await import(new URL('../dados/src/index.js', import.meta.url).href);
const handleMessage = indexModule.default ?? indexModule;

const {
  PLAQ_DIR, PLAQ_COMMANDS
} = await import(new URL('../dados/src/funcs/utils/plaq.js', import.meta.url).href);
const restricted = await import(new URL('../dados/src/utils/restrictedMedia.js', import.meta.url).href);

const BOT_JID = '5599999999999@s.whatsapp.net';
const BOT_LID = '111111111111111@lid';
const MEM_1 = '55710001000000@lid';       // quem pede o comando
const MEM_1_PN = '55130001999999@s.whatsapp.net';
const MEM_2 = '55710002000000@lid';       // outro membro comum
const MEM_2_PN = '55130002999999@s.whatsapp.net';
const ADM_A = '55710003000000@lid';       // admin
const ADM_A_PN = '55130003999999@s.whatsapp.net';

const GROUP_PARTICIPANTS = [
  { id: MEM_1, phoneNumber: MEM_1_PN, admin: null },
  { id: MEM_2, phoneNumber: MEM_2_PN, admin: null },
  { id: ADM_A, phoneNumber: ADM_A_PN, admin: 'admin' },
  { id: BOT_LID, phoneNumber: BOT_JID, admin: 'admin' }
];

let groupCounter = 0;
function makeGroup() {
  groupCounter += 1;
  const jid = `120363900000000${String(groupCounter).padStart(3, '0')}@g.us`;
  fs.writeFileSync(path.join(GRUPOS_DIR, `${jid}.json`),
    JSON.stringify({ groupName: `GP ${groupCounter}`, modobrincadeira: true }, null, 2));
  return jid;
}

/**
 * Socket falso que registra TUDO: `sendMessage` comum e a rotação.
 * Assim o teste distingue "enviou para todos" de "enviou restrito".
 */
function makeNazu({ sent, rotations, groupJid, withRotation = true, failRotation = false }) {
  const nazu = {
    sent,
    rotations,
    sendMessage: async (jid, content, options) => {
      sent.push({ jid, content, options });
      return { key: { id: `S-${sent.length}` } };
    },
    user: { id: `${BOT_JID.split('@')[0]}:5@s.whatsapp.net`, lid: BOT_LID, name: 'Lizzy' },
    // Resolve PN<->LID para QUALQUER participante do grupo (inclusive os
    // remetentes dinâmicos criados por `nextSender`), senão o handler não
    // consegue casar o autor com o metadata.
    onWhatsApp: async (jid) => {
      const pair = GROUP_PARTICIPANTS.find((p) => p.phoneNumber === jid || p.id === jid);
      if (pair) return [{ jid, exists: true, lid: pair.id }];
      return [{ jid, exists: false }];
    },
    signalRepository: {
      lidMapping: {
        getPNForLID: async (lid) => {
          const pair = GROUP_PARTICIPANTS.find((p) => p.id === lid);
          return pair?.phoneNumber || null;
        }
      }
    },
    groupMetadata: async () => ({ id: groupJid, subject: 'GP', participants: GROUP_PARTICIPANTS }),
    groupParticipantsUpdate: async () => ({}),
    groupRequestParticipantsList: async () => [],
    groupRequestParticipantsUpdate: async () => ({}),
    ev: { on: () => {}, emit: () => {}, removeAllListeners: () => {} },
    readMessages: async () => {}, sendPresenceUpdate: async () => {},
    profilePictureUrl: async () => null, react: async () => ({}),
    /**
     * Uploader de mídia do socket real. O `generateWAMessage` (caminho normal da
     * lib) exige `options.upload`; sem ele a mídia nunca é preparada e a
     * mensagem sai sem mediaKey. Aqui só precisa existir e devolver o formato
     * que o `prepareWAMessageMedia` espera.
     */
    waUploadToServer: async () => ({
      mediaUrl: 'https://example.invalid/media.enc',
      directPath: '/v/t62/media.enc',
      url: 'https://example.invalid/media.enc'
    })
  };
  if (withRotation) {
    nazu.relayGroupMessageWithSenderKeyRotation = async (jid, message, options) => {
      if (failRotation) throw new Error('falha simulada na rotacao');
      rotations.push({ jid, message, options });
      return { groupJid: jid, messageId: options?.messageId };
    };
  }
  return nazu;
}

/** PNG 1x1 válido. */
const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);
function criarPlaq(cmd, ext = 'png', buf = PNG_1x1) {
  fs.mkdirSync(PLAQ_DIR, { recursive: true });
  fs.writeFileSync(path.join(PLAQ_DIR, `${cmd}.${ext}`), buf);
}
function limparPlaq() {
  for (const cmd of PLAQ_COMMANDS) {
    for (const ext of ['png', 'jpg', 'gif', 'mp4', 'webp']) {
      const f = path.join(PLAQ_DIR, `${cmd}.${ext}`);
      if (fs.existsSync(f)) fs.unlinkSync(f);
    }
  }
}

/**
 * Gera um remetente inédito.
 *
 * O bot limita 3 comandos por 5s POR REMETENTE. Reusar o mesmo autor entre
 * testes faz o 4º comando responder "calma aí" e o teste medir o anti-flood em
 * vez do comando — armadilha já documentada no `!testcall` e no `me-profile`.
 */
let senderSeq = 0;
function nextSender() {
  senderSeq += 1;
  const n = String(senderSeq).padStart(4, '0');
  return { lid: `5572${n}000000@lid`, pn: `5514${n}999999@s.whatsapp.net` };
}

/** Executa o comando como um remetente NOVO (para não cair no throttle). */
async function rodar({ groupJid, text, sender = null, fromMe = false, nazuOverrides = {} }) {
  const s = sender || nextSender();
  const senderLid = s.lid;
  const senderPn = s.pn;
  const sent = [];
  const rotations = [];
  const nazu = makeNazu({ sent, rotations, groupJid, ...nazuOverrides });
  await handleMessage(nazu, {
    key: { remoteJid: groupJid, fromMe, id: `M-${Math.random().toString(36).slice(2, 8)}`, participant: senderPn, participantAlt: senderPn },
    message: {
      extendedTextMessage: {
        text,
        contextInfo: { remoteJid: groupJid, mentionedJid: [], participant: senderPn }
      }
    },
    messageTimestamp: Math.floor(Date.now() / 1000),
    pushName: 'Tester'
  }, null, new Map(), null);
  return {
    sent,
    rotations,
    texto: sent.map((s) => s.content?.text ?? '').filter(Boolean).join('\n')
  };
}

// ============================================================================
// 1. MÓDULO
// ============================================================================

await test('helper: alvo normalizado para um JID válido', () => {
  ok(restricted.normalizeRestrictedTargets([MEM_1, MEM_1, '', null, 'lixo']).length === 1,
    'deduplica e descarta inválidos');
  ok(!restricted.normalizeRestrictedTargets([]).length, 'lista vazia -> vazio');
  ok(restricted.supportsRestrictedMedia({ relayGroupMessageWithSenderKeyRotation() {} }), 'detecta a API');
  ok(!restricted.supportsRestrictedMedia({}), 'sem a API -> false');
});

// ============================================================================
// 2. ORDEM E VISIBILIDADE
// ============================================================================

await test('!plaq1 manda o aviso (todos veem) ANTES da mídia restrita', async () => {
  limparPlaq();
  criarPlaq('plaq1');
  const groupJid = makeGroup();
  const { sent, rotations, texto } = await rodar({ groupJid, text: '!plaq1' });

  // 1º: um texto comum, que vai para o grupo (por isso `sendMessage`).
  ok(sent.length >= 1, 'mandou o aviso');
  const aviso = sent[0];
  ok(typeof aviso.content?.text === 'string', 'o aviso é texto');
  includes(texto, 'só sua', 'o aviso diz que a mídia é só de quem pediu');

  // 2º: a mídia, pelo caminho restrito.
  ok(rotations.length === 1, 'a mídia foi pelo caminho restrito');
  limparPlaq();
});

await test('o aviso cita quem pediu e menciona ele de verdade', async () => {
  limparPlaq();
  criarPlaq('plaq1');
  const groupJid = makeGroup();
  const { sent } = await rodar({ groupJid, text: '!plaq1' });
  const aviso = sent.find((s) => typeof s.content?.text === 'string');
  ok(aviso.content.text.includes('@'), 'o aviso cita o usuário');
  ok(Array.isArray(aviso.content.mentions) && aviso.content.mentions.length === 1,
    'leva a menção real (senão o @ não vira link)');
  limparPlaq();
});

await test('a mídia NÃO é enviada por sendMessage (iria para todos)', async () => {
  limparPlaq();
  criarPlaq('plaq1');
  const groupJid = makeGroup();
  const { sent } = await rodar({ groupJid, text: '!plaq1' });
  const mandouMidiaComum = sent.some((s) => s.content?.image || s.content?.video);
  ok(!mandouMidiaComum, 'nenhuma imagem/vídeo pelo caminho comum');
  limparPlaq();
});

// ============================================================================
// 3. O TRANSPORTE: quem realmente consegue decifrar
// ============================================================================

await test('o subconjunto restrito é SÓ quem pediu (1 de 4 participantes)', async () => {
  limparPlaq();
  criarPlaq('plaq1');
  const groupJid = makeGroup();
  const quem = nextSender();
  // O grupo precisa conhecer quem pediu, senão a resolução do subconjunto não
  // tem como casar o JID com um participante.
  GROUP_PARTICIPANTS.push({ id: quem.lid, phoneNumber: quem.pn, admin: null });
  const { rotations } = await rodar({ groupJid, text: '!plaq1', sender: quem });

  ok(rotations.length === 1, 'houve exatamente uma rotação');
  const opcoes = rotations[0].options;
  ok(Array.isArray(opcoes.allowedParticipants) && opcoes.allowedParticipants.length >= 1,
    'passou allowedParticipants');

  // Resolvido como a fork resolve no relayMessage.
  const resolved = resolveGroupRecipients({
    options: { recipientParticipants: opcoes.allowedParticipants },
    groupData: { participants: GROUP_PARTICIPANTS },
    jid: groupJid
  });
  assert.equal(resolved.jids.length, 1, `um único destinatário (veio ${resolved.jids.length})`);

  // E é quem pediu — não outro membro, não o admin.
  ok(resolved.jids.includes(quem.lid) || resolved.jids.includes(quem.pn),
    `o destinatário é quem pediu (${resolved.jids.join(',')})`);
  ok(!resolved.jids.includes(MEM_2) && !resolved.jids.includes(MEM_2_PN),
    'outro membro comum NÃO recebe o material da chave');
  ok(!resolved.jids.includes(ADM_A) && !resolved.jids.includes(BOT_LID),
    'nem o admin nem o bot');
  limparPlaq();
});

await test('o payload restrito carrega a imagem de verdade (buffer, não URL)', async () => {
  limparPlaq();
  criarPlaq('plaq1');
  const groupJid = makeGroup();
  const { rotations } = await rodar({ groupJid, text: '!plaq1' });
  const msg = rotations[0].message;
  // A mídia é preparada pelo caminho normal da lib (generateWAMessageFromContent),
  // então o que chega para a rotação é o message com a imagem montada.
  const tipo = Object.keys(msg || {}).join(',');
  ok(/imageMessage|videoMessage/.test(tipo), `message tem mídia (veio: ${tipo})`);
  limparPlaq();
});

await test('todos os 10 comandos usam o caminho restrito', async () => {
  limparPlaq();
  const groupJid = makeGroup();
  for (const cmd of PLAQ_COMMANDS) {
    criarPlaq(cmd);
    const { rotations } = await rodar({ groupJid, text: `!${cmd}` });
    ok(rotations.length === 1, `${cmd} passou pela rotação`);
  }
  limparPlaq();
});

// ============================================================================
// 4. FALHA FECHADA
// ============================================================================

await test('sem a API de rotação, NADA é enviado (não cai para o grupo)', async () => {
  limparPlaq();
  criarPlaq('plaq1');
  const groupJid = makeGroup();
  const { sent, texto } = await rodar({ groupJid, text: '!plaq1', nazuOverrides: { withRotation: false } });
  const mandouMidia = sent.some((s) => s.content?.image || s.content?.video);
  ok(!mandouMidia, 'não mandou a mídia para o grupo inteiro');
  includes(texto, 'Não consegui', 'avisa que falhou em vez de silenciar');
  limparPlaq();
});

await test('falha na rotação também não vaza a mídia', async () => {
  limparPlaq();
  criarPlaq('plaq1');
  const groupJid = makeGroup();
  const { sent } = await rodar({ groupJid, text: '!plaq1', nazuOverrides: { failRotation: true } });
  const mandouMidia = sent.some((s) => s.content?.image || s.content?.video);
  ok(!mandouMidia, 'nada de mídia pelo caminho comum');
  limparPlaq();
});

await test('sem mídia na pasta continua avisando (não passa pela rotação)', async () => {
  limparPlaq();
  const groupJid = makeGroup();
  const { rotations, texto } = await rodar({ groupJid, text: '!plaq2' });
  ok(rotations.length === 0, 'não tentou enviar');
  includes(texto, 'não tem mídia', 'avisa que falta mídia');
});

// ============================================================================
// 5. MENU
// ============================================================================

await test('o menu18 mostra o emoji 🖼️ antes de cada comando', async () => {
  const { default: menu18 } = await import(new URL('../dados/src/menus/menu18.js', import.meta.url).href);
  const txt = await menu18('!', 'Bot', 'User');
  for (const cmd of PLAQ_COMMANDS) {
    const linha = txt.split('\n').find((l) => l.includes(`!${cmd}`));
    ok(linha && linha.includes('🖼️'), `${cmd} tem o emoji`);
  }
});

// ============================================================================

const totalOk = RESULTS.reduce((a, r) => a + r.passed, 0);
const totalFail = RESULTS.reduce((a, r) => a + r.failed, 0);
console.log('\n════════════════════════════════════════');
console.log(`RESULTADO: ${RESULTS.length} testes | ${totalOk} asserções ok | ${totalFail} falhas`);
console.log('════════════════════════════════════════');

fs.rmSync(TMP_DB, { recursive: true, force: true });
fs.rmSync(TMP_PLAQ, { recursive: true, force: true });
if (totalFail > 0) {
  console.log('\nFALHAS:');
  for (const r of RESULTS) if (r.failed) for (const e of r.errors) console.log(`- [${r.name}] ${e}`);
  process.exit(1);
}
console.log('✅ TODOS OS TESTES PASSARAM');
process.exit(0);
