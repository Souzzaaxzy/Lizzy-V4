/**
 * COOKIES DO INSTAGRAM — o arquivo que libera o perfil (inclusive privado).
 *
 * ## Por que existe
 *
 * O `!pinsta` usava o endpoint ANÔNIMO `web_profile_info`, que o Instagram
 * DESLIGOU: hoje ele responde 404/400 para qualquer usuário, logado ou não.
 * Medido: `web_profile_info` -> 404 (HTML de erro), `users/<u>/info/` -> 400.
 *
 * Com uma conta logada (o cookie `sessionid`) a API privada volta a responder —
 * e ela entrega o CABEÇALHO de qualquer perfil, inclusive PRIVADO: foto, nome,
 * nº de seguidores e quantos segue. O que a conta NÃO desbloqueia é o CONTEÚDO
 * de um perfil privado (posts/stories) — isso só com "seguir e ser aceito".
 *
 * ## Igual ao YouTube (o pedido do dono)
 *
 * Basta jogar o arquivo de cookies no diretório:
 *
 *   data/instagram/cookies.txt      <- exportado do navegador (formato Netscape)
 *
 * ou, pelo comando do dono, `!keyig <sessionid>` grava
 * `data/instagram/sessionid.txt`.
 *
 * ## Ordem de resolução
 *
 *   1. `IG_COOKIES_FILE`            (env — caminho explícito)
 *   2. data/instagram/cookies.txt   (padrão implícito, formato Netscape)
 *   3. data/instagram/sessionid.txt (gravado pelo `!keyig`)
 *
 * Aceita os DOIS formatos: um `cookies.txt` do Netscape (extrai a linha do
 * `sessionid`) ou um arquivo com o valor cru do sessionid.
 *
 * Módulo PURO: só lê/escreve arquivo; nada de rede. Nunca imprime o valor.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// dados/src/utils -> raiz do projeto
const RAIZ = path.resolve(__dirname, '..', '..', '..');

/** Diretório padrão dos cookies do Instagram (fora do git). */
export const IG_DIR = process.env.IG_COOKIES_DIR || path.join(RAIZ, 'data', 'instagram');

/** Arquivo do Netscape (o mesmo tipo que o YouTube usa). */
export const ARQUIVO_NETSCAPE = path.join(IG_DIR, 'cookies.txt');

/** Arquivo com o sessionid cru (gravado pelo `!keyig`). */
export const ARQUIVO_SESSIONID = path.join(IG_DIR, 'sessionid.txt');

/**
 * Resolve o caminho do arquivo de cookies a usar.
 * @returns {string|null} caminho existente ou `null`
 */
export function caminhoCookies() {
  const candidatos = [];
  if (process.env.IG_COOKIES_FILE) candidatos.push(process.env.IG_COOKIES_FILE);
  candidatos.push(ARQUIVO_NETSCAPE, ARQUIVO_SESSIONID);
  try {
    for (const c of candidatos) {
      if (c && fs.existsSync(c) && fs.statSync(c).isFile()) return c;
    }
  } catch { /* segue sem cookies */ }
  return null;
}

/**
 * Extrai o `sessionid` do CONTEÚDO do arquivo.
 *
 * Aceita o formato Netscape (`dominio\tflag\tpath\tsecure\texpira\tnome\tvalor`)
 * e, se não achar uma linha do sessionid, trata o conteúdo inteiro como o valor
 * cru (o arquivo do `!keyig`).
 *
 * @param {string} conteudo
 * @returns {string|null}
 */
export function extrairSessionId(conteudo) {
  if (!conteudo || typeof conteudo !== 'string') return null;
  const linhas = conteudo.split(/\r?\n/);
  for (const linha of linhas) {
    const l = linha.trim();
    if (!l || l.startsWith('#')) continue;
    // Formato Netscape: o NOME do cookie é o penúltimo campo e o VALOR o último.
    const campos = l.split('\t');
    if (campos.length >= 7) {
      const nome = campos[campos.length - 2];
      const valor = campos[campos.length - 1];
      if (nome === 'sessionid' && valor) return valor;
    }
  }
  // Não é Netscape (ou não tem a linha): trata como sessionid cru.
  const cru = conteudo.trim();
  if (!cru) return null;
  // Um sessionid do Instagram é um token longo com `%3A` (o `:` url-encoded).
  if (cru.length >= 20 && !cru.includes('\n') && !cru.includes('\t')) return cru;
  return null;
}

/**
 * Lê o sessionid configurado.
 * @returns {string|null}
 */
export function lerSessionId() {
  const arquivo = caminhoCookies();
  if (!arquivo) return null;
  try {
    return extrairSessionId(fs.readFileSync(arquivo, 'utf-8'));
  } catch { return null; }
}

/** Há cookies configurados (e legíveis)? */
export function temCookies() {
  return Boolean(lerSessionId());
}

/**
 * Grava o sessionid cru em `data/instagram/sessionid.txt`.
 * @param {string} valor
 * @returns {{ok: boolean, caminho?: string, motivo?: string}}
 */
export function salvarSessionId(valor) {
  const limpo = String(valor || '').trim();
  if (!limpo) return { ok: false, motivo: 'vazio' };
  if (/\s/.test(limpo)) return { ok: false, motivo: 'espaco' };
  if (limpo.length < 20) return { ok: false, motivo: 'curto' };
  try {
    fs.mkdirSync(IG_DIR, { recursive: true });
    fs.writeFileSync(ARQUIVO_SESSIONID, limpo + '\n', { mode: 0o600 });
    return { ok: true, caminho: ARQUIVO_SESSIONID };
  } catch (e) {
    return { ok: false, motivo: e?.message || 'erro' };
  }
}

/** Remove os arquivos de cookies do Instagram. */
export function limparCookies() {
  const removidos = [];
  for (const f of [ARQUIVO_SESSIONID, ARQUIVO_NETSCAPE]) {
    try {
      if (fs.existsSync(f)) { fs.unlinkSync(f); removidos.push(f); }
    } catch { /* ignora */ }
  }
  return removidos;
}

/** Mascara um valor para exibição/log (`abc...xyz`). */
export function mascarar(valor) {
  const v = String(valor || '');
  if (v.length <= 8) return v ? '•••' : '(vazio)';
  return `${v.slice(0, 4)}...${v.slice(-4)}`;
}
