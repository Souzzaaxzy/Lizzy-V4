/**
 * Capa (thumb) da musica que esta tocando na call.
 *
 * ## Por que existe
 *
 * O aviso *"Tocando agora"* era so' texto. O dono pediu a foto junto: *"quero
 * que nisso tenha a foto da musica, a thumb"*.
 *
 * ## Ciclo de vida: o MESMO do audio
 *
 * A imagem e' baixada para o cache do GRUPO (`callCache.caminhoNovo`), com o
 * caminho guardado na propria faixa da fila. Assim ela sai do disco junto com o
 * audio quando a musica acaba, e' pulada ou a fila e' limpa -- nao ha um
 * segundo sistema de limpeza. Se o download falhar, devolve `null` e o aviso
 * sai so' com texto (nunca quebra a musica por causa da capa).
 *
 * ## Por que baixar em vez de mandar a URL
 *
 * O `image: { url }` faz a lib buscar a imagem na hora de enviar, a cada
 * mensagem. Baixando uma vez, o envio e' local e a limpeza fica sob nosso
 * controle (a URL do YouTube nao expira, mas a do SoundCloud/Spotify pode).
 */

import fs from 'fs';
import axios from 'axios';
import * as callCache from './callCache.js';

/** Teto do download da capa (uma thumb tem dezenas de KB; 5 MB e' folga). */
const MAX_BYTES = Number.parseInt(process.env.CALL_THUMB_MAX_BYTES || '5242880', 10);

/** Timeout do download. */
const TIMEOUT_MS = Number.parseInt(process.env.CALL_THUMB_TIMEOUT_MS || '15000', 10);

/**
 * Baixa a capa e grava no cache do grupo.
 *
 * Best-effort de proposito: qualquer falha (URL vazia, 404, timeout, disco)
 * devolve `null` e o chamador segue com o texto. A musica NUNCA deixa de tocar
 * porque a capa falhou.
 *
 * @param {string} grupo
 * @param {string} url URL da imagem (http/https)
 * @returns {Promise<string|null>} o caminho no cache, ou null
 */
export async function baixarThumb(grupo, url) {
  if (!grupo || typeof url !== 'string') return null;
  const alvo = url.trim();
  if (!/^https?:\/\//i.test(alvo)) return null;

  try {
    const resp = await axios.get(alvo, {
      responseType: 'arraybuffer',
      timeout: TIMEOUT_MS,
      maxContentLength: MAX_BYTES,
      maxBodyLength: MAX_BYTES,
      // Alguns CDNs (ytimg) bloqueiam o UA padrao do axios.
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });

    const dados = Buffer.from(resp?.data || []);
    if (!dados.length) return null;
    if (dados.length > MAX_BYTES) return null;

    // So' aceita o que PARECE imagem (um HTML de erro tem de ser descartado).
    if (!ehImagem(dados)) return null;

    const destino = callCache.caminhoNovo(grupo, extensaoDe(resp?.headers?.['content-type']));
    fs.writeFileSync(destino, dados);
    return destino;
  } catch {
    return null;
  }
}

/**
 * Detecta o formato pela assinatura do arquivo (magic bytes).
 *
 * Nao confia no `content-type`: varios CDNs devolvem `application/octet-stream`
 * e alguns respondem HTML de bloqueio com status 200.
 *
 * @param {Buffer} buf
 * @returns {boolean}
 */
export function ehImagem(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 4) return false;
  // JPEG
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return true;
  // PNG
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return true;
  // GIF
  if (buf.slice(0, 3).toString('ascii') === 'GIF') return true;
  // WebP (RIFF....WEBP)
  if (buf.length >= 12 && buf.slice(0, 4).toString('ascii') === 'RIFF'
      && buf.slice(8, 12).toString('ascii') === 'WEBP') return true;
  return false;
}

/** Extensao do arquivo a partir do content-type (default .jpg). */
export function extensaoDe(contentType) {
  const ct = String(contentType || '').toLowerCase();
  if (ct.includes('png')) return '.png';
  if (ct.includes('gif')) return '.gif';
  if (ct.includes('webp')) return '.webp';
  return '.jpg';
}
