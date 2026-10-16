/**
 * Cache de audio da call, por grupo.
 *
 * ## O que guarda
 *
 * O audio pronto para o motor: 16 kHz mono WAV em
 * `dados/database/call-cache/<grupo>/`. O nome do arquivo e' um id aleatorio
 * (nao o titulo) -- titulo de musica tem acento, barra e emoji, e isso quebra
 * caminho de arquivo.
 *
 * ## Ciclo de vida
 *
 * Gravado ao entrar na fila; apagado ao sair (tocou, pulou, ou a fila limpou);
 * o diretorio do grupo inteiro sai quando a call encerra. E' o que o dono
 * pediu: "passou a musica ou fechou a fila, todas as musicas salvas saem".
 *
 * ## Limite
 *
 * `CALL_CACHE_MAX_MB` (padrao 300) por grupo. Ao passar, as mais ANTIGAS saem
 * primeiro. Sem isso, um grupo enfileirando musica por horas enche o disco --
 * e o backup do `!atualizar` (que e' recursivo) copiaria tudo.
 */

import fs from 'fs';
import path from 'path';
import { DATABASE_DIR } from './paths.js';

/** Raiz do cache (fora do banco de estado, mas sob DATABASE_DIR). */
const RAIZ = process.env.CALL_CACHE_DIR || path.join(DATABASE_DIR, 'call-cache');

/** Teto por grupo, em MB. */
function limiteBytes() {
  const mb = Number.parseInt(process.env.CALL_CACHE_MAX_MB || '300', 10);
  return (Number.isFinite(mb) && mb > 0 ? mb : 300) * 1024 * 1024;
}

/** Normaliza o jid para nome de pasta (sem `@`, sem `/`). */
function pastaDoGrupo(grupo) {
  const limpo = String(grupo || '').trim().replace(/[^a-zA-Z0-9._-]/g, '_');
  return path.join(RAIZ, limpo || 'sem-grupo');
}

/** Id curto e unico para o arquivo (nao usa o titulo). */
function idArquivo() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Reserva um caminho novo no cache do grupo.
 *
 * @param {string} grupo
 * @param {string} [ext] extensao (padrao .wav)
 * @returns {string} caminho absoluto (o arquivo ainda NAO existe)
 */
export function caminhoNovo(grupo, ext = '.wav') {
  const dir = pastaDoGrupo(grupo);
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `${idArquivo()}${ext}`);
}

/**
 * Registra um arquivo no cache e aplica o limite.
 *
 * @param {string} grupo
 * @param {string} caminho
 * @returns {{ ok: boolean, bytes?: number, removidas?: number }}
 */
export function registrar(grupo, caminho) {
  try {
    const bytes = fs.statSync(caminho).size;
    podar(grupo, caminho);
    return { ok: true, bytes };
  } catch {
    return { ok: false };
  }
}

/**
 * Mantem o cache do grupo dentro do limite, removendo as mais antigas.
 *
 * @param {string} grupo
 * @param {string} [protegido] caminho que NAO pode sair (a faixa que acabou de entrar)
 */
export function podar(grupo, protegido = null) {
  try {
    const dir = pastaDoGrupo(grupo);
    if (!fs.existsSync(dir)) return { removidas: 0 };

    const arquivos = fs.readdirSync(dir)
      .map((nome) => {
        const p = path.join(dir, nome);
        try {
          const st = fs.statSync(p);
          return st.isFile() ? { p, mtime: st.mtimeMs, size: st.size } : null;
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .sort((a, b) => a.mtime - b.mtime); // mais antigas primeiro

    let total = arquivos.reduce((s, a) => s + a.size, 0);
    let removidas = 0;
    const teto = limiteBytes();

    for (const a of arquivos) {
      if (total <= teto) break;
      if (protegido && path.resolve(a.p) === path.resolve(protegido)) continue;
      try {
        fs.rmSync(a.p, { force: true });
        total -= a.size;
        removidas++;
      } catch { /* segue */ }
    }
    return { removidas };
  } catch {
    return { removidas: 0 };
  }
}

/** Apaga UM arquivo do cache (best-effort). */
export function apagar(caminho) {
  if (!caminho) return false;
  try {
    fs.rmSync(caminho, { force: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * Apaga o cache inteiro do grupo (call encerrada / fila limpa).
 *
 * @param {string} grupo
 * @returns {number} quantos arquivos sairam
 */
export function limparGrupo(grupo) {
  try {
    const dir = pastaDoGrupo(grupo);
    if (!fs.existsSync(dir)) return 0;
    const n = fs.readdirSync(dir).length;
    fs.rmSync(dir, { recursive: true, force: true });
    return n;
  } catch {
    return 0;
  }
}

/** Apaga varios caminhos (o que a fila devolve ao limpar). */
export function apagarVarios(caminhos = []) {
  let n = 0;
  for (const c of caminhos) if (apagar(c)) n++;
  return n;
}

/** Espaco usado pelo grupo, em MB (diagnostico). */
export function usoMb(grupo) {
  try {
    const dir = pastaDoGrupo(grupo);
    if (!fs.existsSync(dir)) return 0;
    const total = fs.readdirSync(dir).reduce((s, nome) => {
      try { return s + fs.statSync(path.join(dir, nome)).size; } catch { return s; }
    }, 0);
    return Math.round((total / 1048576) * 10) / 10;
  } catch {
    return 0;
  }
}

/** Raiz do cache (para o `!atualizar` pular no backup, se preciso). */
export function raizCache() {
  return RAIZ;
}
