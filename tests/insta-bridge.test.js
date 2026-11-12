/**
 * Ponte do Instagram (DM) — `dados/src/utils/instaBridge.js`.
 *
 * O que este teste garante (o que NÃO depende de rede):
 *   - a ponte é OPT-IN (`INSTA_DM=1`); sem a env, `ligarPonteInstagram` não sobe;
 *   - `infoDoDm` monta o `info` no formato que o handler espera, e NÃO trata a
 *     própria mensagem do bot como comando (anti-eco);
 *   - `enviarParaInsta` traduz o content do bot (texto/foto/vídeo/voz/gif) e
 *     avisa em texto quando o tipo não existe no Instagram (figurinha/documento);
 *   - `criarNazuInsta` monta um `nazu` que o handler USA de verdade;
 *   - o `!ping` e o `!menu` REAIS do bot respondem quando a DM vem "do
 *     Instagram" — chamando o MESMO handler, com o `nazu` da ponte.
 *
 * Uso: node tests/insta-bridge.test.js
 */

import fs from 'fs';
import os from 'os';
import path from 'path';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'lizzy-insta-'));
process.env.DATABASE_PATH = TMP;
process.env.CONFIG_PATH = path.join(TMP, 'config.json');
fs.mkdirSync(path.join(TMP, 'grupos'), { recursive: true });
fs.writeFileSync(process.env.CONFIG_PATH, JSON.stringify({
  nomebot: 'Lizzy', prefixo: '!', numerodono: '5511999999999', nomedono: 'Dono'
}));

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('FAIL:', m); } };
// O layout do bot usa MATHEMATICAL BOLD — desbold antes de comparar.
function desbold(t) {
  return String(t || '').replace(/[\u{1D400}-\u{1D7FF}]/gu, (c) => {
    const n = c.codePointAt(0);
    if (n >= 0x1D400 && n <= 0x1D419) return String.fromCharCode(65 + n - 0x1D400);
    if (n >= 0x1D41A && n <= 0x1D433) return String.fromCharCode(97 + n - 0x1D41A);
    return c;
  });
}
const contem = (h, n, m) => ok(typeof h === 'string' && desbold(h).includes(n), `${m || n} — esperado "${n}"`);

const bridge = await import(new URL('../dados/src/utils/instaBridge.js', import.meta.url).href);
const { infoDoDm, instaDmLigado, ligarPonteInstagram, enviarParaInsta, criarNazuInsta, imagemPequena, pedacosDeTexto } = bridge;

// ── 1) OPT-IN ────────────────────────────────────────────────────────────────
delete process.env.INSTA_DM;
ok(instaDmLigado() === false, 'sem INSTA_DM -> desligado');
process.env.INSTA_DM = '1';
ok(instaDmLigado() === true, 'com INSTA_DM=1 -> ligado');
delete process.env.INSTA_DM;
ok((await ligarPonteInstagram({ executar: () => {} })) === null, 'desligado -> nao sobe (null)');
process.env.INSTA_DM = '1';

// ── 2) infoDoDm (o formato que o handler espera) ─────────────────────────────
const i = infoDoDm({ thread_id: 'T1', user_id: 'U1', text: '!ping', id: 'M1', item_type: 'text', timestamp: Date.now() });
ok(i !== null, 'texto -> info montado');
ok(i.key.remoteJid === 'T1', 'remoteJid = id da THREAD');
ok(i.key.participant === 'U1', 'participant = quem mandou');
ok(i.key.fromMe === false, 'fromMe = false');
ok(i.message.conversation === '!ping', 'o texto vai em conversation');
ok(i._origem === 'instagram', 'marca a origem');
ok(typeof i.messageTimestamp === 'number' && i.messageTimestamp > 1e9 && i.messageTimestamp < 1e11,
  'timestamp em SEGUNDOS (o handler multiplica por 1000)');

ok(infoDoDm(null) === null, 'null -> null');
ok(infoDoDm({ thread_id: 'T', user_id: 'U', text: '' }) === null, 'texto vazio -> null');
ok(infoDoDm({ thread_id: 'T', user_id: 'U', text: 'oi', item_type: 'reaction' }) === null, 'reacao -> ignorada');
ok(infoDoDm({ user_id: 'U', text: 'oi' }) === null, 'sem thread -> null');

// ANTI-ECO: a propria mensagem do bot nao vira comando (senao vira loop).
ok(infoDoDm({ thread_id: 'T', user_id: 'BOT', text: '!ping', item_type: 'text', is_sent_by_viewer: true }) === null,
  'eco do bot (is_sent_by_viewer) -> ignorado');

