/**
 * Download do APK — streaming, com teto de tamanho, timeout e limpeza garantida.
 *
 * Regras que este módulo faz valer:
 *   - a URL vem SEMPRE dos metadados do F-Droid (nunca do usuário) e passa por
 *     `assertAllowedUrl` (anti-SSRF) antes de qualquer requisição;
 *   - o download é em STREAMING para um arquivo temporário: um APK de ~127 MB
 *     nunca é carregado inteiro na memória;
 *   - o tamanho é conferido ANTES (Content-Length, quando existe) e DURANTE
 *     (contagem real): passar do teto aborta na hora;
 *   - o SHA-256 é calculado enquanto o arquivo é escrito (sem reler);
 *   - há timeout de conexão e de fluxo ocioso;
 *   - o arquivo temporário é removido em qualquer falha — quem chama (o
 *     orquestrador) ainda tem um `finally` que garante a limpeza final.
 *
 * Reutiliza o `mediaClient` (axios com connection pooling) já existente.
 */

import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { mediaClient } from '../../utils/httpClient.js';
import { DATABASE_DIR } from '../../utils/paths.js';
import { assertAllowedUrl } from './fdroidIndex.js';

/** Teto de tamanho do APK. Configurável e documentado. */
export const MAX_APK_BYTES = Number(process.env.APK_MAX_BYTES) || 600 * 1024 * 1024;
/** Timeout de conexão/primeira resposta. */
export const CONNECT_TIMEOUT_MS = Number(process.env.APK_CONNECT_TIMEOUT_MS) || 30000;
/** Tempo máximo sem receber bytes antes de abortar. */
export const IDLE_TIMEOUT_MS = Number(process.env.APK_IDLE_TIMEOUT_MS) || 60000;
/** Tempo máximo total do download. */
export const TOTAL_TIMEOUT_MS = Number(process.env.APK_TOTAL_TIMEOUT_MS) || 10 * 60 * 1000;

/** Pasta de temporários: a mesma que o bot já usa. */
export const TMP_DIR = path.join(DATABASE_DIR, 'tmp');

/**
 * HTTP puro só é permitido para loopback, e SOMENTE quando o ambiente de teste
 * pede (`APK_ALLOW_INSECURE=1`). Em produção o caminho exige HTTPS — esta
 * função devolve `false` e o downloader recusa.
 */
function resolveAllowInsecure(url, opts = {}) {
  if (opts.allowInsecure === true) return true;
  if (process.env.APK_ALLOW_INSECURE !== '1') return false;
  try {
    const h = new URL(url).hostname;
    return h === '127.0.0.1' || h === 'localhost' || h === '::1';
  } catch {
    return false;
  }
}

export class ApkDownloadError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'ApkDownloadError';
    this.code = code;
    this.details = details;
  }
}

/** Descarta o arquivo temporário sem lançar (usado em caminhos de erro). */
export async function safeUnlink(filePath) {
  if (!filePath) return;
  await fsp.rm(filePath, { force: true }).catch(() => {});
}

/**
 * Baixa a URL para um arquivo temporário.
 *
 * @param {string} url URL do APK (origem F-Droid, validada)
 * @param {{maxBytes?: number, allowedHosts?: Set<string>, logger?: object}} [opts]
 * @returns {Promise<{path: string, size: number, sha256: string, temp: true}>}
 */
export async function downloadApkToTemp(url, opts = {}) {
  const maxBytes = opts.maxBytes ?? MAX_APK_BYTES;

  const allowed = assertAllowedUrl(url, opts.allowedHosts, { allowInsecure: resolveAllowInsecure(url, opts) });
  if (!allowed.ok) {
    throw new ApkDownloadError(allowed.reason, 'URL de download não permitida.');
  }

  await fsp.mkdir(TMP_DIR, { recursive: true });
  const tempPath = path.join(TMP_DIR, `apk-${Date.now()}-${crypto.randomBytes(6).toString('hex')}.part`);

  const controller = new AbortController();
  let idleTimer = null;
  const totalTimer = setTimeout(() => controller.abort(), TOTAL_TIMEOUT_MS);
  const resetIdle = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => controller.abort(), IDLE_TIMEOUT_MS);
  };

  let written = 0;
  const hash = crypto.createHash('sha256');

  try {
    const res = await mediaClient.get(url, {
      responseType: 'stream',
      timeout: CONNECT_TIMEOUT_MS,
      signal: controller.signal,
      headers: { Accept: '*/*' },
      // O APK é binário e não deve ser descomprimido pelo axios.
      decompress: false,
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
      validateStatus: (s) => s >= 200 && s < 300,
    });

    const declared = Number(res.headers['content-length'] || 0);
    if (declared && declared > maxBytes) {
      res.data.destroy?.();
      throw new ApkDownloadError(
        'APK_SIZE_LIMIT',
        `APK maior que o limite (${declared} > ${maxBytes}).`,
        { declared, maxBytes }
      );
    }

    const out = fs.createWriteStream(tempPath);
    resetIdle();

    await new Promise((resolve, reject) => {
      res.data.on('data', (chunk) => {
        written += chunk.length;
        if (written > maxBytes) {
          controller.abort();
          reject(new ApkDownloadError('APK_SIZE_LIMIT', `APK maior que o limite (${maxBytes}).`, { maxBytes }));
          return;
        }
        hash.update(chunk);
        resetIdle();
      });
      res.data.on('error', (err) => reject(new ApkDownloadError('APK_DOWNLOAD_ERROR', 'Falha no download.', { cause: err?.message })));
      res.data.on('aborted', () => reject(new ApkDownloadError('APK_DOWNLOAD_TIMEOUT', 'Download abortado.')));
      out.on('error', (err) => reject(new ApkDownloadError('APK_DOWNLOAD_ERROR', 'Falha ao gravar o arquivo.', { cause: err?.message })));
      out.on('finish', resolve);
      res.data.pipe(out);
    });

    // Confere o tamanho no disco: protege contra escrita parcial.
    const stat = await fsp.stat(tempPath);
    if (stat.size !== written) {
      throw new ApkDownloadError('APK_DOWNLOAD_ERROR', 'Tamanho gravado difere do recebido.');
    }
    if (stat.size === 0) {
      throw new ApkDownloadError('APK_INVALID_FILE', 'Arquivo baixado está vazio.');
    }
    if (stat.size > maxBytes) {
      throw new ApkDownloadError('APK_SIZE_LIMIT', `APK maior que o limite (${maxBytes}).`, { maxBytes });
    }

    return { path: tempPath, size: stat.size, sha256: hash.digest('hex'), temp: true };
  } catch (error) {
    await safeUnlink(tempPath);
    if (error instanceof ApkDownloadError) throw error;
    const code = controller.signal.aborted ? 'APK_DOWNLOAD_TIMEOUT' : 'APK_DOWNLOAD_ERROR';
    throw new ApkDownloadError(code, 'Não consegui baixar o APK.', { cause: error?.message });
  } finally {
    if (idleTimer) clearTimeout(idleTimer);
    clearTimeout(totalTimer);
  }
}

export default {
  MAX_APK_BYTES,
  CONNECT_TIMEOUT_MS,
  IDLE_TIMEOUT_MS,
  TOTAL_TIMEOUT_MS,
  TMP_DIR,
  ApkDownloadError,
  downloadApkToTemp,
  safeUnlink,
};
