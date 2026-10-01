/**
 * `!impostor` — Among Us de texto no grupo, SEM privado.
 *
 * A palavra secreta de cada jogador chega por **mensagem invisível** dentro do
 * próprio grupo (mesma entrega do `!rajar`): a mensagem é NORMAL, mas o
 * transporte é a rotação de Sender Key restrita a `allowedParticipants: [jogador]`.
 * Ou seja, só aquele jogador decifra — nem os outros jogadores nem os admins
 * veem. Nada vai para o PV.
 *
 * Fluxo com LOBBY:
 *   `!impostor criar`    -> abre a sala (quem cria já entra)
 *   `!impostor entrar`   -> entra na sala
 *   `!impostor`          -> status (sala/partida)
 *   `!impostor sair`     -> sai da sala
 *   `!impostor fechar`   -> fecha a sala (só quem criou)
 *   `!impostor iniciar`  -> começa a partida (só quem criou)
 *   `!impostor votar @x` -> vota; quando TODOS votam, encerra sozinho
 *
 * Este módulo é PURO (não conhece socket nem fs): quem chama passa os membros e
 * um `enviarSecreto` que faz a entrega invisível.
 */

/** Mínimo de jogadores para uma partida. */
export const MIN_JOGADORES = 3;

// ════════════════════════════════════════════════════════════════════════════
// LOBBY
// ════════════════════════════════════════════════════════════════════════════

/** Cria a sala; quem cria já entra como jogador. */
export function criarLobby(criador) {
  return { fase: 'lobby', criador, jogadores: [criador], criadoEm: Date.now() };
}

/** Entra na sala (só no lobby). */
export function entrarNoLobby(lobby, jid) {
  if (!lobby || lobby.fase !== 'lobby') return { ok: false, motivo: 'sem_sala' };
  if (!jid) return { ok: false, motivo: 'jid_invalido' };
  if (lobby.jogadores.includes(jid)) return { ok: false, motivo: 'ja_esta' };
  lobby.jogadores.push(jid);
  return { ok: true };
}

/**
 * Sai da sala (só no lobby). Se quem saiu é o CRIADOR, a sala fecha
 * (`fechou: true`) — sem o criador ninguém poderia iniciar.
 */
export function sairDoLobby(lobby, jid) {
  if (!lobby || lobby.fase !== 'lobby') return { ok: false, motivo: 'sem_sala' };
  if (!lobby.jogadores.includes(jid)) return { ok: false, motivo: 'nao_esta' };
  lobby.jogadores = lobby.jogadores.filter((j) => j !== jid);
  if (jid === lobby.criador) return { ok: true, fechou: true };
  return { ok: true, fechou: false };
}

/** Só o criador inicia, e precisa do mínimo de jogadores. */
export function podeIniciar(lobby, jid) {
  if (!lobby || lobby.fase !== 'lobby') return { ok: false, motivo: 'sem_sala' };
  if (lobby.criador !== jid) return { ok: false, motivo: 'nao_criador' };
  if (lobby.jogadores.length < MIN_JOGADORES) {
    return { ok: false, motivo: 'poucos_jogadores', faltam: MIN_JOGADORES - lobby.jogadores.length };
  }
  return { ok: true };
}

// ════════════════════════════════════════════════════════════════════════════
// SORTEIO E ATRIBUIÇÃO
// ════════════════════════════════════════════════════════════════════════════

/**
 * Escolhe o impostor.
 *
 * @param {string[]} membros
 * @param {() => number} [rng]
 * @returns {{impostor: string|null}}
 */
export function escolherImpostor(membros, rng = Math.random) {
  const lista = [...new Set((membros || []).filter(Boolean))];
  if (lista.length < MIN_JOGADORES) return { impostor: null };
  const idx = Math.floor(rng() * lista.length) % lista.length;
  return { impostor: lista[idx] };
}

/**
 * Sorteia um par (comum, impostor) do banco.
 *
 * @param {object} banco `{ categorias: { nome: [[comum, impostor], ...] } }`
 * @param {string} [categoria]
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

/** Atribuição de cada jogador (comum recebe a palavra comum). */
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

