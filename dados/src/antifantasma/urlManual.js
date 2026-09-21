/**
 * AntiFantasma — URL pública gravada À MÃO pelo dono (`!seturlghost`).
 *
 * Por que existe: a detecção automática cobre várias plataformas (runtime,
 * Render, Railway, Pterodactyl...), mas existem cenários em que ela não acerta:
 * proxy próprio, domínio customizado, túnel (ngrok/cloudflared), ou o bot
 * rodando atrás de algo que não expõe variável nenhuma. Nesses casos o dono
 * escreve a URL e ela passa a valer — sem depender de editar o ambiente.
 *
 * Fica em arquivo separado das keys: é configuração do servidor, não
 * credencial. E sobrevive a `git pull` (é gitignored, como o resto do database).
 *
 * Precedência final da URL (do maior para o menor):
 *   1. o que o dono gravou aqui (`!seturlghost`)
 *   2. `ANTIFANTASMA_PUBLIC_URL` / `PUBLIC_URL` (variável de ambiente)
 *   3. detecção automática da plataforma
 *
 * Ou seja: o comando GANHA da variável de ambiente. É o mais previsível — quem
 * acabou de digitar a URL espera que ela valha, sem precisar mexer no painel.
 */

import fs from 'node:fs';
import path from 'node:path';

import { DATABASE_DIR } from '../utils/paths.js';

const URL_FILE = path.join(DATABASE_DIR, 'antifantasma', 'publicUrl.json');

/**
 * Normaliza a URL informada: tira espaços, a barra final e garante o esquema.
 *
 * Nunca aceita `http://` em host público — a KEY do usuário não pode trafegar
 * em claro. Só `localhost`/`127.0.0.1` ficam em http (desenvolvimento).
 *
 * @returns {string|null} URL normalizada, ou `null` se não for utilizável
 */
export function normalizarUrl(valor) {
  if (typeof valor !== 'string') return null;
  let bruto = valor.trim().replace(/^<|>$/g, '').trim();
  if (!bruto) return null;

  // Remove barra(s) final(is) para não gerar `//` ao montar o endpoint.
  bruto = bruto.replace(/\/+$/, '');

  // Sem esquema: assume https.
  if (!/^https?:\/\//i.test(bruto)) bruto = `https://${bruto}`;

  // `http://` só em endereço local.
  if (/^http:\/\//i.test(bruto)) {
    const host = bruto.slice('http://'.length);
    const ehLocal = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?/i.test(host);
    if (!ehLocal) bruto = bruto.replace(/^http:/i, 'https:');
  }

  // Precisa ter um host plausível (letras/números/hífen/ponto, opcional :porta).
  let url;
  try {
    url = new URL(bruto);
  } catch {
    return null;
  }
  if (!url.hostname || !/^[a-z0-9.-]+$/i.test(url.hostname)) return null;
  // O host precisa ter pelo menos um caractere alfanumérico. Sem isto, "."
  // ou "..." passariam (são "hosts" de só pontuação) e virariam `https://.`.
  if (!/[a-z0-9]/i.test(url.hostname)) return null;
  // Um host sem ponto (ex.: "abc") quase sempre é erro de digitação. Aceitamos
  // localhost, IP e hostnames com ponto.
  const ehLocal = /^(localhost|127\.0\.0\.1|\[::1\])$/i.test(url.hostname);
  const ehIp = /^\d+\.\d+\.\d+\.\d+$/.test(url.hostname);
  if (!ehLocal && !ehIp && !url.hostname.includes('.')) return null;
  // Rótulo de host não pode começar/terminar com ponto nem ter ponto duplo.
  if (/^\.|\.$|\.\./.test(url.hostname)) return null;

  return `${url.protocol}//${url.host}`;
}

/** Lê a URL gravada. `null` quando não há nada válido. */
export function lerUrlManual() {
  try {
    const bruto = JSON.parse(fs.readFileSync(URL_FILE, 'utf-8'));
    const valor = bruto && typeof bruto === 'object' ? bruto.url : null;
    return normalizarUrl(valor);
  } catch {
    return null;
  }
}

/**
 * Grava a URL do servidor.
 *
 * @param {string} valor
 * @returns {{ok: boolean, url?: string, motivo?: string}}
 */
export function gravarUrlManual(valor) {
  const url = normalizarUrl(valor);
  if (!url) return { ok: false, motivo: 'url_invalida' };

  try {
    fs.mkdirSync(path.dirname(URL_FILE), { recursive: true });
    // Escrita atômica com tmp único (mesmo cuidado do resto do projeto).
    const tmp = `${URL_FILE}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({
      url,
      atualizadoEm: new Date().toISOString(),
    }, null, 2));
    fs.renameSync(tmp, URL_FILE);
    return { ok: true, url };
  } catch {
    return { ok: false, motivo: 'falha_escrita' };
  }
}

/** Remove a URL gravada (volta a valer a detecção automática). */
export function limparUrlManual() {
  try {
    if (fs.existsSync(URL_FILE)) fs.unlinkSync(URL_FILE);
    return { ok: true };
  } catch {
    return { ok: false, motivo: 'falha_remocao' };
  }
}

/** Há URL gravada à mão? */
export function temUrlManual() {
  return lerUrlManual() !== null;
}

export { URL_FILE };