/**
 * TTS do `!iap` -- a resposta do agente vira audio na call.
 *
 * ## Duas fontes, nesta ordem
 *
 * 1. **edge-tts** (padrao): usa as vozes neurais do Microsoft Edge. Sem chave,
 *    sem limite, qualidade alta e vozes pt-BR prontas
 *    (`pt-BR-AntonioNeural`, `pt-BR-FranciscaNeural`,
 *    `pt-BR-ThalitaMultilingualNeural`). Roda como processo -- gera um MP3.
 * 2. **Gemini TTS** (fallback): `gemini-2.5-flash-preview-tts` devolve PCM
 *    24 kHz, que este modulo reamostra para 16 kHz. Usa a MESMA chave do `!key`.
 *
 * O resultado e' sempre o formato do motor: **PCM float 16 kHz mono**.
 *
 * ## Por que edge-tts como principal
 *
 * O tier gratis do Gemini tem limite de requisicoes por minuto, e num agente de
 * voz cada resposta e' uma requisicao. O edge-tts tira o custo e o limite do
 * caminho da VOZ, deixando so' o LLM/STT na API.
 */

import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import axios from 'axios';
import { resamplePcm, wavParaPcm, TAXA_MOTOR } from './iapAudio.js';


/**
 * Voz do edge-tts (a voz do agente).
 *
 * ## Feminina por padrão
 *
 * O padrão anterior (`pt-BR-AntonioNeural`) era **MASCULINO** — o dono pediu voz
 * de mulher. As vozes **femininas** pt-BR do edge-tts são:
 *
 *  - **`pt-BR-FranciscaNeural`** (padrão) — feminina, natural;
 *  - `pt-BR-ThalitaMultilingualNeural` — feminina, multilíngue.
 *
 * (O único masculino é o Antonio.)
 *
 * Lida em TEMPO DE USO (não no import): o comando `!iap voz` troca a voz em
 * runtime, sem reiniciar o bot.
 */
function vozEdge() {
  return process.env.IAP_TTS_VOICE || 'pt-BR-FranciscaNeural';
}

/** As vozes pt-BR conhecidas (para o comando `!iap voz`). */
export const VOZES_PTBR = Object.freeze({
  francisca: 'pt-BR-FranciscaNeural',
  thalita: 'pt-BR-ThalitaMultilingualNeural',
  antonio: 'pt-BR-AntonioNeural'
});

/** Modelo do Gemini TTS (fallback). */
const MODELO_TTS = process.env.IAP_TTS_MODEL || 'gemini-2.5-flash-preview-tts';

/**
 * Cadeia de modelos TTS, tentados em ordem.
 *
 * Um nome FIXO envelhece: foi exatamente o que derrubou o LLM e o STT antes
 * (o Google aposenta previews e devolve 404 "no longer available"). Aqui o
 * modelo pedido vai primeiro e, se ele responder 404, o proximo da lista e'
 * tentado — assim uma aposentadoria do Google nao deixa a Lizzy muda.
 */
const MODELOS_TTS = [
  MODELO_TTS,
  'gemini-2.5-flash-preview-tts',
  'gemini-2.5-pro-preview-tts',
  'gemini-flash-latest'
].filter((m, i, a) => m && a.indexOf(m) === i);

/** Voz do Gemini TTS (fallback). */
const VOZ_GEMINI = process.env.IAP_TTS_GEMINI_VOICE || 'Puck';

/** Teto de tempo do edge-tts. */
const TIMEOUT_EDGE_MS = Number.parseInt(process.env.IAP_TTS_TIMEOUT_MS || '45000', 10);

/** HTTP injetavel (testes). */
let _http = null;
export function setIapTtsHttpForTest(fn) { _http = fn; }
const post = (url, data, config) => (_http ? _http(url, data, config) : axios.post(url, data, config));

/** Cache do binario do edge-tts resolvido (evita re-testar a cada fala). */
let _binarioEdge = undefined;
/** Quando o cache NEGATIVO foi gravado (ele expira; o positivo nao). */
let _binarioEdgeFalhouEm = 0;
/** TTL do cache negativo: se o edge-tts for instalado depois, volta a tentar. */
const EDGE_CACHE_NEGATIVO_MS = Number.parseInt(process.env.IAP_EDGE_RETRY_MS || '60000', 10);

/**
 * Resolve como chamar o edge-tts: o executavel direto, ou via `python -m`.
 * `undefined` = ainda nao testado; `null` = indisponivel (com expiracao).
 */
