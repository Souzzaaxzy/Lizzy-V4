/**
 * !pin e !tiktok — aviso de busca + carrossel.
 *
 * Roda o HANDLER REAL (index.js) com socket falso e valida:
 *
 *   !pin       — envia "Pesquisando Pin...", APAGA essa mensagem e só então
 *                envia o carrossel (ou o erro).
 *   !tiktok    — envia "Procurando vídeos...", apaga e envia um CARROSSEL com
 *                até 5 vídeos da busca. Com link, mantém o fluxo de download.
 *
 * As dependências externas (Bing/tikwm) são substituídas por um `fetch`
 * controlado e por um roteiro de respostas — nada de rede real. O que se mede é
 * o comportamento do comando: ordem de envio, apagar o aviso, quantidade de
 * cards e a forma do payload.
 *
 * Uso: DATABASE_PATH=... node tests/pin-tiktok-carousel.test.js
 */
import fs from 'fs';
import os from 'os';
import path from 'path';

const TMP_DB = fs.mkdtempSync(path.join(os.tmpdir(), 'lizzy-pintk-db-'));
process.env.DATABASE_PATH = TMP_DB;
const GRUPOS_DIR = path.join(TMP_DB, 'grupos');
fs.mkdirSync(GRUPOS_DIR, { recursive: true });

const CONFIG_PATH = path.join(TMP_DB, 'config.json');
process.env.CONFIG_PATH = CONFIG_PATH;
fs.writeFileSync(CONFIG_PATH, JSON.stringify({
  numerodono: '5511978819676',
  nomedono: 'Dono',
  nomebot: 'Lizzy',
  prefixo: '!',
  lidowner: null,
}, null, 2));

let ok = 0, fail = 0;
const erros = [];
function check(cond, msg) {
  if (cond) { ok += 1; console.log(`✅ ${msg}`); }
  else { fail += 1; erros.push(msg); console.log(`❌ ${msg}`); }
}

// ============================================================================
// CONTROLE DA REDE (Bing + tikwm) — antes de importar o index.
// ============================================================================

const realFetch = globalThis.fetch;

/** Rotas controladas: host+query -> resposta. */
let bingImageHtml = '';
let bingVideoHtml = '';
/** url do tiktok -> objeto de mídia do tikwm (ou null). */
let tikwmByUrl = new Map();
let tikwmCalls = [];

function installFetch() {
  globalThis.fetch = async (url, opts) => {
    const u = String(url);
    if (u.startsWith('https://www.bing.com/images/search')) {
      return new Response(bingImageHtml, { status: 200 });
    }
    if (u.startsWith('https://www.bing.com/videos/search')) {
      return new Response(bingVideoHtml, { status: 200 });
    }
    if (u.startsWith('https://www.tikwm.com/api/')) {
      const target = decodeURIComponent(new URL(u).searchParams.get('url') || '');
      tikwmCalls.push(target);
      const media = tikwmByUrl.get(target);
      if (!media) return new Response(JSON.stringify({ code: -1 }), { status: 200 });
      return new Response(JSON.stringify({ code: 0, data: media }), { status: 200 });
    }
    return realFetch(url, opts);
  };
}
installFetch();

// html do Bing com N urls de vídeo do TikTok.
const tiktokUrl = (id) => `https://www.tiktok.com/@user${id}/video/${1000000000000 + Number(id)}`;
const videoHtmlFor = (ids) => ids.map((i) => `href="${tiktokUrl(i)}"`).join('\n');

/** Mídia do tikwm como VÍDEO. */
const videoMedia = (id) => ({
  title: `Vídeo ${id}`,
  play: `https://v16.tiktokcdn.com/video-${id}.mp4`,
  cover: `https://p16.tiktokcdn.com/cover-${id}.jpg`,
  author: { nickname: `Autor ${id}`, unique_id: `user${id}` },
  play_count: 1000 + Number(id),
});
/** Mídia do tikwm como SLIDESHOW de imagem (não serve para card de vídeo). */
const imagesMedia = (id) => ({
  images: [`https://p16.tiktokcdn.com/img-${id}-1.jpg`, `https://p16.tiktokcdn.com/img-${id}-2.jpg`],
  title: `Slideshow ${id}`,
  author: { nickname: `Autor ${id}`, unique_id: `user${id}` },
});

