import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { DATABASE_DIR } from './paths.js';
import { extractText, resolveMedia } from './viewOnce.js';

const ARQUIVO = path.join(DATABASE_DIR, 'reposts.json');
const MIDIA_DIR = path.join(DATABASE_DIR, 'reposts-media');
const TTL_MS = 24 * 60 * 60 * 1000;
export const MAX_CARDS = 10;

const EXT = { image: 'jpg', video: 'mp4', ptv: 'mp4', audio: 'ogg' };
const MIME = { image: 'image/jpeg', video: 'video/mp4', audio: 'audio/ogg; codecs=opus' };

const LABEL = { image: 'imagem', video: 'vídeo', audio: 'áudio', ptv: 'vídeo', text: 'texto' };

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

function apagarArquivo(arquivo) {
  const p = caminhoMidia(arquivo);
  if (!p) return;
  try {
    fs.unlinkSync(p);
  } catch {
    /* arquivo já ausente */
  }
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
  for (const r of vencidos) apagarArquivo(r.arquivo);
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
    const nome = `${numero}-${Date.now()}.${EXT[type]}`;
    fs.mkdirSync(MIDIA_DIR, { recursive: true });
    try {
      fs.writeFileSync(path.join(MIDIA_DIR, nome), buffer);
    } catch {
      return { ok: false, msg: 'Não consegui salvar a mídia do repost.' };
    }

    return salvarRegistro(d, {
      tipo: type === 'ptv' ? 'video' : type,
      arquivo: path.join('reposts-media', nome),
      mimetype: media.mimetype || MIME[type === 'ptv' ? 'video' : type] || null,
      texto
    });
  }

  if (!texto) return { ok: false, msg: 'A mensagem respondida não tem mídia nem texto para repostar.' };
  return salvarRegistro(ler(), { tipo: 'text', arquivo: null, mimetype: null, texto });
}

export function remover(numero) {
  const d = ler();
  const idx = d.reposts.findIndex((r) => r.numero === numero);
  if (idx < 0) return { ok: false };
  const [repost] = d.reposts.splice(idx, 1);
  apagarArquivo(repost.arquivo);
  gravar(d);
  return { ok: true, repost };
}

export function montarCard(r) {
  const titulo = `Repost #${r.numero}`;

  if (r.tipo === 'text') {
    return { text: `${titulo}\n\n${r.texto}`, nativeFlow: [] };
  }

  if (r.tipo === 'audio') {
    return {
      text: r.texto ? `${titulo}\n\n${r.texto}` : titulo,
      audioFooter: { url: caminhoMidia(r.arquivo) },
      nativeFlow: []
    };
  }

  return {
    [r.tipo]: { url: caminhoMidia(r.arquivo) },
    mimetype: r.mimetype,
    caption: r.texto || undefined,
    title: titulo,
    nativeFlow: []
  };
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
