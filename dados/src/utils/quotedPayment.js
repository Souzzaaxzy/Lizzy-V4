/**
 * Detector de PAYMENT RESPONDIDA (quoted payment) — parte do `!antifantasma`.
 *
 * Quando alguém RESPONDE a um card de pagamento e esse card tem a assinatura
 * suspeita (transactionData grande + várias menções ou link), o AUTOR ORIGINAL
 * do card é removido do grupo. É a técnica do "flood por resposta a payment":
 * o atacante mira um card antigo para empurrar o próprio payload.
 *
 * Módulo PURO (sem socket, sem arquivo, sem timers): a decisão é testável e o
 * efeito (remover) fica com o handler. Reutiliza o `classifyMessage` central
 * para o TEXTO e as MENÇÕES — nada de um segundo parser de payment.
 */

import { classifyMessage } from './messageInspector.js';
import { findParticipantByNumber } from './helpers.js';

export const SEND = 'sendPaymentMessage';
export const REQUEST = 'requestPaymentMessage';
export const TIPOS_PAYMENT = [SEND, REQUEST];

/** Tamanho mínimo do `transactionData` para contar como payload de flood. */
export const MIN_TRANSACTION_LENGTH = 512;

/** Menções mínimas na nota para contar como suspeito (quando não há link). */
export const MIN_MENTIONS = 2;

const LINK_RE = /(?:https?:\/\/|www\.|t\.me\/|wa\.me\/|whatsapp\.com\/)/i;

/** Content achatado de um wrapper (viewOnce/efêmera/editada) até a folha. */
function conteudoDaMensagem(message) {
  let node = message;
  for (let i = 0; i < 5 && node; i++) {
    const chave = Object.keys(node)[0];
    if (!chave) return null;
    const valor = node[chave];
    if (chave === 'viewOnceMessage' || chave === 'viewOnceMessageV2' || chave === 'viewOnceMessageV2Extension'
      || chave === 'ephemeralMessage' || chave === 'documentWithCaptionMessage') {
      node = valor?.message;
      continue;
    }
    if (chave === 'editedMessage') {
      node = valor?.message?.protocolMessage?.editedMessage;
      continue;
    }
    return { chave, valor };
  }
  return null;
}

/** Tamanho do `transactionData` (aceita string, Buffer e Uint8Array). */
export function tamanhoTransactionData(transactionData) {
  if (typeof transactionData === 'string') return transactionData.length;
  if (Buffer.isBuffer(transactionData) || transactionData instanceof Uint8Array) return transactionData.length;
  return 0;
}

/** Há link/convite no texto da nota? */
export function temLink(text) {
  return typeof text === 'string' && LINK_RE.test(text);
}

/**
 * A assinatura suspeita: `transactionData` grande E (várias menções OU link).
 * Exige os dois lados de propósito — evita banir por payment comum.
 */
export function assinaturaSuspeita({ transactionLength = 0, mentions = 0, text = '' } = {}) {
  return transactionLength >= MIN_TRANSACTION_LENGTH && (mentions >= MIN_MENTIONS || temLink(text));
}

/** Nome da chave do payment citado (send/request), ou null. */
export function tipoPaymentCitado(quoted) {
  if (!quoted || typeof quoted !== 'object') return null;
  if (quoted[SEND]) return SEND;
  if (quoted[REQUEST]) return REQUEST;
  return null;
}

/**
 * Analisa a mensagem: ela RESPONDE a um payment suspeito?
 *
 * Devolve `{ ataque: false }` ou `{ ataque: true, paymentType, author, id }`.
 * `author`/`id` vêm do `contextInfo` da mensagem citada — é o autor ORIGINAL
 * do card (quem vai ser removido), não quem respondeu.
 */
export function detectarPaymentRespondida(info) {
  try {
    const group = info?.key?.remoteJid;
    if (!group || !String(group).endsWith('@g.us') || info?.key?.fromMe) return { ataque: false };

    const folha = conteudoDaMensagem(info?.message);
    if (!folha) return { ataque: false };

    const ctx = folha.valor?.contextInfo;
    const quoted = ctx?.quotedMessage;
    const paymentType = tipoPaymentCitado(quoted);
    if (!paymentType) return { ataque: false };

    const author = ctx?.participant;
    const id = ctx?.stanzaId;
    if (!author || !id) return { ataque: false };

    const c = classifyMessage(quoted);
    const text = c.noteText || '';
    const mentions = c.mentionCount || 0;

    const payment = quoted[paymentType] || {};
    const transactionLength = tamanhoTransactionData(payment.transactionData);

    const suspicious = assinaturaSuspeita({ transactionLength, mentions, text });
    if (!suspicious) return { ataque: false };

    return {
      ataque: true,
      paymentType,
      author,
      id,
      mentions,
      transactionLength,
      hasLink: temLink(text),
    };
  } catch {
    return { ataque: false };
  }
}

/** O autor (do payment) é admin/superadmin do grupo? */
export function autorEhAdmin(participant) {
  return participant?.admin === 'admin' || participant?.admin === 'superadmin';
}

/**
 * Decide o alvo da remoção: acha o participante do grupo pelo autor original e
 * devolve o JID de remoção (telefone/pn primeiro — mais estável que o LID).
 * Recusa admin e devolve `null` se não achar.
 */
export function alvoDaRemocao(participants, author) {
  const p = findParticipantByNumber(participants, author);
  if (!p || autorEhAdmin(p)) return null;
  const jid = p.phoneNumber || p.pn || p.id || author;
  return { participant: p, jid };
}
