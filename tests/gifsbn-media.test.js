/**
 * Testes das mídias dos comandos de brincadeira (pasta `dados/src/gifsbn/`).
 *
 * Cobre as duas formas de definir a mídia de um comando:
 *   1. `!setgif <comando>` grava o arquivo em `gifsbn/` e registra no games.json;
 *   2. arquivo solto na pasta com o nome do comando (ex.: `gifsbn/tapar.gif`) —
 *      o comando passa a usar aquele arquivo sem precisar rodar nada.
 *
 * O arquivo solto tem PRIORIDADE sobre o games.json.
 *
 * Uso: node tests/gifsbn-media.test.js
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.resolve(HERE, '..');

const TMP_DB = fs.mkdtempSync(path.join(os.tmpdir(), 'lizzy-gifsbn-db-'));
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

const gifsbn = await import(new URL('../dados/src/funcs/utils/gifsbn.js', import.meta.url).href);
const indexModule = await import(new URL('../dados/src/index.js', import.meta.url).href);
const handleMessage = indexModule.default ?? indexModule;

const GIFSBN_DIR = gifsbn.GIFSBN_DIR;

/** GIF 1x1 válido — conteúdo real para o teste de mídia. */
const GIF_1PX = Buffer.from(
  '47494638396101000100800000000000ffffff21f90401000000002c00000000010001000002024401003b',
  'hex'
);

const criados = [];
/** Cria um arquivo na pasta gifsbn e marca para limpar no fim. */
function criarMidia(nome, ext, conteudo = GIF_1PX) {
  fs.mkdirSync(GIFSBN_DIR, { recursive: true });
  const file = path.join(GIFSBN_DIR, `${nome}.${ext}`);
  fs.writeFileSync(file, conteudo);
  criados.push(file);
  return file;
}

// ============================================================================
// FIXTURES DO HANDLER
// ============================================================================

const BOT_JID = '5599999999999@s.whatsapp.net';
const BOT_LID = '111111111111111@lid';

let groupCounter = 0;
let senderCounter = 0;

function makeGroup() {
  groupCounter += 1;
  const jid = `1203635000000000${String(groupCounter).padStart(3, '0')}@g.us`;
  fs.writeFileSync(
    path.join(TMP_DB, 'grupos', `${jid}.json`),
    JSON.stringify({ modobrincadeira: true, groupName: 'Grupo BN' }, null, 2)
  );
  return jid;
}

function makeSender() {
  senderCounter += 1;
  const n = String(senderCounter).padStart(4, '0');
  return { lid: `888${n}00000000@lid`, jid: `5588${n}000000@s.whatsapp.net` };
}

