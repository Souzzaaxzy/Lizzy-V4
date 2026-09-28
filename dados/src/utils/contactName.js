/**
 * Resolvedor de NOME DE CONTATO — fonte única.
 *
 * O nome "bonito" de alguém não estava em um lugar só: cada comando tinha a sua
 * própria tentativa (o `!me` lia `store.contacts`, o `!cf` lia metadata, outros
 * liam `groupData.contador[].pushname`). Isso fazia o mesmo usuário aparecer com
 * nomes diferentes (ou com o LID/número cru) dependendo do comando.
 *
 * Aqui a ordem é única e testável. Puro de propósito: as dependências externas
 * (`nazu`, `metadata`) entram por parâmetro, então dá para usar dentro de um
 * handler (que tem tudo) ou fora dele.
 *
 * Ordem de resolução:
 *   1. `nazu.getName(from, id)` — é o que devolve o NOME DO CONTATO salvo na
 *      agenda (com queda para o pushName). Fonte preferida.
 *   2. `store.contacts` da sessão (`notify`/`verifiedName`/`name`/`subject`) —
 *      varia conforme a versão do Baileys.
 *   3. Participantes do metadata do grupo (`notify`/`name`/`pushName`).
 *   4. Fallback opcional do chamador (`pushname` do contador, por exemplo).
 *   5. Número de telefone do membro.
 *   6. O próprio id.
 *
 * Em TODAS as etapas é descartado o que é genérico (`Usuário`, `user`, …) e o
 * que é **número de telefone ou JID cru** — inclusive o número do próprio
 * membro, para o nome NUNCA cair no LID/número quando existe um nome real.
 */

const GENERICO_RE = /^(usu[aá]rio|user|unknown|desconhecido|voc[eê]|sem nome|nome n[aã]o dispon[ií]vel)$/i;
const NUMERO_RE = /^\+?\d+$/;
const JID_CRU_RE = /^\d+@(s\.whatsapp\.net|lid)$/;

/** Base de um id (sem `:device` e sem `@...`). */
export function baseId(id) {
  return String(id || '').split('@')[0].split(':')[0];
}

/** `true` quando o valor não serve como nome (vazio, genérico, número ou JID). */
export function nomeInutil(valor) {
  const texto = String(valor ?? '').trim();
  if (!texto) return true;
  if (GENERICO_RE.test(texto)) return true;
  if (NUMERO_RE.test(texto)) return true;
  if (JID_CRU_RE.test(texto)) return true;
  return false;
}

/**
 * Acha o participante do grupo por qualquer uma das identidades
 * (`id`, `lid`, `phoneNumber`, `pn`).
 *
 * @param {object|null} metadata  `groupMetadata` (do socket ou cacheado)
 * @param {string} id
 */
export function acharParticipantePorId(metadata, id) {
  const base = baseId(id);
  if (!base) return null;
  const participantes = metadata?.participants;
  if (!Array.isArray(participantes)) return null;
  return participantes.find((p) => {
    if (!p) return false;
    if (typeof p === 'string') return baseId(p) === base;
    const ids = [p.id, p.lid, p.phoneNumber, p.pn].filter(Boolean).map(baseId);
    return ids.includes(base);
  }) || null;
}

/** Números de telefone conhecidos do participante (para a guarda anti-número). */
export function numerosDoParticipante(metadata, id) {
  const p = acharParticipantePorId(metadata, id);
  return [p?.phoneNumber, p?.pn].filter(Boolean).map(baseId);
}

/** Contatos da sessão (`nazu.store.contacts`) indexados pela base do id. */
function contatosDaSessao(nazu) {
  const contacts = nazu?.store?.contacts;
  return contacts && typeof contacts === 'object' ? contacts : {};
}

/**
 * Resolve o nome do contato.
 *
 * @param {string} id  JID/LID/`@...` do alvo
 * @param {object} [opts]
 * @param {object} [opts.nazu]        socket (usa `getName` e `store.contacts`)
 * @param {object} [opts.metadata]    `groupMetadata` (com `participants`)
 * @param {string} [opts.from]        jid do chat (para `nazu.getName`)
 * @param {string} [opts.fallback]    usado se nada melhor: `pushname` do
 *                                    contador, por exemplo
 * @returns {Promise<string>} o nome, ou o número/id como último recurso
 */
