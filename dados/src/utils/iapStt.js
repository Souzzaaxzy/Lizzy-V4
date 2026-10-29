/**
 * STT do `!iap` (e do `!transcrever`) -- audio vira texto.
 *
 * ## Dois provedores, nesta ordem
 *
 * 1. **Gemini** (principal) — usa a chave do `!key`, a mesma dos outros comandos
 *    de IA. A requisicao vai pela **cadeia de modelos** do `ia.js`.
 * 2. **Groq Whisper** (reserva) — `whisper-large-v3-turbo` numa API compativel
 *    com OpenAI. So' entra quando o Gemini falha (timeout/rede/limite), o que
 *    garante que o agente nao fique mudo por causa de um provedor.
 *
 * ## O que foi MEDIDO nos logs do dono (e o que cada correcao resolve)
 *
 *     [Gemini API] modelo "gemini-2.5-flash" indisponível; tentando o próximo.
 *     [TRANSCREVER] falhou | motivo=rede | timeout of 90000ms exceeded
 *
 * - `motivo=rede` (nao `chave`) provou que a chave esta' OK — o que falha e' o
 *   TEMPO. O audio ia INTEIRO inline e o modelo padrao gasta tempo "pensando"
 *   antes de transcrever;
 * - o PRIMEIRO modelo da cadeia (`gemini-2.5-flash`) ja' deu 404, gastando uma
 *   rodada antes de chegar no que funciona.
 *
 * Correcoes: o modelo **preferido virou o alias rolante** (`gemini-flash-latest`,
 * que nao envelhece), o **thinking foi DESLIGADO** na transcricao
 * (`thinkingBudget: 0` — transcrever nao precisa de raciocinio, e a doc marca o
 * thinking como o caminho da LATENCIA), o timeout subiu e o **Groq entra como
 * reserva**.
 *
 * ## O que entra
 *
 * PCM 16 kHz mono (`Float32Array`), o mesmo formato que o motor entrega. Vira
 * WAV antes de sair (o cabecalho e' o que diz a taxa e os canais).
 */

import axios from 'axios';
import * as ia from '../funcs/private/ia.js';
import { pcmParaWav, TAXA_MOTOR } from './iapAudio.js';

/**
 * Modelo PREFERIDO do Gemini.
 *
 * O alias rolante (`gemini-flash-latest`) aponta para a release atual e NAO
 * envelhece — usar `gemini-2.5-flash` aqui custava uma rodada 404 antes de
 * achar um modelo bom (medido no log do dono).
 */
const MODELO_STT = process.env.IAP_STT_MODEL || 'gemini-flash-latest';

/** Modelo da reserva (Groq). */
const MODELO_GROQ = process.env.IAP_GROQ_STT_MODEL || 'whisper-large-v3-turbo';

/** Prompt da transcricao: so' o texto, sem comentario. */
const PROMPT_STT = 'Transcreva o audio a seguir em portugues do Brasil. '
  + 'Retorne APENAS a transcricao, sem comentarios, sem marcacoes e sem prefixo. '
  + 'Se nao houver fala inteligivel, retorne uma linha vazia.';

/** Teto de tempo do Gemini por modelo. Audio curto nao deveria passar disso. */
const TIMEOUT_GEMINI_MS = Number.parseInt(process.env.IAP_STT_TIMEOUT_MS || '45000', 10);

/** Teto de tempo do Groq. */
const TIMEOUT_GROQ_MS = Number.parseInt(process.env.IAP_GROQ_TIMEOUT_MS || '45000', 10);

/** Injetavel para os testes. */
let _httpPost = null;

/**
 * Troca o cliente HTTP (teste). Reusa o MESMO seam do `ia.js`, para a cadeia de
 * modelos ser exercitada sem rede.
 * @param {null|Function} postFn
 * @param {null|Function} [getFn]
 */
export function setIapHttpForTest(postFn, getFn) {
  _httpPost = typeof postFn === 'function' ? postFn : null;
  try { ia.setGeminiHttpForTest?.(_httpPost, typeof getFn === 'function' ? getFn : null); } catch { /* ok */ }
}

