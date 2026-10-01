/**
 * Pontuação dos jogos de BRINCADEIRAS e os rankings `!rankbn` / `!rankbng`.
 *
 * Cada jogo (quemsoueu, filme, emojiquiz, quiz, wordle, forca) chama
 * `registrarPontos` quando o jogador acerta. A pontuação fica gravada no JSON
 * do grupo, na chave `rankbn`:
 *
 *   {
 *     "rankbn": {
 *       "<jid do jogador>": { "emojiquiz": 120, "filme": 80 },
 *       ...
 *     }
 *   }
 *
 * O `!rankbn` lê esse mapa do próprio grupo; o `!rankbng` agrega os mapas de
 * TODOS os grupos (ranking global). Nos dois casos só os **5 melhores** entram
 * no texto, com a pontuação individual por jogo e o total.
 *
 * O módulo é puro (não toca em fs nem no socket): quem chama passa o mapa e a
 * função de nome, o que deixa tudo testável sem subir o handler inteiro.
 */

/** Jogos que contam ponto. A ORDEM aqui é a ordem exibida no ranking. */
export const JOGOS_RANKBN = [
  { id: 'emojiquiz', emoji: '🧩', nome: 'emojiquiz' },
  { id: 'filme', emoji: '🎬', nome: 'filme' },
  { id: 'quemsoueu', emoji: '🕵️', nome: 'quemsoueu' },
  { id: 'quiz', emoji: '❓', nome: 'quiz' },
  { id: 'wordle', emoji: '📝', nome: 'wordle' },
  { id: 'forca', emoji: '🎭', nome: 'forca' }
];

/** Teto de jogadores exibidos no ranking. */
export const LIMITE_RANKBN = 5;

/**
 * Soma pontos de um jogador num jogo.
 *
 * @param {object} store mapa `{ jid: { jogo: pontos } }` (mutado no lugar)
 * @param {string} jogo id do jogo (ex.: 'emojiquiz')
 * @param {string} jid jogador
 * @param {number} pontos pontos a somar (positivo)
 * @returns {boolean} true se gravou
 */
export function registrarPontos(store, jogo, jid, pontos) {
  if (!store || typeof store !== 'object') return false;
  if (typeof jid !== 'string' || !jid) return false;
  if (typeof jogo !== 'string' || !jogo) return false;
  const valor = Number(pontos);
  if (!Number.isFinite(valor) || valor <= 0) return false;

  if (!store[jid] || typeof store[jid] !== 'object') store[jid] = {};
  store[jid][jogo] = (Number(store[jid][jogo]) || 0) + valor;
  return true;
}

/** Total de um jogador (soma de todos os jogos). */
export function totalDoJogador(jogos) {
  if (!jogos || typeof jogos !== 'object') return 0;
  return Object.values(jogos).reduce((acc, v) => acc + (Number(v) || 0), 0);
}

/**
 * Ordena os jogadores por total (desc) e devolve no máximo `limite`.
 *
 * @param {object} store mapa `{ jid: { jogo: pontos } }`
 * @param {number} [limite]
 * @returns {Array<{jid: string, jogos: object, total: number}>}
 */
export function ranking(store, limite = LIMITE_RANKBN) {
  const lista = Object.entries(store || {})
    .map(([jid, jogos]) => ({ jid, jogos: jogos && typeof jogos === 'object' ? jogos : {}, total: totalDoJogador(jogos) }))
    .filter((x) => x.total > 0);
  // Empate: desempata pelo jid, para a ordem ser estável entre chamadas.
  lista.sort((a, b) => b.total - a.total || a.jid.localeCompare(b.jid));
  return typeof limite === 'number' && limite > 0 ? lista.slice(0, limite) : lista;
}

/**
 * Monta o texto do ranking no layout pedido:
 *
 *   Rank Brincadeiras
 *
 *   1 @Fulano
 *   emojiquiz: 120
 *   filme: 80
 *   total: 200
 *
 * @param {object} store mapa `{ jid: { jogo: pontos } }`
 * @param {object} [opts]
 * @param {string} [opts.titulo] título (ex.: 'Rank Brincadeiras')
 * @param {number} [opts.limite] quantos jogadores exibir
 * @param {(jid: string) => string} [opts.nomeDe] como exibir o jogador
 * @returns {{texto: string, mentions: string[]}}
 */
export function formatarRanking(store, opts = {}) {
  const titulo = opts.titulo || 'Rank Brincadeiras';
  const limite = typeof opts.limite === 'number' ? opts.limite : LIMITE_RANKBN;
  const nomeDe = typeof opts.nomeDe === 'function' ? opts.nomeDe : (jid) => `@${String(jid).split('@')[0]}`;

  const top = ranking(store, limite);
  const mentions = top.map((x) => x.jid);

  if (!top.length) {
    const jogos = JOGOS_RANKBN.map((j) => j.nome).join(', ');
    return { texto: `🎮 *${titulo}*\n\nNenhuma pontuação registrada ainda.\n\n💡 Jogue (${jogos}) para aparecer aqui!`, mentions: [] };
  }

  const linhas = top.map((x, i) => {
    const partes = [`*${i + 1}.* ${nomeDe(x.jid)}`, ''];
    // Só os jogos que o jogador pontuou (na ordem canônica de JOGOS_RANKBN).
    for (const jogo of JOGOS_RANKBN) {
      const valor = Number(x.jogos[jogo.id]) || 0;
      if (valor > 0) partes.push(`${jogo.nome}: ${valor}`);
    }
    partes.push(`total: ${x.total}`);
    return partes.join('\n');
  });

  return { texto: `🎮 *${titulo}*\n\n${linhas.join('\n\n')}`, mentions };
}

/**
 * Junta vários mapas (ex.: todos os grupos) num único mapa global.
 *
 * @param {Array<object>} mapas
 * @returns {object} mapa agregado
 */
export function agregarMapas(mapas) {
  const total = {};
  for (const mapa of Array.isArray(mapas) ? mapas : []) {
    if (!mapa || typeof mapa !== 'object') continue;
    for (const [jid, jogos] of Object.entries(mapa)) {
      if (!jogos || typeof jogos !== 'object') continue;
      if (!total[jid] || typeof total[jid] !== 'object') total[jid] = {};
      for (const [jogo, pontos] of Object.entries(jogos)) {
        const valor = Number(pontos) || 0;
        if (valor <= 0) continue;
        total[jid][jogo] = (Number(total[jid][jogo]) || 0) + valor;
      }
    }
  }
  return total;
}

export default {
  JOGOS_RANKBN,
  LIMITE_RANKBN,
  registrarPontos,
  totalDoJogador,
  ranking,
  formatarRanking,
  agregarMapas
};
