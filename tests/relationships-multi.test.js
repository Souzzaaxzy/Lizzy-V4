/**
 * Testes dos comandos de relacionamento multiplo (!trisal / !quadrisal) e da
 * exibicao via !relacionamento.
 *
 * Executa o HANDLER REAL (NazuninhaBotExec) com um socket Baileys falso, para
 * cobrir o fluxo ponta a ponta: pedido -> aceite de cada participante ->
 * relacionamento formado -> !relacionamento mostrando os parceiros.
 *
 * Regressao principal: depois de trisal/quadrisal formado, !relacionamento
 * respondia "Nenhum relacionamento ativo registrado entre essas pessoas".
 * Causa: em multi, `getActivePairForUser().partnerId` era a lista de parceiros
 * separada por virgula ("b@lid,c@lid") -- que nao e um JID -- e o handler
 * passava isso como "a outra pessoa" para getRelationshipSummary, que resolve
 * o par pela chave de DUAS pessoas. Nunca casava.
 *
 * Uso: node tests/relationships-multi.test.js
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

// Banco temporario ANTES de importar o bot: paths.js le DATABASE_PATH no load.
const TMP_DB = fs.mkdtempSync(path.join(os.tmpdir(), 'lizzy-rel-db-'));
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

/**
 * Normaliza o MATHEMATICAL BOLD/ITALIC do layout para ASCII.
 *
 * Os títulos e rótulos passaram a sair em bold Unicode (`𝐏𝐄𝐃𝐈𝐃𝐎`), então
 * comparar com texto ASCII direto falharia mesmo com a mensagem correta. Aqui
 * a comparação mede o CONTEÚDO (o texto que o usuário lê), não o code point.
 */
function desbold(text) {
  if (typeof text !== 'string') return text;
  let out = '';
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    if (cp >= 0x1d400 && cp <= 0x1d419) out += String.fromCharCode(65 + (cp - 0x1d400));
    else if (cp >= 0x1d41a && cp <= 0x1d433) out += String.fromCharCode(97 + (cp - 0x1d41a));
    else if (cp >= 0x1d468 && cp <= 0x1d481) out += String.fromCharCode(65 + (cp - 0x1d468));
    else if (cp >= 0x1d482 && cp <= 0x1d49b) out += String.fromCharCode(97 + (cp - 0x1d482));
    else if (cp >= 0x1d7ce && cp <= 0x1d7e7) out += String.fromCharCode(48 + (cp - 0x1d7ce));
    else out += ch;
  }
  return out;
}

function includes(haystack, needle, label) {
  ok(typeof haystack === 'string' && desbold(haystack).includes(needle), `${label ?? needle} — esperado conter "${needle}"`);
}

function notIncludes(haystack, needle, label) {
  ok(typeof haystack === 'string' && !desbold(haystack).includes(needle), `${label ?? needle} — não deveria conter "${needle}"`);
}

// ============================================================================
// HANDLER REAL + MODULO DE RELACIONAMENTOS
// ============================================================================

const indexModule = await import(new URL('../dados/src/index.js', import.meta.url).href);
const handleMessage = indexModule.default ?? indexModule;
if (typeof handleMessage !== 'function') throw new Error('index.js não exporta o handler');

const { default: relationshipManager } = await import(
  new URL('../dados/src/funcs/utils/relationships.js', import.meta.url).href
);

// ============================================================================
// FIXTURES
// ============================================================================

const BOT_JID = '5599999999999@s.whatsapp.net';
const BOT_LID = '111111111111111@lid';

let groupCounter = 0;
let personCounter = 0;

/** Cria um grupo com modo brincadeira ligado (exigido por !trisal). */
function makeGroup() {
  groupCounter += 1;
  const groupJid = `1203638000000000${String(groupCounter).padStart(3, '0')}@g.us`;
  fs.writeFileSync(
    path.join(GRUPOS_DIR, `${groupJid}.json`),
    JSON.stringify({ modobrincadeira: true, groupName: `Grupo Rel ${groupCounter}` }, null, 2)
  );
  return groupJid;
}

/** Cria uma pessoa com JID e LID proprios (o handler normaliza os dois). */
function makePerson() {
  personCounter += 1;
  const n = String(personCounter).padStart(4, '0');
  return {
    lid: `5551${n}000000@lid`,
    jid: `5511${n}999999@s.whatsapp.net`,
    name: `5551${n}000000`,
    jidName: `5511${n}999999`,
  };
}

