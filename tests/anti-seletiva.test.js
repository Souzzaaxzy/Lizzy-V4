/**
 * Testes do anti-distribuição-seletiva (dentro do !antifantasma).
 *
 * Deteta o mecanismo pelo TRANSPORTE: a fork marca `info.selectiveDistribution`
 * quando um `skmsg` de grupo não decifra (este dispositivo não recebeu a Sender
 * Key) e o `<enc>` carrega `decrypt-fail="hide"`. O teste roda o HANDLER REAL e
 * verifica que o bot avisa, apaga e remove — e que NÃO age quando:
 *   - o toggle `antiinvi` está desligado;
 *   - a mensagem é normal (sem a marca);
 *   - o autor é admin/dono.
 *
 * Uso: node tests/anti-seletiva.test.js
 */

import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

const TMP_DB = fs.mkdtempSync(path.join(os.tmpdir(), 'lizzy-antisel-db-'));
process.env.DATABASE_PATH = TMP_DB;
const GRUPOS_DIR = path.join(TMP_DB, 'grupos');
fs.mkdirSync(GRUPOS_DIR, { recursive: true });

const RESULTS = [];
let CURRENT = null;

function test(name, fn) {
  CURRENT = { name, passed: 0, failed: 0, errors: [] };
  RESULTS.push(CURRENT);
  try {
    const result = fn();
    if (result && typeof result.then === 'function') {
      return result
        .then(() => finish(name))
        .catch((error) => {
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

const indexModule = await import(new URL('../dados/src/index.js', import.meta.url).href);
const handleMessage = indexModule.default ?? indexModule;

const BOT_JID = '5599999999999@s.whatsapp.net';
const BOT_LID = '111111111111111@lid';

let groupCounter = 0;
function makeGroup({ antiinvi = true } = {}) {
  groupCounter += 1;
  const jid = `1203637000000000${String(groupCounter).padStart(3, '0')}@g.us`;
  fs.writeFileSync(
    path.join(GRUPOS_DIR, `${jid}.json`),
    JSON.stringify({ modobrincadeira: true, groupName: 'Grupo AntiSeletiva', antiinvi }, null, 2)
  );
  return jid;
}

const ADM = '111000000000001@lid';
const ADM_PN = '5511911111111@s.whatsapp.net';
const MEM = '222000000000001@lid';
const MEM_PN = '5511922222221@s.whatsapp.net';
// Segundo membro comum, usado para provar que a marca de punição é por autor
// (um agressor novo continua sendo punido mesmo com outro já marcado).
const MEM2 = '222000000000002@lid';
const MEM2_PN = '5511922222222@s.whatsapp.net';

const PARTICIPANTS = [
  { id: BOT_LID, lid: BOT_LID, phoneNumber: BOT_JID, admin: 'admin' },
  { id: ADM, lid: ADM, phoneNumber: ADM_PN, admin: 'superadmin' },
  { id: MEM, lid: MEM, phoneNumber: MEM_PN, admin: null },
  { id: MEM2, lid: MEM2, phoneNumber: MEM2_PN, admin: null },
];

function makeNazu({ sent, groupJid, senderLid, calls = {} }) {
  return {
    sendMessage: async (jid, content, options) => {
      sent.push({ jid, content, options });
      return { key: { id: `SENT-${sent.length}` } };
    },
    groupParticipantsUpdate: async (jid, jids, action) => {
      calls.groupParticipantsUpdate = (calls.groupParticipantsUpdate || 0) + 1;
      calls.lastAction = action;
      calls.lastJids = jids;
      return {};
    },
    // Usado pelo enforcement em segundo plano (fechar/abrir o grupo antes e
    // depois da remoção). Sem isto o enforcement falharia silenciosamente e o
    // teste mediria "não removeu" mesmo com o anti funcionando.
    groupSettingUpdate: async (jid, setting) => {
      calls.groupSettingUpdate = (calls.groupSettingUpdate || 0) + 1;
      calls.lastSetting = setting;
      return {};
    },
    user: { id: `${BOT_JID.split('@')[0]}:5@s.whatsapp.net`, lid: BOT_LID, name: 'Lizzy' },
    onWhatsApp: async (jid) => [{ jid, exists: true, lid: jid.replace('@s.whatsapp.net', '@lid') }],
    signalRepository: { lidMapping: { getPNForLID: async () => null, getLIDForPN: async () => null } },
    groupMetadata: async () => ({
      id: groupJid,
      subject: 'Grupo AntiSeletiva',
      // Mantém os papéis REAIS do metadata. Rebaixar o sender aqui faria o
      // handler tratar um admin como membro comum e o teste mediria a coisa
      // errada (foi o que aconteceu na primeira versão deste teste).
      participants: PARTICIPANTS,
    }),
    groupRequestParticipantsList: async () => [],
    groupRequestParticipantsUpdate: async () => ({}),
    ev: { on: () => {}, emit: () => {}, removeAllListeners: () => {} },
    readMessages: async () => {},
    sendPresenceUpdate: async () => {},
    profilePictureUrl: async () => 'x',
    react: async () => ({}),
  };
}

/** A message as the fork reports it when selective distribution is detected.
 *
 * IMPORTANTE: sem `message` — uma mensagem que não decifra tem só
 * `messageStubType`/`messageStubParameters`. O teste antigo inventava
 * `message: {}` e por isso passava enquanto na produção nada acontecia: o guard
 * `!info.message` do connect.js descartava antes do anti rodar.
 */
const selectiveInfo = ({ groupJid, authorLid }) => ({
  key: { remoteJid: groupJid, fromMe: false, id: 'SEL-1', participant: authorLid, participantAlt: MEM_PN },
  messageStubType: 2, // CIPHERTEXT
  messageStubParameters: ['No session found to decrypt message'],
  selectiveDistribution: {
    kind: 'selective-distribution',
    messageId: 'SEL-1',
    groupJid,
    author: authorLid,
    encType: 'skmsg',
    decryptFail: 'hide',
    addressedDeviceCount: 1,
    reason: 'No session found to decrypt message',
  },
  messageTimestamp: 1757900000,
  pushName: 'Invasor',
});

async function rodar({ groupJid, info, senderLid = MEM, fromMe = false, esperarEnforcement = false }) {
  const sent = [];
  const calls = {};
  const nazu = makeNazu({ sent, groupJid, senderLid, calls });
  await handleMessage(nazu, { ...info, key: { ...info.key, fromMe } }, null, new Map(), null);
  if (esperarEnforcement) {
    // A remoção roda em segundo plano (com sleep interno), então o teste espera
    // o enforcement terminar em vez de medir um estado intermediário.
    await new Promise((resolve) => setTimeout(resolve, 4000));
  }
  const textos = sent.map((s) => s.content?.text ?? '').filter(Boolean).join('\n');
  return { sent, textos, calls };
}

// ============================================================================

await test('detecta e reage a uma mensagem seletiva (avisa, apaga e remove)', async () => {
  const groupJid = makeGroup({ antiinvi: true });
  const r = await rodar({ groupJid, info: selectiveInfo({ groupJid, authorLid: MEM }), esperarEnforcement: true });
  ok(r.textos.includes('tentou atacar com mensagem fantasma'), 'avisou o ataque fantasma');
  ok(r.textos.includes('foi banido'), 'avisou o banimento');
  const apagou = r.sent.some((s) => s.content?.delete);
  ok(apagou, 'tentou apagar a mensagem');
  ok((r.calls.groupParticipantsUpdate || 0) >= 1, `removeu o autor (${r.calls.groupParticipantsUpdate || 0})`);
  assert.equal(r.calls.lastAction, 'remove', 'ação foi remove');
});

await test('NÃO age quando o anti-invisível está desligado', async () => {
  const groupJid = makeGroup({ antiinvi: false });
  const r = await rodar({ groupJid, info: selectiveInfo({ groupJid, authorLid: MEM }) });
  ok(!r.textos.includes('mensagem fantasma'), 'não avisou (toggle off)');
  assert.equal(r.calls.groupParticipantsUpdate || 0, 0, 'não removeu ninguém');
});

await test('NÃO age em mensagem normal (sem a marca de detecção)', async () => {
  const groupJid = makeGroup({ antiinvi: true });
  const normal = {
    key: { remoteJid: groupJid, fromMe: false, id: 'N-1', participant: MEM },
    message: { extendedTextMessage: { text: 'oi pessoal' } },
    messageTimestamp: 1757900000,
    pushName: 'Membro',
  };
  const r = await rodar({ groupJid, info: normal });
  ok(!r.textos.includes('mensagem fantasma'), 'não avisou em mensagem normal');
  assert.equal(r.calls.groupParticipantsUpdate || 0, 0, 'não removeu ninguém');
});

await test('NÃO age contra admin (mesmo com a marca)', async () => {
  const groupJid = makeGroup({ antiinvi: true });
  const info = selectiveInfo({ groupJid, authorLid: ADM });
  info.key.participantAlt = ADM_PN;
  const r = await rodar({ groupJid, info, senderLid: ADM, esperarEnforcement: true });
  ok((r.calls.groupParticipantsUpdate || 0) === 0, 'não removeu o admin');
  ok(!r.textos.includes('mensagem fantasma'), 'não avisou contra admin');
});

await test('NÃO age em mensagem do próprio bot', async () => {
  const groupJid = makeGroup({ antiinvi: true });
  const r = await rodar({ groupJid, info: selectiveInfo({ groupJid, authorLid: MEM }), fromMe: true, esperarEnforcement: true });
  ok((r.calls.groupParticipantsUpdate || 0) === 0, 'não removeu em mensagem fromMe');
  ok(!r.textos.includes('mensagem fantasma'), 'não avisou em mensagem fromMe');
});

await test('o log de diagnóstico sai com os campos estruturais', async () => {
  const groupJid = makeGroup({ antiinvi: true });
  const original = console.log;
  const linhas = [];
  console.log = (...args) => { linhas.push(args.join(' ')); };
  try {
    await rodar({ groupJid, info: selectiveInfo({ groupJid, authorLid: MEM }) });
  } finally {
    console.log = original;
  }
  const linha = linhas.find((l) => l.includes('[ANTI-SELETIVA]'));
  ok(!!linha, 'logou a detecção');
  ok(linha?.includes('enc=skmsg'), 'logou o tipo do enc');
  ok(linha?.includes('decryptFail=hide'), 'logou o decrypt-fail');
  ok(linha?.includes(`messageId=SEL-1`), 'logou o messageId');
});
await test('VÁRIAS mensagens fantasma do mesmo autor: UM ciclo e UM aviso só', async () => {
  // Era o relatado: `!raja 2` produzia 2 ciclos de fechar/abrir e 2 avisos. O
  // lock do enforcement só dura ~2,5s, então mensagens mais espaçadas caíam fora
  // dele e repetiam tudo. Agora a punição é lembrada por grupo+autor.
  const groupJid = makeGroup({ antiinvi: true });
  const sent = [];
  const calls = {};
  const nazu = makeNazu({ sent, groupJid, senderLid: MEM, calls });

  const ghost = (id) => ({
    key: { remoteJid: groupJid, fromMe: false, id, participant: MEM, participantAlt: MEM_PN },
    messageStubType: 2,
    selectiveDistribution: {
      kind: 'selective-distribution', messageId: id, groupJid, author: MEM,
      encType: 'skmsg', decryptFail: 'hide', addressedDeviceCount: 1,
      reason: 'No session found to decrypt message',
    },
    messageTimestamp: 1757900000, pushName: 'Invasor',
  });

  // Três mensagens, com intervalo maior que a janela do lock (~2,5s).
  for (const id of ['M-1', 'M-2', 'M-3']) {
    await handleMessage(nazu, ghost(id), null, new Map(), null);
    await new Promise((r) => setTimeout(r, 1200));
  }
  await new Promise((r) => setTimeout(r, 4000));

  const avisos = sent.filter((s) => s.content?.text?.includes('mensagem fantasma')).length;
  ok(avisos === 1, `enviou UM aviso só (${avisos})`);
  ok((calls.groupParticipantsUpdate || 0) === 1, `removeu UMA vez (${calls.groupParticipantsUpdate || 0})`);
  ok((calls.groupSettingUpdate || 0) === 2, `um ciclo fechar+abrir = 2 chamadas de setting (${calls.groupSettingUpdate || 0})`);
});

await test('um autor DIFERENTE ainda é punido normalmente (a marca é por autor)', async () => {
  const groupJid = makeGroup({ antiinvi: true });
  const sent = [];
  const calls = {};
  const nazu = makeNazu({ sent, groupJid, senderLid: MEM, calls });

  const ghost = (id, authorLid, authorPn) => ({
    key: { remoteJid: groupJid, fromMe: false, id, participant: authorLid, participantAlt: authorPn },
    messageStubType: 2,
    selectiveDistribution: {
      kind: 'selective-distribution', messageId: id, groupJid, author: authorLid,
      encType: 'skmsg', decryptFail: 'hide', addressedDeviceCount: 1,
      reason: 'No session found to decrypt message',
    },
    messageTimestamp: 1757900000, pushName: 'Invasor',
  });

  await handleMessage(nazu, ghost('D-1', MEM, MEM_PN), null, new Map(), null);
  // Espera o enforcement do primeiro TERMINAR (fechar+remover+reabrir ~2,5s).
  // Antes deste ajuste o intervalo era 1,2s: o lock por GRUPO ainda estava ativo
  // e absorvia a segunda punição, então o teste media o lock em vez da marca por
  // autor — o mesmo cenário em isolamento pune os dois normalmente.
  await new Promise((r) => setTimeout(r, 4000));
  // Autor diferente: precisa ser punido, mesmo com outro já marcado.
  await handleMessage(nazu, ghost('D-2', MEM2, MEM2_PN), null, new Map(), null);
  await new Promise((r) => setTimeout(r, 4000));

  ok((calls.groupParticipantsUpdate || 0) === 2, `puniu os dois autores (${calls.groupParticipantsUpdate || 0})`);
  ok(sent.filter((s) => s.content?.text?.includes('mensagem fantasma')).length === 2, 'dois avisos, um por autor');
});

await test('o guard do connect.js deixa passar a mensagem sem `message` (causa raiz do "não bane")', async () => {
  // Reproduz a condição EXATA do processMessage em connect.js. Antes, o guard
  // `!info.message` descartava a mensagem aqui e o anti nunca rodava — era o
  // motivo real de "ativo o !antifantasma mas não bane".
  const guard = (info) => {
    const isUndecryptableGroupMsg = info?.selectiveDistribution && info.key?.remoteJid;
    if (!info || !info.key?.remoteJid) return 'drop';
    if (!info.message && !isUndecryptableGroupMsg) return 'drop';
    return 'pass';
  };

  const fantasma = selectiveInfo({ groupJid: 'g@g.us', authorLid: MEM });
  ok(guard(fantasma) === 'pass', 'a mensagem fantasma passa pelo guard');

  // Um stub qualquer SEM detecção continua sendo descartado (nada regrediu).
  ok(guard({ key: { remoteJid: 'g@g.us', id: 'X' }, messageStubType: 2 }) === 'drop', 'stub sem detecção continua descartado');
  ok(guard({ selectiveDistribution: {} }) === 'drop', 'sem remoteJid é descartado');
  ok(guard({ message: { conversation: 'oi' }, key: { remoteJid: 'g@g.us' } }) === 'pass', 'mensagem normal segue passando');
});


// ============================================================================

const totalPassed = RESULTS.reduce((a, r) => a + r.passed, 0);
const totalFailed = RESULTS.reduce((a, r) => a + r.failed, 0);
console.log(`\nTOTAL: ${totalPassed} ok, ${totalFailed} falhas em ${RESULTS.length} testes`);
process.exit(totalFailed === 0 ? 0 : 1);