/** Cartão secreto de um jogador (vai na mensagem invisível). */
export function textoAtribuicao(palavra, ehImpostor) {
  return ehImpostor
    ? `🕵️ *VOCÊ É O IMPOSTOR!*\n\nFaça o máximo para não ser descoberto! 😈`
    : `🧑 *Sua palavra é:* *${palavra}*\n\n🤫 Descreva sem falar direto e descubra o impostor!`;
}

// ════════════════════════════════════════════════════════════════════════════
// PARTIDA
// ════════════════════════════════════════════════════════════════════════════

/**
 * Inicia a partida: anuncia (regras + dica), sorteia e entrega as palavras.
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
  if (lista.length < MIN_JOGADORES) return { ok: false, motivo: 'poucos_jogadores' };
  const par = sortearPar(banco, categoria, rng);
  if (!par) return { ok: false, motivo: 'sem_palavras' };

  const { impostor } = escolherImpostor(lista, rng);
  const atribuicoes = montarAtribuicoes(lista, par, impostor);

  // 1) Anúncio público (regras + dica) ANTES das palavras.
  if (typeof anunciar === 'function') {
    await anunciar({ categoria: par.categoria, jogadores: lista, total: lista.length });
  }

  // 2) Entrega o cartão de cada um (invisível). Falha fechado se algum falhar.
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
      fase: 'jogando',
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

/** Registra o voto de um jogador. */
export function votar(jogo, votante, alvo) {
  if (!jogo || !Array.isArray(jogo.jogadores)) return { ok: false, motivo: 'sem_jogo' };
  if (!jogo.jogadores.includes(votante)) return { ok: false, motivo: 'nao_jogador' };
  if (!jogo.jogadores.includes(alvo)) return { ok: false, motivo: 'alvo_invalido' };
  if (votante === alvo) return { ok: false, motivo: 'voto_em_si' };
  jogo.votos[votante] = alvo;
  return { ok: true };
}

/** Todos os jogadores já votaram? */
export function todosVotaram(jogo) {
  if (!jogo || !Array.isArray(jogo.jogadores) || !jogo.jogadores.length) return false;
  return Object.keys(jogo.votos || {}).length >= jogo.jogadores.length;
}

/**
 * Decide se a votação já pode encerrar, SEM esperar todos.
 *
 * Regras (o voto é do grupo inteiro, ninguém é obrigado a votar):
 *   1. **Maioria absoluta**: alguém tem mais da metade dos jogadores -> encerra.
 *      Ex.: 5 jogadores, 3 votos no mesmo alvo -> já decidiu (3 > 2,5).
 *   2. **Todos votaram**: encerra (mesmo empatado — aí o resultado é empate).
 *   3. **Inalcançável**: o líder é único e os que faltam nem somando alcançam.
 *   4. Caso contrário: **aguarda** (pode virar empate).
 *
 * @param {object} jogo
 * @returns {{decidido: boolean, motivo: string, maisVotado?: string|null,
 *            pendentes: number, maxVotos: number}}
 */
export function checarVotacao(jogo) {
  const total = Array.isArray(jogo?.jogadores) ? jogo.jogadores.length : 0;
  const votos = Object.keys(jogo?.votos || {}).length;
  const pendentes = Math.max(total - votos, 0);
  const lista = contarVotos(jogo?.votos);
  const topo = lista[0] || null;
  const maxVotos = topo ? topo.votos : 0;
  const segundo = lista[1] ? lista[1].votos : 0;
  const empatadosNoTopo = lista.filter((x) => x.votos === maxVotos && maxVotos > 0);

  // 1) Maioria absoluta.
  if (maxVotos > total / 2) {
    return { decidido: true, motivo: 'maioria_absoluta', maisVotado: topo.alvo, pendentes, maxVotos };
  }
  // 2) Todos votaram.
  if (pendentes <= 0) {
    return {
      decidido: true,
      motivo: empatadosNoTopo.length > 1 ? 'empate' : 'todos_votaram',
      maisVotado: topo ? topo.alvo : null,
      pendentes,
      maxVotos
    };
  }
  // 3) Líder único e inalcançável (nem somando todos os pendentes ele empata).
  if (topo && empatadosNoTopo.length === 1 && maxVotos > segundo + pendentes) {
    return { decidido: true, motivo: 'inalcancavel', maisVotado: topo.alvo, pendentes, maxVotos };
  }
  // 4) Aguarda.
  return { decidido: false, motivo: 'aguardando', maisVotado: topo ? topo.alvo : null, pendentes, maxVotos };
}