async function resolverEdge() {
  // Cache POSITIVO: o binario nao some. Cache NEGATIVO: expira, senao instalar
  // o edge-tts (ou corrigir o PATH) depois nunca mais seria percebido.
  if (_binarioEdge !== undefined) {
    const expirou = _binarioEdge === null
      && Date.now() - _binarioEdgeFalhouEm > (EDGE_CACHE_NEGATIVO_MS || 60000);
    if (!expirou) return _binarioEdge;
  }
  // O `pip install --user` (o caminho sem root que o instalador usa) grava o
  // binario em `~/.local/bin`, que normalmente NAO esta no PATH. Sem este
  // candidato, o instalador dizia "edge-tts instalado" e o runtime respondia
  // `edge_indisponivel` — o dono via a voz parar sem causa aparente.
  const localBin = path.join(os.homedir(), '.local', 'bin', 'edge-tts');
  const candidatos = [
    process.env.EDGE_TTS_PATH ? [process.env.EDGE_TTS_PATH, []] : null,
    ['edge-tts', []],
    [localBin, []],
    ['python3', ['-m', 'edge_tts']],
    ['python', ['-m', 'edge_tts']]
  ].filter(Boolean);

  for (const [cmd, base] of candidatos) {
    const ok = await testarBinario(cmd, base);
    if (ok) {
      _binarioEdge = { cmd, base };
      return _binarioEdge;
    }
  }
  _binarioEdge = null;
  _binarioEdgeFalhouEm = Date.now();
  return null;
}

/** Zera o cache de resolucao do edge-tts (testes e diagnostico). */
export function resetEdgeCache() {
  _binarioEdge = undefined;
  _binarioEdgeFalhouEm = 0;
}

/** Roda `cmd base... --list-voices` e ve se responde. */
function testarBinario(cmd, base) {
  return new Promise((resolve) => {
    let proc;
    try {
      proc = spawn(cmd, [...base, '--version'], { stdio: ['ignore', 'ignore', 'ignore'] });
    } catch {
      resolve(false);
      return;
    }
    const timer = setTimeout(() => {
      try { proc.kill('SIGKILL'); } catch { /* ok */ }
      resolve(false);
    }, 15000);
    proc.on('error', () => { clearTimeout(timer); resolve(false); });
    proc.on('close', (code) => { clearTimeout(timer); resolve(code === 0); });
  });
}

/** Disponibilidade do edge-tts (diagnostico/testes). */
export async function edgeDisponivel() {
  return Boolean(await resolverEdge());
}

/**
 * Sintetiza com o edge-tts. Devolve MP3 (Buffer) ou null.
 * @param {string} texto
 * @returns {Promise<Buffer|null>}
 */
async function sintetizarEdge(texto) {
  const bin = await resolverEdge();
  if (!bin) return null;

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'iap-tts-'));
  const saida = path.join(dir, 'fala.mp3');
  try {
    const ok = await new Promise((resolve) => {
      let proc;
      try {
        proc = spawn(bin.cmd, [
          ...bin.base,
          '--voice', vozEdge(),
          '--text', texto,
          '--write-media', saida
        ], { stdio: ['ignore', 'ignore', 'ignore'] });
      } catch {
        resolve(false);
        return;
      }
      const timer = setTimeout(() => {
        try { proc.kill('SIGKILL'); } catch { /* ok */ }
        resolve(false);
      }, Number.isFinite(TIMEOUT_EDGE_MS) && TIMEOUT_EDGE_MS > 0 ? TIMEOUT_EDGE_MS : 45000);
      proc.on('error', () => { clearTimeout(timer); resolve(false); });
      proc.on('close', (code) => { clearTimeout(timer); resolve(code === 0); });
    });

    if (!ok || !fs.existsSync(saida)) return null;
    return fs.readFileSync(saida);
  } catch {
    return null;
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ok */ }
  }
}

/**
 * Sintetiza com o Gemini TTS. Devolve `{ pcm, motivo }` — o `motivo` explica a
 * falha (sem chave, modelo indisponivel, rede), em vez de um `null` mudo.
 *
 * Tenta a CADEIA de modelos: um 404 ("modelo aposentado") passa para o proximo,
 * em vez de deixar a Lizzy muda por causa de um nome que envelheceu.
 *
 * @param {string} texto
 * @param {string} apiKey
 * @returns {Promise<{ pcm: Float32Array|null, motivo?: string }>}
 */
