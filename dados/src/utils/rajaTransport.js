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

/** True quando a mensagem é o "raja" (enc somente pareado, sem skmsg, sem count). */
export function ehRajaTransporte(info) {
  if (!info || typeof info !== 'object') return false;
  if (info.groupEncInfo) return info.groupEncInfo.pairwiseOnly === true;
  // Compat: fork antiga só sinaliza a presença do payload pareado.
  return info.pairwiseGroupPayload === true;
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
export function registrarRajada(mapa, chave, id, agora = Date.now(), janelaMs = 600000) {
  if (!chave || !(mapa instanceof Map)) return { count: 0, ids: [] };
  const arr = (mapa.get(chave) || []).filter((e) => agora - e.t < janelaMs);
  if (id) arr.push({ t: agora, id });
  mapa.set(chave, arr);
  if (mapa.size > 5000) mapa.delete(mapa.keys().next().value);
  return { count: arr.length, ids: arr.map((e) => e.id).filter(Boolean) };
}
