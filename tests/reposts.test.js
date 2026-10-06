/**
 * Sistema de reposts — armazenamento, expiração (24h), mídia e cards.
 *
 * Roda o módulo REAL (`dados/src/utils/reposts.js`) com um DATABASE_PATH
 * temporário, então não toca o banco do bot.
 *
 * Uso: node tests/reposts.test.js
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.resolve(HERE, '..');

const TMP_DB = fs.mkdtempSync(path.join(os.tmpdir(), 'lizzy-repost-db-'));
process.env.DATABASE_PATH = TMP_DB;

const reposts = (await import(new URL('../dados/src/utils/reposts.js', import.meta.url).href)).default;

const ARQUIVO = path.join(TMP_DB, 'reposts.json');
const MIDIA_DIR = path.join(TMP_DB, 'reposts-media');

const RESULTS = [];
let CURRENT = null;

function test(name, fn) {
  CURRENT = { name, passed: 0, failed: 0, errors: [] };
  RESULTS.push(CURRENT);
  return Promise.resolve()
    .then(fn)
    .catch((error) => {
      CURRENT.failed += 1;
      CURRENT.errors.push(`EXCEÇÃO: ${error?.stack || error}`);
    })
    .then(() => {
      console.log(`${CURRENT.failed === 0 ? '✅' : '❌'} ${name} (${CURRENT.passed} ok, ${CURRENT.failed} falhas)`);
      for (const err of CURRENT.errors) console.log(`     ${err.split('\n')[0]}`);
    });
}

function ok(cond, msg) {
  if (cond) CURRENT.passed += 1;
  else {
    CURRENT.failed += 1;
    CURRENT.errors.push(`ASSERT FALHOU: ${msg}`);
  }
}

const JPEG = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
  0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xd9
]);
const MP4 = Buffer.concat([
  Buffer.from([0x00, 0x00, 0x00, 0x18]), Buffer.from('ftypmp42'),
  Buffer.from([0x00, 0x00, 0x00, 0x00]), Buffer.from('mp42isom'), Buffer.alloc(64)
]);
const OGG = Buffer.concat([Buffer.from('OggS'), Buffer.alloc(64)]);

const CONTEUDO = { image: JPEG, video: MP4, ptv: MP4, audio: OGG };
const baixar = async (_media, tipo) => CONTEUDO[tipo] || Buffer.from('x');

const imgMsg = (caption) => ({ imageMessage: { mediaKey: 'k', mimetype: 'image/jpeg', caption } });
const vidMsg = (caption) => ({ videoMessage: { mediaKey: 'k', mimetype: 'video/mp4', caption } });
const audMsg = () => ({ audioMessage: { mediaKey: 'k', mimetype: 'audio/ogg; codecs=opus', ptt: false } });
const txtMsg = (t) => ({ conversation: t });

const criar = (conteudo) => reposts.criar({ conteudo, baixar });

await test('texto puro vira repost #1 com capa (header obrigatório do carrossel)', async () => {
  const r = await criar(txtMsg('mensagem original aqui'));
  ok(r.ok, 'criou o repost');
  ok(r.repost.numero === 1, `numero sequencial (veio ${r.repost.numero})`);
  ok(r.repost.tipo === 'text', 'tipo texto');
  ok(r.repost.texto === 'mensagem original aqui', 'preserva o texto');
  ok(r.repost.arquivo === null, 'texto nao gera arquivo de mídia');
  ok(!!r.repost.capa && fs.existsSync(reposts.caminhoMidia(r.repost.capa)), 'gera capa (header do card)');
  ok(r.repost.expiraEm - r.repost.criadoEm === 24 * 60 * 60 * 1000, 'expira em 24h exatas');
});

await test('imagem com legenda vira #2 e salva a mídia local', async () => {
  const r = await criar(imgMsg('Essa é a legenda original.'));
  ok(r.ok && r.repost.numero === 2, 'criou o #2');
  ok(r.repost.tipo === 'image', 'tipo imagem');
  ok(r.repost.texto === 'Essa é a legenda original.', 'preserva a legenda');
  const p = reposts.caminhoMidia(r.repost.arquivo);
  ok(fs.existsSync(p), 'arquivo de mídia salvo');
  ok(fs.readFileSync(p).equals(JPEG), 'conteúdo da mídia correto');
});

await test('vídeo e áudio viram #3 e #4 (áudio salvo local)', async () => {
  const v = await criar(vidMsg('legenda do video'));
  const a = await criar(audMsg());
  ok(v.repost.numero === 3 && v.repost.tipo === 'video', 'video #3');
  ok(v.repost.texto === 'legenda do video', 'preserva legenda do video');
  ok(a.repost.numero === 4 && a.repost.tipo === 'audio', 'audio #4');
  ok(fs.existsSync(reposts.caminhoMidia(a.repost.arquivo)), 'audio salvo local');
});

await test('listar devolve em ordem numérica crescente', () => {
  const ativos = reposts.listar();
  ok(ativos.length === 4, `4 ativos (veio ${ativos.length})`);
  ok(ativos.map((r) => r.numero).join(',') === '1,2,3,4', 'ordem 1,2,3,4');
});

await test('montarCard: TODO card tem header de imagem/vídeo (exigência do carrossel)', () => {
  const [t1, t2, t3, t4] = reposts.listar();

  const cTexto = reposts.montarCard(t1);
  ok(cTexto.image && cTexto.image.url, 'card de texto tem header de imagem (capa)');
  ok(fs.existsSync(cTexto.image.url), 'a capa do card de texto existe');
  ok(cTexto.caption === 'mensagem original aqui', 'o texto vai no caption (texto real, não imagem)');
  ok(!cTexto.video && !cTexto.audioFooter, 'card de texto nao tem video/audio');

  const cImg = reposts.montarCard(t2);
  ok(cImg.image && cImg.image.url, 'card de imagem aponta a mídia');
  ok(cImg.caption === 'Essa é a legenda original.', 'card de imagem mantém a legenda');
  ok(cImg.title === 'Repost #2', 'card de imagem tem título');
  ok(fs.existsSync(cImg.image.url), 'a mídia do card existe em disco');

  const cVid = reposts.montarCard(t3);
  ok(cVid.video && cVid.mimetype === 'video/mp4', 'card de vídeo usa o vídeo (não imagem)');
  ok(cVid.caption === 'legenda do video', 'card de vídeo mantém a legenda');

  const cAud = reposts.montarCard(t4);
  ok(cAud.image && cAud.image.url, 'card de áudio usa capa (o card não reproduz áudio)');
  ok(fs.existsSync(cAud.image.url), 'a capa do card de áudio existe');
  ok(!cAud.audioFooter, 'não usa audioFooter (o carrossel do WhatsApp ignora)');
});

await test('audiosAtivos devolve só os áudios ativos, em ordem', () => {
  const audios = reposts.audiosAtivos();
  ok(audios.length === 1, `1 áudio ativo (veio ${audios.length})`);
  ok(audios[0].numero === 4, 'é o #4');
  ok(fs.existsSync(audios[0].arquivo), 'arquivo de áudio existe');
});

await test('remover #2 apaga registro, mídia e capa, sem renumerar', async () => {
  const antes = reposts.listar().find((r) => r.numero === 2);
  const arquivo = reposts.caminhoMidia(antes.arquivo);
  ok(fs.existsSync(arquivo), 'arquivo existe antes');

  const r = reposts.remover(2);
  ok(r.ok, 'removeu o #2');
  ok(!fs.existsSync(arquivo), 'arquivo de mídia apagado');
  ok(!reposts.listar().some((x) => x.numero === 2), '#2 sumiu do listar');
  ok(reposts.listar().map((x) => x.numero).join(',') === '1,3,4', '#1,#3,#4 continuam (sem renumerar)');

  const novo = await criar(txtMsg('depois do delete'));
  ok(novo.repost.numero === 5, `o próximo é #5 (veio ${novo.repost.numero})`);
});

await test('remover número inexistente devolve ok=false', () => {
  ok(reposts.remover(999).ok === false, 'não encontrado');
});

await test('expiração individual: só o vencido sai (apaga mídia e capa)', async () => {
  const antes = reposts.listar().length;
  const d = JSON.parse(fs.readFileSync(ARQUIVO, 'utf-8'));
  const alvo = d.reposts.find((r) => r.numero === 3);
  const arquivo = reposts.caminhoMidia(alvo.arquivo);
  alvo.expiraEm = Date.now() - 1000;
  fs.writeFileSync(ARQUIVO, JSON.stringify(d, null, 2));

  const removidos = reposts.limparExpirados();
  ok(removidos === 1, `removeu 1 (veio ${removidos})`);
  ok(!fs.existsSync(arquivo), 'arquivo do vencido apagado');
  ok(reposts.listar().length === antes - 1, 'sobrou o resto');
  ok(!reposts.listar().some((r) => r.numero === 3), '#3 expirou');
});

await test('persistência: reler do disco mantém números e dados', () => {
  const doDisco = JSON.parse(fs.readFileSync(ARQUIVO, 'utf-8'));
  ok(typeof doDisco.proximoNumero === 'number' && doDisco.proximoNumero >= 6, 'proximoNumero persistido');
  ok(doDisco.reposts.every((r) => r.id && r.numero && r.criadoEm && r.expiraEm), 'cada repost tem id/numero/datas');
  ok(doDisco.reposts.some((r) => r.numero === 5 && r.tipo === 'text'), 'o #5 texto está no disco');
});

await test('sem mensagem respondida devolve erro claro', async () => {
  const r = await criar(null);
  ok(r.ok === false, 'não criou');
  ok(/responda/i.test(r.msg), `mensagem pede para responder (veio "${r.msg}")`);
});

await test('tipo não suportado (documento) é recusado sem quebrar', async () => {
  const r = await criar({ documentMessage: { mediaKey: 'k', mimetype: 'application/pdf', fileName: 'x.pdf' } });
  ok(r.ok === false, 'não criou');
  ok(/repostar/i.test(r.msg), `mensagem explica (veio "${r.msg}")`);
});

await test('falha no download não cria repost', async () => {
  const r = await reposts.criar({
    conteudo: imgMsg('x'),
    baixar: async () => { throw new Error('rede'); }
  });
  ok(r.ok === false && /baixar/i.test(r.msg), 'erro tratado');
});

await test('mídia vazia não cria repost', async () => {
  const r = await reposts.criar({ conteudo: imgMsg('x'), baixar: async () => Buffer.alloc(0) });
  ok(r.ok === false, 'não criou com mídia vazia');
});

await test('limite de cards do carrossel é positivo e razoável', () => {
  ok(Number.isInteger(reposts.MAX_CARDS) && reposts.MAX_CARDS >= 2 && reposts.MAX_CARDS <= 10,
    `MAX_CARDS=${reposts.MAX_CARDS}`);
});

await test('os cards viram UM carrossel real na fork (todos com header de mídia)', async () => {
  const { generateWAMessageContent } = await import('@itsliaaa/baileys');

  fs.mkdirSync(path.join(TMP_DB, 'reposts-media'), { recursive: true });
  fs.mkdirSync(path.join(TMP_DB, 'reposts-cards'), { recursive: true });
  fs.writeFileSync(path.join(TMP_DB, 'reposts-media', 'a.jpg'), JPEG);
  fs.writeFileSync(path.join(TMP_DB, 'reposts-media', 'a.mp4'), MP4);
  fs.writeFileSync(path.join(TMP_DB, 'reposts-media', 'a.ogg'), OGG);
  fs.writeFileSync(path.join(TMP_DB, 'reposts-cards', 'cap.png'), JPEG);

  const cards = [
    reposts.montarCard({ tipo: 'image', arquivo: 'reposts-media/a.jpg', capa: null, mimetype: 'image/jpeg', texto: 'legenda img' }),
    reposts.montarCard({ tipo: 'video', arquivo: 'reposts-media/a.mp4', capa: null, mimetype: 'video/mp4', texto: 'legenda vid' }),
    reposts.montarCard({ tipo: 'text', arquivo: null, capa: 'reposts-cards/cap.png', texto: 'texto puro' })
  ];

  const upload = async () => ({ url: 'https://mmg.whatsapp.net/fake', directPath: '/v/fake' });
  const m = await generateWAMessageContent(
    { text: '📌 Reposts ativos', cards },
    { userJid: '5599999999999:5@s.whatsapp.net', upload, jid: '120363826666666601@g.us' }
  );

  const car = m.interactiveMessage?.carouselMessage;
  ok(!!car, 'gerou interactiveMessage.carouselMessage (UM carrossel)');
  ok(car.cards.length === 3, `um card por repost (${car.cards.length})`);

  ok(car.cards[0].header?.imageMessage, 'card #1 é imagem');
  ok(car.cards[0].body?.text === 'legenda img', 'card #1 mantém a legenda');
  ok(car.cards[1].header?.videoMessage, 'card #2 é vídeo');
  ok(car.cards[1].body?.text === 'legenda vid', 'card #2 mantém a legenda');
  ok(car.cards[2].header?.imageMessage, 'card #3 (texto) tem header de imagem (capa) — exigência do carrossel');
  ok(car.cards[2].body?.text?.includes('texto puro'), 'card #3 carrega o texto real no body');
});

await test('montarCards gera capa sob demanda para repost antigo sem capa', async () => {
  const d = JSON.parse(fs.readFileSync(ARQUIVO, 'utf-8'));
  const alvo = d.reposts.find((r) => r.tipo === 'text');
  delete alvo.capa;
  fs.writeFileSync(ARQUIVO, JSON.stringify(d, null, 2));

  const cards = await reposts.montarCards();
  const card = cards.find((c) => c.caption && c.caption.includes('depois do delete')) || cards[0];
  ok(card.image && card.image.url && fs.existsSync(card.image.url), 'gerou a capa e o card tem header');

  const recarregado = JSON.parse(fs.readFileSync(ARQUIVO, 'utf-8')).reposts.find((r) => r.numero === alvo.numero);
  ok(!!recarregado.capa && fs.existsSync(reposts.caminhoMidia(recarregado.capa)), 'a capa ficou persistida no registro');
});

const totalOk = RESULTS.reduce((a, r) => a + r.passed, 0);
const totalFail = RESULTS.reduce((a, r) => a + r.failed, 0);
console.log('\n════════════════════════════════════════');
console.log(`RESULTADO: ${RESULTS.length} testes | ${totalOk} asserções ok | ${totalFail} falhas`);
console.log('════════════════════════════════════════');

fs.rmSync(TMP_DB, { recursive: true, force: true });
if (totalFail > 0) {
  for (const r of RESULTS) if (r.failed) for (const e of r.errors) console.log(`- [${r.name}] ${e}`);
  process.exit(1);
}
console.log('✅ TODOS OS TESTES PASSARAM');
process.exit(0);
