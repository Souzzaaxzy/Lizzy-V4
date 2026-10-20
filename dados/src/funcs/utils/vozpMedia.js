/**
 * Ponte de MÍDIA do **CHAT DE VOZ** (`!vozp`) — independente do `!callp`.
 *
 * ## Por que separado
 *
 * O `!callp` (chamada) e o `!vozp` (chat de voz) são comandos **independentes**:
 *
 * | | comando | backend | por quê |
 * |---|---|---|---|
 * | chamada | `!callp` | `zapoCall.js` | tem UDP cru no relay sem ICE |
 * | chat de voz | `!vozp` | **este módulo** (`lizzy-call`) | é o único que declara o offer como voice chat |
 *
 * Antes, os dois passavam pela mesma fachada (`callMedia.js`) com um parâmetro
 * `voiceChat` e um `Map` de backend compartilhado. Isso acoplou os comandos: o
 * `!callp` passou a **conhecer** o chat de voz, e um estado do `!vozp` podia
 * interferir no `!callp`. Aqui cada um tem a sua ponte, e a única coisa que os
 * dois compartilham é o **código** que usa o mesmo motor — nunca o estado.
 *
 * ## O que este módulo é
 *
 * Uma sessão de chat de voz no motor WASM do WhatsApp Web (`lizzy-call`), com o
 * `isLightWeight: true` que faz o motor declarar o offer como voice chat. O motor
 * usa o **socket do próprio bot** (já pareado) — não há sessão separada.
 *
 * ## Honestidade
 *
 * Todo passo devolve o que de fato aconteceu (`ok`, `motivo`, `stage`). O comando
 * reporta isso; nada é inventado.
 */

import { criarLogDoVozp } from '../../utils/vozpLog.js';

/**
 * Dublê para os testes do bot.
 *
 * O ESM **não deixa** reatribuir um export: `modulo.subirChatDeVoz = ...` lança
 * `Cannot assign to read only property`. Então a substituição passa por aqui —
 * uma porta própria, como o `callMedia` faz com `__setDuble`.
 */
let duble = null;

/** Instala (ou remove, com null) o dublê do chat de voz. */
export function __setDubleVozp(novo) {
  duble = novo;
}

/** O módulo do lizzy-call (carregado sob demanda). */
let modulo = null;
let erroDeCarga = null;

/**
 * A instância de mídia do voz p (uma por processo).
 *
 * Separada da instância do `callMedia`: são sistemas distintos, com ciclos de vida
 * distintos. O motor guarda estado por call, então compartilhar a instância
 * também misturaria as sessões.
 */
let instancia = null;

/** Sessões por grupo, para o `encerrar` e o `status` saberem o que existe. */
const sessoes = new Map();

/** Carrega o motor uma vez. */
export async function carregarVozp() {
  if (modulo) return modulo;
  try {
    modulo = await import('lizzy-call/group-media');
  } catch (e) {
    erroDeCarga = e?.message || String(e);
    modulo = null;
  }
  return modulo;
}

/** Motivo pelo qual o motor não carregou, ou null. */
export function motivoVozp() {
  return erroDeCarga;
}

/** O motor está disponível? (é o requisito do comando) */
export async function suportaVozp() {
  if (duble) return true;
  return (await carregarVozp()) !== null;
}

function obterInstancia(mod) {
  if (!instancia) {
    // O log do motor passa pelo filtro do VOZP (vozpLog.js): o ruído sai e o que
    // decide (subida, mídia pronta, roster, queda, erro) fica.
    instancia = new mod.GroupCallMedia({ log: criarLogDoVozp() });
  }
  return instancia;
}

/**
 * Sobe o chat de voz num grupo.
 *
 * @param {object} p
 * @param {string} p.grupo
 * @param {string} [p.callId]
 * @param {string[]} p.participantes
 * @param {object} p.sock socket do bot
 * @returns {Promise<{ok:boolean, callId?:string, stage?:string, motivo?:string, detalhe?:string}>}
 */
export async function subirChatDeVoz({ grupo, callId, participantes, sock }) {
  if (duble) return duble.subir({ grupo, callId, participantes, sock });
  const mod = await carregarVozp();
  if (!mod) {
    return { ok: false, motivo: 'voice_chat_indisponivel', detalhe: erroDeCarga };
  }
  try {
    const r = await obterInstancia(mod).entrarNaCall({
      grupo,
      callId,
      participantes,
      sock,
      groupInfo: null,
      // É ISTO que faz o motor declarar o offer como VOICE CHAT (e não a chamada
      // que toca). Ver `voice_chat.cc` no WASM do pacote.
      isLightWeight: true
    });
    if (r?.ok) sessoes.set(grupo, { callId: r.callId, stage: r.stage });
    return r;
  } catch (e) {
    return { ok: false, motivo: 'falha_ao_entrar', detalhe: e?.message || String(e) };
  }
}

/**
 * Sai do chat de voz (manda o `<terminate>` e derruba a pilha).
 *
 * @param {string} grupo
 * @returns {Promise<{ok:boolean, motivo?:string, detalhe?:string}>}
 */
export async function sairDoChatDeVoz(grupo) {
  if (duble) return duble.sair(grupo);
  const mod = await carregarVozp();
  if (!mod) return { ok: false, motivo: 'voice_chat_indisponivel', detalhe: erroDeCarga };
  try {
    const r = await obterInstancia(mod).sairDaCall(grupo);
    sessoes.delete(grupo);
    return r;
  } catch (e) {
    return { ok: false, motivo: 'falha_ao_sair', detalhe: e?.message || String(e) };
  }
}

/** Toca um arquivo no chat de voz (o `!musicap` é do callp; isto é do voz p). */
export async function tocarNoChatDeVoz(grupo, arquivo) {
  const mod = await carregarVozp();
  if (!mod) return { ok: false, motivo: 'voice_chat_indisponivel', detalhe: erroDeCarga };
  try {
    return await obterInstancia(mod).tocarAudio(grupo, arquivo);
  } catch (e) {
    return { ok: false, motivo: 'falha_ao_tocar', detalhe: e?.message || String(e) };
  }
}

/** Estágio da pilha do voz p num grupo. */
export async function estagioDoVozp(grupo) {
  if (duble) return duble.estagio(grupo);
  const mod = await carregarVozp();
  if (!mod) return 'indisponivel';
  try {
    return obterInstancia(mod).estagio(grupo);
  } catch {
    return 'desconhecido';
  }
}

/** Descarta a pilha (usado no `uncaughtException` do connect). */
export function resetarVozp() {
  try {
    instancia = null;
    modulo = null;
    erroDeCarga = null;
    sessoes.clear();
  } catch { /* nada a fazer */ }
}