// ============================================================================
// HANDLER REAL
// ============================================================================

const indexModule = await import(new URL('../dados/src/index.js', import.meta.url).href);
const handleMessage = indexModule.default ?? indexModule;

const BOT_JID = '5599999999999@s.whatsapp.net';
const BOT_LID = '111111111111111@lid';
const USER_LID = '333000000000003@lid';

let groupCounter = 0;
function makeGroup() {
  groupCounter += 1;
  const jid = `1203638000000000${String(groupCounter).padStart(3, '0')}@g.us`;
  fs.writeFileSync(
    path.join(GRUPOS_DIR, `${jid}.json`),
    JSON.stringify({ modobrincadeira: true, groupName: 'Grupo PT' }, null, 2)
  );
  return jid;
}

let senderSeq = 0;
function nextSender() {
  senderSeq += 1;
  return `4440000000${String(senderSeq).padStart(5, '0')}@lid`;
}

/**
 * Socket falso que registra tudo e permite "apagar" (a key devolvida é
 * rastreável, então dá para provar que o comando apagou o aviso certo).
 */
function makeNazu() {
  const enviados = [];
  let seq = 0;
  return {
    enviados,
    sendMessage: async (jid, content, options) => {
      seq += 1;
      const key = { id: `MSG-${seq}`, remoteJid: jid, fromMe: true };
      enviados.push({ jid, content, options, key, deleted: false });
      // Marca como apagada a mensagem cujo id bate com o delete pedido.
      if (content?.delete?.id) {
        const alvo = enviados.find((e) => e.key.id === content.delete.id);
        if (alvo) alvo.deleted = true;
      }
      return { key };
    },
    user: { id: `${BOT_JID.split('@')[0]}:5@s.whatsapp.net`, lid: BOT_LID, name: 'Lizzy' },
    store: { contacts: {} },
    onWhatsApp: async (n) => [{ jid: `${n}@s.whatsapp.net`, exists: true, lid: `${n}@lid` }],
    signalRepository: { lidMapping: { getPNForLID: async () => null } },
    groupMetadata: async () => ({
      id: 'x', subject: 'Grupo PT',
      participants: [{ id: BOT_LID, lid: BOT_LID, phoneNumber: BOT_JID, admin: 'admin' }],
    }),
    groupParticipantsUpdate: async () => ({}),
    groupRequestParticipantsList: async () => [],
    groupRequestParticipantsUpdate: async () => ({}),
    groupSettingUpdate: async () => ({}),
    ev: { on: () => {}, emit: () => {}, removeAllListeners: () => {} },
    readMessages: async () => {},
    sendPresenceUpdate: async () => {},
    profilePictureUrl: async () => 'x',
    react: async () => ({}),
    fetchStatus: async () => [],
  };
}

async function rodar(texto, sender = nextSender()) {
  const nazu = makeNazu();
  await handleMessage(nazu, {
    key: { remoteJid: makeGroup(), fromMe: false, id: `M-${Math.random().toString(36).slice(2, 9)}`, participant: sender },
    message: { extendedTextMessage: { text: texto } },
    messageTimestamp: 1757900000,
    pushName: 'Testador',
  }, null, new Map(), null);
  return nazu.enviados;
}

const porTexto = (enviados) => enviados.map((e) => e.content?.text).filter((t) => typeof t === 'string');
const carrosseis = (enviados) => enviados.filter((e) => Array.isArray(e.content?.cards));

// ============================================================================
// 1) !pin
// ============================================================================

