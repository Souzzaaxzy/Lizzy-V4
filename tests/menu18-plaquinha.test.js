/**
 * Menu 18 (Plaquinhas) + comandos `!plaq1`..`!plaq10`.
 *
 * Roda o handler REAL com socket falso. O ponto central do teste é a promessa
 * feita ao dono: **colocar `plaq/plaq1.png` na pasta já basta** — nenhum
 * comando, nenhum JSON. Então o teste grava os arquivos e confere que os
 * comandos os enviam.
 *
 * Cobre:
 *   1. o menu (`!menu18` + aliases) responde e usa o layout dos outros menus;
 *   2. a categoria lista os 10 comandos, cada um só com o emoji 🖼️;
 *   3. `!plaq1`..`!plaq10` enviam a mídia da pasta (imagem e vídeo/GIF);
 *   4. sem mídia, o comando AVISA em vez de mandar nada;
 *   5. a pasta é restrita: só os 10 nomes são atendidos;
 *   6. `!menu18` está na categoria COMUNIDADE do menu principal;
 *   7. `menu18` está no `blockPv`;
 *   8. regressão: `!menufig`/`!menusticker` continuam funcionando.
 *
 * Uso: node tests/menu18-plaquinha.test.js
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');

// Banco E pasta de mídia temporários, ANTES de importar o bot: tanto o
// `paths.js` quanto o `plaq.js` leem o ambiente no load. Assim o teste nunca
// escreve no repositório (a pasta real fica intacta).
const TMP_DB = fs.mkdtempSync(path.join(os.tmpdir(), 'lizzy-plaq-'));
process.env.DATABASE_PATH = TMP_DB;
const TMP_PLAQ = fs.mkdtempSync(path.join(os.tmpdir(), 'lizzy-plaq-media-'));
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
  ok(typeof hay === 'string' && hay.includes(needle), `${label ?? needle} \u2014 esperado conter "${needle}"`);
}

/**
 * Normaliza o MATHEMATICAL BOLD/ITALIC do layout para ASCII.
 *
 * Os titulos das categorias saem em bold Unicode, entao comparar com o texto
 * ASCII direto falharia mesmo com o menu correto \u2014 o teste mede o CONTEUDO
 * que o usuario le, nao o code point.
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
    else out += ch;
  }
  return out;
}

/** includes que ignora o bold Unicode (mede o texto visivel). */
function includesTxt(hay, needle, label) {
  ok(typeof hay === 'string' && desbold(hay).includes(needle),
    `${label ?? needle} \u2014 esperado conter "${needle}"`);
}

// ============================================================================

const indexModule = await import(new URL('../dados/src/index.js', import.meta.url).href);
const handleMessage = indexModule.default ?? indexModule;
if (typeof handleMessage !== 'function') throw new Error('index.js não exporta o handler');

const {
  PLAQ_DIR, PLAQ_COMMANDS, findPlaqMedia, normalizePlaqCommand, isPlaqCommand,
  resolvePlaqMedia
} = await import(new URL('../dados/src/funcs/utils/plaq.js', import.meta.url).href);

/**
 * Foto da pasta REAL do repositório, tirada ANTES de qualquer teste.
 * O teste escreve em `PLAQ_PATH` (tmp), então ao final a pasta real tem de
 * estar idêntica — é o repositório do dono, com as mídias reais dele.
 */
const PASTA_REAL_ANTES = fs.readdirSync(path.join(ROOT, 'dados', 'src', 'plaq')).sort();

const BOT_JID = '5599999999999@s.whatsapp.net';
const BOT_LID = '111111111111111@lid';

let groupCounter = 0;
let personCounter = 0;

function makeGroup(extra = {}) {
  groupCounter += 1;
  const jid = `1203638000000000${String(groupCounter).padStart(3, '0')}@g.us`;
  fs.writeFileSync(path.join(GRUPOS_DIR, `${jid}.json`),
    JSON.stringify({ groupName: `Grupo Plaq ${groupCounter}`, ...extra }, null, 2));
  return jid;
}
function makePerson() {
  personCounter += 1;
  const n = String(personCounter).padStart(4, '0');
  return { lid: `5571${n}000000@lid`, jid: `5513${n}999999@s.whatsapp.net`, name: `5571${n}000000` };
}
function makeNazu({ sent, groupJid, participants }) {
  const map = {};
  for (const p of participants) { map[p.jid] = p.lid; map[p.lid] = p.jid; }
  return {
    sent,
    sendMessage: async (jid, content) => { sent.push({ jid, content }); return { key: { id: 'SENT' } }; },
    user: { id: `${BOT_JID.split('@')[0]}:5@s.whatsapp.net`, lid: BOT_LID, name: 'Lizzy' },
    onWhatsApp: async (jid) => (map[jid] ? [{ jid, exists: true, lid: map[jid] }] : [{ jid, exists: false }]),
    signalRepository: { lidMapping: { getPNForLID: async (lid) => map[lid] || null } },
    groupMetadata: async () => ({
      id: groupJid, subject: 'Grupo Plaq',
      participants: participants.map((p) => ({ id: p.lid, admin: p.isAdmin ? 'admin' : null, phoneNumber: p.jid }))
    }),
    groupParticipantsUpdate: async () => ({}),
    groupRequestParticipantsList: async () => [],
    groupRequestParticipantsUpdate: async () => ({}),
    ev: { on: () => {}, emit: () => {}, removeAllListeners: () => {} },
    readMessages: async () => {}, sendPresenceUpdate: async () => {},
    profilePictureUrl: async () => null, react: async () => ({})
  };
}

