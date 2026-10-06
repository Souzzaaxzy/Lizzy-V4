import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
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

const PALETA = {
  image: ['#1d4ed8', '#0b1b46'],
  video: ['#b45309', '#2a1608'],
  audio: ['#7c3aed', '#221048'],
  text: ['#0f766e', '#062a26']
};

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

const svgCapa = (tipo, titulo, corpo) => {
  const [c1, c2] = PALETA[tipo] || PALETA.text;
  const linha1 = String(titulo || '').slice(0, 28);
  const linha2 = String(corpo || '').replace(/\s+/g, ' ').slice(0, 46);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360">
  <defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0%" stop-color="${c1}"/><stop offset="100%" stop-color="${c2}"/>
  </linearGradient></defs>
  <rect width="640" height="360" fill="url(#bg)"/>
  <text x="320" y="150" text-anchor="middle" fill="#ffffff" font-family="DejaVu Sans, Arial, sans-serif" font-size="46" font-weight="bold">${escaparXml(linha1)}</text>
  <text x="320" y="215" text-anchor="middle" fill="#ffffff" fill-opacity="0.85" font-family="DejaVu Sans, Arial, sans-serif" font-size="24">${escaparXml(linha2)}</text>
</svg>`;
};

function escaparXml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

const vazio = () => ({ proximoNumero: 1, reposts: [] });

function ler() {
  try {
    const d = JSON.parse(fs.readFileSync(ARQUIVO, 'utf-8'));
    if (!d || !Array.isArray(d.reposts)) return vazio();
    if (typeof d.proximoNumero !== 'number') {
      d.proximoNumero = d.reposts.reduce((m, r) => Math.max(m, r.numero || 0), 0) + 1;
    }
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

export function caminhoMidia(arquivo) {
  return arquivo ? path.join(DATABASE_DIR, arquivo) : null;
}

async function gerarCapa(numero, tipo, texto) {
  const nome = `card-${numero}-${Date.now()}.png`;
  fs.mkdirSync(CAPA_DIR, { recursive: true });
  await sharp(Buffer.from(svgCapa(tipo, `Repost #${numero}`, texto))).png().toFile(path.join(CAPA_DIR, nome));
  return path.join('reposts-cards', nome);
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
}

function salvarRegistro(d, dados) {
  const repost = {
    id: crypto.randomUUID(),
    numero: d.proximoNumero,
    criadoEm: Date.now(),
    expiraEm: Date.now() + TTL_MS,
    ...dados
  };
  d.proximoNumero += 1;
  d.reposts.push(repost);
  gravar(d);
  return { ok: true, repost };
}

export function limparExpirados(agora = Date.now()) {
  const d = ler();
  const vencidos = d.reposts.filter((r) => r.expiraEm <= agora);
  if (!vencidos.length) return 0;
  for (const r of vencidos) apagarRepost(r);
  d.reposts = d.reposts.filter((r) => r.expiraEm > agora);
  gravar(d);
  return vencidos.length;
}

export function listar(agora = Date.now()) {
  return ler()
    .reposts.filter((r) => r.expiraEm > agora)
    .sort((a, b) => a.numero - b.numero);
}

export async function criar({ conteudo, baixar }) {
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
    const numero = d.proximoNumero;
    const tipo = type === 'ptv' ? 'video' : type;
    const nome = `${numero}-${Date.now()}.${EXT[type]}`;
    fs.mkdirSync(MIDIA_DIR, { recursive: true });
    try {
      fs.writeFileSync(path.join(MIDIA_DIR, nome), buffer);
    } catch {
      return { ok: false, msg: 'Não consegui salvar a mídia do repost.' };
    }

    // Áudio não é mídia de header de carrossel (o card só aceita imagem/vídeo),
    // então o card leva uma capa gerada e o áudio vai no footer do card.
    let capa = null;
    if (tipo === 'audio') {
      try {
        capa = await gerarCapa(numero, 'audio', texto || 'áudio');
      } catch {
        /* segue sem capa; montarCard recusa o card depois */
      }
    }

    return salvarRegistro(d, {
      tipo,
      arquivo: path.join('reposts-media', nome),
      capa,
      mimetype: media.mimetype || MIME[tipo] || null,
      texto
    });
  }

  if (!texto) return { ok: false, msg: 'A mensagem respondida não tem mídia nem texto para repostar.' };

  const d = ler();
  let capa;
  try {
    capa = await gerarCapa(d.proximoNumero, 'text', texto);
  } catch {
    return { ok: false, msg: 'Não consegui gerar a capa do repost.' };
  }
  return salvarRegistro(d, { tipo: 'text', arquivo: null, capa, mimetype: null, texto });
}

export function remover(numero) {
  const d = ler();
  const idx = d.reposts.findIndex((r) => r.numero === numero);
  if (idx < 0) return { ok: false };
  const [repost] = d.reposts.splice(idx, 1);
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

  // Texto e áudio: todo card de carrossel precisa de header de imagem/vídeo, então
  // usam a capa gerada. O texto vai no caption (texto real, não imagem).
  const card = { image: { url: caminhoMidia(r.capa) }, caption, title: titulo, nativeFlow: [] };
  if (r.tipo === 'audio' && r.arquivo) {
    card.audioFooter = { url: caminhoMidia(r.arquivo) };
  }
  return card;
}

export default {
  MAX_CARDS,
  criar,
  listar,
  remover,
  montarCard,
  limparExpirados,
  caminhoMidia
};
