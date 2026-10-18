/**
 * !mencoes — quem te marcou hoje.
 *
 * Roda o HANDLER REAL com socket falso. O ponto central: o REGISTRO e' feito em
 * toda mensagem de grupo (nao so' nos comandos), e o `marcar <n>` cita a
 * mensagem ORIGINAL pelo objeto do `messagesCache`.
 *
 * Cobre: a lista de hoje, a contagem por pessoa, a consulta por nome/numero,
 * o indice, o `marcar` (com o cache e sem o cache), a deduplicacao, o alvo
 * certo (so' quem foi marcado), e o menu.
 *
 * Uso: node tests/mencoes.test.js
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const TMP_DB = fs.mkdtempSync(path.join(os.tmpdir(), 'lizzy-mencoes-'));
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
 * O layout da Lizzy poe os TITULOS em MATHEMATICAL BOLD. As assercoes medem o
 * TEXTO, entao comparam sem o bold (senao falhariam com a mensagem correta).
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
  const alvo = desbold(haystack);
  ok(typeof alvo === 'string' && alvo.includes(needle), `${label ?? needle} — esperado conter "${needle}"`);
}

/** Como `includes`, mas para o TITULO (que sai em bold). */
function includesTxt(haystack, needle, label) {
  includes(desbold(haystack), needle, label);
}

// ============================================================================
// HANDLER REAL
// ============================================================================

const indexModule = await import(new URL('../dados/src/index.js', import.meta.url).href);
const handleMessage = indexModule.default ?? indexModule;
if (typeof handleMessage !== 'function') throw new Error('index.js nao exporta o handler');

const mencoes = await import(new URL('../dados/src/utils/mencoes.js', import.meta.url).href);

// ============================================================================
// FIXTURES
// ============================================================================

const BOT_JID = '5599999999999@s.whatsapp.net';
const BOT_LID = '111111111111111@lid';
const AUTOR_LID = '111000000000002@lid';
const AUTOR_JID = '5511000000002@s.whatsapp.net';
const ALVO_LID = '111000000000003@lid';
const ALVO_JID = '5511000000003@s.whatsapp.net';

let groupCounter = 0;
let senderCounter = 0;


/**
 * Um LID de ALVO novo por teste de consulta.
 *
 * O throttle do handler e' por REMETENTE (3 comandos/5s). Os testes de consulta
 * mandam varios comandos seguidos COMO o alvo (e' a caixa dele), entao reusar o
 * mesmo LID faz o 4o responder "Calma ai!" e o teste medir o rate limit.
 */
let alvoCounter = 0;
function novoAlvo() {
  alvoCounter += 1;
  return `3333${String(alvoCounter).padStart(6, '0')}@lid`;
}

function makeGroup() {
  groupCounter += 1;
  const groupJid = `1203639111111100${String(groupCounter).padStart(3, '0')}@g.us`;
  fs.writeFileSync(
    path.join(GRUPOS_DIR, `${groupJid}.json`),
    JSON.stringify({ groupName: 'Grupo Mencoes' }, null, 2)
  );
  return groupJid;
}