/** Extrai o texto das partes da resposta do Gemini. */
function textoDaResposta(data) {
  const partes = data?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(partes)) return '';
  return partes.map((p) => (p && typeof p.text === 'string' ? p.text : '')).join('').trim();
}

/**
 * Chave do Groq (a reserva). Vem do `!keygroq` / `.env`.
 * @returns {string}
 */
export function chaveGroq() {
  return String(process.env.GROQ_API_KEY || '').trim();
}

/**
 * Transcreve pelo Groq Whisper (`/openai/v1/audio/transcriptions`).
 *
 * Multipart com o WAV — a API aceita 25 MB no plano gratis e devolve rapido
 * (o Whisper turbo roda ~200x o tempo real).
 *
 * @param {Buffer} wav
 * @param {string} apiKey
 * @returns {Promise<{ ok: boolean, texto?: string, motivo?: string, detalhe?: string }>}
 */
async function transcreverGroq(wav, apiKey) {
  if (!apiKey) return { ok: false, motivo: 'sem_chave_groq' };

  try {
    const form = new FormData();
    form.append('file', new Blob([wav], { type: 'audio/wav' }), 'audio.wav');
    form.append('model', MODELO_GROQ);
    form.append('language', 'pt');
    form.append('response_format', 'text');

    const config = {
      headers: { Authorization: `Bearer ${apiKey}` },
      timeout: TIMEOUT_GROQ_MS
    };
    const url = 'https://api.groq.com/openai/v1/audio/transcriptions';
    const resp = _httpPost
      ? await _httpPost(url, form, config)
      : await axios.post(url, form, config);

    // Com `response_format: text` o corpo JA' e' o texto.
    const bruto = typeof resp?.data === 'string' ? resp.data : (resp?.data?.text || '');
    const texto = String(bruto).trim();
    if (!texto) return { ok: false, motivo: 'sem_fala' };
    return { ok: true, texto };
  } catch (e) {
    const status = e?.response?.status;
    const detalhe = e?.response?.data?.error?.message || e?.message || String(e);
    if (status === 401 || status === 403) return { ok: false, motivo: 'chave_groq', detalhe };
    if (status === 429) return { ok: false, motivo: 'limite', detalhe };
    if (!status || e?.code === 'ECONNABORTED' || e?.code === 'ETIMEDOUT') {
      return { ok: false, motivo: 'rede', detalhe };
    }
    return { ok: false, motivo: 'falha', detalhe };
  }
}

/**
 * Transcreve um ARQUIVO de audio (ja' baixado) pelo Groq Whisper.
 *
 * E' a porta que o `!transcrever` usa: ele tem o arquivo original do WhatsApp,
 * nao o PCM — entao nao passa por `transcreverPcm`.
 *
 * @param {Buffer} arquivo bytes do audio
 * @param {string} [mimeType]
 * @returns {Promise<{ ok: boolean, texto?: string, motivo?: string, detalhe?: string }>}
 */
export async function transcreverArquivoGroq(arquivo, mimeType = 'audio/ogg') {
  if (!arquivo || !arquivo.length) return { ok: false, motivo: 'audio_vazio' };
  const apiKey = chaveGroq();
  if (!apiKey) return { ok: false, motivo: 'sem_chave_groq' };

  try {
    const form = new FormData();
    form.append('file', new Blob([arquivo], { type: mimeType }), 'audio');
    form.append('model', MODELO_GROQ);
    form.append('language', 'pt');
    form.append('response_format', 'text');

    const config = {
      headers: { Authorization: `Bearer ${apiKey}` },
      timeout: TIMEOUT_GROQ_MS
    };
    const url = 'https://api.groq.com/openai/v1/audio/transcriptions';
    const resp = _httpPost
      ? await _httpPost(url, form, config)
      : await axios.post(url, form, config);

    const bruto = typeof resp?.data === 'string' ? resp.data : (resp?.data?.text || '');
    const texto = String(bruto).trim();
    if (!texto) return { ok: false, motivo: 'sem_fala' };
    return { ok: true, texto };
  } catch (e) {
    const status = e?.response?.status;
    const detalhe = e?.response?.data?.error?.message || e?.message || String(e);
    if (status === 401 || status === 403) return { ok: false, motivo: 'chave_groq', detalhe };
    if (status === 429) return { ok: false, motivo: 'limite', detalhe };
    if (!status || e?.code === 'ECONNABORTED' || e?.code === 'ETIMEDOUT') {
      return { ok: false, motivo: 'rede', detalhe };
    }
    return { ok: false, motivo: 'falha', detalhe };
  }
}

