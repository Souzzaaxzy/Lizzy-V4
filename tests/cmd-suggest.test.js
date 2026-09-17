/**
 * Testes da variável {cmdSm} da mensagem de comando não encontrado.
 *
 * `{cmdSm}` mostra o comando mais parecido com o que o usuário digitou
 * (ex.: `!pingg` -> `!ping`), seguindo o mesmo padrão das outras variáveis do
 * `!configcmdnotfound` ({command}, {prefix}, {user}, {botName}, {userName}).
 *
 * Uso: node tests/cmd-suggest.test.js
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.resolve(HERE, '..');

const TMP_DB = fs.mkdtempSync(path.join(os.tmpdir(), 'lizzy-suggest-db-'));
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
// MÓDULOS
// ============================================================================

const suggest = await import(new URL('../dados/src/utils/commandSuggest.js', import.meta.url).href);
const db = await import(new URL('../dados/src/utils/database.js', import.meta.url).href);
const indexModule = await import(new URL('../dados/src/index.js', import.meta.url).href);
const handleMessage = indexModule.default ?? indexModule;

// ============================================================================
// 1) ACHAR O COMANDO MAIS PARECIDO
// ============================================================================

await test('sugestão: acha o comando por erro de digitação', () => {
  const casos = [
    ['pingg', 'ping'],
    ['menuu', 'menu'],
    ['tapp', 'tapa'],
    ['sticker2', 'sticker2'],
    ['banir', 'banir'],
    ['figurinha', 'figurinhas'], // comando real: o plural é a sugestão certa
    ['zzzqqqwww', null],         // sem nada parecido: não inventa sugestão
  ];
  for (const [entrada, esperado] of casos) {
    const r = suggest.findClosestCommand(entrada);
    ok(r === esperado, `"${entrada}" -> "${r}" (esperado "${esperado}")`);
  }
});

await test('sugestão: sempre devolve um comando que EXISTE', () => {
  // O valor de {cmdSm} nunca pode apontar para algo inexistente.
  const todos = new Set(suggest.getAllBotCommands());
  for (const entrada of ['pingg', 'menuu', 'tapp', 'gi', 'figurinha', 'gift', 'stikcer', 'baan']) {
    const r = suggest.findClosestCommand(entrada);
    ok(r === null || todos.has(r), `"${entrada}" -> "${r}" existe na lista`);
  }
});

await test('sugestão: palavra curta sugere o comando mais próximo existente', () => {
  // 'gi' está mais perto de 'gift' (comando real) do que de qualquer outra
  // coisa; o importante é a sugestão ser um comando real.
  const r = suggest.findClosestCommand('gi');
  ok(r === 'gift', `"gi" -> "${r}" (esperado "gift")`);
});

await test('sugestão: entrada sem sentido não sugere nada', () => {
  for (const lixo of ['zzzqqqwww', 'qwertyuiop', 'xxxxxxxx', '???']) {
    const r = suggest.findClosestCommand(lixo);
    ok(r === null, `"${lixo}" -> ${r} (esperado null)`);
  }
});

await test('sugestão: entrada vazia/nula devolve null', () => {
  ok(suggest.findClosestCommand('') === null, 'string vazia -> null');
  ok(suggest.findClosestCommand(null) === null, 'null -> null');
  ok(suggest.findClosestCommand(undefined) === null, 'undefined -> null');
  ok(suggest.findClosestCommand('   ') === null, 'só espaços -> null');
});

await test('sugestão: ignora maiúsculas e espaços', () => {
  ok(suggest.findClosestCommand('  PINGG  ') === 'ping', 'normaliza para minúsculas e apara espaços');
  ok(suggest.findClosestCommand('MENUU') === 'menu', 'maiúsculas funcionam');
});

await test('sugestão: prefere o comando que contém a entrada', () => {
  // 'fig' deve virar 'fig' (exato) e não algo aleatório; 'stick' deve virar 'sticker'/'sticker2'.
  const r = suggest.findClosestCommand('stick');
  ok(r && r.startsWith('stick'), `"stick" -> "${r}" (deve começar com stick)`);
});

await test('sugestão: não sugere SUBCOMANDO (só comandos de topo)', () => {
  // 'set'/'style'/'preview' são subcomandos do configcmdnotfound: não devem
  // aparecer como sugestão de comando.
  const todos = suggest.getAllBotCommands();
  ok(!todos.includes('style'), '"style" não está na lista de comandos');
  ok(!todos.includes('preview'), '"preview" não está na lista');
  ok(!todos.includes('activate'), '"activate" não está na lista');
  ok(todos.includes('menu'), '"menu" está na lista (controle)');
  ok(todos.includes('tapa'), '"tapa" está na lista (controle)');
});

await test('sugestão: a lista de comandos é grande e cacheada', () => {
  const a = suggest.getAllBotCommands();
  const b = suggest.getAllBotCommands();
  ok(a.length > 1000, `lista tem ${a.length} comandos`);
  ok(a === b, 'a lista é cacheada (mesma referência)');
});

await test('levenshtein: distância correta', () => {
  ok(suggest.levenshtein('ping', 'ping') === 0, 'iguais -> 0');
  ok(suggest.levenshtein('pingg', 'ping') === 1, 'uma letra a mais -> 1');
  ok(suggest.levenshtein('', 'abc') === 3, 'vazio -> tamanho');
  ok(suggest.levenshtein('abc', '') === 3, 'tamanho -> vazio');
});

// ============================================================================
// 2) MONTAGEM DO VALOR DE {cmdSm}
// ============================================================================

await test('extras: {cmdSm} vem com o prefixo na frente', () => {
  ok(suggest.buildCmdNotFoundExtras('pingg', '!').cmdSm === '!ping', 'prefixo ! aplicado');
  ok(suggest.buildCmdNotFoundExtras('pingg', '/').cmdSm === '/ping', 'prefixo / aplicado');
});

await test('extras: sem sugestão cai no menu (nunca vazio)', () => {
  const r = suggest.buildCmdNotFoundExtras('zzzqqqwww', '!');
  ok(r.cmdSm === '!menu', `sem sugestão -> "${r.cmdSm}"`);
});

// ============================================================================
// 3) TEMPLATE: {cmdSm} é uma variável válida
// ============================================================================

await test('template: {cmdSm} passa na validação', () => {
  const v = db.validateMessageTemplate('O comando {command} não existe! Você quis dizer {cmdSm}?');
  ok(v.valid === true, `template válido (issues: ${JSON.stringify(v.issues)})`);
  ok(v.variables.includes('{cmdSm}'), 'a variável foi reconhecida');
});

await test('template: variável desconhecida continua sendo rejeitada', () => {
  const v = db.validateMessageTemplate('Oi {naoExiste}');
  ok(v.valid === false, 'template com variável inventada é inválido');
  ok(v.issues.some((i) => i.includes('{naoExiste}')), 'aponta a variável inválida');
});

await test('template: {cmdSm} é substituído na formatação', () => {
  const msg = db.formatMessageWithFallback(
    'O comando {command} não existe! Você quis dizer {cmdSm}?',
    { command: 'pingg', prefix: '!', ...suggest.buildCmdNotFoundExtras('pingg', '!') },
    'fallback'
  );
  includes(msg, 'pingg', 'mantém o comando digitado');
  includes(msg, '!ping', 'trocou {cmdSm} pela sugestão');
  notIncludes(msg, '{cmdSm}', 'não sobrou a variável literal');
});

// ============================================================================
// 4) FLUXO REAL: comando inexistente no handler
// ============================================================================

const BOT_JID = '5599999999999@s.whatsapp.net';
const BOT_LID = '111111111111111@lid';
let groupCounter = 0;

function makeGroup() {
  groupCounter += 1;
  const jid = `1203634000000000${String(groupCounter).padStart(3, '0')}@g.us`;
  fs.writeFileSync(
    path.join(TMP_DB, 'grupos', `${jid}.json`),
    JSON.stringify({ modobrincadeira: true, groupName: 'Grupo Sug' }, null, 2)
  );
  return jid;
}

function makeNazu(sent, groupJid) {
  return {
    sendMessage: async (jid, content) => {
      sent.push({ jid, content });
      return { key: { id: 'SENT' } };
    },
    user: { id: `${BOT_JID.split('@')[0]}:5@s.whatsapp.net`, lid: BOT_LID, name: 'Lizzy' },
    onWhatsApp: async (jid) => [{ jid, exists: true, lid: jid.replace('@s.whatsapp.net', '@lid') }],
    signalRepository: { lidMapping: { getPNForLID: async () => null } },
    groupMetadata: async () => ({
      id: groupJid,
      subject: 'Grupo Sug',
      participants: [{ id: BOT_LID, lid: BOT_LID, phoneNumber: BOT_JID, admin: 'admin' }],
    }),
    groupParticipantsUpdate: async () => ({}),
    groupRequestParticipantsList: async () => [],
    groupRequestParticipantsUpdate: async () => ({}),
    ev: { on: () => {}, emit: () => {}, removeAllListeners: () => {} },
    readMessages: async () => {},
    sendPresenceUpdate: async () => {},
    profilePictureUrl: async () => 'x',
    react: async () => ({}),
  };
}

/**
 * Envia um texto qualquer e devolve o que o bot respondeu.
 *
 * Cada envio usa um sender diferente: o handler limita 3 comandos/5s por
 * sender, então reutilizar o mesmo faria o 4º responder "Calma aí!" em vez de
 * exercitar a mensagem de comando não encontrado.
 */
