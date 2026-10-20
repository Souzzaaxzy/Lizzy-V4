/**
 * Ponte de MÍDIA do **CHAT DE VOZ** (`!vozp`) — independente do `!callp`.
 *
 * ## Por que separado
 *
 * O `!callp` (chamada) e o `!vozp` (chat de voz) são comandos **independentes**:
 *
 * | | comando | o que sobe | registro |
 * |---|---|---|---|
 * | chamada | `!callp` | chamada (toca) | `callOffer.registrarCall` |
 * | chat de voz | `!vozp` | chat de voz (não toca) | `registroVozp` (no index) |
 *
 * Cada um tem a sua **ponte** e o seu **registro**; o que os dois compartilham é
 * o **motor** (o `zapo`, via `zapoCall.js`) — nunca o estado do comando. Como o
 * WhatsApp só permite UMA call por grupo, o motor ter um mapa por grupo é o
 * comportamento correto: um `!vozp` não vê o registro do `!callp` (e vice-versa),
 * mas não existem duas calls no mesmo grupo.
 *
 * ## O que este módulo é
 *
 * Uma sessão de chat de voz no motor **zapo** (`zapo-js` + `@zapo-js/voip`), com o
 * `isLightweight: true` que declara o offer como voice chat (`lightweight='1'` +
 * `<silence>`, o grupo **não** toca). É o MESMO motor do `!callp` — então o chat
 * de voz herda o transporte por **UDP cru** no relay sem ICE, o roster
 * transacional, o `heartbeat` e o `peer_state` que mantêm a call de pé.
 *
 * Antes, o chat de voz ia pelo motor WASM do WhatsApp Web (`lizzy-call`), que
 * ficava em "conectando" e caía em ciclo. O motor do `zapo` é o que **se mantém**
 * na call — daí a migração.
 *
 * ## UM pareamento só (o do `!callp`) vale para o `!vozp`
 *
 * O motor é um client PRÓPRIO do bot, com credenciais no formato dele, gravadas
 * em `dados/database/zapo-auth/`. Não existe "pareamento do chat de voz": quem
 * pareia é o `!callp parear <numero>`, e a MESMA sessão/banco atende os dois
 * comandos. Por isso `precisaPareamentoVozp` pergunta ao próprio motor
 * (`zapoCall.estaPareado`) — não há estado separado para manter em dia.
 *
 * ## Honestidade
 *
 * Todo passo devolve o que de fato aconteceu (`ok`, `motivo`, `stage`). O comando
 * reporta isso; nada é inventado.
 */

import * as zapoCall from './zapoCall.js';

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

/** Sessões por grupo, para o `encerrar` e o `status` saberem o que existe. */
const sessoes = new Map();

/** Carrega o motor do zapo uma vez (delegação pura). */
export async function carregarVozp() {
  if (duble) return duble;
  return zapoCall.carregarZapo();
}

/** Motivo pelo qual o motor não carregou, ou null. */
export function motivoVozp() {
  return zapoCall.motivoZapo();
}

/** O motor está disponível? (é o requisito do comando) */
export async function suportaVozp() {
  if (duble) return true;
  return (await zapoCall.carregarZapo()) !== null;
}

/**
 * O chat de voz exige pareamento PRÓPRIO?
 *
 * NÃO: o motor é o mesmo do `!callp`, com o mesmo store
 * (`dados/database/zapo-auth/`). Parear uma vez (`!callp parear <numero>`) vale
 * para os dois comandos.
 *
 * Com DUBLÊ instalado, o dublê pode responder por si (o teste mede o CONTRATO
 * do comando); sem ele, quem responde é o motor de verdade.
 */
export async function precisaPareamentoVozp() {
  if (duble) {
    return typeof duble.precisaPareamento === 'function' ? duble.precisaPareamento() : false;
  }
  return !zapoCall.estaPareado();
}

/**
 * Sobe o chat de voz num grupo.
 *
 * @param {object} p
 * @param {string} p.grupo
 * @param {string} [p.callId]
 * @param {string[]} p.participantes
 * @param {object} [p.sock]
 * @returns {Promise<{ok:boolean, callId?:string, stage?:string, motivo?:string, detalhe?:string}>}
 */
export async function subirChatDeVoz({ grupo, callId, participantes, sock }) {
  if (duble) return duble.subir({ grupo, callId, participantes, sock });
  if (!(await suportaVozp())) {
    return { ok: false, motivo: 'voice_chat_indisponivel', detalhe: zapoCall.motivoZapo() };
  }
  // É ISTO que faz o motor declarar o offer como VOICE CHAT (e não a chamada
  // que toca): `lightweight='1'` + `<silence>` no offer. Ver o doc do pacote.
  const r = await zapoCall.entrarNaCallComMidia({
    grupo,
    callId,
    participantes,
    sock,
    isLightweight: true
  });
  if (r?.ok) sessoes.set(grupo, { callId: r.callId, stage: r.stage });
  return r;
}

/**
 * Sai do chat de voz (manda o `<terminate>` ao objeto da call e derruba a pilha).
 *
 * @param {string} grupo
 * @returns {Promise<{ok:boolean, motivo?:string, detalhe?:string}>}
 */
export async function sairDoChatDeVoz(grupo) {
  if (duble) return duble.sair(grupo);
  try {
    const r = await zapoCall.sairDaCallComMidia(grupo);
    sessoes.delete(grupo);
    return r;
  } catch (e) {
    return { ok: false, motivo: 'falha_ao_sair', detalhe: e?.message || String(e) };
  }
}

/** Estágio da pilha do voz p num grupo. */
export async function estagioDoVozp(grupo) {
  if (duble) return duble.estagio(grupo);
  try {
    return await zapoCall.estagioMidia(grupo);
  } catch {
    return 'desconhecido';
  }
}

/** Descarta a pilha (usado no `uncaughtException` do connect). */
export function resetarVozp() {
  try {
    sessoes.clear();
    zapoCall.resetarMidia();
  } catch { /* nada a fazer */ }
}
