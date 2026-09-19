/**
 * Group Status — detecção e revogação.
 *
 * O `!statusgrupo` publica um status nativo do grupo, que a fork encapsula em
 * `groupStatusMessageV2` e marca com `is_group_status='true'` na stanza. Esse
 * tipo de conteúdo NÃO é apagado pelo `!d` normal por dois motivos:
 *
 *   1. o `!d` monta a key com `fromMe: false` + `participant` (pensado em
 *      mensagem de terceiro), e um status publicado pelo próprio bot é
 *      `fromMe: true` — a key não casa e o servidor ignora;
 *   2. um status é uma stanza especial (`is_group_status`), então a revogação
 *      precisa sair no mesmo formato de status, senão o cliente não a associa
 *      ao status publicado.
 *
 * Aqui ficam as peças puras (sem Baileys, sem socket) que o `!d` usa:
 * reconhecer um status em qualquer encapsulamento, dizer se o ID está no
 * registro de status publicados por este bot, e montar a lista de payloads de
 * revogação a tentar (do mais específico para o mais genérico).
 */

/** Wrappers que carregam um status de grupo dentro. */
const STATUS_WRAPPERS = ['groupStatusMessageV2', 'groupStatusMessage'];

/** Campos de mensagem que podem carregar (ou conter) um status. */
const CHILDREN = ['message', 'editedMessage', 'originalMessage', 'groupStatusMessage'];

/**
 * O conteúdo é (ou encapsula) um status de grupo?
 *
 * Olha o `contextInfo.isGroupStatus` — que é o marcador que a fork põe no
 * nó interno — e os wrappers de status, descendo a cadeia.
 *
 * @param {object} content `info.message` ou um `quotedMessage`
 * @returns {boolean}
 */
export function isGroupStatusContent(content) {
  let current = content;
  let guard = 0;

  while (current && typeof current === 'object' && guard < 12) {
    guard += 1;

    for (const key of Object.keys(current)) {
      const node = current[key];
      if (!node || typeof node !== 'object') continue;
      if (STATUS_WRAPPERS.includes(key)) return true;
      if (node.contextInfo?.isGroupStatus === true) return true;
    }

    const wrapperKey = STATUS_WRAPPERS.find((k) => current[k] && typeof current[k] === 'object');
    if (!wrapperKey) break;
    const wrapper = current[wrapperKey];
    const child = CHILDREN.map((f) => wrapper?.[f]).find((v) => v && typeof v === 'object');
    if (!child) break;
    current = child;
  }

  return false;
}

/**
 * Payloads de revogação a tentar, do mais específico para o mais genérico.
 *
 * O primeiro é a revogação encapsulada como status (`groupStatus: true`), que
 * marca a stanza com `is_group_status='true'` — é o formato casado com o status
 * publicado. O segundo é a revogação simples, rede de segurança caso a versão
 * do cliente/servidor não aceite a variante de status.
 *
 * @param {{remoteJid: string, id: string, fromMe?: boolean, participant?: string}} key
 * @returns {Array<object>}
 */
export function buildGroupStatusRevokePayloads(key) {
  if (!key?.id || !key?.remoteJid) return [];
  const base = {
    remoteJid: key.remoteJid,
    id: key.id,
    fromMe: key.fromMe !== false,
  };
  if (key.participant && base.fromMe === false) base.participant = key.participant;

  return [
    { groupStatus: true, delete: { ...base } },
    { delete: { ...base } },
  ];
}

// ---------------------------------------------------------------------------
// Registro dos status publicados por ESTE bot (por chat).
// Serve para reconhecer como status um ID que o quoted não trouxe encapsulado —
// sem depender de o cliente devolver o wrapper na citação.
// ---------------------------------------------------------------------------

const TTL_MS = 12 * 60 * 60 * 1000; // status do grupo vive ~24h; guardamos 12h
const MAX_POR_CHAT = 50;

const publicados = new Map(); // chatId -> Map<messageId, { when }>

function limparExpirados() {
  const agora = Date.now();
  for (const [chatId, mapa] of publicados) {
    for (const [id, entry] of mapa) {
      if (agora - entry.when > TTL_MS) mapa.delete(id);
    }
    if (mapa.size === 0) publicados.delete(chatId);
  }
}

/** Guarda o ID de um status publicado, para poder revogá-lo depois. */
export function rememberPublishedGroupStatus(chatId, messageId) {
  if (!chatId || !messageId) return false;
  limparExpirados();
  let mapa = publicados.get(chatId);
  if (!mapa) {
    mapa = new Map();
    publicados.set(chatId, mapa);
  }
  mapa.set(messageId, { when: Date.now() });
  // Teto: descarta os mais antigos (Map preserva a ordem de inserção).
  while (mapa.size > MAX_POR_CHAT) {
    mapa.delete(mapa.keys().next().value);
  }
  return true;
}

/** O ID é um status publicado por este bot neste chat? */
export function isPublishedGroupStatus(chatId, messageId) {
  if (!chatId || !messageId) return false;
  return publicados.get(chatId)?.has(messageId) || false;
}

/**
 * ID do status MAIS RECENTE publicado por este bot no chat (ordem de inserção).
 *
 * Serve para o `!d` conseguir revogar um status sem depender de citar a
 * mensagem — o cliente não entrega um status de grupo como mensagem citável
 * de forma confiável, então o registro é o caminho garantido.
 *
 * @param {string} chatId
 * @returns {string|null}
 */
export function getLastPublishedGroupStatus(chatId) {
  const mapa = publicados.get(chatId);
  if (!mapa || mapa.size === 0) return null;
  const ids = Array.from(mapa.keys());
  return ids[ids.length - 1];
}

/** Remove o ID do registro (após revogar, ou quando o status já caiu). */
export function forgetPublishedGroupStatus(chatId, messageId) {
  if (!chatId || !messageId) return false;
  const mapa = publicados.get(chatId);
  if (!mapa) return false;
  const removido = mapa.delete(messageId);
  if (mapa.size === 0) publicados.delete(chatId);
  return removido;
}

/** Esvazia o registro. Usado pelos testes. */
export function clearPublishedGroupStatuses() {
  publicados.clear();
}