function makeNazu({ sent, groupJid }) {
  return {
    sendMessage: async (jid, content, options) => {
      sent.push({ jid, content, options });
      return { key: { id: `SENT-${sent.length}` } };
    },
    user: { id: `${BOT_JID.split('@')[0]}:5@s.whatsapp.net`, lid: BOT_LID, name: 'Lizzy' },
    onWhatsApp: async (jid) => {
      const map = { [AUTOR_JID]: AUTOR_LID, [ALVO_JID]: ALVO_LID, [BOT_JID]: BOT_LID };
      const lid = map[jid];
      return lid ? [{ jid, exists: true, lid }] : [{ jid, exists: false }];
    },
    signalRepository: {
      lidMapping: {
        getPNForLID: async (lid) => ({
          [AUTOR_LID]: AUTOR_JID, [ALVO_LID]: ALVO_JID, [BOT_LID]: BOT_JID,
        }[lid] || null),
      },
    },
    groupMetadata: async () => ({
      id: groupJid,
      subject: 'Grupo Mencoes',
      participants: [
        { id: AUTOR_LID, admin: 'admin', phoneNumber: AUTOR_JID, notify: 'Ana' },
        { id: ALVO_LID, admin: null, phoneNumber: ALVO_JID, notify: 'Alvo' },
        { id: BOT_LID, admin: 'admin', phoneNumber: BOT_JID, notify: 'Lizzy' },
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

/**
 * Envia UMA mensagem pelo handler real.
 *
 * @param {object} p
 * @param {string} p.groupJid
 * @param {string} [p.texto]        texto da mensagem (o comando vai aqui)
 * @param {string[]} [p.mencionados] quem a mensagem MARCA
 * @param {string} [p.de]           quem envia (default: o autor)
 * @param {string} [p.id]           id da mensagem
 * @param {object} [p.cache]        messagesCache (Map) a passar
 * @param {object} [p.quoted]       mensagem citada (contextInfo.quotedMessage)
 */
async function enviar({ groupJid, texto = 'oi', mencionados = [], de = null, id = null, cache = null, quoted = null, deNome = 'Autor' }) {
  senderCounter += 1;
  // ## Remetente NOVO por chamada (o throttle e' por remetente: 3 cmd/5s)
  //
  // Sem isto, o 4o comando do teste responde 'Calma ai!' e o teste mede o
  // rate limit em vez do comando (mesma armadilha do !testcall).
  const quemEnvia = de || `2222${String(senderCounter).padStart(6, '0')}@lid`;
  const sent = [];
  const nazu = makeNazu({ sent, groupJid });
  const contextInfo = { remoteJid: groupJid };
  if (mencionados.length) contextInfo.mentionedJid = mencionados;
  if (quoted) contextInfo.quotedMessage = quoted;

  // O nome tem de acompanhar o remetente: com um nome fixo, duas pessoas
  // viram a mesma e a lista mede a coisa errada.
  const nome = deNome || `Pessoa${String(senderCounter).padStart(3, '0')}`;
  const info = {
    key: {
      remoteJid: groupJid,
      fromMe: false,
      id: id || `MSG-${senderCounter}`,
      participant: quemEnvia,
    },
    message: { extendedTextMessage: { text: texto, contextInfo } },
    messageTimestamp: Math.floor(Date.now() / 1000),
    pushName: nome,
  };

  await handleMessage(nazu, info, null, cache || new Map(), null);
  const resposta = sent.map((s) => s.content?.text ?? s.content?.caption ?? '').filter(Boolean).join('\n');
  return { sent, resposta, info };
}

// ============================================================================
// 1) O MODULO PURO
// ============================================================================

await test('modulo: registra, deduplica e resume', async () => {
  const g = '1203639111111100999@g.us';
  mencoes.registrarMencao({ grupo: g, alvo: ALVO_LID, de: AUTOR_LID, deNome: 'Ana', id: 'A1', texto: 'oi' });
  mencoes.registrarMencao({ grupo: g, alvo: ALVO_LID, de: AUTOR_LID, deNome: 'Ana', id: 'A2', texto: 'tudo bem?' });
  // Mesmo id de novo: nao duplica.
  const dup = mencoes.registrarMencao({ grupo: g, alvo: ALVO_LID, de: AUTOR_LID, deNome: 'Ana', id: 'A1' });
  ok(dup === false, 'o mesmo id nao registra duas vezes');

  const lista = mencoes.mencoesDeHoje(g, ALVO_LID);
  ok(lista.length === 2, `2 mencoes (veio ${lista.length})`);

  const resumo = mencoes.resumoDeHoje(g, ALVO_LID);
  ok(resumo.length === 1, 'uma pessoa marcou');
  ok(resumo[0].total === 2, `total 2 (veio ${resumo[0].total})`);
  ok(resumo[0].deNome === 'Ana', 'o nome de quem marcou');
});

await test('modulo: separa por ALVO (so quem foi marcado)', async () => {
  const g = '1203639111111100998@g.us';
  mencoes.registrarMencao({ grupo: g, alvo: ALVO_LID, de: AUTOR_LID, deNome: 'Ana', id: 'B1' });
  mencoes.registrarMencao({ grupo: g, alvo: AUTOR_LID, de: ALVO_LID, deNome: 'Bia', id: 'B2' });
  ok(mencoes.mencoesDeHoje(g, ALVO_LID).length === 1, 'o alvo tem 1');
  ok(mencoes.mencoesDeHoje(g, AUTOR_LID).length === 1, 'o outro alvo tem 1');
  ok(mencoes.mencoesDeHoje(g, '5551999999999@lid').length === 0, 'quem nao foi marcado tem 0');
});

await test('modulo: acha por nome, numero e indice', async () => {
  const g = '1203639111111100997@g.us';
  mencoes.registrarMencao({ grupo: g, alvo: ALVO_LID, de: AUTOR_LID, deNome: 'Ana Paula', id: 'C1', texto: 'primeira' });
  mencoes.registrarMencao({ grupo: g, alvo: ALVO_LID, de: AUTOR_LID, deNome: 'Ana Paula', id: 'C2', texto: 'segunda' });
  const resumo = mencoes.resumoDeHoje(g, ALVO_LID);

  ok(mencoes.acharNoResumo(resumo, 'ana')?.de === AUTOR_LID, 'acha por nome parcial');
  ok(mencoes.acharNoResumo(resumo, 'ANA PAULA')?.de === AUTOR_LID, 'acha ignorando caixa');
  // Em grupo o `de` e' um LID, que NAO contem o numero. O chamador passa
  // os telefones resolvidos pelo metadata do grupo.
  const tels = (id) => (id === AUTOR_LID ? ['5511000000002'] : []);
  ok(mencoes.acharNoResumo(resumo, '5511000000002', tels)?.de === AUTOR_LID, 'acha por numero (via metadata)');
  ok(mencoes.acharNoResumo(resumo, 'zzz') === null, 'nao acha quem nao existe');

  ok(mencoes.registroPorIndice(g, ALVO_LID, 1)?.texto === 'primeira', 'indice 1 = a primeira');
  ok(mencoes.registroPorIndice(g, ALVO_LID, 2)?.texto === 'segunda', 'indice 2 = a segunda');
  ok(mencoes.registroPorIndice(g, ALVO_LID, 3) === null, 'indice fora da lista = null');
  ok(mencoes.registroPorIndice(g, ALVO_LID, 0) === null, 'indice 0 = null');
});

// ============================================================================
// 2) O REGISTRO PELO HANDLER (toda mensagem de grupo)
// ============================================================================

await test('handler: uma mensagem que marca entra na lista do alvo', async () => {
  const g = makeGroup();
  await enviar({ groupJid: g, texto: 'ei @alvo', mencionados: [ALVO_LID], id: 'H1', deNome: 'Ana' });

  const lista = mencoes.mencoesDeHoje(g, ALVO_LID);
  ok(lista.length === 1, `registrou 1 (veio ${lista.length})`);
  ok(lista[0].id === 'H1', 'guardou o id da mensagem (para o marcar)');
  ok(lista[0].texto === 'ei @alvo', 'guardou o texto');
});

await test('handler: mensagem SEM mencao nao registra', async () => {
  const g = makeGroup();
  await enviar({ groupJid: g, texto: 'bom dia a todos', mencionados: [], id: 'H2' });
  ok(mencoes.mencoesDeHoje(g, ALVO_LID).length === 0, 'nada registrado');
});

await test('handler: o BOT nao entra como alvo', async () => {
  const g = makeGroup();
  await enviar({ groupJid: g, texto: 'oi bot', mencionados: [BOT_LID], id: 'H3' });
  ok(mencoes.mencoesDeHoje(g, BOT_LID).length === 0, 'marcar o bot nao registra');
});

await test('handler: uma mensagem que marca DOIS registra nos dois', async () => {
  const g = makeGroup();
  await enviar({ groupJid: g, texto: 'oi voces', mencionados: [ALVO_LID, BOT_LID], id: 'H4' });
  ok(mencoes.mencoesDeHoje(g, ALVO_LID).length === 1, 'o alvo humano registrou');
  ok(mencoes.mencoesDeHoje(g, BOT_LID).length === 0, 'o bot nao');
});

// ============================================================================
// 3) O COMANDO
//
// ## Armadilha do throttle (MEDIDA)
//
// O handler limita 3 comandos/5s POR REMETENTE. Os testes de consulta mandam
// varios comandos seguidos COMO o alvo (e' a caixa dele), entao cada teste usa
// um ALVO PROPRIO (`novoAlvo()`): o remetente e' novo e a caixa e' dele.
// ============================================================================

await test('!mencoes: lista quem te marcou hoje com a contagem', async () => {
  const g = makeGroup();
  const alvo = novoAlvo();
  await enviar({ groupJid: g, texto: 'a', mencionados: [alvo], id: 'L1', de: AUTOR_LID, deNome: 'Ana' });
  await enviar({ groupJid: g, texto: 'b', mencionados: [alvo], id: 'L2', de: AUTOR_LID, deNome: 'Ana' });
  await enviar({ groupJid: g, texto: 'c', mencionados: [alvo], id: 'L3', de: BOT_LID, deNome: 'Bia' });

  const r = await enviar({ groupJid: g, texto: '!mencoes', de: alvo, id: 'CMD1' });
  includes(r.resposta, 'MENÇÕES DE HOJE', 'o titulo');
  includes(r.resposta, '3x', 'o total (2 da Ana + 1 da Bia)');
  includes(r.resposta, '2x', 'a contagem de quem marcou 2x');
  includes(r.resposta, 'Ana', 'o nome de quem marcou');
  // O `de` da terceira e' o BOT_LID; o nome resolvido vem do metadata.
  includes(r.resposta, 'Lizzy', 'o nome da outra (resolvido do metadata)');
});

await test('!mencoes: sem ninguem, avisa (nao fica mudo)', async () => {
  const g = makeGroup();
  const alvo = novoAlvo();
  const r = await enviar({ groupJid: g, texto: '!mencoes', de: alvo, id: 'CMD2' });
  includes(r.resposta, 'Ninguém te marcou hoje', 'o aviso');
});

await test('!mencoes <nome>: as mensagens de quem te marcou', async () => {
  const g = makeGroup();
  const alvo = novoAlvo();
  await enviar({ groupJid: g, texto: 'primeira mencao', mencionados: [alvo], id: 'N1', de: AUTOR_LID, deNome: 'Ana' });
  await enviar({ groupJid: g, texto: 'segunda mencao', mencionados: [alvo], id: 'N2', de: AUTOR_LID, deNome: 'Ana' });

  const r = await enviar({ groupJid: g, texto: '!mencoes ana', de: alvo, id: 'CMD3' });
  console.log('DBG-A:', JSON.stringify(desbold(r.resposta).slice(0,300)));
  includes(r.resposta, 'MENÇÕES DE', 'o titulo');
  includes(r.resposta, 'Ana', 'o nome de quem marcou');
  includes(r.resposta, '2x', 'o total');
  includes(r.resposta, 'primeira mencao', 'a primeira mensagem');
  includes(r.resposta, 'segunda mencao', 'a segunda mensagem');
});

await test('!mencoes <numero>: acha pelo numero de quem marcou', async () => {
  const g = makeGroup();
  const alvo = novoAlvo();
  await enviar({ groupJid: g, texto: 'oi', mencionados: [alvo], id: 'NM1', de: AUTOR_LID, deNome: 'Ana' });
  // O `de` e' LID (nao contem o numero); o numero vem do metadata do grupo.
  const r = await enviar({ groupJid: g, texto: '!mencoes 5511000000002', de: alvo, id: 'CMD4' });
  includes(r.resposta, 'MENÇÕES DE', 'achou pelo numero');
  includes(r.resposta, 'Ana', 'e mostrou o NOME (nao o LID)');
  ok(!r.resposta.includes('Ninguém'), 'nao caiu no "ninguem"');
});

await test('!mencoes <n>: mostra a mencao de indice n', async () => {
  const g = makeGroup();
  const alvo = novoAlvo();
  await enviar({ groupJid: g, texto: 'a primeira', mencionados: [alvo], id: 'I1', de: AUTOR_LID, deNome: 'Ana' });
  await enviar({ groupJid: g, texto: 'a segunda', mencionados: [alvo], id: 'I2', de: AUTOR_LID, deNome: 'Ana' });

  const r1 = await enviar({ groupJid: g, texto: '!mencoes 1', de: alvo, id: 'CMD5' });
  includes(r1.resposta, 'MENÇÃO #1', 'o titulo com o indice');
  includes(r1.resposta, 'a primeira', 'o texto da 1a');

  const r2 = await enviar({ groupJid: g, texto: '!mencoes 2', de: alvo, id: 'CMD6' });
  includes(r2.resposta, 'a segunda', 'o texto da 2a');

  const r3 = await enviar({ groupJid: g, texto: '!mencoes 99', de: alvo, id: 'CMD7' });
  includes(r3.resposta, 'Não achei', 'indice inexistente avisa');
});

await test('!mencoes <nome desconhecido>: avisa', async () => {
  const g = makeGroup();
  const alvo = novoAlvo();
  await enviar({ groupJid: g, texto: 'oi', mencionados: [alvo], id: 'X1', de: AUTOR_LID, deNome: 'Ana' });
  const r = await enviar({ groupJid: g, texto: '!mencoes zezinho', de: alvo, id: 'CMD8' });
  includes(r.resposta, 'Ninguém com', 'avisa que ninguem com esse nome');
});

// ============================================================================
// 4) O MARCAR (cita a mensagem ORIGINAL)
// ============================================================================

await test('!mencoes marcar <n>: cita a mensagem ORIGINAL (com o cache)', async () => {
  const g = makeGroup();
  const alvo = novoAlvo();
  await enviar({ groupJid: g, texto: 'me marca', mencionados: [alvo], id: 'M1', de: AUTOR_LID, deNome: 'Ana' });

  // O cache guarda a mensagem COMPLETA (e' o que o `quoted` da fork exige).
  const cache = new Map();
  cache.set(`${g}_M1`, {
    key: { remoteJid: g, fromMe: false, id: 'M1', participant: AUTOR_LID },
    message: { extendedTextMessage: { text: 'me marca' } },
  });

  const r = await enviar({ groupJid: g, texto: '!mencoes marcar 1', de: alvo, id: 'CMD9', cache });
  const envio = r.sent.find((s) => s.content?.text === 'Aqui está.');
  ok(!!envio, 'mandou o "Aqui está."');
  ok(envio?.options?.quoted?.key?.id === 'M1', 'citou a mensagem ORIGINAL (id M1)');
});

await test('!mencoes marcar <n>: sem o cache, avisa (nao quebra)', async () => {
  const g = makeGroup();
  const alvo = novoAlvo();
  await enviar({ groupJid: g, texto: 'oi', mencionados: [alvo], id: 'M2', de: AUTOR_LID, deNome: 'Ana' });
  const r = await enviar({ groupJid: g, texto: '!mencoes marcar 1', de: alvo, id: 'CMD10' });
  includes(r.resposta, 'Não consegui recuperar', 'avisa que nao achou a original');
});

await test('!mencoes marcar <n>: indice invalido avisa o uso', async () => {
  const g = makeGroup();
  const alvo = novoAlvo();
  const r = await enviar({ groupJid: g, texto: '!mencoes marcar 0', de: alvo, id: 'CMD11' });
  includes(r.resposta, 'marcar <número>', 'mostra o uso');
});

// ============================================================================
// 5) MENU E BLOCKPV
// ============================================================================

await test('menu: !mencoes no menumemb e no blockPv', async () => {
  const menu = fs.readFileSync(path.join(HERE, '..', 'dados/src/menus/menumemb.js'), 'utf-8');
  includes(menu, 'mencoes', 'o comando aparece no menumemb');
  includes(menu, 'MENÇÕES', 'a categoria MENÇÕES');
  const bp = fs.readFileSync(path.join(HERE, '..', 'dados/src/utils/blockPv.js'), 'utf-8');
  includes(bp, "'mencoes'", 'esta no blockPv');
});

// ============================================================================

console.log('\n========================================');
const totOk = RESULTS.reduce((a, r) => a + r.passed, 0);
const totFail = RESULTS.reduce((a, r) => a + r.failed, 0);
console.log(`RESULTADO: ${RESULTS.length} testes | ${totOk} asserções ok | ${totFail} falhas`);
console.log('========================================');
process.exit(totFail > 0 ? 1 : 0);