let senderCounter = 0;
async function enviar(texto) {
  senderCounter += 1;
  const sent = [];
  const groupJid = makeGroup();
  const sender = `77700000${String(senderCounter).padStart(5, '0')}@lid`;
  const nazu = makeNazu(sent, groupJid);
  await handleMessage(nazu, {
    key: { remoteJid: groupJid, fromMe: false, id: `M-${Math.random().toString(36).slice(2, 9)}`, participant: sender },
    message: { extendedTextMessage: { text: texto, contextInfo: { remoteJid: groupJid } } },
    messageTimestamp: 1757900000,
    pushName: 'Tester',
  }, null, new Map(), null);
  return sent.map((s) => s.content?.text ?? '').filter(Boolean).join('\n');
}

/** Define a mensagem de comando não encontrado para o teste. */
function configurarMensagem(template) {
  const file = path.join(TMP_DB, 'dono', 'cmdNotFound.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({
    enabled: true,
    message: template,
    style: 'friendly',
    lastUpdated: new Date().toISOString(),
  }, null, 2));
}

/** Garante que a resposta não é o aviso de throttle (mediria a coisa errada). */
function semThrottle(texto, label) {
  notIncludes(texto, 'Calma aí', `${label}: resposta não pode ser o aviso de throttle`);
}