async function sintetizarGemini(texto, apiKey) {
  if (!apiKey) return { pcm: null, motivo: 'sem_chave_gemini' };
  let ultimoMotivo = 'tts_indisponivel';
  let ultimoDetalhe;
  for (const modelo of MODELOS_TTS) {
    const r = await tentarGeminiComModelo(texto, apiKey, modelo);
    if (r.pcm && r.pcm.length) return r;
    ultimoMotivo = r.motivo || ultimoMotivo;
    ultimoDetalhe = r.detalhe;
    // Só um 404 (modelo inexistente/aposentado) justifica tentar o proximo;
    // chave/limite/rede nao melhoram com outro nome de modelo.
    if (r.motivo !== 'gemini_modelo_indisponivel') break;
  }
  return { pcm: null, motivo: ultimoMotivo, detalhe: ultimoDetalhe };
}

/**
 * Uma tentativa de TTS do Gemini com UM modelo.
 * @param {string} texto
 * @param {string} apiKey
 * @param {string} modelo
 * @returns {Promise<{ pcm: Float32Array|null, motivo?: string, detalhe?: string }>}
 */
async function tentarGeminiComModelo(texto, apiKey, modelo) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelo)}:generateContent`;
  try {
    const r = await post(url, {
      contents: [{ parts: [{ text: texto }] }],
      generationConfig: {
        responseModalities: ['AUDIO'],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: VOZ_GEMINI } } }
      }
    }, {
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      timeout: 60000
    });
    const partes = r?.data?.candidates?.[0]?.content?.parts;
    const dado = Array.isArray(partes)
      ? partes.map((p) => p?.inlineData?.data).find(Boolean)
      : null;
    if (!dado) return { pcm: null, motivo: 'gemini_sem_audio' };
    const bruto = Buffer.from(dado, 'base64');
    // O TTS do Gemini devolve WAV com cabecalho RIFF.
    if (bruto.toString('ascii', 0, 4) === 'RIFF') {
      const { pcm } = wavParaPcm(bruto);
      return { pcm };
    }
    // Sem cabecalho: PCM 16-bit little-endian a 24 kHz (o formato documentado).
    const n = Math.floor(bruto.length / 2);
    const pcm = new Float32Array(n);
    for (let i = 0; i < n; i++) pcm[i] = bruto.readInt16LE(i * 2) / 32768;
    return { pcm };
  } catch (e) {
    // O motivo REAL importa: um 404 de modelo aposentado nao e' a mesma coisa
    // que uma chave invalida (400) ou um limite (429).
    const status = e?.response?.status;
    const msg = String(e?.response?.data?.error?.message || e?.message || '');
    let motivo = 'gemini_falhou';
    if (status === 404 || /not found|no longer available/i.test(msg)) motivo = 'gemini_modelo_indisponivel';
    else if (status === 400 || /API key not valid|API_KEY_INVALID/i.test(msg)) motivo = 'gemini_chave';
    else if (status === 429) motivo = 'gemini_limite';
    else if (status === 403) motivo = 'gemini_sem_permissao';
    else if (/timeout|ECONNABORTED|ETIMEDOUT/i.test(msg)) motivo = 'gemini_timeout';
    return { pcm: null, motivo, detalhe: msg.slice(0, 200) };
  }
}

/**
 * Sintetiza a fala do agente e devolve PCM 16 kHz mono pronto para o motor.
 *
 * `IAP_TTS_ENGINE` escolhe o motor: `auto` (padrao) tenta edge-tts e cai no
 * Gemini; `edge`/`gemini` forcam um so' (util para testar e para quem tem
 * preferencia).
 *
 * @param {string} texto
 * @param {object} [opts]
 * @param {string} [opts.apiKey] chave do Gemini (fallback)
 * @returns {Promise<{ ok: boolean, pcm?: Float32Array, fonte?: string, motivo?: string }>}
 */
export async function sintetizarFala(texto, { apiKey } = {}) {
  const limpo = String(texto || '').trim();
  if (!limpo) return { ok: false, motivo: 'texto_vazio' };

  const motor = String(process.env.IAP_TTS_ENGINE || 'auto').toLowerCase();
  // `IAP_TTS_EDGE=off` desliga o edge-tts mesmo no `auto` — util para quem so'
  // quer o Gemini e para testar o caminho de falha de forma deterministica.
  const edgeDesativado = ['off', '0', 'false', 'nao', 'não'].includes(
    String(process.env.IAP_TTS_EDGE || '').trim().toLowerCase()
  );
  const tentarEdge = (motor === 'auto' || motor === 'edge') && !edgeDesativado;
  const tentarGemini = motor === 'auto' || motor === 'gemini';

  // Motivo pelo qual o edge-tts nao foi usado (vai no erro, se o Gemini
  // tambem falhar — sem isto, "caiu no Gemini" fica sem causa).
  let falhaEdge = edgeDesativado ? 'edge_desativado' : null;

  // 1) edge-tts -> MP3 -> ffmpeg reamostra para 16 kHz.
  if (tentarEdge) {
    const mp3 = await sintetizarEdge(limpo);
    if (mp3 && mp3.length) {
      const pcm = await converterPara16k(mp3);
      if (pcm && pcm.length) return { ok: true, pcm, fonte: 'edge-tts' };
      // O edge-tts gerou o MP3 mas o ffmpeg nao converteu — pista importante.
      falhaEdge = 'ffmpeg_faltando';
    } else {
      falhaEdge = 'edge_indisponivel';
    }
    // `edge` sozinho: o chamador pediu so' ele, entao nao cai no Gemini.
    if (motor === 'edge') return { ok: false, motivo: falhaEdge };
  }

  // 2) Gemini TTS -> PCM 24 kHz -> reamostra.
  if (tentarGemini) {
    const g = await sintetizarGemini(limpo, apiKey);
    const pcm24 = g?.pcm;
    if (pcm24 && pcm24.length) {
      const pcm = await resamplePcm(pcm24, 24000, TAXA_MOTOR);
      if (pcm && pcm.length) {
        // O Gemini salvou a fala, mas o motivo do edge importa: se for
        // `edge_indisponivel`, instalar o edge-tts tira a dependencia.
        return { ok: true, pcm, fonte: 'gemini-tts', motivoEdge: falhaEdge };
      }
      return { ok: false, motivo: 'ffmpeg_faltando', ...(falhaEdge ? { motivoEdge: falhaEdge } : {}) };
    }
    // O Gemini FALHOU: o motivo dele e' a informacao util (modelo aposentado,
    // chave, limite...). Antes ele era mascarado pelo motivo do edge, e o dono
    // via `edge_indisponivel` mesmo quando o edge nao tinha nada a ver.
    return {
      ok: false,
      motivo: g?.motivo || 'tts_indisponivel',
      ...(falhaEdge ? { motivoEdge: falhaEdge } : {}),
      ...(g?.detalhe ? { detalhe: g.detalhe } : {})
    };
  }

  return { ok: false, motivo: falhaEdge || 'tts_indisponivel' };
}

/**
 * Converte um arquivo de audio (mp3/ogg/wav) em PCM float 16 kHz mono, via
 * ffmpeg. Entra e sai por pipe -- nada fica no disco alem do arquivo de origem.
 * @param {Buffer} arquivo
 * @returns {Promise<Float32Array|null>}
 */
export function converterPara16k(arquivo) {
  return new Promise((resolve) => {
    let proc;
    try {
      proc = spawn(process.env.FFMPEG_PATH || 'ffmpeg', [
        '-hide_banner', '-loglevel', 'error',
        '-i', 'pipe:0',
        '-f', 'f32le', '-ar', String(TAXA_MOTOR), '-ac', '1', 'pipe:1'
      ], { stdio: ['pipe', 'pipe', 'ignore'] });
    } catch {
      resolve(null);
      return;
    }
    const pedacos = [];
    let terminou = false;
    const encerrar = (v) => { if (!terminou) { terminou = true; clearTimeout(timer); resolve(v); } };
    const timer = setTimeout(() => { try { proc.kill('SIGKILL'); } catch { /* ok */ } encerrar(null); }, 60000);
    proc.on('error', () => encerrar(null));
    proc.stdout.on('data', (d) => pedacos.push(d));
    proc.stdout.on('end', () => {
      const b = Buffer.concat(pedacos);
      const n = Math.floor(b.length / 4);
      const pcm = new Float32Array(n);
      for (let i = 0; i < n; i++) pcm[i] = b.readFloatLE(i * 4);
      encerrar(n ? pcm : null);
    });
    try {
      proc.stdin.on('error', () => { /* EPIPE */ });
      proc.stdin.end(arquivo);
    } catch { encerrar(null); }
  });
}

/** Voz e modelo em uso (diagnostico/testes). */
export function configTts() {
  return { vozEdge: vozEdge(), modeloGemini: MODELO_TTS, vozGemini: VOZ_GEMINI };
}
