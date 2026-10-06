import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { spawn } from 'child_process';
import sharp from 'sharp';
import { DATABASE_DIR } from './paths.js';
import { extractText, resolveMedia } from './viewOnce.js';

const ARQUIVO = path.join(DATABASE_DIR, 'reposts.json');
const MIDIA_DIR = path.join(DATABASE_DIR, 'reposts-media');
const CAPA_DIR = path.join(DATABASE_DIR, 'reposts-cards');
const TTL_MS = 24 * 60 * 60 * 1000;
export const MAX_CARDS = 10;

const EXT = { image: 'jpg', video: 'mp4', ptv: 'mp4', audio: 'ogg' };
const MIME = { image: 'image/jpeg', video: 'video/mp4', audio: 'audio/ogg; codecs=opus' };

const LABEL = { image: 'imagem', video: 'vídeo', audio: 'áudio', ptv: 'vídeo', text: 'texto' };

// Estilo de cada tipo de card: gradiente, acento, emoji e rótulo.
const ESTILO = {
  image: { c1: '#312e81', c2: '#0b1026', acento: '#818cf8', emoji: '🖼️', rotulo: 'IMAGEM' },
  video: { c1: '#7c2d12', c2: '#180a06', acento: '#fb923c', emoji: '🎬', rotulo: 'VÍDEO' },
  audio: { c1: '#4c1d95', c2: '#150826', acento: '#c084fc', emoji: '🎵', rotulo: 'ÁUDIO' },
  text: { c1: '#134e4a', c2: '#04191a', acento: '#2dd4bf', emoji: '📝', rotulo: 'TEXTO' }
};
const estiloDe = (tipo) => ESTILO[tipo] || ESTILO.text;

// O body de um card de carrossel tem limite curto (WhatsApp: ~160 chars e no
// máximo 2 quebras). O texto COMPLETO fica no registro; aqui é só o preview.
const LIMITE_CARD = 160;
const corpoCard = (texto) => {
  if (!texto) return undefined;
  const linhas = String(texto).replace(/\r/g, '').split('\n').filter((l) => l.trim());
  let s = linhas.slice(0, 2).join('\n').trim();
  if (s.length > LIMITE_CARD) s = `${s.slice(0, LIMITE_CARD - 1).trimEnd()}…`;
  return s || undefined;
};

function escaparXml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

// Quebra o texto em linhas de no máximo `max` caracteres (sem cortar palavras).
function quebrar(texto, max, maxLinhas) {
  const palavras = String(texto || '').replace(/\s+/g, ' ').trim().split(' ');
  const linhas = [];
  let atual = '';
  for (const p of palavras) {
    if (!atual) { atual = p; continue; }
    if ((atual + ' ' + p).length <= max) atual += ' ' + p;
    else { linhas.push(atual); atual = p; if (linhas.length === maxLinhas) break; }
  }
  if (atual && linhas.length < maxLinhas) linhas.push(atual);
  return linhas.slice(0, maxLinhas);
}

