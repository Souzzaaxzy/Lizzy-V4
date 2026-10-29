/**
 * Ligação do agente de voz (`!iap`) com as peças reais do bot.
 *
 * O `iapVoice.js` tem o MOTOR do agente (VAD, barge-in, fila) e nao conhece
 * ninguem: recebe `falar`/`pensar`/`transcrever`/`sintetizar`. Este modulo faz a
 * unica coisa que falta -- injetar as dependencias REAIS:
 *
 *   transcrever -> iapStt  (Groq Whisper, a chave do `!keygroq`)
 *   pensar      -> groqClient (Groq, o MESMO provedor e chave)
 *   sintetizar  -> iapTts (edge-tts; Gemini TTS como reserva)
 *   falar       -> callMedia.falarNaCallDoGrupo (o motor, `feedLiveAudio`)
 *
 * Fica separado do `index.js` para o fluxo poder ser testado sem importar o
 * arquivo de 36k linhas (que abre conexao de verdade no import).
 */

import * as ia from '../funcs/private/ia.js';
import { groqChat } from './groqClient.js';
import { transcreverPcm, chaveGroq } from './iapStt.js';
import { sintetizarFala } from './iapTts.js';
import { iap, promptDoSistema } from './iapVoice.js';
import {
  aoOuvirAudioDaCall,
  modoAudioExternoDaCall,
  falarNaCallDoGrupo
} from '../funcs/utils/callMedia.js';

/** Log do agente, com o prefixo do sistema de call (filtravel). */
function logIap(msg, extra) {
  const detalhe = extra ? ` | ${JSON.stringify(extra)}` : '';
  console.log(`🎙️ [IAP] ${msg}${detalhe}`);
}

/**
 * A chave do Gemini em uso (a mesma que o `!key` grava).
 *
 * Ainda existe para o TTS de RESERVA (o edge-tts e' o principal). O STT e o LLM
 * do `!iap` NAO a usam mais — os dois vao pelo Groq.
 */
function chaveGemini() {
  try {
    if (typeof ia.getGeminiApiKey === 'function') return ia.getGeminiApiKey();
  } catch { /* cai no env */ }
  return process.env.GEMINI_API_KEY || '';
}

/**
 * O LLM do agente: texto -> resposta.
 *
 * **Groq** (`openai/gpt-oss-120b`), na mesma chave do `!keygroq`. O Gemini foi
 * removido daqui junto com o STT (pedido do dono): os dois lados do `!iap`
 * passam pelo mesmo provedor, sem dividir cota com os outros comandos.
 *
 * O historico entra como mensagens anteriores, para o agente lembrar do assunto.
 *
 * @param {string} texto
 * @param {Array<{role:string, content:string}>} historico
 * @param {object} [opts]
 * @param {string} [opts.personalidade]
 * @param {string} [opts.botName]
 * @returns {Promise<string>}
 */
export async function pensarComIa(texto, historico = [], { personalidade, botName } = {}) {
  const sistema = promptDoSistema({ botName, personalidade });
  const r = await groqChat({
    texto,
    sistema,
    historico: historico.map((h) => ({ role: h.role, content: h.content }))
  });
  if (!r.ok) {
    logIap(`LLM falhou: ${r.motivo}`, {
      detalhe: r.detalhe ? String(r.detalhe).slice(0, 200) : undefined
    });
    return '';
  }
  return r.texto || '';
}

/**
 * Liga o agente de voz no grupo.
 *
 * @param {string} grupo
 * @param {object} [opts]
 * @param {string} [opts.botName]
 * @param {string} [opts.personalidade]
 * @returns {Promise<{ ok: boolean, motivo?: string }>}
 */
export async function ligarIap(grupo, { botName, personalidade } = {}) {
  // O `!iap` inteiro roda no Groq (ouvir E pensar): sem a chave dele nao ha' o
  // que ligar. Antes esta checagem era da chave do Gemini.
  if (!chaveGroq()) return { ok: false, motivo: 'sem_chave_groq' };

  // O modo de audio externo precisa estar ligado, senao o motor ignora o que
  // chega por `feedLiveAudio` e volta a tocar o arquivo pre-carregado.
  const ligouExterno = await modoAudioExternoDaCall(grupo, true);
  if (!ligouExterno) return { ok: false, motivo: 'sem_call' };

  // O agente OUVE pelo callback do motor.
  const registrou = await aoOuvirAudioDaCall(grupo, (g, pcm) => iap.receber(g, pcm));
  if (!registrou) {
    await modoAudioExternoDaCall(grupo, false);
    return { ok: false, motivo: 'sem_call' };
  }

  iap.ligar(grupo, {
    log: logIap,
    pensar: (texto, historico) => pensarComIa(texto, historico, { botName, personalidade }),
    transcrever: async (pcm) => {
      const r = await transcreverPcm(pcm, { apiKey: chaveGroq() });
      if (!r.ok) {
        // O MOTIVO tem de aparecer: antes daqui saia um `null` mudo e o log
        // dizia so' "sem fala reconhecida" para QUALQUER causa (chave, limite,
        // formato, audio vazio). Era impossivel diagnosticar.
        logIap(`STT falhou: ${r.motivo}`, {
          grupo,
          detalhe: r.detalhe ? String(r.detalhe).slice(0, 200) : undefined,
          modelo: r.modelo
        });
        return null;
      }
      return r.texto;
    },
    sintetizar: async (texto) => {
      const r = await sintetizarFala(texto, { apiKey: chaveGemini() });
      return r.ok ? r.pcm : null;
    },
    falar: (pcm) => { void falarNaCallDoGrupo(grupo, pcm); }
  });

  logIap('ligado', { grupo });
  return { ok: true };
}

/**
 * Desliga o agente de voz do grupo e limpa o que ele registrou.
 *
 * @param {string} grupo
 * @returns {Promise<boolean>} `true` se havia um agente ligado
 */
export async function desligarIap(grupo) {
  const havia = iap.desligar(grupo);
  try { await aoOuvirAudioDaCall(grupo, null); } catch { /* ok */ }
  try { await modoAudioExternoDaCall(grupo, false); } catch { /* ok */ }
  if (havia) logIap('desligado', { grupo });
  return havia;
}

/** Estado do agente no grupo (para o comando mostrar). */
export function estadoIap(grupo) {
  const st = iap.estado(grupo);
  if (!st) return st;
  // O `!iap` roda INTEIRO no Groq (ouvir e pensar) — o dono precisa ver isso,
  // e se a chave esta' presente.
  return {
    ...st,
    stt: chaveGroq() ? 'groq' : 'nenhum',
    llm: chaveGroq() ? 'groq' : 'nenhum',
    reservaGroq: Boolean(chaveGroq())
  };
}

/** Desliga todos os agentes (a call caiu: o `index.js` chama isto). */
export function desligarTodosIap() {
  iap.desligarTudo();
}