console.log('\n── 1. !pin: aviso "Pesquisando Pin..." e apagar antes do carrossel ──');
{
  bingImageHtml = Array.from({ length: 6 }, (_, i) => `murl&quot;:&quot;https://i.pinimg.com/img${i}.jpg&quot;`).join('\n');

  const enviados = await rodar('!pin gatinhos');
  const aviso = enviados.find((e) => e.content?.text === '🔎 Pesquisando Pin...');
  check(Boolean(aviso), 'enviou o aviso "Pesquisando Pin..."');
  check(aviso?.deleted === true, 'o aviso foi APAGADO');
  check(aviso?.options?.quoted, 'o aviso saiu respondendo o comando');

  const car = carrosseis(enviados)[0];
  check(Boolean(car), 'enviou o carrossel');
  check(aviso && car && enviados.indexOf(aviso) < enviados.indexOf(car), 'ordem: aviso antes do carrossel');
  check(car?.content?.cards?.length === 5, `carrossel com 5 imagens (${car?.content?.cards?.length})`);
  check(car?.content?.cards?.every((c) => c.image?.url), 'todos os cards têm imagem');
  check((porTexto(enviados) || []).some((t) => t.includes('Resultados da pesquisa')), 'texto do carrossel presente');
}

console.log('\n── 2. !pin: erro/nenhum resultado também apaga o aviso ──');
{
  // Bing sem imagens -> "Nenhuma imagem encontrada".
  bingImageHtml = '<html>nada</html>';
  const enviados = await rodar('!pin termo-sem-resultado-xyz');
  const aviso = enviados.find((e) => e.content?.text === '🔎 Pesquisando Pin...');
  check(Boolean(aviso), 'enviou o aviso mesmo sem resultados');
  check(aviso?.deleted === true, 'apagou o aviso no caminho de erro');
  check(porTexto(enviados).some((t) => t.includes('Nenhuma imagem encontrada')), 'avisou que não achou nada');
  check(carrosseis(enviados).length === 0, 'não enviou carrossel vazio');
}

console.log('\n── 3. !pin: link único do Pinterest (1 imagem) não vira carrossel ──');
{
  const enviados = await rodar('!pin https://pin.it/abc123');
  const aviso = enviados.find((e) => e.content?.text === '🔎 Pesquisando Pin...');
  check(Boolean(aviso), 'enviou o aviso no fluxo de link');
  check(aviso?.deleted === true, 'apagou o aviso no fluxo de link');
  // Sem rede para o pin, o esperado é uma recusa tratada — sem carrossel.
  check(carrosseis(enviados).length === 0, 'não enviou carrossel no fluxo de link');
}

// ============================================================================
// 4) !tiktok — busca
// ============================================================================

console.log('\n── 4. !tiktok busca: aviso "Procurando vídeos..." + carrossel de vídeos ──');
{
  const ids = ['1', '2', '3', '4', '5', '6'];
  bingVideoHtml = videoHtmlFor(ids);
  tikwmByUrl = new Map(ids.map((i) => [tiktokUrl(i), videoMedia(i)]));
  tikwmCalls = [];

  const enviados = await rodar('!tiktok gatinhos');
  const aviso = enviados.find((e) => e.content?.text === '🔎 Procurando vídeos...');
  check(Boolean(aviso), 'enviou o aviso "Procurando vídeos..."');
  check(aviso?.deleted === true, 'o aviso foi APAGADO');

  const car = carrosseis(enviados)[0];
  check(Boolean(car), 'enviou o carrossel de vídeos');
  check(aviso && car && enviados.indexOf(aviso) < enviados.indexOf(car), 'ordem: aviso antes do carrossel');
  check(car?.content?.cards?.length === 5, `carrossel com 5 vídeos (${car?.content?.cards?.length})`);
  check(car?.content?.cards?.every((c) => c.video?.url), 'todos os cards são de VÍDEO');
  check(car?.content?.cards?.every((c) => /\.mp4/.test(c.video.url)), 'as URLs apontam para .mp4 (play, sem marca d\'água)');
  check(car?.content?.cards?.[0]?.caption?.includes('1.'), 'caption numerada');
  check(car?.content?.cards?.every((c) => c.title && c.footer === '🎵 TikTok'), 'cards trazem title e footer');
  check(porTexto(enviados).some((t) => t.includes('Vídeos encontrados')), 'texto do carrossel presente');
  check(tikwmCalls.length === 5, `resolveu exatamente 5 vídeos no tikwm (${tikwmCalls.length})`);
}