function makeNazu({ sent, groupJid, participants }) {
  const map = {};
  for (const p of participants) {
    map[p.jid] = p.lid;
    map[p.lid] = p.jid;
  }
  return {
    sent,
    sendMessage: async (jid, content, options) => {
      sent.push({ jid, content, options });
      return { key: { id: 'SENT' } };
    },
    user: { id: `${BOT_JID.split('@')[0]}:5@s.whatsapp.net`, lid: BOT_LID, name: 'Lizzy' },
    // O handler resolve admin/LID por aqui.
    onWhatsApp: async (jid) => {
      const lid = map[jid];
      return lid ? [{ jid, exists: true, lid }] : [{ jid, exists: false }];
    },
    signalRepository: {
      lidMapping: {
        getPNForLID: async (lid) => map[lid] || null,
      },
    },
    groupMetadata: async () => ({
      id: groupJid,
      subject: `Grupo Rel`,
      participants: participants.map((p) => ({
        id: p.lid,
        admin: p.isAdmin ? 'admin' : null,
        phoneNumber: p.jid,
      })),
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

/**
 * Executa uma mensagem no handler real.
 *
 * O throttle do bot limita 3 comandos/5s por sender, entao cada execucao usa um
 * autor novo. Para as respostas de aceite ("sim") o autor precisa ser um dos
 * alvos, entao esses casos reutilizam a pessoa convidada.
 *
 * As mencoes vao como LID: e o que o WhatsApp entrega em grupo e o que o
 * handler usa para comparar com o `sender` (tambem LID). Mandar JID aqui faria
 * o "nao pode incluir a si mesmo" e a formacao do trisal nunca casarem.
 */
async function run({ groupJid, sender, text, mentions = [], sent = [], participants }) {
  const nazu = makeNazu({ sent, groupJid, participants });
  const info = {
    key: { remoteJid: groupJid, fromMe: false, id: `M-${Math.random().toString(36).slice(2, 10)}`, participant: sender.lid },
    message: {
      extendedTextMessage: {
        text,
        contextInfo: {
          remoteJid: groupJid,
          mentionedJid: mentions.map((m) => m.lid),
          participant: mentions[0]?.lid,
        },
      },
    },
    messageTimestamp: 1757900000,
    pushName: sender.name,
  };
  await handleMessage(nazu, info, null, new Map(), null);
  return sent.map((s) => s.content?.text ?? '').filter(Boolean).join('\n');
}

/** Cria grupo + participantes (com modo brincadeira) e devolve tudo pronto. */
function setup(n) {
  const groupJid = makeGroup();
  const people = [];
  for (let i = 0; i < n; i++) people.push(makePerson());
  const participants = [...people, { lid: BOT_LID, jid: BOT_JID, name: 'Lizzy', isAdmin: true }];
  return { groupJid, people, participants };
}

/** Faz o pedido de trisal/quadrisal e TODOS os alvos aceitarem. */
async function formGroup(kind, count, { accepts = true } = {}) {
  const { groupJid, people, participants } = setup(count);
  const [requester, ...targets] = people;

  const sent = [];
  const requestText = await run({
    groupJid,
    sender: requester,
    text: `!${kind}`,
    mentions: targets,
    sent,
    participants,
  });

  const acceptTexts = [];
  // Cada alvo responde "sim" individualmente (o bot so forma quando todos aceitam).
  for (const target of targets) {
    acceptTexts.push(
      await run({
        groupJid,
        sender: target,
        text: accepts ? 'sim' : 'não',
        sent,
        participants,
      })
    );
  }

  return { groupJid, people, participants, requester, targets, requestText, acceptTexts, sent };
}

// ============================================================================
// 1) PEDIDO
// ============================================================================

await test('!trisal: exige grupo e modo brincadeira', async () => {
  const { groupJid, people, participants } = setup(3);
  const [requester, t1, t2] = people;

  // Fora de grupo: PV nao forma trisal.
  const pvText = await run({
    groupJid: requester.jid,
    sender: requester,
    text: '!trisal',
    mentions: [t1, t2],
    participants,
  });
  includes(pvText, 'só pode ser usado em grupos', 'recusa fora de grupo');

  // Em grupo, sem modo brincadeira.
  const noModeJid = `1203637000000000${String(++groupCounter).padStart(3, '0')}@g.us`;
  fs.writeFileSync(path.join(GRUPOS_DIR, `${noModeJid}.json`), JSON.stringify({ groupName: 'Sem BN' }, null, 2));
  const noModeText = await run({
    groupJid: noModeJid,
    sender: requester,
    text: '!trisal',
    mentions: [t1, t2],
    participants,
  });
  includes(noModeText, 'modo brincadeira', 'recusa sem modo brincadeira');
});

await test('!trisal: valida quantidade, self e duplicados', async () => {
  const { groupJid, people, participants } = setup(3);
  const [requester, t1] = people;

  const onlyOne = await run({ groupJid, sender: requester, text: '!trisal', mentions: [t1], participants });
  includes(onlyOne, 'Mencione 2 pessoas', 'exige 2 menções');

  const self = await run({ groupJid, sender: requester, text: '!trisal', mentions: [requester, t1], participants });
  includes(self, 'não pode incluir a si mesmo', 'recusa a si mesmo');

  const dup = await run({ groupJid, sender: requester, text: '!trisal', mentions: [t1, t1], participants });
  includes(dup, 'pessoas diferentes', 'recusa duplicados');
});

await test('!quadrisal: exige exatamente 3 pessoas além do autor', async () => {
  const { groupJid, people, participants } = setup(3);
  const [requester, t1, t2] = people;

  const few = await run({ groupJid, sender: requester, text: '!quadrisal', mentions: [t1, t2], participants });
  includes(few, 'Mencione 3 pessoas', 'exige 3 menções');

  const self = await run({
    groupJid,
    sender: requester,
    text: '!quadrisal',
    mentions: [requester, t1, t2],
    participants,
  });
  includes(self, 'não pode incluir a si mesmo', 'recusa a si mesmo');
});

// ============================================================================
// 2) ACEITACAO
// ============================================================================

await test('!trisal: só forma quando TODOS aceitam (parcial avisa quem falta)', async () => {
  const { groupJid, people, participants } = setup(3);
  const [requester, t1, t2] = people;

  await run({ groupJid, sender: requester, text: '!trisal', mentions: [t1, t2], participants });

  const first = await run({ groupJid, sender: t1, text: 'sim', participants });
  includes(first, 'aceitou', 'avisa o aceite');
  includes(first, 'Ainda aguardando', 'avisa quem falta');
  ok(!relationshipManager.getActivePairForUser(requester.lid, groupJid), 'ainda NAO formou com 1 aceite');

  const second = await run({ groupJid, sender: t2, text: 'sim', participants });
  includes(second, 'TRISAL FORMADO', 'forma ao completar');
  ok(relationshipManager.getActivePairForUser(requester.lid, groupJid)?.pair?.status === 'trisal', 'trisal registrado');
});

await test('!quadrisal: forma só com os 3 aceites', async () => {
  const { groupJid, people, participants } = setup(4);
  const [requester, a, b, c] = people;

  await run({ groupJid, sender: requester, text: '!quadrisal', mentions: [a, b, c], participants });
  await run({ groupJid, sender: a, text: 'sim', participants });
  await run({ groupJid, sender: b, text: 'sim', participants });
  ok(!relationshipManager.getActivePairForUser(requester.lid, groupJid), 'ainda não formou com 2 aceites');

  const last = await run({ groupJid, sender: c, text: 'sim', participants });
  includes(last, 'QUADRISAL FORMADO', 'forma no último aceite');
  const ap = relationshipManager.getActivePairForUser(requester.lid, groupJid);
  ok(ap?.pair?.users?.length === 4, `registrou 4 participantes (obtido ${ap?.pair?.users?.length})`);
});

await test('!trisal: recusa de um alvo cancela o pedido inteiro', async () => {
  const { groupJid, people, participants } = setup(3);
  const [requester, t1, t2] = people;

  await run({ groupJid, sender: requester, text: '!trisal', mentions: [t1, t2], participants });
  await run({ groupJid, sender: t1, text: 'sim', participants });
  const cancel = await run({ groupJid, sender: t2, text: 'não', participants });

  includes(cancel, 'CANCELADO', 'avisa o cancelamento');
  ok(!relationshipManager.getActivePairForUser(requester.lid, groupJid), 'não formou nada');
});

// ============================================================================
// 3) EXIBICAO — O BUG PRINCIPAL
// ============================================================================

await test('!relacionamento após trisal: mostra os 3 parceiros (regressao)', async () => {
  const { groupJid, people, participants, requester, targets } = await formGroup('trisal', 3);

  // Cada participante consulta e precisa ver os OUTROS DOIS.
  for (const person of [requester, ...targets]) {
    const others = people.filter((p) => p.lid !== person.lid);
    const text = await run({ groupJid, sender: person, text: '!relacionamento', participants });

    notIncludes(text, 'Nenhum relacionamento ativo', `sem "nenhum relacionamento" para ${person.name}`);
    includes(text, 'Trisal', `status Trisal para ${person.name}`);
    for (const other of others) {
      includes(text, `@${other.name}`, `parceiro @${other.name} na lista de ${person.name}`);
    }
  }
});

await test('!relacionamento após trisal: nunca vaza lista com vírgula (JID inválido)', async () => {
  const { groupJid, people, participants } = await formGroup('trisal', 3);
  const requester = people[0];

  const ap = relationshipManager.getActivePairForUser(requester.lid, groupJid);
  ok(ap && typeof ap.partnerId === 'string' && !ap.partnerId.includes(','),
    `partnerId é um JID único (obtido: ${JSON.stringify(ap?.partnerId)})`);
  ok(Array.isArray(ap.allPartners) && ap.allPartners.length === 2,
    `allPartners traz os 2 demais (obtido: ${ap?.allPartners?.length})`);

  const text = await run({ groupJid, sender: requester, text: '!relacionamento', participants });
  // A virgula como separador da LISTA e esperada; o que nao pode existir e um
  // "@a@lid,@b@lid" (JID invalido com virgula no meio) nem placeholder.
  ok(!/@\S+@lid,\S+@lid/.test(text), 'nenhum JID colado com vírgula no texto');
  notIncludes(text, 'undefined', 'sem undefined');
  notIncludes(text, 'null', 'sem null');
});

await test('!relacionamento após quadrisal: mostra os 4 participantes', async () => {
  const { groupJid, people, participants, requester, targets } = await formGroup('quadrisal', 4);

  const text = await run({ groupJid, sender: requester, text: '!relacionamento', participants });
  notIncludes(text, 'Nenhum relacionamento ativo', 'encontrou o quadrisal');
  includes(text, 'Quadrisal', 'status Quadrisal');
  for (const person of targets) {
    includes(text, `@${person.name}`, `parceiro @${person.name} presente`);
  }
});

await test('!relacionamento com menção (@pessoa) também acha o trisal', async () => {
  const { groupJid, people, participants, requester, targets } = await formGroup('trisal', 3);

  // Marca dois parceiros do mesmo trisal: precisa encontrar o relacionamento.
  const text = await run({
    groupJid,
    sender: requester,
    text: '!relacionamento',
    mentions: [targets[0], targets[1]],
    participants,
  });
  notIncludes(text, 'Nenhum relacionamento ativo', 'achou o trisal pelos mencionados');
  includes(text, 'Trisal', 'status Trisal');
  includes(text, `@${people[0].name}`, 'inclui o autor do trisal');
});

await test('!relacionamento sem relacionamento: mensagem clara, sem quebrar', async () => {
  const { groupJid, people, participants } = setup(1);
  const text = await run({ groupJid, sender: people[0], text: '!relacionamento', participants });
  includes(text, 'não possui relacionamento ativo', 'avisa que não tem relacionamento');
  notIncludes(text, 'undefined', 'sem undefined');
});

// ============================================================================
// 4) ISOLAMENTO POR GRUPO
// ============================================================================

await test('trisal de um grupo não aparece como relacionamento de outro grupo', async () => {
  const { groupJid: g1, people, participants } = await formGroup('trisal', 3);
  const requester = people[0];

  // Mesmo conjunto de pessoas, OUTRO grupo.
  const g2 = makeGroup();
  const textOther = await run({ groupJid: g2, sender: requester, text: '!relacionamento', participants });
  includes(textOther, 'não possui relacionamento ativo', 'não vaza o trisal entre grupos');

  // E no grupo original continua funcionando.
  const textSame = await run({ groupJid: g1, sender: requester, text: '!relacionamento', participants });
  includes(textSame, 'Trisal', 'no grupo certo continua aparecendo');
});

// ============================================================================
// 5) TÉRMINO E TRAIÇÃO EM MULTI
// ============================================================================

await test('!terminartrisal: encerra e libera os participantes', async () => {
  const { groupJid, people, participants, requester } = await formGroup('trisal', 3);

  const text = await run({ groupJid, sender: requester, text: '!terminartrisal', participants });
  includes(text, 'ENCERRADO', 'avisa o término');
  ok(!relationshipManager.getActivePairForUser(requester.lid, groupJid), 'não tem mais trisal');

  // Agora pode entrar em outro relacionamento.
  const again = await run({ groupJid, sender: requester, text: '!relacionamento', participants });
  includes(again, 'não possui relacionamento ativo', 'sem relacionamento após terminar');
});

await test('!quadrisal não é encerrado por !terminartrisal de outro grupo', async () => {
  const { groupJid: g1, people, participants, requester } = await formGroup('quadrisal', 4);
  const otherGroup = makeGroup();

  const text = await run({ groupJid: otherGroup, sender: requester, text: '!terminarquadrisal', participants });
  includes(text, 'não está em nenhum relacionamento', 'não encerra quadrisal de outro grupo');

  ok(relationshipManager.getActivePairForUser(requester.lid, g1)?.pair?.status === 'quadrisal',
    'quadrisal do grupo certo permanece');
});

await test('!trair em trisal: parceiro do próprio trisal não conta como traição', async () => {
  const { groupJid, people, participants, requester, targets } = await formGroup('trisal', 3);

  const text = await run({ groupJid, sender: requester, text: '!trair', mentions: [targets[0]], participants });
  includes(text, 'não pode trair seu parceiro', 'recusa trair parceiro do trisal');
});

// ============================================================================
// 6) RELACIONAMENTO 1-1 CONTINUA FUNCIONANDO
// ============================================================================

await test('1-1 (!casar/!namorar): fluxo e exibição preservados', async () => {
  const { groupJid, people, participants } = setup(2);
  const [a, b] = people;

  const invite = await run({ groupJid, sender: a, text: '!namorar', mentions: [b], participants });
  includes(invite, 'PEDIDO DE NAMORO', 'pedido de namoro enviado');

  const accepted = await run({ groupJid, sender: b, text: 'sim', participants });
  includes(accepted, 'namorando', 'namoro formado');

  const text = await run({ groupJid, sender: a, text: '!relacionamento', participants });
  includes(text, 'Parceiros', 'rótulo no singular/par');
  includes(text, `@${b.name}`, 'mostra o parceiro');
  includes(text, 'Namoro', 'status Namoro');

  const ap = relationshipManager.getActivePairForUser(a.lid, groupJid);
  ok(ap?.partnerId === b.lid, `partnerId é o parceiro (obtido ${ap?.partnerId})`);
  ok(ap?.allPartners === undefined, '1-1 não expõe allPartners');
});

// ============================================================================
// 7) LAYOUT NOVO + NEWSLETTER (set/2026)
// ============================================================================

await test('layout: pedido/aceitação/status usam a caixa ꧁༺ ✦ ༻꧂', async () => {
  const { groupJid, people, participants } = setup(2);
  const [a, b] = people;

  const invite = await run({ groupJid, sender: a, text: '!namorar', mentions: [b], participants });
  includes(invite, '╭━━━꧁༺', 'pedido abre a caixa');
  includes(invite, '╰━━━꧁༺ ✦', 'pedido fecha a caixa com o nome do bot');
  includes(invite, '✦ ༻꧂━━━╯', 'pedido tem o fecho completo');

  const accepted = await run({ groupJid, sender: b, text: 'sim', participants });
  includes(accepted, '╭━━━꧁༺', 'aceitação abre a caixa');
  includes(accepted, '✦ ༻꧂━━━╯', 'aceitação fecha a caixa');

  const status = await run({ groupJid, sender: a, text: '!relacionamento', participants });
  includes(status, '╭━━━꧁༺', 'status abre a caixa');
  includes(status, '✦ ༻꧂━━━╯', 'status fecha a caixa');
  // Títulos em bold Unicode de verdade (MATHEMATICAL BOLD), não texto cru.
  ok(/[\u{1D400}-\u{1D433}]/u.test(invite), 'título do pedido em bold Unicode');
  ok(/[\u{1D400}-\u{1D433}]/u.test(status), 'título do status em bold Unicode');
  // Nunca sobra marcador de markdown antigo no cabeçalho.
  notIncludes(invite.split('\n')[0], '*', 'cabeçalho sem asteriscos');
});

await test('newsletter: pedido, aceitação e status levam o cabeçalho de canal', async () => {
  const { groupJid, people, participants } = setup(2);
  const [a, b] = people;

  const sent = [];
  await run({ groupJid, sender: a, text: '!namorar', mentions: [b], participants, sent });
  await run({ groupJid, sender: b, text: 'sim', participants, sent });
  await run({ groupJid, sender: a, text: '!relacionamento', participants, sent });

  // Só as mensagens com texto do relacionamento (as demais não têm contextInfo).
  const comCtx = sent.filter((s) => s.content?.text && s.content?.contextInfo);
  ok(comCtx.length >= 3, `3 mensagens com contextInfo (obtido ${comCtx.length})`);

  for (const s of comCtx) {
    const info = s.content.contextInfo;
    ok(info?.forwardedNewsletterMessageInfo?.newsletterJid === '120363410980452460@newsletter',
      `newsletter presente (${s.content.text.slice(0, 20)}...)`);
    ok(info.isForwarded === true, 'marcado como encaminhado do canal');
  }

  // E o corpo do newsletter não aparece no texto.
  for (const s of comCtx) {
    notIncludes(s.content.text, 'newsletterJid', 'texto sem vazar o contexto');
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