/**
 * DIVULGAÇÃO DE CANAL (newsletter) — `!divcanal`.
 *
 * Mesma linha do `!divdono`: o dono registra os **GRUPOS de destino**, salva uma
 * legenda e dispara. O que muda é o conteúdo enviado — em vez de texto/imagem,
 * vai o **cardzinho nativo de "seguir canal"**.
 *
 * O **CANAL não é registrado**: é o canal padrão do bot
 * (`global.json → channel`), o mesmo que o bot usa nos cabeçalhos de newsletter.
 * Por isso este módulo cuida da lista de GRUPOS, não de canais.
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
 * Normaliza um ID de grupo: aceita o JID pronto (`...@g.us`) ou só os dígitos
 * (que ganham o sufixo). Devolve `null` quando não é um grupo válido.
 */
export function normalizarIdGrupo(entrada) {
  let id = String(entrada ?? '').trim();
  if (!id) return null;
  if (!id.includes('@')) {
    // Sem `@`: só serve se houver dígitos suficientes (evita `42` -> `@g.us`).
    const digitos = id.replace(/\D/g, '');
    if (digitos.length < 8) return null;
    id = `${digitos}@g.us`;
  }
  // Precisa terminar em `@g.us` E ter dígitos antes do `@`.
  return /^\d{8,}@g\.us$/i.test(id) ? id : null;
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
 * Normaliza a lista de GRUPOS registrados (tolera formato antigo/errado).
 * Cada item é o JID do grupo (`...@g.us`).
 */
export function normalizarGrupos(lista) {
  const out = [];
  const vistos = new Set();
  for (const item of Array.isArray(lista) ? lista : []) {
    const bruto = typeof item === 'string' ? item : (item?.id || item?.jid || '');
    const jid = normalizarIdGrupo(bruto);
    if (!jid || vistos.has(jid)) continue;
    vistos.add(jid);
    out.push(jid);
  }
  return out;
}

/** Adiciona um grupo. Devolve `{ grupos, adicionado }`. */
export function adicionarGrupo(lista, id) {
  const jid = normalizarIdGrupo(id);
  if (!jid) throw new Error('ID de grupo inválido');
  const grupos = normalizarGrupos(lista);
  if (grupos.includes(jid)) return { grupos, adicionado: false };
  grupos.push(jid);
  return { grupos, adicionado: true };
}

/** Remove um grupo por JID ou pelo número da lista (1-based). */
export function removerGrupo(lista, idOuIndice) {
  const grupos = normalizarGrupos(lista);
  let alvo = null;
  if (/^\d+$/.test(String(idOuIndice ?? '').trim())) {
    const idx = Number(String(idOuIndice).trim()) - 1;
    if (idx >= 0 && idx < grupos.length) alvo = grupos[idx];
  }
  if (!alvo) alvo = normalizarIdGrupo(idOuIndice);
  if (!alvo) return { grupos, removido: false };
  const restantes = grupos.filter((g) => g !== alvo);
  return { grupos: restantes, removido: restantes.length !== grupos.length };
}
