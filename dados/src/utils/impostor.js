/**
 * `!impostor` — Among Us de texto no grupo, SEM privado.
 *
 * A palavra secreta de cada jogador chega por **mensagem invisível** dentro do
 * próprio grupo (a mesma entrega do `!rajar`): o conteúdo é um
 * `requestPaymentMessage` e o transporte é a rotação de Sender Key restrita a
 * `allowedParticipants: [jogador]`. Ou seja, só aquele jogador decifra — nem os
 * outros jogadores nem os admins veem. Nada vai para o PV.
 *
 * O estado da partida vive em `global.impostorGames[grupo]` (memória, como o
 * `!uno`): a partida é da sessão do socket.
 *
 * Este módulo é PURO (não conhece socket nem fs): quem chama passa os membros e
 * um `enviarSecreto` que faz a entrega invisível. Isso deixa a lógica toda
 * testável sem subir o handler.
 */

/** Mínimo de jogadores para uma partida. */
export const MIN_JOGADORES = 3;

/**
 * Escolhe o impostor e monta as atribuições.
 *
 * @param {string[]} membros  JIDs/LIDs dos jogadores (ordem qualquer)
 * @param {() => number} [rng] gerador [0,1) (injetável para teste)
 * @returns {{impostor: string, atribuicoes: Array<{jid: string, palavra: string}>}}
 */
export function escolherImpostor(membros, rng = Math.random) {
  const lista = [...new Set((membros || []).filter(Boolean))];
  if (lista.length < MIN_JOGADORES) return { impostor: null, atribuicoes: [] };
  const idx = Math.floor(rng() * lista.length) % lista.length;
  return { impostor: lista[idx], atribuicoes: [] };
}

/**
 * Sorteia um par (comum, impostor) do banco.
 *
 * @param {object} banco  `{ categorias: { nome: [[comum, impostor], ...] } }`
 * @param {string} [categoria] nome da categoria (ou aleatória)
 * @param {() => number} [rng]
 * @returns {{comum: string, impostor: string, categoria: string}|null}
 */
export function sortearPar(banco, categoria, rng = Math.random) {
  const categorias = banco && banco.categorias && typeof banco.categorias === 'object' ? banco.categorias : {};
  const nomes = Object.keys(categorias).filter((c) => Array.isArray(categorias[c]) && categorias[c].length);
  if (!nomes.length) return null;
  const escolhida = (categoria && categorias[categoria] && categorias[categoria].length)
    ? categoria
    : nomes[Math.floor(rng() * nomes.length) % nomes.length];
  const pares = categorias[escolhida];
  const par = pares[Math.floor(rng() * pares.length) % pares.length];
  return { comum: par[0], impostor: par[1], categoria: escolhida };
}

/**
 * Monta a atribuição de cada jogador (comum recebe a palavra comum; o impostor
 * recebe a dele).
 */
export function montarAtribuicoes(membros, par, impostor) {
  return (membros || []).map((jid) => ({
    jid,
    palavra: jid === impostor ? par.impostor : par.comum
  }));
}