// ── 3) enviarParaInsta — o content do bot -> a lib do Instagram ──────────────
function fakeInsta() {
  const enviados = [];
  return {
    enviados,
    userId: '66619508210',
    me: { pk: '66619508210', username: 'liz.zybot' },
    sendMessage: async (alvo, content) => { enviados.push({ alvo, content }); return { item_id: '1' }; },
    direct: { sendGif: async (alvo, id) => { enviados.push({ alvo, gif: id }); return { item_id: '2' }; } },
  };
}
const silencio = { log: () => {}, error: () => {} };

// pedacosDeTexto — o texto grande (o menu) e' dividido em blocos de ~1000 chars.
const grande = Array.from({ length: 400 }, (_, k) => `linha ${k} do menu`).join('\n');
const pedacos = pedacosDeTexto(grande, 1000);
ok(pedacos.length > 1, 'texto grande vira varios pedacos');
ok(pedacos.every((p) => p.length <= 1000), 'nenhum pedaco passa do limite');
ok(pedacos.join('\n') === grande, 'os pedacos juntos reconstroem o texto (nada se perde)');
ok(pedacosDeTexto('curto').length === 1, 'texto curto vira 1 pedaco');
ok(pedacosDeTexto('').length === 0, 'texto vazio vira 0 pedacos');

// imagemPequena — reduz de verdade (sharp) e mantem o formato JPEG.
const sharp = (await import('sharp')).default;
const imgGrande = await sharp({ create: { width: 1200, height: 1200, channels: 3, background: '#334455' } }).jpeg().toBuffer();
const reduzida = await imagemPequena(imgGrande, silencio);
ok(Buffer.isBuffer(reduzida), 'imagemPequena devolve um Buffer');
const meta = await sharp(reduzida).metadata();
ok(Math.max(meta.width, meta.height) <= 480, `a imagem foi reduzida (${meta.width}x${meta.height} <= 480)`);
ok(meta.format === 'jpeg', 'a saida e JPEG');
ok((await imagemPequena(Buffer.from('nao e imagem'), silencio)) === null, 'buffer invalido -> null (best-effort)');

let insta = fakeInsta();
await enviarParaInsta(insta, 'T', { text: 'oi' }, silencio);
ok(insta.enviados.length === 1 && insta.enviados[0].content.text === 'oi', 'texto -> 1 mensagem { text }');

// O CASO DO BUG: imagem + legenda -> imagem (reduzida) E o texto ABAIXO.
insta = fakeInsta();
await enviarParaInsta(insta, 'T', { image: imgGrande, caption: 'MENU COMPLETO\ncomandos aqui' }, silencio);
ok(insta.enviados.length === 2, 'imagem+legenda -> 2 mensagens (midia + texto)');
ok(Buffer.isBuffer(insta.enviados[0].content.image), 'a 1a mensagem e a IMAGEM');
ok(insta.enviados[1].content.text === 'MENU COMPLETO\ncomandos aqui', 'a 2a mensagem e o TEXTO (abaixo da midia)');
const imgMeta = await sharp(insta.enviados[0].content.image).metadata();
ok(Math.max(imgMeta.width, imgMeta.height) <= 480, 'a imagem do menu saiu PEQUENA');

insta = fakeInsta();
await enviarParaInsta(insta, 'T', { video: Buffer.from([1]), caption: 'legenda do video' }, silencio);
ok(insta.enviados.length === 2, 'video+legenda -> 2 mensagens');
ok(Buffer.isBuffer(insta.enviados[0].content.video), 'a 1a e o VIDEO');
ok(insta.enviados[1].content.text === 'legenda do video', 'a 2a e o texto abaixo');

insta = fakeInsta();
await enviarParaInsta(insta, 'T', { audio: Buffer.from([1]) }, silencio);
ok(insta.enviados.length === 1 && Buffer.isBuffer(insta.enviados[0].content.audio), 'audio -> 1 mensagem { audio }');

insta = fakeInsta();
await enviarParaInsta(insta, 'T', { gif: '3o7aCTfyhYawdOXcFW' }, silencio);
ok(insta.enviados.at(-1).gif === '3o7aCTfyhYawdOXcFW', 'gif -> direct.sendGif(id)');

insta = fakeInsta();
await enviarParaInsta(insta, 'T', { sticker: Buffer.from([1]) }, silencio);
ok(/figurinha/.test(insta.enviados.at(-1).content.text || ''), 'figurinha -> avisa em texto');

insta = fakeInsta();
await enviarParaInsta(insta, 'T', { document: Buffer.from([1]), fileName: 'a.pdf' }, silencio);
ok(/documento/.test(insta.enviados.at(-1).content.text || ''), 'documento -> avisa em texto');

// texto GRANDE (o menu real) e' enviado inteiro, em varios pedacos.
insta = fakeInsta();
await enviarParaInsta(insta, 'T', { text: grande }, silencio);
ok(insta.enviados.length === pedacos.length, `texto grande -> ${pedacos.length} mensagens`);
ok(insta.enviados.map((e) => e.content.text).join('\n') === grande, 'o texto grande chega inteiro');

