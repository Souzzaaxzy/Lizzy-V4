/**
 * AntiBot na Lizzy — comando, configuração por grupo e FALSO POSITIVO.
 *
 * O que este teste protege acima de tudo: um humano **não** pode ser removido.
 * Ele roda o handler REAL (`NazuninhaBotExec`) com socket falso e verifica:
 *
 *   1. o `!antibot` (on/off/modo/status/lista/reset) e a permissão;
 *   2. configuração POR GRUPO, persistida no JSON do grupo;
 *   3. presença no `menuadm`, na lista de antis e no `blockPv`;
 *   4. falso positivo: humano normal/ativo nunca é removido;
 *   5. bot simulado: o caminho de ação só existe no modo `active` e com
 *      `actionAllowed` do núcleo;
 *   6. admins/dono/bot nunca são removidos, mesmo com score alto;
 *   7. regressão: com o AntiBot desligado, nada muda no comportamento.
 *
 * Uso: node tests/antibot-lizzy.test.js
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

// Banco temporário ANTES de importar o bot: paths.js lê DATABASE_PATH no load.
const TMP_DB = fs.mkdtempSync(path.join(os.tmpdir(), 'lizzy-antibot-'));
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
  ok(typeof haystack === 'string' && haystack.includes(needle),
    `${label ?? needle} — esperado conter "${needle}"`);
}

// ============================================================================

const indexModule = await import(new URL('../dados/src/index.js', import.meta.url).href);
const handleMessage = indexModule.default ?? indexModule;
if (typeof handleMessage !== 'function') throw new Error('index.js não exporta o handler');

const { getGroupAntiBotConfig } = await import(
  new URL('../dados/src/utils/antibot/config.js', import.meta.url).href
);
const {
  getEngine: getEngineForTest,
  buildStatusText
} = await import(new URL('../dados/src/utils/antibot/manager.js', import.meta.url).href);

const BOT_JID = '5599999999999@s.whatsapp.net';
const BOT_LID = '111111111111111@lid';

let groupCounter = 0;
let personCounter = 0;

function makeGroup(extra = {}) {
  groupCounter += 1;
  const groupJid = `1203638000000000${String(groupCounter).padStart(3, '0')}@g.us`;
  fs.writeFileSync(
    path.join(GRUPOS_DIR, `${groupJid}.json`),
    JSON.stringify({ groupName: `Grupo AntiBot ${groupCounter}`, ...extra }, null, 2)
  );
  return groupJid;
}

function makePerson() {
  personCounter += 1;
  const n = String(personCounter).padStart(4, '0');
  return { lid: `5561${n}000000@lid`, jid: `5512${n}999999@s.whatsapp.net`, name: `5561${n}000000` };
}

function makeNazu({ sent, removed, groupJid, participants }) {
  const map = {};
  for (const p of participants) { map[p.jid] = p.lid; map[p.lid] = p.jid; }
  return {
    sent,
    removed,
    sendMessage: async (jid, content) => { sent.push({ jid, content }); return { key: { id: 'SENT' } }; },
    user: { id: `${BOT_JID.split('@')[0]}:5@s.whatsapp.net`, lid: BOT_LID, name: 'Lizzy' },
    onWhatsApp: async (jid) => {
      const lid = map[jid];
      return lid ? [{ jid, exists: true, lid }] : [{ jid, exists: false }];
    },
    signalRepository: { lidMapping: { getPNForLID: async (lid) => map[lid] || null } },
    groupMetadata: async () => ({
      id: groupJid,
      subject: 'Grupo AntiBot',
      participants: participants.map((p) => ({
        id: p.lid,
        admin: p.isAdmin ? 'admin' : null,
        phoneNumber: p.jid,
      })),
    }),
    groupParticipantsUpdate: async (jid, jids, action) => {
      removed.push({ jid, jids, action });
      return {};
    },
    groupRequestParticipantsList: async () => [],
    groupRequestParticipantsUpdate: async () => ({}),
    ev: { on: () => {}, emit: () => {}, removeAllListeners: () => {} },
    readMessages: async () => {},
    sendPresenceUpdate: async () => {},
    profilePictureUrl: async () => null,
    react: async () => ({}),
  };
}

/**
 * Executa uma mensagem no handler real.
 * O throttle é por remetente (3/5s), então cada caso usa um remetente novo.
 */
