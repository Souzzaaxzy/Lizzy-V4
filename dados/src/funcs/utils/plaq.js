/**
 * Mídias dos comandos `!plaq1`..`!plaq10` — pasta `dados/src/plaq/`.
 *
 * Mesmo mecanismo do `gifsbn`: a mídia do comando é o **arquivo solto** na
 * pasta, com o nome do comando. Ex.: `plaq/plaq1.png` faz o `!plaq1` usar
 * aquela imagem — sem rodar nenhum comando, sem registro em JSON.
 *
 * Escopo DELIBERADAMENTE restrito a esses 10 comandos: um nome fora da lista é
 * recusado, então a pasta não vira um resolvedor genérico de mídia para
 * qualquer comando (diferente do `gifsbn`, que serve toda a família de
 * brincadeiras).
 *
 * Sem sistema paralelo: reusa `MEDIA_EXTS` e o mesmo formato de caminho
 * relativo (`./plaq/<arquivo>`) que o `resolveMediaUrl` do `gifsbn` já resolve.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { MEDIA_EXTS } from './gifsbn.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * `dados/src/plaq` — pasta das mídias (o usuário só joga o arquivo aqui).
 *
 * Este arquivo mora em `dados/src/funcs/utils`, então são DOIS `..` para voltar
 * a `dados/src` (mesma convenção do `gifsbn.js`, que fica ao lado).
 *
 * `PLAQ_PATH` permite apontar para outra pasta — mesmo padrão do
 * `DATABASE_PATH`. É o que permite o teste rodar sem escrever no repositório.
 */
export const PLAQ_DIR = process.env.PLAQ_PATH || path.join(__dirname, '..', '..', 'plaq');

/** Prefixo relativo, no mesmo formato que o `gifsbn` grava no games.json. */
export const PLAQ_PREFIX = './plaq';

/** Os 10 comandos deste recurso. Nada fora desta lista é atendido. */
export const PLAQ_COMMANDS = Object.freeze([
  'plaq1', 'plaq2', 'plaq3', 'plaq4', 'plaq5',
  'plaq6', 'plaq7', 'plaq8', 'plaq9', 'plaq10'
]);

/** Vídeo/animação recebem `gifPlayback`; imagem vai como imagem. */
const VIDEO_EXTS = new Set(['gif', 'mp4', 'webm', 'mov']);

/** Garante que a pasta exista (o bot pode subir antes de alguém colocar mídia). */
export function ensurePlaqDir() {
  fs.mkdirSync(PLAQ_DIR, { recursive: true });
}

/**
 * Valida o nome do comando contra a LISTA dos 10.
 * Aceita com ou sem o prefixo `!` e em qualquer caixa (`!PLAQ3`, `plaq3`).
 *
 * @param {string} command
 * @returns {string|null} nome canônico (ex.: 'plaq3') ou null se não for um dos 10
 */
export function normalizePlaqCommand(command) {
  if (typeof command !== 'string') return null;
  const name = command.trim().toLowerCase().replace(/^!+/, '');
  return PLAQ_COMMANDS.includes(name) ? name : null;
}

/** É um dos 10 comandos? Usado pelo `index.js` para decidir o caminho. */
export function isPlaqCommand(command) {
  return normalizePlaqCommand(command) !== null;
}

/**
 * Procura o arquivo de mídia de um comando na pasta `plaq`.
 *
 * @param {string} command ex.: 'plaq1' (aceita com `!` também)
 * @returns {{file: string, ext: string, isVideo: boolean}|null}
 */
export function findPlaqMedia(command) {
  const name = normalizePlaqCommand(command);
  if (!name) return null;

  for (const ext of MEDIA_EXTS) {
    const file = path.join(PLAQ_DIR, `${name}.${ext}`);
    try {
      if (fs.existsSync(file) && fs.statSync(file).isFile()) {
        return { file, ext, isVideo: VIDEO_EXTS.has(ext) };
      }
    } catch {
      /* caminho inválido: tenta a próxima extensão */
    }
  }
  return null;
}

/**
 * Resolve a mídia de um comando para uso direto no envio.
 *
 * Devolve o caminho ABSOLUTO do arquivo — não um caminho relativo. O relativo
 * (`./plaq/...`) exigiria que quem consome juntasse com a pasta `dados/src`, e
 * isso quebrava quando a pasta real é trocada (ex.: `PLAQ_PATH` nos testes).
 *
 * @param {string} command
 * @returns {{file: string, ext: string, isVideo: boolean, isGif: boolean}|null}
 */
export function resolvePlaqMedia(command) {
  const found = findPlaqMedia(command);
  if (!found) return null;
  return { ...found, isGif: found.ext === 'gif' };
}

/** Lista o que existe hoje na pasta, para o menu mostrar o estado real. */
export function listPlaqMedia() {
  const out = {};
  for (const cmd of PLAQ_COMMANDS) {
    const found = findPlaqMedia(cmd);
    out[cmd] = found ? found.ext : null;
  }
  return out;
}