const svgCapa = (tipo, numero, texto) => {
  const { c1, c2, acento, emoji, rotulo } = estiloDe(tipo);
  const linhas = quebrar(texto, 26, 2);
  const t1 = linhas[0] || '';
  const t2 = linhas[1] || '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${c1}"/><stop offset="100%" stop-color="${c2}"/>
    </linearGradient>
    <linearGradient id="brilho" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${acento}" stop-opacity="0.28"/>
      <stop offset="100%" stop-color="${acento}" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <rect width="640" height="360" fill="url(#bg)"/>
  <circle cx="560" cy="40" r="180" fill="url(#brilho)"/>
  <circle cx="70" cy="330" r="140" fill="url(#brilho)"/>
  <rect x="26" y="26" width="588" height="308" rx="22" fill="none" stroke="#ffffff" stroke-opacity="0.14" stroke-width="2"/>
  <rect x="26" y="26" width="588" height="6" rx="3" fill="${acento}"/>
  <text x="56" y="120" font-family="DejaVu Sans, Arial, sans-serif" font-size="30" letter-spacing="6" fill="${acento}" fill-opacity="0.95">REPOST</text>
  <text x="56" y="196" font-family="DejaVu Sans, Arial, sans-serif" font-size="88" font-weight="bold" fill="#ffffff">#${escaparXml(numero)}</text>
  <text x="584" y="150" text-anchor="end" font-family="DejaVu Sans, Arial, sans-serif" font-size="64">${emoji}</text>
  <text x="56" y="248" font-family="DejaVu Sans, Arial, sans-serif" font-size="26" font-weight="bold" fill="#ffffff" fill-opacity="0.95">${escaparXml(t1)}</text>
  <text x="56" y="288" font-family="DejaVu Sans, Arial, sans-serif" font-size="24" fill="#ffffff" fill-opacity="0.72">${escaparXml(t2)}</text>
  <text x="584" y="308" text-anchor="end" font-family="DejaVu Sans, Arial, sans-serif" font-size="16" letter-spacing="4" fill="#ffffff" fill-opacity="0.55">${rotulo}</text>
</svg>`;
};

// Chave do dono do repost (cada usuário tem o seu conjunto).
const chaveDono = (dono) => (dono && String(dono).trim()) || 'global';

const vazio = () => ({ usuarios: {} });

function ler() {
  try {
    const d = JSON.parse(fs.readFileSync(ARQUIVO, 'utf-8'));
    if (!d || typeof d !== 'object' || !d.usuarios || typeof d.usuarios !== 'object') return vazio();
    return d;
  } catch {
    return vazio();
  }
}

function gravar(d) {
  fs.mkdirSync(path.dirname(ARQUIVO), { recursive: true });
  const tmp = `${ARQUIVO}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(d, null, 2));
  fs.renameSync(tmp, ARQUIVO);
}

function balde(d, dono, criar = false) {
  const k = chaveDono(dono);
  if (!d.usuarios[k] && criar) d.usuarios[k] = { reposts: [] };
  return d.usuarios[k] || { reposts: [] };
}

// Menor número livre (reaproveita buracos deixados por exclusões/expiração).
function proximoLivre(bal) {
  const usados = new Set((bal.reposts || []).map((r) => r.numero));
  let n = 1;
  while (usados.has(n)) n += 1;
  return n;
}

export function caminhoMidia(arquivo) {
  return arquivo ? path.join(DATABASE_DIR, arquivo) : null;
}

async function gerarCapa(numero, tipo, texto) {
  const nome = `card-${numero}-${Date.now()}-${crypto.randomBytes(2).toString('hex')}.png`;
  fs.mkdirSync(CAPA_DIR, { recursive: true });
  await sharp(Buffer.from(svgCapa(tipo, numero, texto))).png().toFile(path.join(CAPA_DIR, nome));
  return path.join('reposts-cards', nome);
}