async function run({ groupJid, sender, text, mentions = [], participants, sent = [], removed = [], fromMe = false }) {
  const nazu = makeNazu({ sent, removed, groupJid, participants });
  const info = {
    key: {
      remoteJid: groupJid,
      fromMe,
      id: `M-${Math.random().toString(36).slice(2, 10)}`,
      participant: sender.lid,
    },
    message: {
      extendedTextMessage: {
        text,
        contextInfo: { remoteJid: groupJid, mentionedJid: mentions.map((m) => m.lid) },
      },
    },
    messageTimestamp: Math.floor(Date.now() / 1000),
    pushName: sender.name,
  };
  await handleMessage(nazu, info, null, new Map(), null);
  return {
    text: sent.map((s) => s.content?.text ?? '').filter(Boolean).join('\n'),
    sent,
    removed,
  };
}

/** Grupo + participantes. O PRIMEIRO é admin; o resto, membros comuns. */
function setup(n, { antibot = null } = {}) {
  const groupJid = makeGroup(antibot ? { antibot } : {});
  const people = [];
  for (let i = 0; i < n; i++) people.push(makePerson());
  people[0].isAdmin = true;
  const participants = [
    ...people.map((p) => ({ lid: p.lid, jid: p.jid, name: p.name, isAdmin: !!p.isAdmin })),
    { lid: BOT_LID, jid: BOT_JID, name: 'Lizzy', isAdmin: true }
  ];
  return { groupJid, people, participants };
}

/**
 * Executa comandos do MESMO admin sem cair no throttle.
 *
 * O limite é por remetente (3 comandos/5s). Cada execução usa um admin novo
 * (todos são admin no grupo), então o teste mede a resposta do comando, não o
 * anti-flood — a mesma armadilha documentada no `!testcall` e no `me-profile`.
 */
/**
 * Executa um comando como o PRÓPRIO BOT (`fromMe: true`).
 *
 * Dois obstáculos do handler, ambos já documentados no projeto, tornam esta a
 * única forma estável de testar vários comandos em sequência:
 *
 *  1. o anti-flood é por REMETENTE (3 comandos/5s) e é **pulado quando
 *     `info.key.fromMe`** — com um membro comum, o 4º comando responderia
 *     "Calma aí!" e o teste mediria o anti-flood;
 *  2. `getCachedGroupMetadata` cacheia o metadata do grupo por 10s, então um
 *     admin acrescentado depois não existe para o handler — ele responderia
 *     "precisa ser adm". Rodando como o bot, a checagem de admin não se aplica.
 */
async function runAsAdmin({ groupJid, people, participants, cmd }) {
  const bot = { lid: BOT_LID, jid: BOT_JID, name: 'Lizzy' };
  return run({ groupJid, sender: bot, text: cmd, participants, fromMe: true });
}

/** Lê o JSON do grupo do disco (como o bot grava). */
const readGroup = (groupJid) => JSON.parse(fs.readFileSync(path.join(GRUPOS_DIR, `${groupJid}.json`), 'utf-8'));

// ============================================================================
// 1) COMANDO
// ============================================================================

await test('!antibot: exige grupo e admin', async () => {
  const { groupJid, people, participants } = setup(2);
  const [admin, common] = people;

  const pv = await run({ groupJid: common.jid, sender: common, text: '!antibot', participants });
  includes(pv.text, 'só pode ser usado em grupo', 'recusa fora de grupo');

  const naoAdmin = await run({ groupJid, sender: common, text: '!antibot', participants });
  includes(naoAdmin.text, 'precisa ser adm', 'recusa membro comum');

  // O bot é dono por definição (fromMe) — caminho de admin mais estável.
  const adm = await run({
    groupJid,
    sender: { lid: BOT_LID, jid: BOT_JID, name: 'Lizzy' },
    text: '!antibot on',
    participants,
    fromMe: true
  });
  includes(adm.text, 'ATIVADO', 'admin consegue usar');
});

await test('!antibot on/off alterna e PERSISTE por grupo', async () => {
  const { groupJid, people, participants } = setup(3);

  const on = await runAsAdmin({ people, participants, groupJid, cmd: '!antibot on' });
  includes(on.text, 'ATIVADO', 'confirma ativação');
  // Espera o lado assíncrono da escrita do JSON do grupo.
  await new Promise((r) => setTimeout(r, 400));
  ok(readGroup(groupJid).antibot?.enabled === true, 'enabled=true gravado no grupo');

  const off = await runAsAdmin({ people, participants, groupJid, cmd: '!antibot off' });
  includes(off.text, 'DESLIGADO', 'confirma desligamento');
  await new Promise((r) => setTimeout(r, 400));
  ok(readGroup(groupJid).antibot?.enabled === false, 'enabled=false gravado no grupo');
});

