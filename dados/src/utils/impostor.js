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

/** Mínimo de jogadores para uma partida (com 1 impostor). */
export const MIN_JOGADORES = 3;

/** Máximo de impostores por partida. */
export const MAX_IMPOSTORES = 2;

/** Tempo máximo de partida (15 minutos). */
export const DURACAO_MAX_MS = 15 * 60 * 1000;

/**
 * Mínimo de jogadores para `q` impostores: 3 com 1, 4 com 2 (precisa sobrar
 * tripulação).
 *
 * @param {number} [quantidadeImpostores]
 * @returns {number}
 */
export function minJogadores(quantidadeImpostores = 1) {
  const q = Math.min(Math.max(Number(quantidadeImpostores) || 1, 1), MAX_IMPOSTORES);
  return MIN_JOGADORES + (q - 1);
}

/**
 * Interpreta a duração digitada em `!impostor criar <tempo>`.
 *
 * Aceita `5`, `5m`, `5min`, `5 minutos`. **Trava no máximo de 15 minutos**
 * (marca `excedeu: true` quando o valor digitado passou disso).
 *
 * @param {string} texto
 * @returns {{minutos: number, ms: number, excedeu: boolean}|null}
 */
export function parseDuracao(texto) {
  if (texto === null || texto === undefined) return null;
  const m = /^(\d{1,4})\s*(m|min|mins|minuto|minutos)?$/i.exec(String(texto).trim());
  if (!m) return null;
  const bruto = parseInt(m[1], 10);
  if (!Number.isFinite(bruto) || bruto <= 0) return null;
  const minutos = Math.min(bruto, DURACAO_MAX_MS / 60000);
  return { minutos, ms: minutos * 60 * 1000, excedeu: bruto > minutos };
}

/**
 * Interpreta a QUANTIDADE de impostores (1 ou 2).
 *
 * @param {string|number} texto
 * @returns {number|null}
 */
export function parseQuantidadeImpostores(texto) {
  if (texto === null || texto === undefined) return null;
  const m = /^(\d{1,2})$/.exec(String(texto).trim());
  if (!m) return null;
  const n = parseInt(m[1], 10);
  if (n < 1 || n > MAX_IMPOSTORES) return null;
  return n;
}

/**
 * Interpreta os argumentos de `!impostor criar`, em QUALQUER ordem.
 *
 * Regras (para resolver a ambiguidade do número solto):
 *   - token COM sufixo de tempo (`5m`, `10min`, `15 minutos`) -> duração;
 *   - número solto **1** ou **2** -> quantidade de impostores;
 *   - número solto **>= 3** -> duração em minutos (compatível com `criar 5`);
 *   - qualquer outra coisa -> erro.
 *
 * Ex.: `criar 5m 2` | `criar 2 5m` | `criar 2` | `criar 5m` | `criar`.
 *
 * @param {string[]} args
 * @returns {{duracaoMs: number, excedeuTempo: boolean, quantidadeImpostores: number, erro: string|null}}
 */
export function parseOpcoesCriar(args) {
  const lista = (Array.isArray(args) ? args : []).map((a) => String(a ?? '').trim()).filter(Boolean);
  let duracaoMs = 0;
  let excedeuTempo = false;
  let quantidadeImpostores = 1;
  let viuDuracao = false;
  let viuQtd = false;

  for (const token of lista) {
    const temSufixo = /^(m|min|mins|minuto|minutos)$/i.test(token.replace(/^\d+/, ''));
    // 1) Duração explícita (com sufixo).
    if (temSufixo) {
      const dur = parseDuracao(token);
      if (!dur) return { duracaoMs: 0, excedeuTempo: false, quantidadeImpostores: 1, erro: `Tempo inválido: ${token}` };
      if (viuDuracao) return { duracaoMs: 0, excedeuTempo: false, quantidadeImpostores: 1, erro: 'Informe o tempo só uma vez.' };
      duracaoMs = dur.ms;
      excedeuTempo = dur.excedeu;
      viuDuracao = true;
      continue;
    }
    // 2) Número solto.
    if (/^\d{1,4}$/.test(token)) {
      const n = parseInt(token, 10);
      // 1 ou 2 -> impostores; >= 3 -> minutos.
      if (n <= MAX_IMPOSTORES) {
        if (viuQtd) return { duracaoMs: 0, excedeuTempo: false, quantidadeImpostores: 1, erro: 'Informe a quantidade de impostores só uma vez.' };
        quantidadeImpostores = n;
        viuQtd = true;
      } else {
        const dur = parseDuracao(token);
        if (!dur) return { duracaoMs: 0, excedeuTempo: false, quantidadeImpostores: 1, erro: `Tempo inválido: ${token}` };
        if (viuDuracao) return { duracaoMs: 0, excedeuTempo: false, quantidadeImpostores: 1, erro: 'Informe o tempo só uma vez.' };
        duracaoMs = dur.ms;
        excedeuTempo = dur.excedeu;
        viuDuracao = true;
      }
      continue;
    }
    return { duracaoMs: 0, excedeuTempo: false, quantidadeImpostores: 1, erro: `Opção inválida: ${token}` };
  }

  return { duracaoMs, excedeuTempo, quantidadeImpostores, erro: null };
}

