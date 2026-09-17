/**
 * Mídias dos comandos de brincadeira — pasta `dados/src/gifsbn/`.
 *
 * Todas as mídias (GIF, vídeo ou imagem) usadas pelos comandos de brincadeira
 * ficam nesta pasta. Duas formas de definir a mídia de um comando:
 *
 *   1. `!setgif <comando>` (respondendo uma mídia) — grava o arquivo em
 *      `gifsbn/<comando>.<ext>` e registra o caminho no `games.json`.
 *   2. Colocar o arquivo direto na pasta com o nome do comando — ex.:
 *      `gifsbn/tapar.gif` faz o `!tapar` usar aquele GIF, sem precisar rodar
 *      nenhum comando. A extensão pode ser qualquer uma suportada abaixo.
 *
 * O arquivo solto tem prioridade sobre o que estiver no `games.json`: assim,
 * trocar o arquivo na pasta é suficiente para trocar a mídia do comando.
 *
 * O caminho gravado no `games.json` é relativo à pasta `dados/src`
 * (ex.: `./gifsbn/tapar.gif`), que é o formato que os comandos já resolvem.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** `dados/src/gifsbn` — quem importa daqui de dentro (funcs/utils). */
export const GIFSBN_DIR = path.join(__dirname, '..', '..', 'gifsbn');

/** Prefixo relativo gravado no `games.json` (resolvido pelo __dirname do index). */
export const GIFSBN_PREFIX = './gifsbn';

/**
 * Extensões aceitas na pasta, na ordem em que são procuradas.
 *
 * A ordem importa: se houver `tapar.gif` e `tapar.mp4`, o primeiro da lista
 * vence. GIF vem primeiro por ser o uso mais comum nesses comandos.
 */
export const MEDIA_EXTS = ['gif', 'mp4', 'webm', 'mov', 'jpg', 'jpeg', 'png', 'webp'];

const VIDEO_EXTS = new Set(['gif', 'mp4', 'webm', 'mov']);

/** Garante que a pasta exista (o bot pode subir antes do primeiro `!setgif`). */
export function ensureGifsbnDir() {
  fs.mkdirSync(GIFSBN_DIR, { recursive: true });
}

/** Só o nome do comando, em minúsculas e sem nada que escape da pasta. */
function safeCommandName(command) {
  if (typeof command !== 'string') return null;
  const name = command.trim().toLowerCase();
  if (!name || !/^[a-z0-9_-]+$/.test(name)) return null;
  return name;
}

/**
 * Procura o arquivo de mídia de um comando na pasta `gifsbn`.
 *
 * @param {string} command nome do comando (ex.: 'tapar')
 * @returns {{file: string, ext: string, isVideo: boolean}|null}
 */
export function findGifsbnMedia(command) {
  const name = safeCommandName(command);
  if (!name) return null;

  for (const ext of MEDIA_EXTS) {
    const file = path.join(GIFSBN_DIR, `${name}.${ext}`);
    try {
      if (fs.existsSync(file) && fs.statSync(file).isFile()) {
        return { file, ext, isVideo: VIDEO_EXTS.has(ext) };
      }
    } catch {
      /* segue para a próxima extensão */
    }
  }
  return null;
}

/**
 * Salva a mídia de um comando (usado pelo `!setgif`).
 *
 * Remove versões anteriores com outra extensão, para não ficar com
 * `tapar.mp4` E `tapar.gif` na pasta — o arquivo solto tem prioridade, então
 * uma sobra antiga passaria a vencer a mídia recém-definida.
 *
 * @param {string} command nome do comando
 * @param {string} ext extensão (sem ponto)
 * @param {Buffer} buffer conteúdo da mídia
 * @returns {{relativePath: string, isVideo: boolean, ext: string}|null}
 */
export function saveGifsbnMedia(command, ext, buffer) {
  const name = safeCommandName(command);
  const cleanExt = typeof ext === 'string' ? ext.toLowerCase().replace(/^\./, '') : '';
  if (!name || !MEDIA_EXTS.includes(cleanExt) || !buffer) return null;

  ensureGifsbnDir();

  // Apaga outras extensões do mesmo comando antes de gravar.
  for (const other of MEDIA_EXTS) {
    if (other === cleanExt) continue;
    const antigo = path.join(GIFSBN_DIR, `${name}.${other}`);
    try {
      if (fs.existsSync(antigo)) fs.unlinkSync(antigo);
    } catch { /* arquivo em uso ou sem permissão: segue */ }
  }

  fs.writeFileSync(path.join(GIFSBN_DIR, `${name}.${cleanExt}`), buffer);
  return {
    relativePath: `${GIFSBN_PREFIX}/${name}.${cleanExt}`,
    isVideo: VIDEO_EXTS.has(cleanExt),
    ext: cleanExt
  };
}

/**
 * Monta a mídia de um comando no formato que os comandos de brincadeira usam
 * (`{ image: { url } }` / `{ video: { url } }`, com `isGif` quando for GIF).
 *
 * É o fallback por arquivo solto: permite `gifsbn/tapar.gif` funcionar sem
 * passar pelo `!setgif`.
 *
 * @param {string} command nome do comando
 * @returns {object|null} mídia no formato do `games.json`, ou null
 */
export function buildMediaFromFile(command) {
  const found = findGifsbnMedia(command);
  if (!found) return null;

  const url = `${GIFSBN_PREFIX}/${path.basename(found.file)}`;
  return found.isVideo
    ? { video: { url }, isGif: found.ext === 'gif' }
    : { image: { url }, isGif: false };
}

/**
 * Mídia efetiva de um comando: o arquivo na pasta vence o `games.json`.
 *
 * @param {object} mediaDoGames mídia registrada no games.json (pode ser undefined)
 * @param {string} command nome do comando
 * @returns {{media: object|undefined, isCustomGif: boolean}}
 */
export function resolveBrincadeiraMedia(mediaDoGames, command) {
  const doArquivo = buildMediaFromFile(command);
  const media = doArquivo || mediaDoGames;
  return { media, isCustomGif: media?.isGif === true };
}

/**
 * Converte o caminho relativo gravado no `games.json` em caminho absoluto.
 *
 * Caminhos que começam com `./` são relativos à pasta `dados/src` (onde ficam
 * `gifsbn/` e `midias/`); URLs http(s) passam direto.
 *
 * @param {string} url caminho ou URL
 * @param {string} baseDir pasta base para os caminhos `./`
 */
export function resolveMediaUrl(url, baseDir) {
  if (typeof url === 'string' && url.startsWith('./')) {
    return path.join(baseDir, url.substring(1));
  }
  return url;
}