/** Executa uma mensagem no handler. Usa remetente novo por chamada (throttle 3/5s). */
async function run({ groupJid, sender, text, participants, sent = [] }) {
  const nazu = makeNazu({ sent, groupJid, participants });
  const info = {
    key: { remoteJid: groupJid, fromMe: false, id: `M-${Math.random().toString(36).slice(2, 10)}`, participant: sender.lid },
    message: { extendedTextMessage: { text, contextInfo: { remoteJid: groupJid, mentionedJid: [] } } },
    messageTimestamp: Math.floor(Date.now() / 1000),
    pushName: sender.name
  };
  await handleMessage(nazu, info, null, new Map(), null);
  return {
    text: sent.map((s) => s.content?.text ?? '').filter(Boolean).join('\n'),
    sent
  };
}

function setup(n) {
  const groupJid = makeGroup({ modobrincadeira: true });
  const people = [];
  for (let i = 0; i < n; i++) people.push(makePerson());
  const participants = [...people, { lid: BOT_LID, jid: BOT_JID, name: 'Lizzy', isAdmin: true }];
  return { groupJid, people, participants };
}

/** PNG 1x1 válido, para os arquivos de teste. */
const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

/** Limpa a pasta temporária (o teste é hermético: nada toca o repositório). */
function limparPlaq() {
  for (const cmd of PLAQ_COMMANDS) {
    for (const ext of ['png', 'jpg', 'gif', 'mp4', 'webp']) {
      const f = path.join(PLAQ_DIR, `${cmd}.${ext}`);
      if (fs.existsSync(f)) fs.unlinkSync(f);
    }
  }
}
function criarPlaq(cmd, ext, buf = PNG_1x1) {
  fs.mkdirSync(PLAQ_DIR, { recursive: true });
  fs.writeFileSync(path.join(PLAQ_DIR, `${cmd}.${ext}`), buf);
}

// ============================================================================
// 1) MÓDULO
// ============================================================================

await test('módulo plaq: lista fechada de 10 e nome normalizado', () => {
  ok(PLAQ_COMMANDS.length === 10, 'são 10 comandos');
  ok(PLAQ_COMMANDS[0] === 'plaq1' && PLAQ_COMMANDS[9] === 'plaq10', 'vai de plaq1 a plaq10');
  ok(isPlaqCommand('plaq1') && isPlaqCommand('!PLAQ10'), 'aceita com ! e em maiúsculas');
  ok(!isPlaqCommand('plaq11') && !isPlaqCommand('plaq0') && !isPlaqCommand('tapar'),
    'recusa fora da lista (a pasta é restrita)');
  ok(normalizePlaqCommand(' !plaq7 ') === 'plaq7', 'normaliza espaços e !');
});

await test('módulo plaq: encontra a mídia pela extensão, sem JSON', () => {
  limparPlaq();
  ok(findPlaqMedia('plaq1') === null, 'sem arquivo, não acha nada');
  criarPlaq('plaq1', 'png');
  const f = findPlaqMedia('plaq1');
  ok(f && f.ext === 'png' && f.isVideo === false, 'encontrou o PNG e marcou como imagem');
  limparPlaq();
});

// ============================================================================
// 2) MENU
// ============================================================================

await test('!menu18 responde e usa o layout dos outros menus', async () => {
  const { groupJid, people, participants } = setup(2);
  const out = await run({ groupJid, sender: people[0], text: '!menu18', participants });
  includesTxt(out.text, 'PLAQUINHA', 'tem a categoria PLAQUINHA');
  includes(out.text, '╭━━━꧁༺', 'usa a caixa do layout');
  includes(out.text, '!plaq1', 'lista o plaq1');
  includes(out.text, '!plaq10', 'lista o plaq10');
});