// ════════════════════════════════════════════════════════════════════════════
// LOBBY
// ════════════════════════════════════════════════════════════════════════════

/** Cria a sala; quem cria já entra como jogador. */
export function criarLobby(criador, duracaoMs = 0, quantidadeImpostores = 1) {
  return {
    fase: 'lobby',
    criador,
    jogadores: [criador],
    criadoEm: Date.now(),
    duracaoMs: Number(duracaoMs) > 0 ? Number(duracaoMs) : 0,
    quantidadeImpostores: parseQuantidadeImpostores(quantidadeImpostores) || 1
  };
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

/** Só o criador inicia, e precisa do mínimo de jogadores (depende dos impostores). */
export function podeIniciar(lobby, jid) {
  if (!lobby || lobby.fase !== 'lobby') return { ok: false, motivo: 'sem_sala' };
  if (lobby.criador !== jid) return { ok: false, motivo: 'nao_criador' };
  const minimo = minJogadores(lobby.quantidadeImpostores || 1);
  if (lobby.jogadores.length < minimo) {
    return { ok: false, motivo: 'poucos_jogadores', faltam: minimo - lobby.jogadores.length, minimo };
  }
  return { ok: true };
}

// ════════════════════════════════════════════════════════════════════════════
// SORTEIO E ATRIBUIÇÃO
// ════════════════════════════════════════════════════════════════════════════

/**
 * Escolhe os impostores (1 ou 2, sem repetir).
 *
 * @param {string[]} membros
 * @param {number} [quantidade] 1 ou 2
 * @param {() => number} [rng]
 * @returns {{impostores: string[]}}
 */
export function escolherImpostores(membros, quantidade = 1, rng = Math.random) {
  const lista = [...new Set((membros || []).filter(Boolean))];
  const q = Math.min(Math.max(Number(quantidade) || 1, 1), MAX_IMPOSTORES);
  if (lista.length < minJogadores(q)) return { impostores: [] };
  const pool = [...lista];
  const escolhidos = [];
  for (let i = 0; i < q && pool.length; i++) {
    const idx = Math.floor(rng() * pool.length) % pool.length;
    escolhidos.push(pool[idx]);
    pool.splice(idx, 1);
  }
  return { impostores: escolhidos };
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

/**
 * Atribuição de cada jogador (comum recebe a palavra comum; impostores recebem
 * o cartão de impostor, sem palavra).
 *
 * @param {string[]} membros
 * @param {object} par
 * @param {string[]|string} impostores  um jid ou a lista de impostores
 */
export function montarAtribuicoes(membros, par, impostores) {
  const lista = Array.isArray(impostores) ? impostores : [impostores];
  const set = new Set(lista.filter(Boolean));
  return (membros || []).map((jid) => ({
    jid,
    palavra: set.has(jid) ? par.impostor : par.comum,
    ehImpostor: set.has(jid)
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
export async function iniciarPartida({ membros, banco, categoria, enviarSecreto, anunciar, duracaoMs = 0, quantidadeImpostores = 1, rng = Math.random }) {
  const lista = [...new Set((membros || []).filter(Boolean))];
  const q = Math.min(Math.max(Number(quantidadeImpostores) || 1, 1), MAX_IMPOSTORES);
  if (lista.length < minJogadores(q)) return { ok: false, motivo: 'poucos_jogadores' };
  const par = sortearPar(banco, categoria, rng);
  if (!par) return { ok: false, motivo: 'sem_palavras' };

  const { impostores } = escolherImpostores(lista, q, rng);
  const atribuicoes = montarAtribuicoes(lista, par, impostores);

  // 1) Anúncio público (regras + dica) ANTES das palavras.
  if (typeof anunciar === 'function') {
    await anunciar({ categoria: par.categoria, jogadores: lista, total: lista.length, duracaoMs, quantidadeImpostores: q });
  }

  // 2) Entrega o cartão de cada um (invisível). Falha fechado se algum falhar.
  let entregues = 0;
  for (const a of atribuicoes) {
    const ok = await enviarSecreto(a.jid, textoAtribuicao(a.palavra, a.ehImpostor));
    if (ok) entregues += 1;
  }
  if (entregues < lista.length) {
    return { ok: false, motivo: 'falha_na_entrega', entregues, total: lista.length };
  }

  const dur = Number(duracaoMs) > 0 ? Number(duracaoMs) : 0;
  return {
    ok: true,
    jogo: {
      fase: 'jogando',
      impostores,
      quantidadeImpostores: q,
      impostor: impostores[0],
      palavraComum: par.comum,
      palavraImpostor: par.impostor,
      categoria: par.categoria,
      jogadores: lista,
      atribuicoes,
      votos: {},
      iniciado: Date.now(),
      duracaoMs: dur,
      expiraEm: dur > 0 ? Date.now() + dur : 0
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

/** Milissegundos restantes da partida (0 se não tem tempo ou já acabou). */
export function msRestantes(jogo, agora = Date.now()) {
  if (!jogo || !jogo.expiraEm) return 0;
  return Math.max(jogo.expiraEm - agora, 0);
}

/** O tempo da partida acabou? */
export function tempoEsgotado(jogo, agora = Date.now()) {
  if (!jogo || !jogo.expiraEm) return false;
  return agora >= jogo.expiraEm;
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
  const impostores = Array.isArray(jogo?.impostores) && jogo.impostores.length
    ? jogo.impostores
    : (jogo?.impostor ? [jogo.impostor] : []);
  const acertouImpostor = !empate && !!maisVotado && impostores.includes(maisVotado);
  return {
    impostores,
    quantidadeImpostores: impostores.length,
    impostor: impostores[0] || null,
    palavraComum: jogo?.palavraComum || '',
    maisVotado,
    empate,
    acertaram: acertouImpostor,
    restantes: impostores.filter((i) => i !== maisVotado).length,
    lista
  };
}

/**
 * Monta o texto do resultado (usado no encerrar manual e no auto-encerramento
 * por maioria).
 *
 * IMPORTANTE: o `nomeDe` é aplicado em TODOS os alvos de voto (não só nos
 * impostores/mais votado) — senão quem só aparece na lista de votos ficaria como
 * `@<lid>` no texto. O `mentions` cobre impostores + mais votado + todos os alvos.
 *
 * @param {object} jogo
 * @param {(jid: string) => string} [nomeDe]
 * @returns {{texto: string, mentions: string[], resultado: object}}
 */
export function formatarResultado(jogo, nomeDe = (jid) => `@${String(jid).split('@')[0]}`) {
  const res = encerrarPartida(jogo);
  const varios = res.impostores.length > 1;
  const linhasVotos = res.lista.length
    ? res.lista.map((x, i) => `• ${i + 1}º ${nomeDe(x.alvo)} — ${x.votos} voto(s)`).join('\n')
    : '• Ninguém votou 😅';

  let veredito;
  if (res.empate) {
    veredito = '⚖️ *EMPATE!* Ninguém foi expulso — o(s) impostor(es) escaparam 😈';
  } else if (res.acertaram) {
    veredito = varios
      ? (res.restantes > 0
        ? `🎉 *ACERTOU UM!* ${nomeDe(res.maisVotado)} era impostor — mas ainda falta *${res.restantes}* impostor(es) 😈`
        : `🎉 *O GRUPO GANHOU!* Expulsaram TODOS os impostores! 🏆`)
      : `🎉 *O GRUPO GANHOU!* ${nomeDe(res.maisVotado)} era o impostor!`;
  } else {
    veredito = `😈 *O IMPOSTOR GANHOU!* Expulsaram ${nomeDe(res.maisVotado)}, que era inocente.`;
  }

  const alvosVotados = res.lista.map((x) => x.alvo);
  const mentions = [...new Set([...res.impostores, res.maisVotado, ...alvosVotados].filter(Boolean))];
  const texto =
    `🕵️ *RESULTADO DO IMPOSTOR*\n\n` +
    `🗳️ *Votos:*\n${linhasVotos}\n\n` +
    `${veredito}\n\n` +
    `😈 Impostor${varios ? 'es' : ''}: ${res.impostores.map(nomeDe).join(', ') || '-'}\n` +
    `🧑 Palavra do grupo: *${res.palavraComum}*`;

  return { texto, mentions, resultado: res };
}

export default {
  MIN_JOGADORES,
  MAX_IMPOSTORES,
  DURACAO_MAX_MS,
  minJogadores,
  parseDuracao,
  parseQuantidadeImpostores,
  parseOpcoesCriar,
  criarLobby,
  entrarNoLobby,
  sairDoLobby,
  podeIniciar,
  escolherImpostores,
  sortearPar,
  montarAtribuicoes,
  embaralhar,
  textoAtribuicao,
  iniciarPartida,
  votar,
  todosVotaram,
  msRestantes,
  tempoEsgotado,
  checarVotacao,
  contarVotos,
  resolverVotacao,
  encerrarPartida,
  formatarResultado
};