// ── 4) criarNazuInsta — a superficie que o handler usa ───────────────────────
insta = fakeInsta();
const infoN = infoDoDm({ thread_id: 'T', user_id: 'U', text: '!ping', id: 'M', item_type: 'text', timestamp: Date.now() });
const nazu = criarNazuInsta(insta, infoN, silencio);
ok(typeof nazu.user.id === 'string', 'nazu.user.id e STRING (getBotId faz .split)');
ok(nazu.user.id.split(':')[0] === '66619508210', 'getBotId consegue ler o id (nao lanca)');
ok(typeof nazu.sendMessage === 'function', 'nazu.sendMessage existe');
await nazu.sendMessage('T', { text: 'x' });
ok(insta.enviados.at(-1).content.text === 'x', 'nazu.sendMessage roteia pro Instagram');
ok((await nazu.groupMetadata('T')) && typeof (await nazu.groupMetadata('T')) === 'object', 'groupMetadata devolve objeto (nao quebra)');
ok((await nazu.groupParticipantsUpdate('T', ['a'], 'remove')) === undefined, 'metodo de grupo e no-op (nao lanca)');
ok(Array.isArray(await nazu.groupRequestParticipantsList('T')), 'lista de requests devolve array');

// ── 5) sem cookie, nao sobe ─────────────────────────────────────────────────
process.env.IG_COOKIES_FILE = path.join(TMP, 'inexistente.txt');
delete process.env.IG_COOKIES_DIR;
const semCookie = await ligarPonteInstagram({ executar: () => {} });
ok(semCookie === null, 'sem cookie -> nao sobe');

// ── 6) o !ping e o !menu REAIS respondem com o info "do Instagram" ───────────
const indexModule = (await import(new URL('../dados/src/index.js', import.meta.url).href)).default;

async function rodarDM(texto) {
  const instaFake = fakeInsta();
  const infoDM = infoDoDm({ thread_id: 'T-FAKE', user_id: 'U-FAKE', text: texto, id: 'M1', item_type: 'text', timestamp: Date.now() });
  const nz = criarNazuInsta(instaFake, infoDM, silencio);
  let erro = null;
  try { await indexModule(nz, infoDM, null, new Map(), null); } catch (e) { erro = e; }
  return { instaFake, erro };
}

const ping = await rodarDM('!ping');
ok(ping.erro === null, `!ping na DM nao lanca (${ping.erro?.message || 'ok'})`);
const pingTexto = ping.instaFake.enviados.map((e) => e.content?.text || '').join('\n');
contem(pingTexto, 'PING', 'a resposta e o PING do bot');
contem(pingTexto, 'Lat', 'traz a latencia (comando real, nao stub)');
ok(ping.instaFake.enviados.length >= 1, 'o !ping respondeu no DM');

const menu = await rodarDM('!menu');
ok(menu.erro === null, `!menu na DM nao lanca (${menu.erro?.message || 'ok'})`);
const menuTexto = menu.instaFake.enviados.map((e) => e.content?.text || e.content?.caption || '').join('\n');
contem(menuTexto, 'Lizzy', 'o menu traz o nome do bot');
ok(/!ping|!menu|!play/i.test(desbold(menuTexto)), 'o menu lista comandos de verdade');

// ── 8) PONTA A PONTA (seam): dm.received -> handler -> envio no Instagram ────
// Escreve um cookie real e injeta uma lib falsa no lugar do MQTT.
const IG_DIR = path.join(TMP, 'ig');
fs.mkdirSync(IG_DIR, { recursive: true });
const cookieFile = path.join(IG_DIR, 'cookies.txt');
fs.writeFileSync(cookieFile, [
  '# Netscape HTTP Cookie File',
  '.instagram.com\tTRUE\t/\tTRUE\t1810239027\tsessionid\t66619508%3Aabc%3A12%3Axyz',
  '.instagram.com\tTRUE\t/\tTRUE\t1810239027\tcsrftoken\tPnqgNUM',
  '',
].join('\n'));
process.env.IG_COOKIES_FILE = cookieFile;
delete process.env.IG_COOKIES_DIR;
process.env.INSTA_DM = '1';

