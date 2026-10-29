/**
 * STT do `!iap` e do `!transcrever` — **só Groq Whisper**.
 *
 * ## Por que só Groq (pedido do dono)
 *
 * O Gemini foi removido destes dois comandos: ele estourava o tempo no audio
 * (o modelo e' um generativo fazendo trabalho de transcricao) e a cota dele era
 * dividida entre OUVIR e PENSAR. Com o Groq o dono confirmou que funcionou.
 *
 * A API e' **OpenAI-compativel**; os detalhes (formato do arquivo, erros) vivem
 * no `groqClient.js` — este modulo so' faz a ponte do PCM do motor de call.
 *
 * ## O que entra
 *
 * PCM 16 kHz mono (`Float32Array`), o mesmo formato que o motor entrega. Vira
 * WAV antes de sair (o cabecalho e' o que diz a taxa e os canais).
 */

import {
  groqTranscrever,
  chaveGroq,
  extensaoDoAudio,
  extensaoPorConteudo,
  normalizarParaGroq,
  setGroqHttpForTest,
  configGroq
} from './groqClient.js';
import { pcmParaWav, TAXA_MOTOR } from './iapAudio.js';

/** Re-export: o `!transcrever` usa este caminho (arquivo ja' baixado). */
export { groqTranscrever as transcreverArquivoGroq };
export { extensaoDoAudio, extensaoPorConteudo, normalizarParaGroq };

/**
 * Troca o cliente HTTP (teste) — repassa ao seam do `groqClient`.
 * @param {null|Function} fn
 */
export function setIapHttpForTest(fn) {
  setGroqHttpForTest(fn);
}

/**
 * Transcreve um bloco de PCM 16 kHz mono pelo Groq Whisper.
 *
 * @param {Float32Array} pcm
 * @param {object} [opts]
 * @param {string} [opts.apiKey] chave do Groq (padrao: a configurada)
 * @returns {Promise<{ ok: boolean, texto?: string, motivo?: string, detalhe?: string, fonte?: string, modelo?: string }>}
 */
export async function transcreverPcm(pcm, { apiKey } = {}) {
  if (!pcm || !pcm.length) return { ok: false, motivo: 'audio_vazio' };

  const chave = apiKey || chaveGroq();
  if (!chave) return { ok: false, motivo: 'sem_chave_groq' };

  // O WAV gerado tem cabecalho, entao o mimetype certo e' audio/wav — e o
  // cliente ainda confere o magic byte antes de enviar.
  const wav = pcmParaWav(pcm, TAXA_MOTOR);
  const r = await groqTranscrever(wav, 'audio/wav');
  return r.ok ? { ...r, fonte: 'groq' } : r;
}

/** O modelo em uso (diagnostico/testes). */
export function modeloStt() {
  return configGroq().stt;
}

/** A chave do Groq (re-export). */
export { chaveGroq };