/**
 * Transcreve um bloco de PCM 16 kHz mono.
 *
 * Ordem: **Gemini** (a chave do `!key`) e, se ele falhar, **Groq Whisper**
 * (a chave do `!keygroq`). Assim um provedor fora do ar nao deixa o agente mudo.
 *
 * @param {Float32Array} pcm
 * @param {object} [opts]
 * @param {string} [opts.apiKey] chave do Gemini
 * @param {string} [opts.groqKey] chave do Groq (reserva)
 * @param {string} [opts.modelo]
 * @returns {Promise<{ ok: boolean, texto?: string, motivo?: string, detalhe?: string, fonte?: string, modelo?: string }>}
 */
export async function transcreverPcm(pcm, { apiKey, groqKey, modelo = MODELO_STT } = {}) {
  if (!pcm || !pcm.length) return { ok: false, motivo: 'audio_vazio' };

  const wav = pcmParaWav(pcm, TAXA_MOTOR);

  // ---- 1) Gemini ----------------------------------------------------------
  if (apiKey) {
    const r = await ia.geminiRequestMultimodal({
      apiKey,
      modelo,
      timeoutMs: TIMEOUT_GEMINI_MS,
      corpo: {
        contents: [{
          parts: [
            { text: PROMPT_STT },
            { inlineData: { mimeType: 'audio/wav', data: wav.toString('base64') } }
          ]
        }],
        // TRANSCREVER NAO PRECISA DE RACIOCINIO. Desligar o thinking corta a
        // latencia (era o timeout de 90s) sem perder qualidade na transcricao.
        generationConfig: { thinkingConfig: { thinkingBudget: 0 } }
      }
    });

    if (r.ok) {
      const texto = textoDaResposta(r.data);
      if (texto) return { ok: true, texto, fonte: 'gemini', modelo: r.modeloUsado };
      // Respondeu OK mas sem texto: o audio nao tinha fala. Nao e' falha de
      // provedor — nao adianta tentar o Groq.
      return { ok: false, motivo: 'sem_fala', fonte: 'gemini', modelo: r.modeloUsado };
    }

    // Falha do Gemini: tenta a reserva ANTES de desistir.
    const reserva = await transcreverGroq(wav, groqKey || chaveGroq());
    if (reserva.ok) return { ...reserva, fonte: 'groq' };

    // Nenhum dos dois: devolve o motivo do Gemini (o principal) + o da reserva.
    return {
      ok: false,
      motivo: r.motivo,
      detalhe: `${r.detalhe || ''}${reserva.motivo ? ` | groq: ${reserva.motivo}` : ''}`.trim(),
      fonte: 'gemini'
    };
  }

  // ---- 2) Sem chave do Gemini: so' a reserva -------------------------------
  if (!apiKey && (groqKey || chaveGroq())) {
    const reserva = await transcreverGroq(wav, groqKey || chaveGroq());
    return reserva.ok ? { ...reserva, fonte: 'groq' } : reserva;
  }

  return { ok: false, motivo: 'sem_chave' };
}

/** O modelo preferido (diagnostico/testes). */
export function modeloStt() {
  return MODELO_STT;
}

/** O modelo da reserva (diagnostico/testes). */
export function modeloGroq() {
  return MODELO_GROQ;
}
