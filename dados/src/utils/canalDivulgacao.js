/**
 * DIVULGAÇÃO DE CANAL (newsletter) — `!divcanal`.
 *
 * Mesma linha do `!divdono` (registrar destinos, mensagem, envio manual,
 * agendamento e estatísticas), mas o que vai no lugar da mensagem é o
 * **cardzinho nativo de "seguir canal"** do WhatsApp — em vez de texto/imagem.
 *
 * Por que o `raw: true`: o `generateWAMessageContent` da fork **não conhece**
 * `newsletterFollowerInviteMessageV2`; sem o `raw` ele cai no
 * `prepareWAMessageMedia`, que lança `Invalid media type` (medido). Com `raw`,
 * o proto passa direto e o tipo chega intacto no destino.
 *
 * Módulo PURO: só monta/valida/introjeta o conteúdo; ninguém aqui abre socket
 * nem lê arquivo. Assim dá para testar a forma do payload sem handler.
 */

/**
 * Interpreta o que o dono digitou no `!divcanal add`.
 *
 * Aceita:
 * - o JID pronto (`1203634...@newsletter`);
 * - o link de convite (`https://whatsapp.com/channel/XXXX`) — o `XXXX` do link
 *   **não é** o JID, então devolvemos o código para o handler resolver via
 *   `newsletterMetadata('invite', ...)`;
 * - só o código final do link.
 *
 * @returns {{ tipo: 'jid'|'codigo', valor: string }|null}
 */
export function interpretarCanalEntrada(entrada) {
  const raw = String(entrada ?? '').trim();
  if (!raw) return null;
  if (/@newsletter$/i.test(raw)) {
    return { tipo: 'jid', valor: raw };
  }
  const semQuery = raw.split('?')[0].replace(/\/+$/, '');
  const codigo = semQuery.includes('/') ? semQuery.split('/').pop() : semQuery;
  if (!codigo) return null;
  return { tipo: 'codigo', valor: codigo };
}

/** O JID é de canal? (`...@newsletter`) */
export function ehJidCanal(jid) {
  return /@newsletter$/i.test(String(jid ?? '').trim());
}

/**
 * Conteúdo do card "seguir canal".
 *
 * @param {{ jid: string, nome?: string, caption?: string }} p
 * @returns {{ object: object, tipo: string }}
 */
export function buildFollowChannelContent({ jid, nome = '', caption = '' } = {}) {
  if (!ehJidCanal(jid)) {
    throw new Error('JID de canal inválido');
  }
  const interno = {
    newsletterJid: String(jid),
    newsletterName: String(nome || 'Canal'),
  };
  if (caption) interno.caption = String(caption);
  return {
    tipo: 'newsletterFollowerInviteMessageV2',
    // `raw` faz o proto passar direto pelo generateWAMessageContent.
    object: { raw: true, newsletterFollowerInviteMessageV2: interno },
  };
}

/**
 * Normaliza a lista de canais registrados (tolera formato antigo/errado).
 * Cada item: `{ jid, nome }`.
 */
export function normalizarCanais(lista) {
  const out = [];
  const vistos = new Set();
  for (const item of Array.isArray(lista) ? lista : []) {
    let jid = '';
    let nome = '';
    if (typeof item === 'string') {
      jid = item;
    } else if (item && typeof item === 'object') {
      jid = item.jid || item.id || '';
      nome = item.nome || item.name || '';
    }
    jid = String(jid).trim();
    if (!ehJidCanal(jid) || vistos.has(jid)) continue;
    vistos.add(jid);
    out.push({ jid, nome: String(nome || '').trim() });
  }
  return out;
}

/** Adiciona (ou atualiza o nome de) um canal. Devolve `{ canais, adicionado }`. */
export function adicionarCanal(lista, { jid, nome = '' } = {}) {
  if (!ehJidCanal(jid)) throw new Error('JID de canal inválido');
  const canais = normalizarCanais(lista);
  const idx = canais.findIndex((c) => c.jid === jid);
  if (idx >= 0) {
    if (nome) canais[idx].nome = String(nome).trim();
    return { canais, adicionado: false };
  }
  canais.push({ jid, nome: String(nome || '').trim() });
  return { canais, adicionado: true };
}

/** Remove um canal pelo JID. Devolve `{ canais, removido }`. */
export function removerCanal(lista, jid) {
  const canais = normalizarCanais(lista);
  const alvo = String(jid ?? '').trim();
  const restantes = canais.filter((c) => c.jid !== alvo);
  return { canais: restantes, removido: restantes.length !== canais.length };
}
