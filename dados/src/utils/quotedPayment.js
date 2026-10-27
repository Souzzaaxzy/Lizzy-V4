/**
 * Detector de PAYMENT RESPONDIDA (quoted payment) — parte do `!antifantasma`.
 *
 * Quando alguém RESPONDE (marca) um card de pagamento, o AUTOR ORIGINAL do card
 * é removido do grupo. É a rede de segurança do `!antifantasma`: o texto do
 * raja vive na NOTA do card, então basta ALGUÉM MARCAR a mensagem para o card
 * inteiro chegar ao bot e ser analisado — mesmo quando a detecção pelo
 * TRANSPORTE não pegou.
 *
 * DUAS assinaturas, ambas medidas:
 *   A) FLOOD por resposta — `transactionData` grande E (várias menções OU link):
 *      o atacante mira um card antigo para empurrar o próprio payload.
 *   B) RAJA — o card é um envelope de pagamento sem lastro: a nota carrega só
 *      texto INVISÍVEL, ou o valor está ZERADO. É o formato do raja real
 *      (`sendPaymentMessage` + `.` com zero-widths) e do raja clássico
 *      (`requestPaymentMessage` com `amount1000` "0").
 *
 * Módulo PURO (sem socket, sem arquivo, sem timers): a decisão é testável e o
 * efeito (remover) fica com o handler. Reutiliza o `classifyMessage` central
 * para o TEXTO/MENÇÕES e o `analisarPagamento` (o MESMO motor do `!get`) para
 * os marcadores do raja — nada de um segundo parser de payment.
 */

import { classifyMessage } from './messageInspector.js';
import { analisarPagamento } from './invisibleAnalyzer.js';
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
 * A assinatura suspeita, nas DUAS variantes (ver o topo do arquivo).
 *
 * A) FLOOD: `transactionData` grande E (várias menções OU link). Exige os dois
 *    lados de propósito — evita banir por payment comum.
 * B) RAJA: nota com texto INVISÍVEL ou valor ZERADO. Pagamento legítimo tem
 *    nota visível e/ou valor positivo, então NÃO entra aqui — é o que separa o
 *    ataque do card comum.
 */
export function assinaturaSuspeita({
  transactionLength = 0, mentions = 0, text = '',
  notaInvisivel = false, valorZero = false,
} = {}) {
  const flood = transactionLength >= MIN_TRANSACTION_LENGTH
    && (mentions >= MIN_MENTIONS || temLink(text));
  const raja = notaInvisivel || valorZero;
  return flood || raja;
}

/**
 * Marcadores do raja, extraídos com o `analisarPagamento` (o mesmo motor que o
 * `!get` usa). Centralizado aqui para o handler não precisar conhecer o motor.
 *
 * `semReferencia` NÃO entra na decisão: medido, um `sendPaymentMessage`
 * LEGÍTIMO também não traz `requestMessageKey` (o tipo não carrega `amount`).
 * Ele é apenas reportado no log, como contexto.
 */
export function marcadoresDoRaja(quoted) {
  try {
    const pa = analisarPagamento(quoted);
    if (!pa?.disponivel) return { disponivel: false, notaInvisivel: false, valorZero: false, semReferencia: false };
    return {
      disponivel: true,
      // `semConteudoVisivel` = o texto da nota é só espaço/zero-width (nada é
      // desenhado). É a assinatura MEDIDA do raja real.
      notaInvisivel: pa.nota?.semConteudoVisivel === true,
      // Zero em `amount1000` ou em `amount.value` — o card não tem o que
      // desenhar (raja clássico).
      valorZero: pa.anomaliaZero === true,
      // Contexto apenas (ver o comentário acima).
      semReferencia: pa.cardZeradoSemReferencia === true,
    };
  } catch {
    return { disponivel: false, notaInvisivel: false, valorZero: false, semReferencia: false };
  }
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

    // Marcadores do raja (nota invisível / valor zero) — é o que cobre o caso
    // em que o bot NÃO pegou o raja pelo transporte e alguém MARCOU o card.
    const marcadores = marcadoresDoRaja(quoted);

    const suspicious = assinaturaSuspeita({
      transactionLength, mentions, text,
      notaInvisivel: marcadores.notaInvisivel,
      valorZero: marcadores.valorZero,
    });
    if (!suspicious) return { ataque: false };

    // Qual variante disparou (para o log e para a mensagem ao grupo).
    const motivo = marcadores.notaInvisivel ? 'nota_invisivel'
      : marcadores.valorZero ? 'valor_zero'
        : 'flood';

    return {
      ataque: true,
      paymentType,
      author,
      id,
      mentions,
      transactionLength,
      hasLink: temLink(text),
      notaInvisivel: marcadores.notaInvisivel,
      valorZero: marcadores.valorZero,
      semReferencia: marcadores.semReferencia,
      motivo,
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