/** Votos (por alvo) e contagem. */
export function contarVotos(votos) {
  const contagem = new Map();
  for (const alvo of Object.values(votos || {})) {
    if (!alvo) continue;
    contagem.set(alvo, (contagem.get(alvo) || 0) + 1);
  }
  const lista = [...contagem.entries()].map(([alvo, n]) => ({ alvo, votos: n }));
  lista.sort((a, b) => b.votos - a.votos || String(a.alvo).localeCompare(String(b.alvo)));
  return lista;
}

/** Resolve a votação (mais votado + empate). */
export function resolverVotacao(votos) {
  const lista = contarVotos(votos);
  if (!lista.length) return { empate: false, maisVotado: null, votos: 0, lista };
  const topo = lista[0];
  const empatados = lista.filter((x) => x.votos === topo.votos);
  return { empate: empatados.length > 1, maisVotado: topo.alvo, votos: topo.votos, lista };
}

/** Encerra a partida com o resultado da votação. */
export function encerrarPartida(jogo) {
  const { empate, maisVotado, lista } = resolverVotacao(jogo?.votos);
  return {
    impostor: jogo?.impostor || null,
    palavraComum: jogo?.palavraComum || '',
    maisVotado,
    empate,
    acertaram: !empate && maisVotado === jogo?.impostor,
    lista
  };
}

/**
 * Monta o texto do resultado (usado no encerrar manual e no auto-encerramento
 * por maioria).
 *
 * IMPORTANTE: o `nomeDe` é aplicado em TODOS os alvos de voto (não só no
 * impostor/mais votado) — senão quem só aparece na lista de votos ficaria como
 * `@<lid>` no texto. O `mentions` cobre impostor + mais votado + todos os alvos.
 *
 * @param {object} jogo
 * @param {(jid: string) => string} [nomeDe]
 * @returns {{texto: string, mentions: string[], resultado: object}}
 */
export function formatarResultado(jogo, nomeDe = (jid) => `@${String(jid).split('@')[0]}`) {
  const res = encerrarPartida(jogo);
  const linhasVotos = res.lista.length
    ? res.lista.map((x, i) => `• ${i + 1}º ${nomeDe(x.alvo)} — ${x.votos} voto(s)`).join('\n')
    : '• Ninguém votou 😅';
  const veredito = res.empate
    ? '⚖️ *EMPATE!* Ninguém foi expulso — o impostor escapou 😈'
    : res.acertaram
      ? `🎉 *O GRUPO GANHOU!* ${nomeDe(res.maisVotado)} era o impostor!`
      : `😈 *O IMPOSTOR GANHOU!* Expulsaram ${nomeDe(res.maisVotado)}, que era inocente.`;

  const alvosVotados = res.lista.map((x) => x.alvo);
  const mentions = [...new Set([res.impostor, res.maisVotado, ...alvosVotados].filter(Boolean))];
  const texto =
    `🕵️ *RESULTADO DO IMPOSTOR*\n\n` +
    `🗳️ *Votos:*\n${linhasVotos}\n\n` +
    `${veredito}\n\n` +
    `😈 Impostor: ${nomeDe(res.impostor)}\n` +
    `🧑 Palavra do grupo: *${res.palavraComum}*`;

  return { texto, mentions, resultado: res };
}

export default {
  MIN_JOGADORES,
  criarLobby,
  entrarNoLobby,
  sairDoLobby,
  podeIniciar,
  escolherImpostor,
  sortearPar,
  montarAtribuicoes,
  embaralhar,
  textoAtribuicao,
  iniciarPartida,
  votar,
  todosVotaram,
  checarVotacao,
  contarVotos,
  resolverVotacao,
  encerrarPartida,
  formatarResultado
};