await test('o cabeçalho avisa em tom safado que é +18', async () => {
  const { groupJid, people, participants } = setup(2);
  const out = await run({ groupJid, sender: people[0], text: '!menu18', participants });
  includesTxt(out.text, '+18', 'diz que é conteúdo +18');
  // O pedido foi uma mensagem "picante" no começo, não um aviso seco.
  ok(/vergonha|picante|safad/i.test(out.text), 'o aviso está em tom picante');
});

await test('o aviso é GENÉRICO (o menu vai ganhar mais categorias)', async () => {
  const { groupJid, people, participants } = setup(2);
  const out = await run({ groupJid, sender: people[0], text: '!menu18', participants });
  // O aviso não pode citar uma categoria específica: o menu recebe outras
  // depois, e uma frase presa a "plaquinha" envelheceria na primeira adição.
  const cabecalho = out.text.split('╰')[0];
  ok(!/plaquinha/i.test(cabecalho),
    'o cabeçalho não cita a categoria (só o título da categoria pode citar)');
  // Sanidade: a categoria continua lá, com o nome dela.
  includesTxt(out.text, 'PLAQUINHA', 'a categoria mantém o nome');
});

await test('o menu NÃO traz mais o bloco COMO USAR', async () => {
  const { groupJid, people, participants } = setup(2);
  const out = await run({ groupJid, sender: people[0], text: '!menu18', participants });
  ok(!desbold(out.text).includes('COMO USAR'), 'o bloco de instruções saiu');
  ok(!out.text.includes('dados/src/plaq/'), 'não expõe mais o caminho da pasta no menu');
});

await test('o menu principal NÃO põe emoji na entrada do menu18', async () => {
  const menuSrc = fs.readFileSync(new URL('../dados/src/menus/menu.js', import.meta.url), 'utf-8');
  // A LINHA DA CHAMADA `categoria(...)`, não o comentário do topo do arquivo
  // (que também cita COMUNIDADE e faria o teste medir outra coisa).
  const linha = menuSrc.split('\n').find((l) => l.includes("categoria(prefix, 'COMUNIDADE'"));
  ok(Boolean(linha), 'achou a linha da categoria COMUNIDADE');
  includes(linha, "'menu18'", 'menu18 está na categoria');
  ok(!linha.includes('🔞'), 'sem o emoji +18 na linha do menu principal');
  ok(!linha.includes('🩻'), 'sem o raio-X na linha do menu principal');
});

await test('menu +18 usa o emoji picante e não um símbolo inventado', async () => {
  const { groupJid, people, participants } = setup(2);
  const out = await run({ groupJid, sender: people[0], text: '!menu18', participants });
  // O emoji do menu18 é o 🌶️ (picante). Antes era o 🔞 e antes disso um 🩻
  // (raio-X) sem sentido — o dono trocou os dois.
  includes(out.text, '🌶️', 'usa o emoji picante');
  ok(!out.text.includes('🩻'), 'não usa o símbolo de raio-X');
  ok(!out.text.includes('🔞'), 'não usa mais o emoji de proibido');
});

await test('aliases do menu funcionam', async () => {
  const { groupJid, people, participants } = setup(2);
  for (const cmd of ['!menuplaquinha', '!menuplaquinhas']) {
    const out = await run({ groupJid, sender: makePerson(), text: cmd, participants });
    includesTxt(out.text, 'PLAQUINHA', `alias ${cmd}`);
  }
});

await test('o menu só tem o emoji 🖼️ (sem ✅/▫️ de status)', async () => {
  const { groupJid, people, participants } = setup(2);
  const out = await run({ groupJid, sender: people[0], text: '!menu18', participants });
  // O menu LISTA os comandos; não é painel de configuração. O ✅/▫️ saiu a
  // pedido do dono, então a linha tem o 🖼️ e nada de check/vazio.
  const linhas = out.text.split('\n').filter((l) => /!plaq\d/.test(l));
  ok(linhas.length === 10, `as 10 linhas de comando (veio ${linhas.length})`);
  for (const l of linhas) {
    ok(l.includes('🖼️'), `linha com o emoji de imagem: ${l}`);
    ok(!l.includes('✅') && !l.includes('▫️'), `linha sem ✅/▫️: ${l}`);
  }
});

// ============================================================================
// 3) COMANDOS
// ============================================================================

await test('!plaq1 usa a imagem colocada na pasta (sem JSON, sem comando)', async () => {
  limparPlaq();
  criarPlaq('plaq1', 'png');
  const { groupJid, people, participants } = setup(2);
  const out = await run({ groupJid, sender: people[0], text: '!plaq1', participants });
  // A mídia NÃO sai mais pelo `sendMessage` comum: ela vai RESTRITA (coberta em
  // `plaq-midia-restrita.test.js`). Aqui se mede que o comando achou o arquivo
  // da pasta e não reclamou de mídia ausente.
  ok(!out.text.includes('não tem mídia'), 'achou a mídia na pasta');
  const mandouComum = out.sent.some((s) => s.content?.image || s.content?.video);
  ok(!mandouComum, 'não manda a mídia para o grupo inteiro');
  limparPlaq();
});