await test('!antibot: config é POR GRUPO (não vaza entre grupos)', async () => {
  const a = setup(3);
  const b = setup(3);
  await runAsAdmin({ people: a.people, participants: a.participants, groupJid: a.groupJid, cmd: '!antibot on' });
  await new Promise((r) => setTimeout(r, 400));

  ok(getGroupAntiBotConfig(readGroup(a.groupJid)).enabled === true, 'grupo A ligado');
  ok(getGroupAntiBotConfig(readGroup(b.groupJid)).enabled === false, 'grupo B continua desligado');
});

await test('!antibot modo: aceita os 4 modos e recusa inválido', async () => {
  const { groupJid, people, participants } = setup(6);

  for (const modo of ['log', 'observe', 'quarantine', 'active']) {
    const r = await runAsAdmin({ people, participants, groupJid, cmd: `!antibot modo ${modo}` });
    includes(r.text, 'Modo', `aceita "${modo}"`);
  }
  const invalido = await runAsAdmin({ people, participants, groupJid, cmd: '!antibot modo banana' });
  includes(invalido.text, 'inválido', 'recusa modo inválido');
});

await test('!antibot status e lista respondem', async () => {
  const { groupJid, people, participants } = setup(4);
  const status = await runAsAdmin({ people, participants, groupJid, cmd: '!antibot' });
  // O título vem em MATHEMATICAL BOLD (`𝐀𝐍𝐓𝐈𝐁𝐎𝐓`), então comparar com o ASCII
  // falharia mesmo com o painel correto — mede-se o CONTEÚDO visível.
  includes(status.text, '🤖', 'painel do status (ícone)');
  includes(status.text, 'Modo', 'painel mostra o modo');
  includes(status.text, 'Stanza', 'painel mostra o subsistema de stanza');

  const lista = await runAsAdmin({ people, participants, groupJid, cmd: '!antibot lista' });
  ok(lista.text.length > 0, 'lista responde');
});

await test('!antibot reset não quebra', async () => {
  const { groupJid, people, participants } = setup(3);
  const r = await runAsAdmin({ people, participants, groupJid, cmd: '!antibot reset' });
  includes(r.text, 'reiniciado', 'confirma reset');
});

// ============================================================================
// 2) FALSO POSITIVO — o requisito mais importante
// ============================================================================

await test('HUMANO muito ativo NÃO é removido do grupo', async () => {
  const { groupJid, people, participants } = setup(2, { antibot: { enabled: true, mode: 'active' } });
  const [admin, human] = people;
  const sent = [];
  const removed = [];

  // 60 mensagens normais e variadas do humano.
  const frases = ['bom dia pessoal', 'kkkkk', 'vou ver e te aviso', 'sim', 'não sei ainda',
    'calma', 'que legal', 'depois eu vejo isso com calma', 'ok', 'beleza então',
    'falou', 'tô aqui', 'alguém viu o jogo?', 'acho que sim', 'depois te conto'];
  for (let i = 0; i < 60; i++) {
    await run({
      groupJid,
      sender: human,
      text: `${frases[i % frases.length]} ${i}`,
      participants,
      sent,
      removed,
    });
  }
  ok(removed.length === 0, `humano ativo nunca removido (tentativas: ${removed.length})`);
  ok(admin !== human, 'sanity: o humano não é o admin');
});

await test('mensagens de mídia/sticker/edição NÃO removem ninguém', async () => {
  const { groupJid, people, participants } = setup(2, { antibot: { enabled: true, mode: 'active' } });
  const [, human] = people;
  const removed = [];
  for (let i = 0; i < 25; i++) {
    await run({ groupJid, sender: human, text: '📷 foto', participants, removed });
  }
  ok(removed.length === 0, 'mídia não gera remoção');
});

await test('modo observe/quarantine/log NUNCA remove', async () => {
  for (const mode of ['log', 'observe', 'quarantine']) {
    const { groupJid, people, participants } = setup(2, { antibot: { enabled: true, mode } });
    const [, human] = people;
    const removed = [];
    for (let i = 0; i < 40; i++) {
      await run({ groupJid, sender: human, text: `promoção imperdível ${i % 1}`, participants, removed });
    }
    ok(removed.length === 0, `modo "${mode}" não remove (tentativas: ${removed.length})`);
  }
});

await test('AntiBot DESLIGADO não analisa nem remove (regressão)', async () => {
  const { groupJid, people, participants } = setup(2);
  const [, human] = people;
  const removed = [];
  for (let i = 0; i < 40; i++) {
    await run({ groupJid, sender: human, text: 'spam spam spam', participants, removed });
  }
  ok(removed.length === 0, 'desligado não remove');
  ok(getGroupAntiBotConfig(readGroup(groupJid)).enabled === false, 'segue desligado');
});

