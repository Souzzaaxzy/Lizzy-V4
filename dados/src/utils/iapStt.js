/**
 * STT do `!iap` -- audio da call vira texto.
 *
 * ## Por que Gemini
 *
 * O bot JA' transcreve audio pelo Gemini (o `!transcrever` manda o arquivo como
 * `inlineData`). Reusar o mesmo caminho significa: uma chave so' (`!key`), um
 * provedor so', e nenhum modelo novo para baixar. O `ia.js` ja' cuida da
 * descoberta de modelos e do fallback quando o Google renomeia algo.
 *
 * ## O que entra
 *
 * PCM 16 kHz mono (`Float32Array`), o mesmo formato que o motor entrega. Vira
 * WAV antes de sair -- o Gemini aceita `audio/wav` e o cabecalho e' o que diz a
 * ele a taxa e o numero de canais.
 */

import axios from 'axios';
import { pcmParaWav, TAXA_MOTOR } from './iapAudio.js';

/** Modelo padrao da transcricao. */
const MODELO_STT = process.env.IAP_STT_MODEL || 'gemini-2.5-flash';

/** Prompt da transcricao: so' o texto, sem comentario. */
const PROMPT_STT = 'Transcreva o audio a seguir em portugues do Brasil. '
  + 'Retorne APENAS a transcricao, sem comentarios, sem marcacoes e sem prefixo. '
  + 'Se nao houver fala inteligivel, retorne uma linha vazia.';

/** HTTP injetavel para os testes (sem rede). */
let _http = null;

/**
 * Troca o cliente HTTP (teste).
 * @param {null|Function} fn
 */
export function setIapHttpForTest(fn) {
  _http = fn;
}

const post = (url, data, config) => (_http ? _http(url, data, config) : axios.post(url, data, config));

/**
 * Transcreve um bloco de PCM 16 kHz mono.
 *
 * @param {Float32Array} pcm
 * @param {object} opts
 * @param {string} opts.apiKey chave do Gemini (vem do `!key` via `ia.js`)
 * @param {string} [opts.modelo]
 * @returns {Promise<{ ok: boolean, texto?: string, motivo?: string }>}
 */
export async function transcreverPcm(pcm, { apiKey, modelo = MODELO_STT } = {}) {
  if (!apiKey) return { ok: false, motivo: 'sem_chave' };
  if (!pcm || !pcm.length) return { ok: false, motivo: 'audio_vazio' };

  const wav = pcmParaWav(pcm, TAXA_MOTOR);
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelo)}:generateContent`;

  try {
    const resposta = await post(url, {
      contents: [{
        parts: [
          { text: PROMPT_STT },
          { inlineData: { mimeType: 'audio/wav', data: wav.toString('base64') } }
        ]
      }]
    }, {
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      timeout: 60000
    });

    const partes = resposta?.data?.candidates?.[0]?.content?.parts;
    const texto = Array.isArray(partes)
      ? partes.map((p) => (p && typeof p.text === 'string' ? p.text : '')).join('').trim()
      : '';

    if (!texto) return { ok: false, motivo: 'sem_fala' };
    return { ok: true, texto };
  } catch (e) {
    const status = e?.response?.status;
    // 401/403 = chave; o chamador mostra a orientacao do `!key`.
    const motivo = status === 401 || status === 403
      ? 'chave_invalida'
      : status === 429 ? 'limite' : 'falha';
    return { ok: false, motivo, detalhe: e?.response?.data?.error?.message || e?.message };
  }
}

/** O modelo em uso (diagnostico/testes). */
export function modeloStt() {
  return MODELO_STT;
}