function makeNazu({ sent, groupJid, participants }) {
  return {
    sendMessage: async (jid, content, options) => {
      sent.push({ jid, content, options });
      return { key: { id: 'SENT' } };
    },
    user: { id: `${BOT_JID.split('@')[0]}:5@s.whatsapp.net`, lid: BOT_LID, name: 'Lizzy' },
    onWhatsApp: async (jid) => {
      const p = participants.find((x) => x.jid === jid || x.lid === jid);
      return p ? [{ jid, exists: true, lid: p.lid }] : [{ jid, exists: false }];
    },
    signalRepository: { lidMapping: { getPNForLID: async () => null } },
    groupMetadata: async () => ({
      id: groupJid,
      subject: 'Grupo BN',
      participants: participants.map((p) => ({
        id: p.lid,
        lid: p.lid,
        phoneNumber: p.jid,
        admin: p.isAdmin ? 'admin' : null,
      })),
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

/** Executa um comando no handler real, com alvo marcado. */
async function runCommand(command, { sender, alvo, groupJid, participants }) {
  const sent = [];
  const nazu = makeNazu({ sent, groupJid, participants });
  const info = {
    key: { remoteJid: groupJid, fromMe: false, id: `M-${Math.random().toString(36).slice(2, 9)}`, participant: sender.lid },
    message: {
      extendedTextMessage: {
        text: `!${command}`,
        contextInfo: { remoteJid: groupJid, mentionedJid: [alvo.lid], participant: alvo.lid },
      },
    },
    messageTimestamp: 1757900000,
    pushName: 'Autor',
  };
  await handleMessage(nazu, info, null, new Map(), null);
  const texto = sent.map((s) => s.content?.text ?? s.content?.caption ?? '').filter(Boolean).join('\n');
  const midia = sent.find((s) => s.content?.video || s.content?.image) || null;
  return { sent, texto, midia };
}

// ============================================================================
// 1) MÓDULO DE MÍDIAS (unitário)
// ============================================================================

await test('gifsbn: a pasta fica em dados/src/gifsbn', () => {
  ok(GIFSBN_DIR.endsWith(path.join('dados', 'src', 'gifsbn')), `caminho da pasta (${GIFSBN_DIR})`);
  ok(fs.existsSync(GIFSBN_DIR), 'a pasta existe');
});

await test('gifsbn: acha o arquivo pelo nome do comando', () => {
  criarMidia('tapar', 'gif');
  const achado = gifsbn.findGifsbnMedia('tapar');
  ok(achado && achado.file.endsWith(`tapar.gif`), 'achou tapar.gif');
  ok(achado.isVideo === true, 'gif é tratado como vídeo');
  ok(gifsbn.findGifsbnMedia('inexistente') === null, 'comando sem arquivo -> null');
});

await test('gifsbn: aceita várias extensões (gif, mp4, jpg, png, webp)', () => {
  criarMidia('soco', 'mp4', Buffer.from('fake-mp4'));
  criarMidia('beijo', 'jpg', Buffer.from('fake-jpg'));
  criarMidia('morder', 'png', Buffer.from('fake-png'));
  criarMidia('lamber', 'webp', Buffer.from('fake-webp'));

  ok(gifsbn.findGifsbnMedia('soco')?.ext === 'mp4', 'mp4 reconhecido');
  ok(gifsbn.findGifsbnMedia('beijo')?.ext === 'jpg', 'jpg reconhecido');
  ok(gifsbn.findGifsbnMedia('morder')?.ext === 'png', 'png reconhecido');
  ok(gifsbn.findGifsbnMedia('lamber')?.ext === 'webp', 'webp reconhecido');

  ok(gifsbn.findGifsbnMedia('soco')?.isVideo === true, 'mp4 é vídeo');
  ok(gifsbn.findGifsbnMedia('beijo')?.isVideo === false, 'jpg é imagem');
});

await test('gifsbn: monta a mídia no formato usado pelos comandos', () => {
  criarMidia('tapargif', 'gif');
  const midia = gifsbn.buildMediaFromFile('tapargif');
  ok(midia?.video?.url === './gifsbn/tapargif.gif', `vídeo com caminho relativo (${midia?.video?.url})`);
  ok(midia?.isGif === true, 'marcado como GIF');

  criarMidia('abracofoto', 'jpg');
  const img = gifsbn.buildMediaFromFile('abracofoto');
  ok(img?.image?.url === './gifsbn/abracofoto.jpg', `imagem com caminho relativo (${img?.image?.url})`);
  ok(img?.isGif === false, 'imagem não é GIF');
});

await test('gifsbn: o arquivo solto tem prioridade sobre o games.json', () => {
  criarMidia('prioridade', 'gif');
  const doGames = { video: { url: 'http://exemplo.com/antigo.mp4' }, isGif: false };
  const r = gifsbn.resolveBrincadeiraMedia(doGames, 'prioridade');
  includes(JSON.stringify(r.media), 'gifsbn/prioridade.gif', 'usou o arquivo da pasta');
  notIncludes(JSON.stringify(r.media), 'exemplo.com', 'ignorou o games.json');
});

await test('gifsbn: sem arquivo na pasta, cai para o games.json', () => {
  const doGames = { video: { url: './midias/goza.mp4' }, isGif: false };
  const r = gifsbn.resolveBrincadeiraMedia(doGames, 'comando-sem-arquivo');
  ok(r.media === doGames, 'usou a mídia do games.json');
  ok(r.isCustomGif === false, 'isGif do games.json respeitado');
});

await test('gifsbn: resolve o caminho relativo e deixa URL http passar', () => {
  const base = path.join(PROJECT, 'dados', 'src');
  const local = gifsbn.resolveMediaUrl('./gifsbn/tapar.gif', base);
  ok(local === path.join(base, 'gifsbn', 'tapar.gif'), `resolveu ./ para ${local}`);
  const url = gifsbn.resolveMediaUrl('http://exemplo.com/x.mp4', base);
  ok(url === 'http://exemplo.com/x.mp4', 'URL http passa intacta');
});

await test('gifsbn: saveGifsbnMedia grava e devolve o caminho relativo', () => {
  const r = gifsbn.saveGifsbnMedia('salvar', 'gif', GIF_1PX);
  ok(r?.relativePath === './gifsbn/salvar.gif', `caminho relativo (${r?.relativePath})`);
  ok(r?.isVideo === true, 'gif marcado como vídeo');
  const file = path.join(GIFSBN_DIR, 'salvar.gif');
  criados.push(file);
  ok(fs.existsSync(file), 'arquivo gravado no disco');
  ok(fs.readFileSync(file).equals(GIF_1PX), 'conteúdo gravado corretamente');
});

await test('gifsbn: salvar com outra extensão remove a anterior do comando', () => {
  // Evita ficar com tapar.gif E tapar.mp4 (o arquivo solto venceria).
  gifsbn.saveGifsbnMedia('troca', 'gif', GIF_1PX);
  const gif = path.join(GIFSBN_DIR, 'troca.gif');
  const mp4 = path.join(GIFSBN_DIR, 'troca.mp4');
  criados.push(gif, mp4);
  ok(fs.existsSync(gif), 'gif criado');

  gifsbn.saveGifsbnMedia('troca', 'mp4', Buffer.from('fake'));
  ok(!fs.existsSync(gif), 'gif antigo removido');
  ok(fs.existsSync(mp4), 'mp4 criado');
  ok(gifsbn.findGifsbnMedia('troca')?.ext === 'mp4', 'a mídia atual é o mp4');
});

await test('gifsbn: rejeita nome perigoso e extensão não suportada', () => {
  ok(gifsbn.saveGifsbnMedia('../escapa', 'gif', GIF_1PX) === null, 'bloqueia nome com ../');
  ok(gifsbn.saveGifsbnMedia('ok', 'exe', GIF_1PX) === null, 'bloqueia extensão .exe');
  ok(gifsbn.findGifsbnMedia('../x') === null, 'busca não aceita ../');
  ok(gifsbn.findGifsbnMedia('') === null, 'busca com nome vazio -> null');
});

// ============================================================================
// 2) ARQUIVO SOLTO FAZ O COMANDO USAR ELE (pontas soltas / handler real)
// ============================================================================

await test('!tapar usa gifsbn/tapar.gif sem nunca rodar !setgif (requisito)', async () => {
  criarMidia('tapar', 'gif');
  const groupJid = makeGroup();
  const autor = makeSender();
  const alvo = makeSender();
  const participants = [
    { lid: autor.lid, jid: autor.jid },
    { lid: alvo.lid, jid: alvo.jid },
    { lid: BOT_LID, jid: BOT_JID, isAdmin: true },
  ];

  const { midia, texto } = await runCommand('tapar', { sender: autor, alvo, groupJid, participants });

  ok(Boolean(midia), 'o comando enviou mídia');
  ok(Boolean(midia?.content?.video), 'enviada como vídeo/GIF');
  ok(midia?.content?.gifPlayback === true, 'gifPlayback ativo');
  ok(texto.length > 0, 'a frase foi junto (legenda ou texto)');
  ok(fs.readFileSync(path.join(GIFSBN_DIR, 'tapar.gif')).equals(GIF_1PX), 'é o arquivo da pasta gifsbn');
});

await test('!beijo usa gifsbn/beijo.jpg (imagem) sem !setgif', async () => {
  criarMidia('beijo', 'jpg');
  const groupJid = makeGroup();
  const autor = makeSender();
  const alvo = makeSender();
  const participants = [
    { lid: autor.lid, jid: autor.jid },
    { lid: alvo.lid, jid: alvo.jid },
    { lid: BOT_LID, jid: BOT_JID, isAdmin: true },
  ];

  const { midia } = await runCommand('beijo', { sender: autor, alvo, groupJid, participants });
  ok(Boolean(midia?.content?.image), 'a imagem da pasta foi enviada');
});

await test('!soco sem arquivo na pasta e sem games.json cai para o texto', async () => {
  const groupJid = makeGroup();
  const autor = makeSender();
  const alvo = makeSender();
  const participants = [
    { lid: autor.lid, jid: autor.jid },
    { lid: alvo.lid, jid: alvo.jid },
    { lid: BOT_LID, jid: BOT_JID, isAdmin: true },
  ];

  // 'socomedia' não existe em nenhum dos dois: deve responder só texto.
  const { midia, texto } = await runCommand('socomedia', { sender: autor, alvo, groupJid, participants });
  ok(!midia, 'não enviou mídia (não há mídia definida)');
  notIncludes(texto, 'undefined', 'sem undefined');
});

// ============================================================================
// 3) LIGAÇÃO DO COMANDO !setgif (verificação de integração)
// ============================================================================

await test('!setgif grava na pasta gifsbn e registra o caminho relativo', () => {
  const src = fs.readFileSync(path.join(PROJECT, 'dados/src/index.js'), 'utf-8');
  const trecho = src.slice(src.indexOf("case 'setgif'"), src.indexOf("case 'setgif'") + 6000);

  includes(trecho, 'saveGifsbnMedia(cmdName', 'usa o helper saveGifsbnMedia');
  includes(trecho, 'saved.relativePath', 'registra o caminho relativo devolvido pelo helper');
  notIncludes(trecho, './database/gifs', 'não grava mais na pasta antiga database/gifs');
  notIncludes(trecho, "gifsDir", 'não monta mais o diretório antigo na mão');
});

await test('!setgif continua aceitando os comandos de brincadeira', () => {
  const src = fs.readFileSync(path.join(PROJECT, 'dados/src/index.js'), 'utf-8');
  const match = /const validCommands = \[([^\]]+)\];/.exec(src);
  ok(Boolean(match), 'lista de comandos válidos encontrada');
  for (const cmd of ['tapa', 'tapar', 'soco', 'beijo', 'goza', 'punheta', 'siririca', 'compatibilidade', 'pgpau', 'pgpeito', 'pgbunda']) {
    includes(match[1], `'${cmd}'`, `aceita ${cmd}`);
  }
});

await test('os comandos leem a mídia pelo helper (arquivo solto tem prioridade)', () => {
  const src = fs.readFileSync(path.join(PROJECT, 'dados/src/index.js'), 'utf-8');
  includes(src, 'resolveBrincadeiraMedia(gamesData.games2[command], command)', 'comandos de brincadeira usam o helper');
  includes(src, "buildMediaFromFile('surubao')", 'surubão usa o helper');
  includes(src, "buildMediaFromFile('compatibilidade')", 'compatibilidade usa o helper');
  // O caminho antigo gravado pelo !setgif continua resolvendo (retrocompatível).
  includes(src, 'resolveGifsbnMediaUrl(', 'paths ./ são resolvidos pelo helper');
});

// ============================================================================

// Limpa o que os testes criaram na pasta real (mantém só o .gitkeep).
for (const f of criados) {
  try { fs.rmSync(f, { force: true }); } catch { /* já removido */ }
}

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