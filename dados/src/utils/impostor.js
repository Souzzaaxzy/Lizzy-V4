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
 * Mínimo de jogadores para `q` impostores: **3 com 1, 5 com 2** (2*q + 1) —
 * precisa sobrar tripulação em número suficiente. Não há teto de jogadores.
 *
 * @param {number} [quantidadeImpostores]
 * @returns {number}
 */
export function minJogadores(quantidadeImpostores = 1) {
  const q = Math.min(Math.max(Number(quantidadeImpostores) || 1, 1), MAX_IMPOSTORES);
  return 2 * q + 1;
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

/** Entra na sala (só no lobby). Não há teto de jogadores. */
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

/** Registra o voto de um jogador (só quem ainda está na partida). */
export function votar(jogo, votante, alvo) {
  if (!jogo || !Array.isArray(jogo.jogadores)) return { ok: false, motivo: 'sem_jogo' };
  const vivos = jogoJogadores(jogo);
  if (!vivos.includes(votante)) return { ok: false, motivo: 'nao_jogador' };
  if (!vivos.includes(alvo)) return { ok: false, motivo: 'alvo_invalido' };
  if (votante === alvo) return { ok: false, motivo: 'voto_em_si' };
  jogo.votos[votante] = alvo;
  return { ok: true };
}

/**
 * Jogadores AINDA na partida (expulsos saem). Na 1ª rodada é a lista inteira.
 */
export function jogoJogadores(jogo) {
  const todos = Array.isArray(jogo?.jogadores) ? jogo.jogadores : [];
  const expulsos = Array.isArray(jogo?.expulsos) ? jogo.expulsos : [];
  return todos.filter((j) => !expulsos.includes(j));
}

/** Impostores que ainda estão na partida (não foram expulsos). */
export function impostoresVivos(jogo) {
  const impostores = Array.isArray(jogo?.impostores) && jogo.impostores.length
    ? jogo.impostores
    : (jogo?.impostor ? [jogo.impostor] : []);
  const expulsos = Array.isArray(jogo?.expulsos) ? jogo.expulsos : [];
  return impostores.filter((i) => !expulsos.includes(i));
}

/** Todos os jogadores vivos já votaram? */
export function todosVotaram(jogo) {
  const vivos = jogoJogadores(jogo);
  if (!vivos.length) return false;
  return vivos.every((j) => jogo.votos && jogo.votos[j] !== undefined);
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
 * Decide se a RODADA de votação já pode fechar, SEM esperar todos.
 *
 * Regras (o voto é do grupo, ninguém é obrigado a votar):
 *   1. **Maioria absoluta** entre os VIVOS: alguém tem mais da metade -> fecha.
 *   2. **Todos os vivos votaram**: fecha (mesmo empatado).
 *   3. **Inalcançável**: líder único e os pendentes nem somando alcançam.
 *   4. Caso contrário: **aguarda**.
 *
 * @param {object} jogo
 * @returns {{decidido: boolean, motivo: string, maisVotado: string|null,
 *            pendentes: number, maxVotos: number, total: number}}
 */
export function checarVotacao(jogo) {
  const total = jogoJogadores(jogo).length;
  const votos = Object.keys(jogo?.votos || {}).length;
  const pendentes = Math.max(total - votos, 0);
  const lista = contarVotos(jogo?.votos);
  const topo = lista[0] || null;
  const maxVotos = topo ? topo.votos : 0;
  const segundo = lista[1] ? lista[1].votos : 0;
  const empatadosNoTopo = lista.filter((x) => x.votos === maxVotos && maxVotos > 0);

  if (maxVotos > total / 2) {
    return { decidido: true, motivo: 'maioria_absoluta', maisVotado: topo.alvo, pendentes, maxVotos, total };
  }
  if (pendentes <= 0) {
    return {
      decidido: true,
      motivo: empatadosNoTopo.length > 1 ? 'empate' : 'todos_votaram',
      maisVotado: topo ? topo.alvo : null,
      pendentes,
      maxVotos,
      total
    };
  }
  if (topo && empatadosNoTopo.length === 1 && maxVotos > segundo + pendentes) {
    return { decidido: true, motivo: 'inalcancavel', maisVotado: topo.alvo, pendentes, maxVotos, total };
  }
  return { decidido: false, motivo: 'aguardando', maisVotado: topo ? topo.alvo : null, pendentes, maxVotos, total };
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

/**
 * Resolve a RODADA: conta os votos e decide o que acontece.
 *
 * - empate -> ninguém sai; a rodada reinicia (`reiniciar: true`).
 * - expulsou um IMPOSTOR -> ele sai; se ainda sobrou impostor, a partida
 *   **continua** em outra rodada (`continua: true`); se era o último, o grupo
 *   ganhou (`fim: 'grupo'`).
 * - expulsou um INOCENTE -> os impostores ganham (`fim: 'impostores'`).
 *
 * @returns {{empate: boolean, maisVotado: string|null, votos: number, lista: Array,
 *            expulsou: string|null, eraImpostor: boolean, reiniciar: boolean,
 *            continua: boolean, fim: 'grupo'|'impostores'|null,
 *            impostoresVivos: string[], impostoresRestantes: number}}
 */
export function resolverRodada(jogo) {
  const { empate, maisVotado, votos, lista } = resolverVotacao(jogo?.votos);
  const vivosAntes = jogoJogadores(jogo);
  const impostoresAntes = impostoresVivos(jogo);

  if (empate || !maisVotado) {
    return {
      empate: true, maisVotado: maisVotado || null, votos, lista,
      expulsou: null, eraImpostor: false, reiniciar: true, continua: false,
      fim: null, impostoresVivos: impostoresAntes, impostoresRestantes: impostoresAntes.length
    };
  }

  const eraImpostor = impostoresAntes.includes(maisVotado);
  const restantes = eraImpostor ? impostoresAntes.filter((i) => i !== maisVotado) : impostoresAntes;
  const inocentesRestantes = vivosAntes.filter((j) => j !== maisVotado && !impostoresAntes.includes(j));

  let fim = null;
  let continua = false;
  if (eraImpostor) {
    if (restantes.length === 0) fim = 'grupo';
    else continua = true;
  } else {
    // Expulsou um inocente. Se não há mais inocentes que os impostores, os
    // impostores venceram (não dá mais para votar um impostor para fora).
    if (inocentesRestantes.length <= restantes.length) fim = 'impostores';
    else continua = true;
  }

  return {
    empate: false, maisVotado, votos, lista,
    expulsou: maisVotado, eraImpostor, reiniciar: false, continua, fim,
    impostoresVivos: restantes, impostoresRestantes: restantes.length
  };
}

/**
 * Aplica o resultado de uma rodada ao estado do jogo.
 *
 * @param {object} jogo
 * @returns {{texto: string, mentions: string[], rodada: object}}
 */
export function aplicarRodada(jogo, nomeDe = (jid) => `@${String(jid).split('@')[0]}`) {
  const rodada = resolverRodada(jogo);
  const lista = rodada.lista.length
    ? rodada.lista.map((x, i) => `• ${i + 1}º ${nomeDe(x.alvo)} — ${x.votos} voto(s)`).join('\n')
    : '• Ninguém votou 😅';

  const mentions = [...new Set([...rodada.impostoresVivos, rodada.maisVotado, ...rodada.lista.map((x) => x.alvo)].filter(Boolean))];
  let cabeca;
  if (rodada.empate) {
    cabeca = `⚖️ *EMPATE!* Ninguém foi expulso nesta rodada.\n🗳️ Votem de novo!`;
  } else if (rodada.eraImpostor) {
    cabeca = `🎯 *${nomeDe(rodada.expulsou)} foi expulso… e ERA IMPOSTOR!* 😈`;
  } else {
    cabeca = `💀 *${nomeDe(rodada.expulsou)} foi expulso… mas era INOCENTE!* 😢`;
  }

  let rodape = '';
  if (rodada.reiniciar) {
    rodape = '🗳️ Nova rodada: votem em quem acham que é o impostor.';
  } else if (rodada.continua) {
    rodape = `😈 Ainda há *${rodada.impostoresRestantes}* impostor(es) entre vocês!\n🗳️ Votem de novo no próximo comando de voto.`;
  } else if (rodada.fim === 'grupo') {
    rodape = '🏆 *O GRUPO GANHOU!* Todos os impostores foram expulsos!';
  } else if (rodada.fim === 'impostores') {
    rodape = '😈 *OS IMPOSTORES GANHARAM!*';
  }

  const texto =
    `🕵️ *RESULTADO DA RODADA*\n\n` +
    `🗳️ *Votos:*\n${lista}\n\n` +
    `${cabeca}\n\n` +
    `${rodape}\n\n` +
    `😈 Impostor(es) vivo(s): ${rodada.impostoresVivos.map(nomeDe).join(', ') || 'nenhum'}\n` +
    `🧑 Palavra do grupo: *${jogo?.palavraComum || ''}*`;

  return { texto, mentions, rodada };
}

/**
 * Consome a rodada no estado do jogo: marca o expulso, limpa os votos e decide
 * se a partida segue ou terminou.
 *
 * @returns {{rodada: object, terminou: boolean}}
 */
export function consumirRodada(jogo) {
  const rodada = resolverRodada(jogo);
  if (rodada.empate) {
    jogo.votos = {};
    return { rodada, terminou: false };
  }
  jogo.expulsos = Array.isArray(jogo.expulsos) ? jogo.expulsos : [];
  if (rodada.expulsou && !jogo.expulsos.includes(rodada.expulsou)) jogo.expulsos.push(rodada.expulsou);
  jogo.votos = {};
  jogo.rodada = (jogo.rodada || 1) + 1;
  const terminou = !rodada.continua;
  return { rodada, terminou };
}

/**
 * Encerra a partida com o resultado final (tempo esgotado ou encerrar manual).
 */
export function encerrarPartida(jogo) {
  const { empate, maisVotado, lista } = resolverVotacao(jogo?.votos);
  const impostores = Array.isArray(jogo?.impostores) && jogo.impostores.length
    ? jogo.impostores
    : (jogo?.impostor ? [jogo.impostor] : []);
  const vivos = impostoresVivos(jogo);
  const acertouImpostor = !empate && !!maisVotado && vivos.includes(maisVotado);
  return {
    impostores,
    quantidadeImpostores: impostores.length,
    impostor: impostores[0] || null,
    palavraComum: jogo?.palavraComum || '',
    maisVotado,
    empate,
    acertaram: acertouImpostor,
    restantes: Math.max(vivos.length - (acertouImpostor ? 1 : 0), 0),
    expulsos: Array.isArray(jogo?.expulsos) ? jogo.expulsos : [],
    lista
  };
}

/**
 * Texto do encerramento (tempo esgotado / encerrar manual): revela quem eram os
 * impostores e o que sobrou.
 */
export function formatarResultado(jogo, nomeDe = (jid) => `@${String(jid).split('@')[0]}`) {
  const res = encerrarPartida(jogo);
  const varios = res.impostores.length > 1;
  const linhasVotos = res.lista.length
    ? res.lista.map((x, i) => `• ${i + 1}º ${nomeDe(x.alvo)} — ${x.votos} voto(s)`).join('\n')
    : '• Ninguém votou 😅';
  const vivos = impostoresVivos(jogo);
  const veredito = vivos.length
    ? `😈 *O(S) IMPOSTOR(ES) GANHARAM!* Sobrou ${vivos.map(nomeDe).join(', ')}.`
    : `🏆 *O GRUPO GANHOU!* Todos os impostores foram expulsos!`;

  const mentions = [...new Set([...res.impostores, res.maisVotado, ...res.lista.map((x) => x.alvo)].filter(Boolean))];
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
  jogoJogadores,
  impostoresVivos,
  todosVotaram,
  msRestantes,
  tempoEsgotado,
  checarVotacao,
  contarVotos,
  resolverVotacao,
  resolverRodada,
  aplicarRodada,
  consumirRodada,
  encerrarPartida,
  formatarResultado
};
