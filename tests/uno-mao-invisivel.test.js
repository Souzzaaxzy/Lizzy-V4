/**
 * Testes do `!uno mao` (e das outras mãos) — entrega NO GRUPO, só para quem pediu.
 *
 * O que mudou: as mãos do UNO iam por **PV** (`nazu.sendMessage(sender, …)`).
 * Agora vão NO GRUPO, pelo mesmo transporte do `!impostor`: a stanza é
 * endereçada ao grupo, mas o material da Sender Key só é distribuído ao
 * jogador (`allowedParticipants: [jogador]`) — os outros recebem a referência
 * e não decifram.
 *
 * Este teste roda o HANDLER REAL com socket falso e verifica:
 *   - NADA vai para PV (o `jid` do envio é sempre o do grupo);
 *   - a entrega usa a API restrita, com `allowedParticipants` de UM jogador;
 *   - o `messageId` vai junto (a fork precisa dele p/ suprimir o retry);
 *   - falha FECHADO quando a API não existe (não cai para o grupo inteiro).
 *
 * Uso: node tests/uno-mao-invisivel.test.js
 */

import fs from 'fs';
import os from 'os';
import path from 'path';

const TMP_DB = fs.mkdtempSync(path.join(os.tmpdir(), 'lizzy-uno-db-'));
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
      return r.then(() => finish()).catch((e) => { CURRENT.failed++; CURRENT.errors.push(`EXCEÇÃO: ${e?.stack || e}`); finish(); });
    }
    finish();
  } catch (e) { CURRENT.failed++; CURRENT.errors.push(`EXCEÇÃO: ${e?.stack || e}`); finish(); }
  return Promise.resolve();
}
function finish() {
  console.log(`${CURRENT.failed === 0 ? '✅' : '❌'} ${CURRENT.name} (${CURRENT.passed} ok, ${CURRENT.failed} falhas)`);
  for (const err of CURRENT.errors) console.log(`     ${err.split('\n')[0]}`);
}
function ok(c, m) { if (c) CURRENT.passed++; else { CURRENT.failed++; CURRENT.errors.push(`ASSERT FALHOU: ${m}`); } }

const indexModule = await import(new URL('../dados/src/index.js', import.meta.url).href);
const handleMessage = indexModule.default ?? indexModule;

const BOT_JID = '5599999999999@s.whatsapp.net';
const BOT_LID = '111111111111111@lid';

let groupCounter = 0;
let senderCounter = 0;
function makeGroup() {
  groupCounter += 1;
  const jid = `1203638000000000${String(groupCounter).padStart(3, '0')}@g.us`;
  fs.writeFileSync(path.join(GRUPOS_DIR, `${jid}.json`),
    JSON.stringify({ modobrincadeira: true, groupName: `Grupo UNO ${groupCounter}` }, null, 2));
  return jid;
}
function makePlayer(label) {
  senderCounter += 1;
  const n = String(senderCounter).padStart(4, '0');
  return { lid: `4441${n}000000@lid`, jid: `5511${n}888888@s.whatsapp.net`, name: `Jogador ${label ?? n}` };
}

/** Socket falso que SEPARA envio no grupo de envio no PV. */
function makeNazu({ sent, groupJid, participants, comApiRestrita = true }) {
  const nazu = {
    sendMessage: async (jid, content, options) => {
      sent.push({ jid, content, options, via: 'sendMessage' });
      return { key: { id: 'S1' } };
    },
    user: { id: BOT_JID, lid: BOT_LID, name: 'Lizzy' },
    store: { contacts: {} },
    groupMetadata: async () => ({
      id: groupJid,
      subject: 'Grupo UNO',
      participants: participants.map((p) => ({ id: p.lid, lid: p.lid, phoneNumber: p.jid, notify: p.name, admin: null }))
    }),
    ev: { on: () => {}, emit: () => {}, removeAllListeners: () => {} },
    readMessages: async () => {},
    sendPresenceUpdate: async () => {},
    profilePictureUrl: async () => 'x',
    react: async () => ({}),
  };
  if (comApiRestrita) {
    nazu.relayGroupMessageWithSenderKeyRotation = async (grupo, msg, opts) => {
      sent.push({ jid: grupo, message: msg, options: opts, via: 'restrito' });
      return { groupJid: grupo, messageId: opts?.messageId, allowedParticipants: opts?.allowedParticipants };
    };
  }
  return nazu;
}

let cenario = 0;
async function rodar({ groupJid, text, autor, participants, comApiRestrita = true }) {
  cenario += 1;
  const sent = [];
  const nazu = makeNazu({ sent, groupJid, participants, comApiRestrita });
  await handleMessage(nazu, {
    key: { remoteJid: groupJid, fromMe: false, id: `M-${cenario}`, participant: autor.lid },
    message: { extendedTextMessage: { text, contextInfo: { remoteJid: groupJid } } },
    messageTimestamp: 1757900000,
    pushName: autor.name,
  }, null);
  return { sent, nazu };
}

console.log('\n=== !uno mao — no GRUPO, só para quem pediu ===\n');

