/**
 * Ligação do agente de voz (`!iap`) com as peças reais do bot.
 *
 * O `iapVoice.js` tem o MOTOR do agente (VAD, barge-in, fila) e não conhece
 * ninguém: recebe `falar`/`pensar`/`transcrever`/`sintetizar`. Este módulo faz a
 * única coisa que falta — injetar as dependências REAIS:
 *
 *   transcrever -> iapStt  (Groq Whisper, a chave do `!keygroq`)
 *   pensar      -> groqClient (Groq) + a GUARDA de permissão
 *   sintetizar  -> iapTts (edge-tts; Gemini TTS como reserva)
 *   falar       -> callMedia.falarNaCallDoGrupo (o motor, `feedLiveAudio`)
 *
 * Fica separado do `index.js` para o fluxo poder ser testado sem importar o
 * arquivo de 36k linhas (que abre conexão de verdade no import).
 */

import { groqChat } from './groqClient.js';
import { transcreverPcm, chaveGroq } from './iapStt.js';
import { sintetizarFala } from './iapTts.js';
import { iap } from './iapVoice.js';
import { iaIdentidade, ehPedidoDeAcao, permitePedidoDeAcao } from './iapGuarda.js';
import {
  aoOuvirAudioDaCall,
  modoAudioExternoDaCall,
  falarNaCallDoGrupo
} from '../funcs/utils/callMedia.js';

/** Log do agente, com o prefixo do sistema de call (filtrável). */
function logIap(msg, extra) {
  const detalhe = extra ? ` | ${JSON.stringify(extra)}` : '';
  console.log(`🎙️ [IAP] ${msg}${detalhe}`);
}

/** A chave do Gemini em uso (só o TTS de reserva usa). */
function chaveGemini() {
  return process.env.GEMINI_API_KEY || '';
}

/**
 * O prompt de sistema do agente — **um só, padrão**.
 *
 * ## Decisão do dono: sem personalidade
 *
 * Antes o `!iap` usava a personalidade do grupo (`abyss`/`humana`/`ia`/`pro`).
 * O dono pediu **padrão em tudo**: uma Lizzy só, mesma voz, mesmo jeito. Então
 * aqui há **um** prompt fixo — não há mais dependência do `assistantPersonality`.
 *
 * ## O nome é LIZZY (limpo)
 *
 * O `nomebot` do config é `𝐋𝐢𝐳𝐳𝐲 𝐝𝐨 𝐩𝐫𝐢𝐯𝐲` (MATHEMATICAL BOLD). Isso é um
 * **pesadelo** para voz: o LLM pode repetir os glifos e o TTS lê errado. O nome
 * é normalizado (NFKC) e reduzido a **Lizzy** — é assim que ela se apresenta.
 *
 * @param {object} opts
 * @param {string} [opts.nomeDono]
 * @param {string[]} [opts.participantes]
 * @returns {string}
 */
export function montarSistemaDoAgente({ nomeDono, participantes = [] } = {}) {
  const nome = iaIdentidade(); // "Lizzy"

  const linhas = [
    `Voce e' ${nome}, uma assistente de voz que participa de uma CHAMADA DE VOZ de um grupo do WhatsApp.`,
    'Sua resposta sera lida em voz alta: fale como numa conversa.',
    '',
    `Seu nome e' ${nome}. E' assim que voce se chama, sempre.`,
    `Se perguntarem seu nome, responda exatamente: "Oi! Eu sou a ${nome}."`,
    `Se alguem chamar "${nome}", e' com voce.`,
    '',
    'COMO FALAR:',
    '- Portugues do Brasil, natural, em frases CURTAS (2 a 3 no maximo).',
    '- NUNCA use emojis, markdown, asteriscos ou listas — apenas o texto falado.',
    '- Nao invente fatos sobre a conversa; se nao souber, diga que nao sabe.',
    '- Se o audio estiver inaudivel, diga apenas que nao entendeu.'
  ];

  if (nomeDono) {
    linhas.push('', `O DONO do bot se chama ${nomeDono}. Trate-o com respeito e deferencia.`);
  }
  if (Array.isArray(participantes) && participantes.length) {
    const nomes = participantes.filter(Boolean).slice(0, 20).join(', ');
    if (nomes) linhas.push(`Quem esta na chamada agora: ${nomes}.`);
  }
  linhas.push('Como o audio chega misturado, voce NAO sabe qual pessoa falou cada frase — nao invente de quem foi.');

  return linhas.join('\n');
}

