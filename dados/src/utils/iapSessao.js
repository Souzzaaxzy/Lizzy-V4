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
import { iap } from './iapVoice.js';
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
 * Monta o prompt de sistema do agente de voz.
 *
 * Junta duas coisas:
 *  1. o **prompt da personalidade** (`ia.promptDaPersonalidade`) — o mesmo do
 *     chat, para o agente falar com o jeito configurado no grupo;
 *  2. o **contexto da call** — quem está na chamada e quem é o dono.
 *
 * ## O ajuste para VOZ
 *
 * O prompt do chat foi escrito para TEXTO (pode ser longo). Na call a fala é
 * lida em voz alta, então acrescentamos as regras de fala: frases curtas, sem
 * emoji/markdown e sem listas.
 *
 * ## Sobre reconhecer o dono
 *
 * O áudio chega **mixado** (o motor não diz quem falou), então o agente não sabe
 * QUAL pessoa disse a frase — mas sabe QUEM está na call. O contexto deixa o
 * dono explícito, então "quem é o dono?" e "o que você faz?" têm resposta certa.
 *
 * @param {object} opts
 * @param {string} [opts.personalidade]
 * @param {string} [opts.botName]
 * @param {string} [opts.nomeDono]
 * @param {string[]} [opts.participantes]
 * @returns {string}
 */
export function montarSistemaDoAgente({ personalidade, botName, nomeDono, participantes = [] } = {}) {
  const base = (() => {
    try {
      const p = ia.promptDaPersonalidade?.(personalidade || 'abyss');
      if (typeof p === 'string' && p.trim()) return p.trim();
    } catch { /* cai no generico */ }
    return `Voce e' ${botName || 'o bot'}, um assistente de voz numa chamada de grupo do WhatsApp.`;
  })();

  const contexto = [];
  contexto.push('--- CONTEXTO DESTA CONVERSA ---');
  contexto.push('Voce esta FALANDO numa CHAMADA DE VOZ de um grupo do WhatsApp. Sua resposta sera lida em voz alta.');
  contexto.push('Responda em portugues do Brasil, em frases CURTAS e naturais de fala (2 a 3 no maximo).');
  contexto.push('NUNCA use emojis, markdown, asteriscos ou listas — apenas o texto falado.');
  contexto.push('Se nao entender ou o audio estiver inaudivel, diga apenas que nao entendeu.');
  if (nomeDono) {
    contexto.push(`O DONO do bot se chama ${nomeDono}. Trate-o com respeito e deferencia — ele e' quem manda.`);
  }
  if (Array.isArray(participantes) && participantes.length) {
    const nomes = participantes.filter(Boolean).slice(0, 20).join(', ');
    if (nomes) contexto.push(`Quem esta na chamada agora: ${nomes}.`);
  }
  contexto.push('Como o audio da chamada chega misturado, voce NAO sabe qual pessoa falou cada frase — nao invente de quem foi.');

  return `${base}\n\n${contexto.join('\n')}`;
}

/**
 * O LLM do agente: texto -> resposta.
 *
 * **Groq** (`openai/gpt-oss-120b`), na mesma chave do `!keygroq`.
 *
 * ## A personalidade é a MESMA do chat
 *
 * Usa `ia.promptDaPersonalidade(...)` — o prompt que a assistente do chat já usa
 * (`abyss`/`humana`/`ia`/`pro`). Antes daqui saía um prompt genérico próprio, e o
 * agente respondia sem graça ("Oi! Como posso ajudar?"), ignorando a
 * personalidade configurada no grupo.
 *
 * ## O agente SABE com quem está falando
 *
 * O motor entrega o áudio **mixado** da call, sem dizer quem falou — então o
 * agente não consegue atribuir a fala a uma pessoa. O que ele **sabe** é quem
 * está na chamada: o `contexto` recebe os participantes e o dono, e o prompt
 * deixa isso explícito. É o suficiente para tratar o dono como dono.
 *
 * @param {string} texto
 * @param {Array<{role:string, content:string}>} historico
 * @param {object} [opts]
 * @param {string} [opts.personalidade] `abyss` | `humana` | `ia` | `pro`
 * @param {string} [opts.botName]
 * @param {string} [opts.nomeDono]
 * @param {string[]} [opts.participantes] nomes de quem está na call
 * @returns {Promise<string>}
 */
export async function pensarComIa(texto, historico = [], {
  personalidade, botName, nomeDono, participantes = []
} = {}) {
  const sistema = montarSistemaDoAgente({ personalidade, botName, nomeDono, participantes });
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
 * @param {string} [opts.personalidade] `abyss` | `humana` | `ia` | `pro`
 * @param {string} [opts.nomeDono]
 * @param {string[]} [opts.participantes]
 * @returns {Promise<{ ok: boolean, motivo?: string }>}
 */
export async function ligarIap(grupo, { botName, personalidade, nomeDono, participantes } = {}) {
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
    pensar: (texto, historico) => pensarComIa(texto, historico, {
      botName, personalidade, nomeDono, participantes
    }),
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
      if (!r.ok) {
        // Sem isto o TTS falho era MUDO: o agente simplesmente nao falava e o
        // log parava no "respondeu", sem dizer por que.
        logIap(`TTS falhou: ${r.motivo}`, { grupo });
        return null;
      }
      // A FONTE importa: `edge-tts` (local, principal) ou `gemini-tts`
      // (reserva). Se caiu no Gemini, o motivo do edge vai junto — e' o que diz
      // se falta instalar o edge-tts (`pip install edge-tts`) ou o ffmpeg.
      logIap(`TTS ok (${r.fonte})`, {
        grupo,
        segundos: r.pcm ? +(r.pcm.length / 16000).toFixed(1) : 0,
        ...(r.motivoEdge ? { motivoEdge: r.motivoEdge } : {})
      });
      return r.pcm;
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