/** Embaralha (Fisher-Yates) com rng injetável. */
export function embaralhar(lista, rng = Math.random) {
  const arr = [...lista];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** Texto do "cartão secreto" de um jogador (vai na mensagem invisível). */
export function textoAtribuicao(palavra, ehImpostor) {
  return ehImpostor
    ? `🕵️ *VOCÊ É O IMPOSTOR!*\n\nFaça o máximo para não ser descoberto! 😈`
    : `🧑 *Sua palavra é:* *${palavra}*\n\n🤫 Descreva sem falar direto e descubra o impostor!`;
}

/** Votos (por jogador) e contagem. */
export function contarVotos(votos) {
  const contagem = new Map();
  for (const alvo of Object.values(votos || {})) {
    if (!alvo) continue;
    contagem.set(alvo, (contagem.get(alvo) || 0) + 1);
  }
  const lista = [...contagem.entries()].map(([alvo, n]) => ({ alvo, votos: n }));
  // Mais votado primeiro; empate resolvido pelo id (estável).
  lista.sort((a, b) => b.votos - a.votos || String(a.alvo).localeCompare(String(b.alvo)));
  return lista;
}

/**
 * Resolve a votação.
 *
 * @returns {{empate: boolean, maisVotado: string|null, votos: number, lista: Array}}
 */
export function resolverVotacao(votos) {
  const lista = contarVotos(votos);
  if (!lista.length) return { empate: false, maisVotado: null, votos: 0, lista };
  const topo = lista[0];
  const empatados = lista.filter((x) => x.votos === topo.votos);
  return { empate: empatados.length > 1, maisVotado: topo.alvo, votos: topo.votos, lista };
}

/**
 * Inicia a partida: sorteia o par, escolhe o impostor, monta as atribuições,
 * ANUNCIA (mensagem pública com as regras + a dica) e ENTREGA cada cartão por
 * `enviarSecreto` (a mensagem invisível).
 *
 * Ordem pedida: o anúncio público sai ANTES, dizendo que logo abaixo os
 * jogadores receberam a palavra. Depois vêm os cartões invisíveis.
 *
 * Falha fechada: se não houver jogadores suficientes, devolve
 * `{ ok: false, motivo }` sem enviar nada.
 *
 * @param {object} opts
 * @param {string[]} opts.membros
 * @param {object} opts.banco
 * @param {string} [opts.categoria]
 * @param {(jid: string, texto: string) => Promise<boolean>} opts.enviarSecreto
 * @param {(info: {categoria: string, jogadores: string[], total: number}) => Promise<void>} [opts.anunciar]
 * @param {() => number} [opts.rng]
 * @returns {Promise<{ok: boolean, motivo?: string, jogo?: object}>}
 */
export async function iniciarPartida({ membros, banco, categoria, enviarSecreto, anunciar, rng = Math.random }) {
  const lista = [...new Set((membros || []).filter(Boolean))];
  if (lista.length < MIN_JOGADORES) {
    return { ok: false, motivo: 'poucos_jogadores' };
  }
  const par = sortearPar(banco, categoria, rng);
  if (!par) return { ok: false, motivo: 'sem_palavras' };

  const { impostor } = escolherImpostor(lista, rng);
  const atribuicoes = montarAtribuicoes(lista, par, impostor);

  // 1) Anúncio público (regras + dica) antes das palavras.
  if (typeof anunciar === 'function') {
    await anunciar({ categoria: par.categoria, jogadores: lista, total: lista.length });
  }

  // 2) Entrega o cartão de cada um (invisível). Se a entrega falhar, a partida
  // NÃO começa — melhor avisar do que rodar sem alguém saber a palavra.
  let entregues = 0;
  for (const a of atribuicoes) {
    const ok = await enviarSecreto(a.jid, textoAtribuicao(a.palavra, a.jid === impostor));
    if (ok) entregues += 1;
  }
  if (entregues < lista.length) {
    return { ok: false, motivo: 'falha_na_entrega', entregues, total: lista.length };
  }

  return {
    ok: true,
    jogo: {
      impostor,
      palavraComum: par.comum,
      palavraImpostor: par.impostor,
      categoria: par.categoria,
      jogadores: lista,
      atribuicoes,
      votos: {},
      iniciado: Date.now()
    }
  };
}

/**
 * Registra o voto de um jogador.
 *
 * @returns {{ok: boolean, motivo?: string}}
 */
export function votar(jogo, votante, alvo) {
  if (!jogo || !Array.isArray(jogo.jogadores)) return { ok: false, motivo: 'sem_jogo' };
  if (!jogo.jogadores.includes(votante)) return { ok: false, motivo: 'nao_jogador' };
  if (!jogo.jogadores.includes(alvo)) return { ok: false, motivo: 'alvo_invalido' };
  if (votante === alvo) return { ok: false, motivo: 'voto_em_si' };
  jogo.votos[votante] = alvo;
  return { ok: true };
}

/**
 * Encerra a partida com o resultado da votação.
 *
 * @returns {{impostor: string, palavraComum: string, palavraImpostor: string,
 *            maisVotado: string|null, empate: boolean, acertaram: boolean,
 *            lista: Array}}
 */
export function encerrarPartida(jogo) {
  const { empate, maisVotado, lista } = resolverVotacao(jogo?.votos);
  return {
    impostor: jogo?.impostor || null,
    palavraComum: jogo?.palavraComum || '',
    palavraImpostor: jogo?.palavraImpostor || '',
    maisVotado,
    empate,
    acertaram: !empate && maisVotado === jogo?.impostor,
    lista
  };
}

export default {
  MIN_JOGADORES,
  escolherImpostor,
  sortearPar,
  montarAtribuicoes,
  embaralhar,
  textoAtribuicao,
  contarVotos,
  resolverVotacao,
  iniciarPartida,
  votar,
  encerrarPartida
};
