/**
 * STT do `!iap` -- audio da call vira texto.
 *
 * ## Por que Gemini
 *
 * O bot JA' transcreve audio pelo Gemini (o `!transcrever` manda o arquivo como
 * `inlineData`). Reusar o mesmo caminho significa: uma chave so' (`!key`), um
 * provedor so', e nenhum modelo novo para baixar.
 *
 * ## O BUG que isto corrige (o agente ficava mudo)
 *
 * A primeira versao chamava o endpoint DIRETO, com um nome de modelo FIXO
 * (`gemini-2.5-flash`). Quando o Google aposenta um nome para contas novas
 * (*"no longer available to new users"*), TODA transcricao vira 404 — e o
 * agente simplesmente nao ouve. Pior: o chamador descartava o motivo, entao o
 * log dizia so' "sem fala reconhecida", sem dizer POR QUE.
 *
 * Agora a requisicao vai pela **cadeia de modelos do `ia.js`**
 * (`geminiRequestMultimodal`): modelo pedido -> aliases rolantes -> descobertos
 * na conta -> lista estatica. Um rename do Google nao derruba mais — e o motivo
 * real (sem chave / modelo indisponivel / limite / falha) SOBE para o log.
 *
 * ## O que entra
 *
 * PCM 16 kHz mono (`Float32Array`), o mesmo formato que o motor entrega. Vira
 * WAV antes de sair -- o Gemini aceita `audio/wav` e o cabecalho e' o que diz a
 * ele a taxa e o numero de canais.
 */

import * as ia from '../funcs/private/ia.js';
import { pcmParaWav, TAXA_MOTOR } from './iapAudio.js';

/** Modelo PREFERIDO da transcricao (a cadeia cobre se ele nao existir). */
const MODELO_STT = process.env.IAP_STT_MODEL || 'gemini-2.5-flash';

/** Prompt da transcricao: so' o texto, sem comentario. */
const PROMPT_STT = 'Transcreva o audio a seguir em portugues do Brasil. '
  + 'Retorne APENAS a transcricao, sem comentarios, sem marcacoes e sem prefixo. '
  + 'Se nao houver fala inteligivel, retorne uma linha vazia.';

/** Injetavel para os testes (repassa ao seam do `ia.js`). */
let _httpPost = null;
let _httpGet = null;

/**
 * Troca o cliente HTTP (teste). Reusa o MESMO seam do `ia.js`, para a cadeia de
 * modelos ser exercitada sem rede.
 * @param {null|Function} postFn
 * @param {null|Function} [getFn]
 */
export function setIapHttpForTest(postFn, getFn) {
  _httpPost = typeof postFn === 'function' ? postFn : null;
  _httpGet = typeof getFn === 'function' ? getFn : null;
  try { ia.setGeminiHttpForTest?.(_httpPost, _httpGet); } catch { /* ok */ }
}

/** Extrai o texto das partes da resposta do Gemini. */
function textoDaResposta(data) {
  const partes = data?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(partes)) return '';
  return partes.map((p) => (p && typeof p.text === 'string' ? p.text : '')).join('').trim();
}

/**
 * Transcreve um bloco de PCM 16 kHz mono.
 *
 * @param {Float32Array} pcm
 * @param {object} [opts]
 * @param {string} [opts.apiKey] chave do Gemini (vem do `!key` via `ia.js`)
 * @param {string} [opts.modelo]
 * @returns {Promise<{ ok: boolean, texto?: string, motivo?: string, detalhe?: string, modelo?: string }>}
 */
export async function transcreverPcm(pcm, { apiKey, modelo = MODELO_STT } = {}) {
  if (!apiKey) return { ok: false, motivo: 'sem_chave' };
  if (!pcm || !pcm.length) return { ok: false, motivo: 'audio_vazio' };

  const wav = pcmParaWav(pcm, TAXA_MOTOR);

  // A CADEIA de modelos vem do `ia.js` — a mesma dos comandos de IA. Sem isto,
  // um nome aposentado pelo Google derruba a transcricao inteira (o bug).
  const r = await ia.geminiRequestMultimodal({
    apiKey,
    modelo,
    corpo: {
      contents: [{
        parts: [
          { text: PROMPT_STT },
          { inlineData: { mimeType: 'audio/wav', data: wav.toString('base64') } }
        ]
      }]
    },
    timeoutMs: 60000
  });

  if (!r.ok) return { ok: false, motivo: r.motivo, detalhe: r.detalhe };

  const texto = textoDaResposta(r.data);
  // Resposta OK mas sem texto: o modelo nao achou fala (ou o audio nao tinha).
  if (!texto) return { ok: false, motivo: 'sem_fala', modelo: r.modeloUsado };
  return { ok: true, texto, modelo: r.modeloUsado };
}

/** O modelo preferido (diagnostico/testes). */
export function modeloStt() {
  return MODELO_STT;
}