const fakeLib = {
  enviados: [],
  makeInstaClient() {
    const ev = { handlers: {}, on(n, f) { (this.handlers[n] ||= []).push(f); }, off() {}, emit() {} };
    const self = this;
    return {
      ev,
      userId: '66619508210',
      me: { pk: '66619508210', username: 'liz.zybot' },
      sendMessage: async (alvo, content) => { self.enviados.push({ alvo, content }); return { item_id: '1' }; },
      direct: { sendGif: async () => ({}) },
      realtime: { subscribeDirect: async () => {} },
      realtimeConnect: async () => {},
      connect: async () => ({ username: 'liz.zybot' }),
      logout: async () => {},
    };
  },
};
const ponte = await ligarPonteInstagram({
  executar: indexModule,
  log: { log: () => {}, error: () => {} },
  _fabricaInsta: () => fakeLib.makeInstaClient.call(fakeLib),
});
ok(ponte !== null, 'com cookie + INSTA_DM -> a ponte sobe');
const handler = ponte.client.ev.handlers['dm.received']?.[0];
ok(typeof handler === 'function', 'a ponte registrou o listener dm.received');
await handler({ thread_id: 'T-E2E', user_id: 'U-E2E', text: '!ping', id: 'E1', item_type: 'text', timestamp: Date.now() });
ok(fakeLib.enviados.length >= 1, 'a DM disparou a resposta do bot');
ok(/PING/i.test(desbold(fakeLib.enviados.map((e) => e.content?.text || '').join('\n'))), 'a resposta e o PING real');
// anti-eco (a) — reentrega do MESMO id nao responde de novo
const antes = fakeLib.enviados.length;
await handler({ thread_id: 'T-E2E', user_id: 'U-E2E', text: '!ping', id: 'E1', item_type: 'text', timestamp: Date.now() });
ok(fakeLib.enviados.length === antes, 'id repetido nao responde de novo (dedup)');
// anti-eco (b) — a propria mensagem do bot nao vira comando
const antes2 = fakeLib.enviados.length;
await handler({ thread_id: 'T-E2E', user_id: 'BOT', text: '!ping', id: 'E2', item_type: 'text', is_sent_by_viewer: true, timestamp: Date.now() });
ok(fakeLib.enviados.length === antes2, 'eco do bot nao vira comando');

// ── 6b) O CASO DO BUG: `!menu` REAL com midia -> foto pequena + menu abaixo ──
// Configura a midia do menu (o handler le `dono/menuMedia.json`) e roda o
// `!menu` pelo handler real com o `nazu` da ponte.
{
  const donoDir = path.join(TMP, 'dono');
  fs.mkdirSync(donoDir, { recursive: true });
  const imgPath = path.join(TMP, 'menu.jpg');
  fs.writeFileSync(imgPath, await sharp({ create: { width: 1000, height: 1000, channels: 3, background: '#224466' } }).jpeg().toBuffer());
  fs.writeFileSync(path.join(donoDir, 'menuMedia.json'), JSON.stringify({ mediaPath: imgPath, mediaType: 'image', isGif: false }));

  const instaFake = fakeInsta();
  const infoMenu = infoDoDm({ thread_id: 'T-MENU', user_id: 'U', text: '!menu', id: 'MM', item_type: 'text', timestamp: Date.now() });
  const nz = criarNazuInsta(instaFake, infoMenu, silencio);
  await indexModule(nz, infoMenu, null, new Map(), null);

  ok(instaFake.enviados.length >= 2, `!menu com midia -> midia + texto (${instaFake.enviados.length} envios)`);
  const primeiro = instaFake.enviados[0].content;
  ok(Buffer.isBuffer(primeiro.image), 'o 1o envio do menu e a IMAGEM (nao so texto)');
  const m = await sharp(primeiro.image).metadata();
  ok(Math.max(m.width, m.height) <= 480, `a imagem do menu saiu PEQUENA (${m.width}x${m.height})`);
  const restoTxt = instaFake.enviados.slice(1).map((e) => e.content?.text || '').join('\n');
  ok(/Lizzy/i.test(desbold(restoTxt)), 'o TEXTO do menu veio ABAIXO da midia (o bug era so a foto)');
  ok(/!ping|!menu|!play/i.test(desbold(restoTxt)), 'o texto abaixo traz os comandos do menu');
}

// ── 7) guard estrutural: a ponte usa o MESMO handler e a lib ─────────────────
const src = fs.readFileSync(new URL('../dados/src/utils/instaBridge.js', import.meta.url), 'utf8');
ok(/executar\(nazu, info, null, new Map\(\), null\)/.test(src), 'a ponte chama o handler no MESMO formato');
ok(/dm\.received/.test(src), 'escuta o evento dm.received da lib');
ok(/sessionIdFromCookiesFile|caminhoCookies/.test(src), 'a sessao vem do MESMO arquivo do !keyig');
ok(!/app\.get|express|listen\(/.test(src), 'a ponte nao abre porta (nao e servidor)');

console.log('════════════════════════════════════════');
console.log(`RESULTADO: ${pass} asserções ok | ${fail} falhas`);
console.log('════════════════════════════════════════');
fs.rmSync(TMP, { recursive: true, force: true });
if (fail > 0) process.exit(1);
console.log('✅ TODOS OS TESTES PASSARAM');
process.exit(0);