/**
 * O LLM do agente: texto -> resposta, COM a guarda de permissão.
 *
 * ## A guarda (o que o dono pediu)
 *
 * "um membro comum falar 'lizzy, bane alguém' — ela reconhece que não é adm nem
 * dono, nem mod e não executa nada".
 *
 * O motor entrega o áudio **por participante** (`participantAudio`), então
 * sabemos **quem falou** (`quemFalou`). Antes de responder, `permitePedidoDeAcao`
 * checa a permissão REAL daquela pessoa (admin do grupo, dono, subdono,
 * moderador). Se o pedido é de AÇÃO e a pessoa não pode, a resposta é uma
 * recusa — o LLM nem é chamado para "decidir" executar.
 *
 * @param {string} texto
 * @param {Array<{role:string, content:string}>} historico
 * @param {object} [opts]
 * @param {string} [opts.quemFalou] JID de quem falou
 * @param {string} [opts.nomeDono]
 * @param {string[]} [opts.participantes]
 * @returns {Promise<string>}
 */
export async function pensarComIa(texto, historico = [], {
  quemFalou, nomeDono, participantes = []
} = {}) {
  // ---- GUARDA: o pedido é de AÇÃO? a pessoa PODE? ------------------------
  const guarda = permitePedidoDeAcao(texto, quemFalou);
  if (!guarda.ok) {
    logIap('pedido de acao RECUSADO (sem permissao)', {
      quem: quemFalou || 'desconhecido',
      pedido: guarda.acao || undefined,
      motivo: guarda.motivo
    });
    return guarda.recusa;
  }

  const sistema = montarSistemaDoAgente({ nomeDono, participantes });
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
 * @param {string} [opts.nomeDono]
 * @param {string[]} [opts.participantes]
 * @param {function} [opts.ehAutorizado] `(jid) => boolean` — a permissão REAL
 *   da pessoa (admin/dono/subdono/mod). Vem do `index.js`, que tem o metadata.
 * @returns {Promise<{ ok: boolean, motivo?: string }>}
 */
export async function ligarIap(grupo, { nomeDono, participantes, ehAutorizado } = {}) {
  // O `!iap` inteiro roda no Groq (ouvir E pensar): sem a chave dele nao ha' o
  // que ligar.
  if (!chaveGroq()) return { ok: false, motivo: 'sem_chave_groq' };

  // O modo de audio externo precisa estar ligado, senao o motor ignora o que
  // chega por `feedLiveAudio` e volta a tocar o arquivo pre-carregado.
  const ligouExterno = await modoAudioExternoDaCall(grupo, true);
  if (!ligouExterno) return { ok: false, motivo: 'sem_call' };

  // O agente OUVE pelo callback do motor. O terceiro argumento e' QUEM FALOU
  // (audio por participante) — e' o que permite a guarda de permissao.
  const registrou = await aoOuvirAudioDaCall(grupo, (g, pcm, quemFalou) => iap.receber(g, pcm, quemFalou));
  if (!registrou) {
    await modoAudioExternoDaCall(grupo, false);
    return { ok: false, motivo: 'sem_call' };
  }

  iap.ligar(grupo, {
    log: logIap,
    pensar: (texto, historico, opts = {}) => pensarComIa(texto, historico, {
      quemFalou: opts.quemFalou, nomeDono, participantes
    }),
    transcrever: async (pcm) => {
      const r = await transcreverPcm(pcm, { apiKey: chaveGroq() });
      if (!r.ok) {
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
        logIap(`TTS falhou: ${r.motivo}`, { grupo });
        return null;
      }
      logIap(`TTS ok (${r.fonte})`, {
        grupo,
        segundos: r.pcm ? +(r.pcm.length / 16000).toFixed(1) : 0,
        ...(r.motivoEdge ? { motivoEdge: r.motivoEdge } : {})
      });
      return r.pcm;
    },
    falar: (pcm) => { void falarNaCallDoGrupo(grupo, pcm); }
  });

  // A permissão é CONSULTADA por fala (o metadata pode mudar durante a call:
  // alguém pode ser promovido). O `index.js` injeta a função real.
  if (typeof ehAutorizado === 'function') {
    const agente = iap.agentes.get(grupo);
    if (agente) agente.ehAutorizado = ehAutorizado;
  }

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
  return { ...st, nome: iaIdentidade(), stt: chaveGroq() ? 'groq' : 'nenhum' };
}

/** Desliga todos os agentes (a call caiu: o `index.js` chama isto). */
export function desligarTodosIap() {
  iap.desligarTudo();
}
