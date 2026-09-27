/**
 * Pin / Unpin de mensagens — parte PURA (não importa o Baileys).
 *
 * O protocolo é o nativo do fork: `sock.sendMessage(jid, { pin: key, type, time })`
 * vira `pinInChatMessage` (com `key`, `type` e `senderTimestampMs`) mais
 * `messageContextInfo.messageAddOnDurationInSecs`.
 *
 * Aqui ficam só as decisões que dão para testar sem socket:
 *   - qual é a duração pedida (`!fixar 7d` -> 604800);
 *   - a partir do `contextInfo` da citação, qual é a `WAMessageKey` do alvo;
 *   - reconhecer um `pinInChatMessage` RECEBIDO (mensagem de controle), para o
 *     bot não tratá-lo como texto nem disparar comando.
 */

/** Durações nativas do WhatsApp (segundos). Valores arbitrários são recusados. */
export const PIN_DURATIONS = Object.freeze({
  86400: '24 horas',
  604800: '7 dias',
  2592000: '30 dias',
});

/** Duração padrão quando o usuário não informa nada. */
export const DEFAULT_PIN_DURATION = 86400;

/** Apelidos de duração aceitos no argumento do comando. */
const DURATION_ALIASES = Object.freeze({
  '24h': 86400,
  '1d': 86400,
  '24': 86400,
  '7d': 604800,
  '7': 604800,
  'semana': 604800,
  '30d': 2592000,
  '30': 2592000,
  'mes': 2592000,
  'mês': 2592000,
});

/**
 * Traduz o argumento do `!fixar` em segundos.
 *
 * Sem argumento devolve a duração padrão (24h). Com um valor nativo aceita os
 * apelidos; qualquer outra coisa é recusada (`ok: false`) em vez de virar um
 * número que o WhatsApp não entende.
 *
 * @param {string} [raw] argumento cru (`"7d"`, `"604800"`, ...)
 * @returns {{ok: true, seconds: number, label: string} | {ok: false}}
 */
export function parsePinDuration(raw) {
  const value = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (!value) {
    return { ok: true, seconds: DEFAULT_PIN_DURATION, label: PIN_DURATIONS[DEFAULT_PIN_DURATION] };
  }

  const aliased = DURATION_ALIASES[value];
  if (aliased) {
    return { ok: true, seconds: aliased, label: PIN_DURATIONS[aliased] };
  }

  // Aceita também o número cru em segundos, mas só se for uma das durações
  // nativas (nada de valor arbitrário).
  const numeric = Number(value);
  if (Number.isInteger(numeric) && numeric in PIN_DURATIONS) {
    return { ok: true, seconds: numeric, label: PIN_DURATIONS[numeric] };
  }

  return { ok: false };
}

/**
 * Texto humano de uma duração nativa. Valor desconhecido cai na própria
 * descrição enviada pelo WhatsApp (a duração é decidida lá, não aqui).
 * @param {number} seconds
 */
export function formatPinDuration(seconds) {
  return PIN_DURATIONS[seconds] || null;
}

/**
 * Monta a `WAMessageKey` do alvo a partir do `contextInfo` da citação.
 *
 * Nunca reconstrói a chave pelo texto: usa `stanzaId`, `participant` e
 * `remoteJid` entregues pelo WhatsApp. Em grupo a chave de uma mensagem de
 * TERCEIRO é `{ remoteJid, fromMe: false, id, participant }`; a de uma mensagem
 * do PRÓPRIO bot é `{ remoteJid, fromMe: true, id }` (participant é do autor,
 * que é o bot). O sufixo de dispositivo (`:XX`) é removido do participant.
 *
 * @param {object|null} contextInfo `contextInfo` da mensagem citada
 * @param {{remoteJid?: string, botIds?: Array<string>}} [options]
 * @returns {object|null} a key, ou null quando não dá para identificar o alvo
 */
export function buildPinKeyFromContext(contextInfo, options = {}) {
  if (!contextInfo || typeof contextInfo !== 'object') return null;

  const id = contextInfo.stanzaId;
  const remoteJid = contextInfo.remoteJid || options.remoteJid;
  if (!id || !remoteJid) return null;

  const participant = normalizeParticipant(contextInfo.participant);
  const botIds = (options.botIds || []).filter(Boolean);
  const fromMe = Boolean(participant && botIds.some((botId) => sameUser(participant, botId)));

  const key = { remoteJid, fromMe, id };
  // Só referencia o autor quando a mensagem NÃO é do bot.
  if (participant && !fromMe) key.participant = participant;
  return key;
}

/** Remove `:XX` do JID e devolve `null` para entradas inválidas. */
function normalizeParticipant(participant) {
  if (typeof participant !== 'string' || !participant) return null;
  if (participant.includes(':')) {
    const server = participant.includes('@lid') ? '@lid' : '@s.whatsapp.net';
    return participant.split(':')[0] + server;
  }
  return participant;
}

/** Compara dois identificadores ignorando `@` e sufixo `:XX`. */
function sameUser(id1, id2) {
  if (!id1 || !id2) return false;
  return String(id1).split('@')[0].split(':')[0] === String(id2).split('@')[0].split(':')[0];
}

/**
 * Reconhece uma mensagem RECEBIDA que é um pin/unpin (controle).
 *
 * Ela passa pelo fluxo normal, então precisa ser descartada como conteúdo: não
 * é texto, não é comando e não deve contar/responder. A varredura aceita
 * wrappers (efêmera) e ignora falsos positivos.
 *
 * @param {object|null} content `info.message`
 * @returns {boolean}
 */
export function isPinControlMessage(content) {
  return extractPinInfo(content) !== null;
}

/**
 * Extrai `key`/`type`/`senderTimestampMs` de um pin recebido, em qualquer
 * encapsulamento. `null` quando não é um pin.
 *
 * @param {object|null} content `info.message`
 * @returns {{key: object, type: number, senderTimestampMs: *}|null}
 */
export function extractPinInfo(content) {
  let current = content;
  let guard = 0;

  while (current && typeof current === 'object' && guard < 12) {
    guard += 1;

    const pin = current.pinInChatMessage;
    if (pin && typeof pin === 'object' && pin.key) {
      return {
        key: pin.key,
        type: pin.type,
        senderTimestampMs: pin.senderTimestampMs ?? null,
      };
    }

    // Desce wrappers conhecidos que carregam outra mensagem dentro.
    const wrapperKey = ['ephemeralMessage', 'viewOnceMessage', 'viewOnceMessageV2', 'viewOnceMessageV2Extension', 'deviceSentMessage']
      .find((k) => current[k] && typeof current[k] === 'object');
    if (!wrapperKey) break;
    const child = current[wrapperKey].message;
    if (!child || typeof child !== 'object') break;
    current = child;
  }

  return null;
}