await test('os 10 comandos respondem (enviam ou avisam, nunca silêncio)', async () => {
  limparPlaq();
  const { groupJid, people, participants } = setup(2);
  for (const cmd of PLAQ_COMMANDS) {
    const out = await run({ groupJid, sender: makePerson(), text: `!${cmd}`, participants });
    const enviou = out.sent.some((s) => s.content?.image || s.content?.video);
    // Sem arquivo: tem de AVISAR (texto), não ficar mudo.
    ok(enviou || out.text.length > 0, `${cmd} respondeu de algum jeito`);
    if (!enviou) includes(out.text, 'não tem mídia', `${cmd} avisa que falta mídia`);
  }
});

await test('cada comando usa O SEU arquivo (não compartilha mídia)', async () => {
  limparPlaq();
  criarPlaq('plaq3', 'png', PNG_1x1);
  // plaq4 com bytes diferentes, para distinguir
  const outro = Buffer.concat([PNG_1x1, Buffer.from([0, 0, 0])]);
  criarPlaq('plaq4', 'png', outro);
  setup(2);

  // Lê os arquivos como o resolvedor do comando lê (o envio em si é restrito).
  const m3 = resolvePlaqMedia('plaq3');
  const m4 = resolvePlaqMedia('plaq4');
  ok(m3 && m4, 'os dois comandos têm arquivo');
  const img3 = fs.readFileSync(m3.file);
  const img4 = fs.readFileSync(m4.file);
  ok(!img3.equals(img4), 'cada comando aponta para o SEU arquivo');
  ok(m3.file.endsWith('plaq3.png') && m4.file.endsWith('plaq4.png'), 'caminhos distintos');
  limparPlaq();
});

await test('GIF é reconhecido como vídeo/GIF pelo resolvedor', async () => {
  limparPlaq();
  criarPlaq('plaq2', 'gif');
  const m = resolvePlaqMedia('plaq2');
  ok(m && m.isVideo === true, 'GIF entra como vídeo');
  ok(m.isGif === true, 'e marcado como GIF (liga o gifPlayback no envio)');
  limparPlaq();
});

// ============================================================================
// 4) INTEGRAÇÃO
// ============================================================================

await test('!menu18 está na categoria COMUNIDADE do menu principal', async () => {
  const menuSrc = fs.readFileSync(new URL('../dados/src/menus/menu.js', import.meta.url), 'utf-8');
  const comunidade = menuSrc.slice(menuSrc.indexOf("'COMUNIDADE'"));
  const linha = comunidade.split('\n')[0];
  includes(linha, 'menu18', 'menu18 na linha da categoria COMUNIDADE');
});

await test('menu18 registrado no loader dos menus', async () => {
  const idx = fs.readFileSync(new URL('../dados/src/menus/index.js', import.meta.url), 'utf-8');
  includes(idx, "menu18: './menu18.js'", 'loader tem menu18');
});

await test('menu18/plaq registrados no blockPv', async () => {
  const bp = fs.readFileSync(new URL('../dados/src/utils/blockPv.js', import.meta.url), 'utf-8');
  includes(bp, "'menu18': { key: 'menu18'", 'blockPv tem o menu');
  const bloco = bp.slice(bp.indexOf('menu18: {'), bp.indexOf('menu18: {') + 300);
  includes(bloco, 'plaq1', 'o menu18 do blockPv lista os comandos');
});

await test('regressão: !menufig / !menusticker continuam funcionando', async () => {
  const { groupJid, people, participants } = setup(2);
  for (const cmd of ['!menufig', '!menusticker']) {
    const out = await run({ groupJid, sender: makePerson(), text: cmd, participants });
    includesTxt(out.text, 'FIGURINHAS', `${cmd} ainda responde o menu de figurinhas`);
  }
});

await test('o teste não suja a pasta real do repositório', () => {
  const realDir = path.join(ROOT, 'dados', 'src', 'plaq');
  ok(fs.existsSync(path.join(realDir, '.gitkeep')), 'a pasta tem .gitkeep (existe no repositório)');
  // O teste roda com PLAQ_PATH apontando para um tmp, então NÃO pode ter
  // acrescentado arquivo aqui. A pasta pode (e deve) conter as mídias reais do
  // dono — o que se mede é que o teste não escreveu no repositório.
  const depois = fs.readdirSync(realDir).sort();
  ok(JSON.stringify(depois) === JSON.stringify(PASTA_REAL_ANTES),
    `a pasta real ficou igual ao início (antes: ${PASTA_REAL_ANTES.join(',')} | depois: ${depois.join(',')})`);
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
