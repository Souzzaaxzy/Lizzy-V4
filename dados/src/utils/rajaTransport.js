// Detecção do "raja" pelo TRANSPORTE — usada pelo comando `!antifantasma`.
//
// Assinatura (a que evita falso positivo):
//   GRUPO + incoming + `enc` SOMENTE pareado (`msg`/`pkmsg`) + SEM `skmsg` +
//   SEM `count`.
//
// A fork calcula isso e expõe em `info.groupEncInfo.pairwiseOnly`; o
// `pairwiseGroupPayload` fica como compatibilidade com uma fork sem o
// `groupEncInfo`. Nada de link/conteúdo entra aqui — o sinal real é o transporte.
//
// Puro: sem socket, sem disco, sem log.

const WRAPPERS = ['ephemeralMessage', 'viewOnceMessage', 'viewOnceMessageV2', 'viewOnceMessageV2Extension', 'deviceSentMessage', 'documentWithCaptionMessage'];

/**
 * O conteúdo decifrado é a PRÓPRIA distribuição de Sender Key?
 *
 * A Baileys gera `senderKeyDistributionMessage` NORMALMENTE (criação de grupo,
 * device novo, re-request de chave) — sem ninguém mandar mensagem. E esse SKDM
 * chega como enc PAREADO (`msg`/`pkmsg`), sem `skmsg`/`count`, ou seja, casa com
 * a assinatura `pairwiseOnly`. Tratar isso como raja removia geral.
 */
export function contemSkdm(message) {
  let atual = message;
  let hops = 0;
  while (atual && typeof atual === 'object' && hops++ < 8) {
    if (atual.senderKeyDistributionMessage || atual.fastRatchetKeySenderKeyDistributionMessage) return true;
    const w = WRAPPERS.find((k) => atual[k] && typeof atual[k] === 'object' && atual[k].message);
    if (!w) break;
    atual = atual[w].message;
  }
  return false;
}

/**
 * True quando a mensagem é o "raja" (enc SOMENTE pareado, sem skmsg, sem count).
 *
 * EXIGE o `groupEncInfo` (a fork calcula `pairwiseOnly`) e NÃO conta quando o
 * conteúdo é a distribuição de Sender Key (SKDM) — essa é gerada normalmente e
 * também chega pareada, então era a causa do "banindo geral". Sem o sinal
 * ESTRITO, retorna `false` de propósito: melhor não detectar do que punir
 * usuário normal.
 */
export function ehRajaTransporte(info) {
  if (!info || typeof info !== 'object') return false;
  if (info.groupEncInfo?.pairwiseOnly !== true) return false;
  if (contemSkdm(info.message)) return false;
  return true;
}

/**
 * Registra uma ocorrência por remetente e devolve quantas houve na janela.
 *
 * O mapa é passado pelo chamador (mantém o módulo puro). A janela é opcional
 * (o `!antifantasma` usa uma janela alta — 2 mensagens já bastam, então o autor
 * só precisa mandá-las dentro do mesmo período de conversa). Podado por tempo e
 * por tamanho, para não crescer sem limite.
 *
 * @returns {{count:number, ids:string[]}}
 */
export function registrarRajada(mapa, chave, id, agora = Date.now(), janelaMs = 5000) {
  if (!chave || !(mapa instanceof Map)) return { count: 0, ids: [] };
  const arr = (mapa.get(chave) || []).filter((e) => agora - e.t < janelaMs);
  // Só conta IDs DIFERENTES (2 IDs diferentes = 2 mensagens distintas). Evita
  // contar a mesma mensagem duas vezes (entrega duplicada) como se fosse rajada.
  if (id && !arr.some((e) => e.id === id)) arr.push({ t: agora, id });
  mapa.set(chave, arr);
  if (mapa.size > 5000) mapa.delete(mapa.keys().next().value);
  return { count: arr.length, ids: arr.map((e) => e.id).filter(Boolean) };
}