await test('!uno mao NAO manda nada no PV (tudo vai endereçado ao grupo)', async () => {
  const g = makeGroup();
  const a = makePlayer('A'), b = makePlayer('B');
  const players = [a, b];
  await rodar({ groupJid: g, text: '!uno criar', autor: a, participants: players });
  await rodar({ groupJid: g, text: '!uno entrar', autor: b, participants: players });
  await rodar({ groupJid: g, text: '!uno iniciar', autor: a, participants: players });

  const { sent } = await rodar({ groupJid: g, text: '!uno mao', autor: b, participants: players });

  const paraPV = sent.filter((s) => s.jid === b.lid || s.jid === b.jid);
  ok(paraPV.length === 0, `nada foi para o PV do jogador (veio ${paraPV.length})`);

  const restritos = sent.filter((s) => s.via === 'restrito');
  ok(restritos.length >= 1, `usou a entrega restrita (veio ${restritos.length})`);
  for (const r of restritos) {
    ok(r.jid === g, 'a stanza e endereçada AO GRUPO');
  }
});

await test('a mão chega só ao jogador: allowedParticipants = [ele]', async () => {
  const g = makeGroup();
  const a = makePlayer('A'), b = makePlayer('B');
  const players = [a, b];
  await rodar({ groupJid: g, text: '!uno criar', autor: a, participants: players });
  await rodar({ groupJid: g, text: '!uno entrar', autor: b, participants: players });
  await rodar({ groupJid: g, text: '!uno iniciar', autor: a, participants: players });

  const { sent } = await rodar({ groupJid: g, text: '!uno mao', autor: b, participants: players });
  const daMao = sent.filter((s) => s.via === 'restrito').pop();

  ok(!!daMao, 'houve entrega restrita');
  const allowed = daMao?.options?.allowedParticipants || [];
  ok(allowed.length === 1, `exatamente 1 autorizado (veio ${allowed.length})`);
  ok(allowed[0] === b.lid, `o autorizado é quem pediu (${allowed[0]})`);
  ok(!!daMao?.options?.messageId, 'leva messageId (a fork precisa dele p/ suprimir o retry)');
  ok(/Sua mão atual/i.test(daMao?.message?.extendedTextMessage?.text || ''), 'o conteudo e a mao atual');
});

await test('a mão INICIAL (no !uno iniciar) tambem vai restrita, um envio por jogador', async () => {
  const g = makeGroup();
  const a = makePlayer('A'), b = makePlayer('B'), c = makePlayer('C');
  const players = [a, b, c];
  await rodar({ groupJid: g, text: '!uno criar', autor: a, participants: players });
  await rodar({ groupJid: g, text: '!uno entrar', autor: b, participants: players });
  await rodar({ groupJid: g, text: '!uno entrar', autor: c, participants: players });

  const { sent } = await rodar({ groupJid: g, text: '!uno iniciar', autor: a, participants: players });

  // Nenhum PV para nenhum jogador.
  for (const p of players) {
    ok(!sent.some((s) => s.jid === p.lid || s.jid === p.jid), `nada no PV de ${p.name}`);
  }
  const restritos = sent.filter((s) => s.via === 'restrito');
  const comMaoInicial = restritos.filter((s) => /Sua mão inicial/i.test(s?.message?.extendedTextMessage?.text || ''));
  ok(comMaoInicial.length === players.length, `1 envio restrito por jogador (veio ${comMaoInicial.length})`);
  for (const s of comMaoInicial) {
    const allowed = s.options?.allowedParticipants || [];
    ok(allowed.length === 1, `cada envio autoriza 1 jogador (veio ${allowed.length})`);
    ok(s.jid === g, 'endereçado ao grupo');
  }
  const autorizados = comMaoInicial.map((s) => s.options.allowedParticipants[0]).sort();
  const esperados = players.map((p) => p.lid).sort();
  ok(JSON.stringify(autorizados) === JSON.stringify(esperados), 'cada jogador recebeu a SUA mão');
});

await test('falha FECHADO sem a API restrita (nao cai para o grupo inteiro)', async () => {
  const g = makeGroup();
  const a = makePlayer('A'), b = makePlayer('B');
  const players = [a, b];
  await rodar({ groupJid: g, text: '!uno criar', autor: a, participants: players });
  await rodar({ groupJid: g, text: '!uno entrar', autor: b, participants: players });
  await rodar({ groupJid: g, text: '!uno iniciar', autor: a, participants: players });

  const { sent } = await rodar({ groupJid: g, text: '!uno mao', autor: b, participants: players, comApiRestrita: false });
  // Sem a API, nada pode mostrar a mao: nem no PV, nem no grupo aberto.
  const vazou = sent.filter((s) => /Sua mão atual/i.test(
    s?.message?.extendedTextMessage?.text || s?.content?.text || ''
  ));
  ok(vazou.length === 0, `a mao NAO vazou por nenhum caminho (veio ${vazou.length})`);
});

await test('o help nao promete mais "envia no PV"', async () => {
  const g = makeGroup();
  const a = makePlayer('A');
  const { sent } = await rodar({ groupJid: g, text: '!uno ajuda', autor: a, participants: [a] });
  const txt = sent.map((s) => s?.content?.text || '').join('\n');
  ok(!/no PV/i.test(txt), 'o help nao diz mais que vai no PV');
  ok(/só você vê|so voce ve/i.test(txt), 'o help diz que so quem pediu ve');
});

console.log('\n=== RESUMO ===');
const totalOk = RESULTS.reduce((a, r) => a + r.passed, 0);
const totalFail = RESULTS.reduce((a, r) => a + r.failed, 0);
console.log(`${RESULTS.length} testes / ${totalOk} assercoes ok / ${totalFail} falhas`);
process.exit(totalFail === 0 ? 0 : 1);