export async function resolverNomeContato(id, opts = {}) {
  const { nazu, metadata, from, fallback } = opts;
  const base = baseId(id);
  const numeros = numerosDoParticipante(metadata, id);
  // Bases pelas quais procurar: a do próprio id E os telefones do membro —
  // em grupo o alvo costuma chegar como LID, mas a agenda é indexada por PN.
  const basesBusca = new Set([base, ...numeros].filter(Boolean));
  // Nem o próprio número do membro serve como "nome".
  const ehNumeroDeste = (v) => {
    const texto = String(v ?? '').trim();
    if (!texto) return false;
    if (NUMERO_RE.test(texto)) {
      const limpo = texto.replace(/^\+/, '');
      return numeros.length === 0 || numeros.includes(limpo);
    }
    return false;
  };
  const aceito = (v) => !nomeInutil(v) && !ehNumeroDeste(v);
  const limpo = (v) => String(v).trim();

  // 1) Cache de contatos da própria lib (`sock.contacts.getName`) — é a fonte
  //    que guarda o NOME DO CONTATO (agenda > notify > verifiedName > username).
  //    Depois o atalho tolerante `nazu.getName` (aceita `getName(jid)` e
  //    `getName(chat, jid)`), para quem implementa por conta própria.
  const alvosGetName = [id, numeros[0] && `${numeros[0]}@s.whatsapp.net`].filter(Boolean);
  if (nazu?.contacts && typeof nazu.contacts.getName === 'function') {
    for (const alvo of alvosGetName) {
      try {
        // A da lib é síncrona, mas aceitamos retorno assíncrono também.
        const nome = await nazu.contacts.getName(alvo);
        if (aceito(nome)) return limpo(nome);
      } catch { /* segue */ }
    }
  }
  if (nazu && typeof nazu.getName === 'function') {
    for (const alvo of alvosGetName) {
      try {
        const nome = await nazu.getName(alvo);
        if (aceito(nome)) return limpo(nome);
      } catch { /* segue */ }
    }
  }

  // 2) Contatos da sessão (indexados normalmente pelo telefone).
  try {
    const contacts = contatosDaSessao(nazu);
    for (const key of Object.keys(contacts)) {
      if (!basesBusca.has(baseId(key))) continue;
      const c = contacts[key] || {};
      const cand = c.notify || c.verifiedName || c.name || c.subject;
      if (aceito(cand)) return limpo(cand);
    }
  } catch { /* segue */ }

  // 3) Metadata do grupo.
  try {
    const p = acharParticipantePorId(metadata, id);
    const cand = p?.notify || p?.name || p?.pushName;
    if (aceito(cand)) return limpo(cand);
  } catch { /* segue */ }

  // 4) Fallback do chamador (ex.: `pushname` do contador de atividade).
  if (aceito(fallback)) return limpo(fallback);

  // 5) Número de telefone do membro.
  if (numeros.length) return numeros[0];

  // 6) O próprio id.
  return base || 'Usuário';
}

/**
 * Versão para LISTAS: resolve o nome de uma lista de ids reaproveitando o
 * mesmo alvo várias vezes sem repetir consultas ao socket por id.
 *
 * @param {string[]} ids
 * @param {object} [opts]  mesmas opções de `resolverNomeContato`, mais
 *   `fallbackPorId(id)` para o caso em que o chamador já tem um nome por id
 *   (ex.: o `pushname` do contador de atividade).
 * @returns {Promise<Map<string,string>>} mapa `id -> nome`
 */
export async function resolverNomesContatos(ids, opts = {}) {
  const { fallbackPorId, ...resto } = opts;
  const mapa = new Map();
  for (const id of ids) {
    const fallback = typeof fallbackPorId === 'function' ? fallbackPorId(id) : resto.fallback;
    mapa.set(id, await resolverNomeContato(id, { ...resto, fallback }));
  }
  return mapa;
}