function runFfmpeg(ffmpeg, args, timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: ['ignore', 'ignore', 'pipe'] });
    } catch (e) {
      reject(e);
      return;
    }
    let err = '';
    const timer = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* já morreu */ } reject(new Error('ffmpeg timeout')); }, timeoutMs);
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg ${code}: ${String(err).slice(-200)}`));
    });
  });
}

// Acha o ffmpeg como o resto do bot (PATH, ~/.local/bin, /usr/bin...).
async function acharFfmpeg() {
  const os = await import('os');
  const home = os.homedir();
  const candidatos = [
    process.env.FFMPEG_PATH || 'ffmpeg',
    path.join(home, '.local', 'bin', 'ffmpeg'),
    '/home/container/.local/bin/ffmpeg',
    '/root/.local/bin/ffmpeg',
    '/usr/bin/ffmpeg',
    '/usr/local/bin/ffmpeg'
  ];
  for (const cmd of candidatos) {
    try {
      await runFfmpeg(cmd, ['-version'], 10000);
      return cmd;
    } catch {
      /* tenta o próximo */
    }
  }
  return null;
}

// Áudio -> vídeo MP4 (capa estática + o áudio original). O card de carrossel
// aceita vídeo, então assim o áudio entra no carrossel com som de verdade.
async function gerarVideoDeAudio(arquivoAudio, arquivoCapa, destino) {
  const ffmpeg = await acharFfmpeg();
  if (!ffmpeg) return false;
  try {
    await runFfmpeg(ffmpeg, [
      '-loop', '1', '-i', arquivoCapa,
      '-i', arquivoAudio,
      '-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'stillimage', '-crf', '28',
      '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '96k',
      '-shortest', '-movflags', '+faststart', destino
    ], 120000);
    return fs.existsSync(destino) && fs.statSync(destino).size > 0;
  } catch {
    return false;
  }
}

function apagarArquivo(arquivo) {
  const p = caminhoMidia(arquivo);
  if (!p) return;
  try {
    fs.unlinkSync(p);
  } catch {
    /* arquivo já ausente */
  }
}

function apagarRepost(r) {
  apagarArquivo(r.arquivo);
  apagarArquivo(r.capa);
  apagarArquivo(r.video);
}

function salvarRegistro(d, dono, dados) {
  const bal = balde(d, dono, true);
  const repost = {
    id: crypto.randomUUID(),
    numero: proximoLivre(bal),
    criadoEm: Date.now(),
    expiraEm: Date.now() + TTL_MS,
    ...dados
  };
  bal.reposts.push(repost);
  gravar(d);
  return { ok: true, repost };
}

// Limpa os expirados de todos os usuários e devolve quantos saíram.
export function limparExpirados(agora = Date.now()) {
  const d = ler();
  let removidos = 0;
  for (const k of Object.keys(d.usuarios)) {
    const bal = d.usuarios[k];
    if (!bal || !Array.isArray(bal.reposts)) continue;
    const vencidos = bal.reposts.filter((r) => r.expiraEm <= agora);
    for (const r of vencidos) apagarRepost(r);
    bal.reposts = bal.reposts.filter((r) => r.expiraEm > agora);
    removidos += vencidos.length;
  }
  if (removidos) gravar(d);
  return removidos;
}

export function listar(dono, agora = Date.now()) {
  return balde(ler(), dono).reposts
    .filter((r) => r.expiraEm > agora)
    .sort((a, b) => a.numero - b.numero);
}

export async function criar({ dono, conteudo, baixar }) {
  if (!conteudo) return { ok: false, msg: 'Responda a uma mensagem para criar um repost.' };

  const texto = extractText(conteudo);
  const achado = resolveMedia([conteudo]);

  if (achado) {
    const { media, type } = achado;
    if (!EXT[type]) return { ok: false, msg: `Não consigo repostar ${LABEL[type] || 'esse tipo de mídia'}.` };

    let buffer;
    try {
      buffer = await baixar(media, type);
    } catch {
      return { ok: false, msg: 'Não consegui baixar a mídia dessa mensagem.' };
    }
    if (!buffer || !buffer.length) return { ok: false, msg: 'A mídia veio vazia.' };

    const d = ler();
    const bal = balde(d, dono, true);
    const numero = proximoLivre(bal);
    const tipo = type === 'ptv' ? 'video' : type;
    const nome = `${numero}-${Date.now()}.${EXT[type]}`;
    fs.mkdirSync(MIDIA_DIR, { recursive: true });
    try {
      fs.writeFileSync(path.join(MIDIA_DIR, nome), buffer);
    } catch {
      return { ok: false, msg: 'Não consegui salvar a mídia do repost.' };
    }

    // Áudio não é header de card, mas o card aceita VÍDEO. Então geramos uma capa
    // e um MP4 (capa + o áudio original) para o áudio entrar no carrossel com som.
    let capa = null;
    let video = null;
    if (tipo === 'audio') {
      try {
        capa = await gerarCapa(numero, 'audio', texto || 'áudio');
      } catch {
        /* sem capa, o card cai para o fallback */
      }
      if (capa) {
        const nomeVideo = `${numero}-${Date.now()}.mp4`;
        const destino = path.join(MIDIA_DIR, nomeVideo);
        const ok = await gerarVideoDeAudio(path.join(MIDIA_DIR, nome), caminhoMidia(capa), destino);
        if (ok) video = path.join('reposts-media', nomeVideo);
      }
    }

    return salvarRegistro(d, dono, {
      tipo,
      arquivo: path.join('reposts-media', nome),
      capa,
      video,
      mimetype: media.mimetype || MIME[tipo] || null,
      texto
    });
  }

  if (!texto) return { ok: false, msg: 'A mensagem respondida não tem mídia nem texto para repostar.' };

  const d = ler();
  const bal = balde(d, dono, true);
  let capa;
  try {
    capa = await gerarCapa(proximoLivre(bal), 'text', texto);
  } catch {
    return { ok: false, msg: 'Não consegui gerar a capa do repost.' };
  }
  return salvarRegistro(d, dono, { tipo: 'text', arquivo: null, capa, mimetype: null, texto });
}

export function remover(dono, numero) {
  const d = ler();
  const bal = balde(d, dono);
  const idx = bal.reposts.findIndex((r) => r.numero === numero);
  if (idx < 0) return { ok: false };
  const [repost] = bal.reposts.splice(idx, 1);
  apagarRepost(repost);
  gravar(d);
  return { ok: true, repost };
}

export function montarCard(r) {
  const titulo = `Repost #${r.numero}`;
  const caption = corpoCard(r.texto);

  if (r.tipo === 'image') {
    return { image: { url: caminhoMidia(r.arquivo) }, caption, title: titulo, nativeFlow: [] };
  }

  if (r.tipo === 'video') {
    return {
      video: { url: caminhoMidia(r.arquivo) },
      mimetype: r.mimetype,
      caption,
      title: titulo,
      nativeFlow: []
    };
  }

  // Texto: card com header de imagem (capa) e o texto real no caption.
  if (r.tipo === 'text') {
    return { image: { url: caminhoMidia(r.capa) }, caption, title: titulo, nativeFlow: [] };
  }

  // Áudio: card de VÍDEO (capa + o áudio), então toca no próprio carrossel. Sem
  // o vídeo (ffmpeg ausente), cai para imagem + o áudio no footer.
  if (r.tipo === 'audio') {
    const legenda = caption || titulo;
    if (r.video && fs.existsSync(caminhoMidia(r.video))) {
      return {
        video: { url: caminhoMidia(r.video) },
        mimetype: 'video/mp4',
        caption: legenda,
        title: titulo,
        nativeFlow: []
      };
    }
    const card = { image: { url: caminhoMidia(r.capa) }, caption: legenda, title: titulo, nativeFlow: [] };
    if (r.arquivo) card.audioFooter = { url: caminhoMidia(r.arquivo) };
    return card;
  }

  return { image: { url: caminhoMidia(r.capa) }, caption, title: titulo, nativeFlow: [] };
}