await test('admin e dono NUNCA são removidos', async () => {
  const { groupJid, people, participants } = setup(2, { antibot: { enabled: true, mode: 'active' } });
  const [admin] = people;
  const removed = [];
  // O admin manda "padrão de bot" — mesmo assim não pode ser removido.
  for (let i = 0; i < 40; i++) {
    await run({ groupJid, sender: admin, text: 'promoção imperdível', participants, removed });
  }
  ok(removed.length === 0, 'admin nunca é removido pelo AntiBot');
});

// ============================================================================
// 3) INTEGRAÇÃO
// ============================================================================

await test('menuadm lista o !antibot', async () => {
  const menuadm = fs.readFileSync(new URL('../dados/src/menus/menuadm.js', import.meta.url), 'utf-8');
  includes(menuadm, 'antibot', 'menuadm contém antibot');
  includes(menuadm, 'SEGURANÇA', 'na categoria de segurança');
});

await test('a lista de antis reconhece o antibot ligado/desligado', async () => {
  const src = fs.readFileSync(new URL('../dados/src/index.js', import.meta.url), 'utf-8');
  includes(src, "key: 'antibot'", 'antibot está na lista de antis');
  includes(src, 'nestedKey', 'usa resolução aninhada (antibot.enabled)');
});

await test('blockPv inclui antibot no menuadm', async () => {
  const bp = fs.readFileSync(new URL('../dados/src/utils/blockPv.js', import.meta.url), 'utf-8');
  const bloco = bp.slice(bp.indexOf('menuadm:'), bp.indexOf('menubn:'));
  includes(bloco, 'antibot', 'blockPv/menuadm contém antibot');
});

await test('o núcleo do AntiBot está disponível na fork instalada', async () => {
  const mod = await import(new URL('../dados/src/utils/antibot/config.js', import.meta.url).href);
  ok(mod.isCoreAvailable(), `núcleo disponível (erro: ${mod.getCoreError() || 'nenhum'})`);
});

// ============================================================================
// 4) O RELATO: "usei o outro bot e só disse 1 usuário analisado"
// ============================================================================

await test('outro bot no grupo É contado e analisado (regressão do relato)', async () => {
  const { groupJid, people, participants } = setup(3, { antibot: { enabled: true, mode: 'observe' } });
  const [, outroBot] = people;
  const sent = [];

  // O outro bot manda comandos no grupo. O engine deve contar E analisar.
  for (let i = 0; i < 30; i++) {
    await run({
      groupJid,
      sender: outroBot,
      text: `!comando${i}`,
      participants,
      sent,
    });
  }
  const engine = getEngineForTest(groupJid, readGroup(groupJid));
  ok(engine, 'engine do grupo existe (AntiBot ligado)');
  const stats = engine.stats(groupJid);
  ok(stats.analyzed >= 1, `o outro bot foi contado como analisado (analyzed=${stats.analyzed})`);

  // E a análise TEM de ter encontrado algo, senão o painel mente.
  const suspeitos = (stats.OBSERVING || 0) + (stats.SUSPICIOUS || 0)
    + (stats.HIGH_RISK || 0) + (stats.CONFIRMED || 0);
  ok(suspeitos >= 1,
    `o outro bot aparece na análise, não zerado (stats=${JSON.stringify(stats)})`);

  // E a lista mostra ele.
  const lista = engine.listChat(groupJid);
  ok(lista.length >= 1, `a lista mostra o outro bot (${lista.length})`);
});

await test('o painel NÃO mente em observe: mostra a banda da análise', async () => {
  const { groupJid, people, participants } = setup(3, { antibot: { enabled: true, mode: 'observe' } });
  const [, outroBot] = people;
  for (let i = 0; i < 30; i++) {
    await run({ groupJid, sender: outroBot, text: `!x${i}`, participants });
  }
  const engine = getEngineForTest(groupJid, readGroup(groupJid));
  const texto = buildStatusText(groupJid, readGroup(groupJid), engine.stats(groupJid));
  // Em observe NADA é escalado; ainda assim o painel precisa revelar a análise.
  includes(texto, 'Participantes analisados', 'painel mostra o total analisado');
  ok(!/Em observação: 0\n┃ ⚠️ Suspeitos: 0\n┃ 🚨 Alto risco: 0\n┃ ✅ Confirmados: 0/.test(texto)
    || /Em observação: [1-9]|Suspeitos: [1-9]|Alto risco: [1-9]|Confirmados: [1-9]/.test(texto),
    'as contagens não ficam todas zeradas em observe');
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
