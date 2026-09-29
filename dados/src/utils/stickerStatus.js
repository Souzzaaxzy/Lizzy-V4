/**
 * FIGURINHA → mídia publicável em STATUS de grupo.
 *
 * Por que existe: o status do grupo aceita `image`, `video` e `audio`, mas a
 * figurinha chega como **WebP** (`stickerMessage`) — nenhum dos tipos aceitos.
 * É preciso converter, e cada variante tem um caminho:
 *
 * - **animada** → MP4 em loop (com `gifPlayback`), igual ao `!togif`. O
 *   decoder de WebP do FFmpeg **ignora** os chunks `ANIM`/`ANMF` (devolve 0
 *   frames), então a conversão passa pelo `stickerToMp4` da fork (o `sharp` lê
 *   os frames). Publicar o WebP cru faria o status não renderizar.
 * - **estática** → PNG. Aqui o `sharp` é o caminho confiável (o cliente exige
 *   ser "pixelado", e o `sharp` já é dependência direta do bot).
 *
 * O módulo não depende do handler: recebe o buffer e devolve
 * `{ type, buffer, mimetype, gifPlayback? }`. As dependências (`stickerToMp4`,
 * `isAnimatedWebP`, `sharp`) entram por parâmetro, então dá para testar sem elas.
 */

/** É um WebP? (RIFF....WEBP) */
export function isWebP(buf) {
  return (
    Buffer.isBuffer(buf) &&
    buf.length >= 12 &&
    buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
    buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50
  );
}

/** Detecta o formato pelos magic bytes (para escolher o mimetype certo). */
export function detectImageFormat(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return null;
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return { mime: 'image/png', ext: 'png' };
  if (buf[0] === 0xff && buf[1] === 0xd8) return { mime: 'image/jpeg', ext: 'jpg' };
  if (isWebP(buf)) return { mime: 'image/webp', ext: 'webp' };
  if (buf[4] === 0x66 && buf[5] === 0x74 && buf[6] === 0x79 && buf[7] === 0x70) return { mime: 'video/mp4', ext: 'mp4' };
  return null;
}

/**
 * Converte a figurinha para uma mídia publicável em status.
 *
 * @param {Buffer} buffer        bytes da figurinha (webp)
 * @param {object} deps
 * @param {Function} deps.stickerToMp4   conversão da fork (animada → mp4)
 * @param {Function} deps.isAnimatedWebP detector da fork (chunk ANIM)
 * @param {object}  deps.sharpLib        módulo sharp (estática → png)
 * @returns {Promise<{type:'video'|'image', buffer:Buffer, mimetype:string, gifPlayback?:boolean, animada:boolean}>}
 */
export async function figurinhaParaStatus(buffer, deps = {}) {
  const { stickerToMp4, isAnimatedWebP, sharpLib } = deps;

  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new Error('Figurinha vazia');
  }

  const animada = typeof isAnimatedWebP === 'function'
    ? !!isAnimatedWebP(buffer)
    : (() => {
        // Fallback: procura o chunk ANIM / o bit de animação do VP8X.
        let off = 12;
        while (off + 8 <= buffer.length) {
          const cc = buffer.toString('ascii', off, off + 4);
          const size = buffer.readUInt32LE(off + 4);
          if (cc === 'ANIM' || cc === 'ANMF') return true;
          if (cc === 'VP8X' && off + 8 < buffer.length && (buffer[off + 8] & 0x02)) return true;
          off += 8 + size + (size & 1);
        }
        return false;
      })();

  if (animada) {
    if (typeof stickerToMp4 !== 'function') {
      throw new Error('Conversão de figurinha animada indisponível (stickerToMp4 ausente).');
    }
    const conv = await stickerToMp4(buffer);
    const mp4 = Buffer.isBuffer(conv) ? conv : conv?.buffer;
    if (!Buffer.isBuffer(mp4) || mp4.length === 0) {
      throw new Error('Não consegui converter a figurinha animada.');
    }
    // `gifPlayback: true` faz o WhatsApp animar o MP4 em loop — mesmo mecanismo
    // do `!togif`.
    return { type: 'video', buffer: mp4, mimetype: 'video/mp4', gifPlayback: true, animada: true };
  }

  // Estática → PNG (preserva o alfa da figurinha).
  if (sharpLib && typeof sharpLib === 'function') {
    const png = await sharpLib(buffer).png().toBuffer();
    if (Buffer.isBuffer(png) && png.length > 0) {
      return { type: 'image', buffer: png, mimetype: 'image/png', animada: false };
    }
  }
  // Sem sharp: se os bytes já forem uma imagem aceita, publica como está.
  const fmt = detectImageFormat(buffer);
  if (fmt && fmt.mime.startsWith('image/') && fmt.mime !== 'image/webp') {
    return { type: 'image', buffer, mimetype: fmt.mime, animada: false };
  }
  throw new Error('Conversão de figurinha indisponível (sharp ausente).');
}