// Cards prontos para enviar (do usuário `dono`): imagem, vídeo, texto e áudio
// (este como vídeo capa+áudio). Gera a capa sob demanda para reposts de texto
// salvos por versões antigas. Áudio sem vídeo (ffmpeg ausente) fica de fora —
// vai por `audiosAtivos`.
export async function montarCards(dono, agora = Date.now()) {
  const d = ler();
  const bal = balde(d, dono);
  const ativos = bal.reposts
    .filter((r) => r.expiraEm > agora)
    .filter((r) => r.tipo !== 'audio' || (r.video && fs.existsSync(caminhoMidia(r.video))))
    .sort((a, b) => a.numero - b.numero);

  let mudou = false;
  for (const r of ativos) {
    if (r.tipo === 'text' && (!r.capa || !fs.existsSync(caminhoMidia(r.capa)))) {
      try {
        r.capa = await gerarCapa(r.numero, r.tipo, r.texto || '');
        mudou = true;
      } catch {
        /* fica sem capa; montarCard ainda devolve o card */
      }
    }
  }
  if (mudou) gravar(d);

  return ativos.map(montarCard);
}

// Áudios (do usuário `dono`) que NÃO conseguiram virar vídeo (sem ffmpeg). Vão
// como mensagem interativa com o áudio no footer, para não ficarem de fora.
export function audiosAtivos(dono, agora = Date.now()) {
  return balde(ler(), dono).reposts
    .filter((r) => r.expiraEm > agora && r.tipo === 'audio' && r.arquivo)
    .filter((r) => !(r.video && fs.existsSync(caminhoMidia(r.video))))
    .sort((a, b) => a.numero - b.numero)
    .map((r) => ({ numero: r.numero, arquivo: caminhoMidia(r.arquivo), texto: r.texto || '' }));
}

// Conteúdo de uma mensagem interativa que carrega o áudio no footer (o player
// real do WhatsApp; o carrossel não tem card de áudio).
export function mensagemAudio({ numero, arquivo, texto }) {
  const corpo = texto ? `Repost #${numero}\n\n${corpoCard(texto)}` : `Repost #${numero}`;
  return { text: corpo, audioFooter: { url: arquivo }, nativeFlow: [] };
}

export default {
  MAX_CARDS,
  criar,
  listar,
  remover,
  montarCard,
  montarCards,
  audiosAtivos,
  mensagemAudio,
  limparExpirados,
  caminhoMidia
};