await test('fluxo: comando errado mostra a sugestão de verdade', async () => {
  configurarMensagem('❌ "{command}" não existe! Você quis dizer {cmdSm}?');
  const texto = await enviar('!pingg');
  semThrottle(texto, 'sugestão');
  includes(texto, 'pingg', 'mostra o comando digitado');
  includes(texto, '!ping', 'mostra a sugestão com prefixo');
  notIncludes(texto, '{cmdSm}', 'sem variável literal');
  notIncludes(texto, 'undefined', 'sem undefined');
});

await test('fluxo: outra digitação errada sugere o comando certo', async () => {
  configurarMensagem('Comando {command} não encontrado. Tente {cmdSm}');
  const texto = await enviar('!menuu');
  includes(texto, '!menu', 'sugeriu o menu');
  notIncludes(texto, '{cmdSm}', 'sem variável literal');
});

await test('fluxo: sem sugestão possível cai no menu, sem quebrar', async () => {
  configurarMensagem('Não achei {command}. Tente {cmdSm}');
  const texto = await enviar('!zzzqqqwww');
  includes(texto, '!menu', 'caiu no menu como fallback');
  notIncludes(texto, '{cmdSm}', 'sem variável literal');
  notIncludes(texto, 'undefined', 'sem undefined');
});

await test('fluxo: as outras variáveis continuam funcionando juntas', async () => {
  configurarMensagem('{userName}, o comando {command} não existe. Use {prefix}menu ou {cmdSm}');
  const texto = await enviar('!pingg');
  semThrottle(texto, 'variáveis juntas');
  notIncludes(texto, '{command}', 'sem {command} literal');
  notIncludes(texto, '{userName}', 'sem {userName} literal');
  notIncludes(texto, '{prefix}', 'sem {prefix} literal');
  includes(texto, '!ping', 'a sugestão aparece junto das outras');
});

await test('fluxo: mensagem SEM {cmdSm} continua igual (não quebra quem já usa)', async () => {
  configurarMensagem('❌ Comando {command} não encontrado! Tente {prefix}menu');
  const texto = await enviar('!pingg');
  includes(texto, 'Comando pingg não encontrado', 'mensagem antiga preservada');
  includes(texto, '!menu', 'prefixo continua sendo trocado');
});

await test('fluxo: template inválido cai no fallback, sem vazar variável', async () => {
  configurarMensagem('Oi {cmdSm} e {variavelInventada}');
  const texto = await enviar('!pingg');
  notIncludes(texto, '{cmdSm}', 'sem variável literal');
  notIncludes(texto, '{variavelInventada}', 'sem variável inválida literal');
  ok(texto.length > 0, 'respondeu algo (fallback)');
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