console.log('\n── 5. !tiktok busca: nunca coloca imagem no carrossel de vídeos ──');
{
  const ids = ['11', '12', '13', '14', '15'];
  bingVideoHtml = videoHtmlFor(ids);
  tikwmByUrl = new Map(ids.map((i) => [tiktokUrl(i), i === '12' ? imagesMedia(i) : videoMedia(i)]));
  tikwmCalls = [];

  const enviados = await rodar('!tiktok termo-misto');
  const car = carrosseis(enviados)[0];
  check(Boolean(car), 'enviou o carrossel mesmo com um slideshow no meio');
  check(car?.content?.cards?.every((c) => c.video), 'todos os cards continuam de vídeo');
  check(car?.content?.cards?.length === 4, `o slideshow foi descartado (4 cards, ${car?.content?.cards?.length})`);
}

console.log('\n── 6. !tiktok busca: sem vídeos -> sem carrossel, com aviso ──');
{
  bingVideoHtml = '';
  tikwmByUrl = new Map();
  const enviados = await rodar('!tiktok nada-aqui-xyz');
  const aviso = enviados.find((e) => e.content?.text === '🔎 Procurando vídeos...');
  check(Boolean(aviso), 'enviou o aviso');
  check(aviso?.deleted === true, 'apagou o aviso');
  check(carrosseis(enviados).length === 0, 'não enviou carrossel vazio');
  check(porTexto(enviados).some((t) => t.includes('Nenhum vídeo encontrado')), 'avisou que não achou vídeos');
}

console.log('\n── 7. !tiktok link: mantém o download do vídeo (não vira carrossel) ──');
{
  const link = 'https://www.tiktok.com/@u/video/1234567890123456789';
  tikwmByUrl = new Map([[link, videoMedia('99')]]);
  tikwmCalls = [];

  const enviados = await rodar(`!tiktok ${link}`);
  const aviso = enviados.find((e) => e.content?.text === '🔎 Procurando vídeo...');
  check(Boolean(aviso), 'enviou o aviso "Procurando vídeo..." (singular, fluxo de link)');
  check(aviso?.deleted === true, 'apagou o aviso');

  const videos = enviados.filter((e) => e.content?.video);
  check(videos.length === 1, 'enviou 1 vídeo (fluxo de download preservado)');
  check(String(videos[0]?.content?.video?.url || '').includes('video-99'), 'o vídeo é o do link');
  check(carrosseis(enviados).length === 0, 'não virou carrossel');
}

console.log('\n── 8. !tiktok: sem termo mantém a mensagem de uso (não envia aviso) ──');
{
  const enviados = await rodar('!tiktok');
  check(porTexto(enviados).some((t) => t.includes('Digite um nome ou o link')), 'pede o termo');
  check(!enviados.some((e) => String(e.content?.text || '').includes('Procurando')), 'não enviou aviso de busca');
}

console.log('\n════════════════════════════════════════');
console.log(`RESULTADO: ${ok} ok | ${fail} falhas`);
console.log('════════════════════════════════════════');
fs.rmSync(TMP_DB, { recursive: true, force: true });
if (fail) {
  console.log('\nFALHAS:');
  for (const e of erros) console.log(`- ${e}`);
  process.exit(1);
}
console.log('✅ !pin e !tiktok VALIDADOS');
process.exit(0);
