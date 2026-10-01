/**
 * Layout do `!rankbn` (grupo) e `!rankbng` (global).
 *
 * O texto segue o desenho do bot: cabeçalho `꧁༺ ✦ ༻꧂` com o nome do bot,
 * uma caixa de categoria e, dentro dela, a posição e a pontuação por jogo.
 *
 * Exemplo (top 1):
 *
 *   ╭━━━꧁༺ ✦ Abyss ✦ ༻꧂━━━╮
 *   ┃ 𖤐 𝐎𝐥á, @Fulano
 *   ┃ 🏆 𝑹𝒂𝒏𝒌 𝑩𝒓𝒊𝒏𝒄𝒂𝒅𝒆𝒊𝒓𝒂𝒔
 *   ╰━━━꧁༺ ✦ ༻꧂━━━━━━━━━━━━━━╯
 *
 *   ╭━━━꧁༺ ㅤ🏆 𝑷𝑶𝑵𝑻𝑶𝑺 🏆ㅤ ༻꧂━━━╮
 *   ┃ 🥇 *1º* @Fulano
 *   ┃     🧩 emojiquiz: 120
 *   ┃     🎬 filme: 80
 *   ┃     💠 total: 200
 *   ╰━━━꧁༺ ✦ ༻꧂━━━━━━━━━━━━╯
 *
 * O módulo só monta texto (não conhece socket nem fs), então é testável puro.
 */

import { cabecalho, abrirCategoria, fecharCategoria, RODAPE_BLOCO, boldItalic } from './layout.js';

/** Medalhas das três primeiras posições; depois vem a genérica. */
const MEDALHAS = ['🥇', '🥈', '🥉'];

/** Emoji por jogo, para a linha da pontuação individual. */
const EMOJI_JOGO = {
  emojiquiz: '🧩',
  filme: '🎬',
  quemsoueu: '🕵️',
  quiz: '❓',
  wordle: '📝',
  forca: '🎭'
};

/**
 * Monta o texto do ranking.
 *
 * @param {object} opts
 * @param {Array<{jid: string, jogos: object, total: number}>} opts.top  já ordenado
 * @param {string[]} opts.jogos  ids dos jogos, na ordem exibida
 * @param {string} [opts.botName]
 * @param {string} [opts.userName]
 * @param {boolean} [opts.global]  título/descrição do global
 * @param {(jid: string) => string} [opts.nomeDe]
 * @returns {{texto: string, mentions: string[]}}
 */
export function montarRankBn({ top, jogos, botName = 'Bot', userName = 'Usuário', global = false, nomeDe }) {
  const exibir = typeof nomeDe === 'function' ? nomeDe : (jid) => `@${String(jid).split('@')[0]}`;
  const titulo = global ? 'Rank Brincadeiras Global' : 'Rank Brincadeiras';
  const descricao = global ? '🌍 Ranking global de pontos' : '🏆 Ranking de pontos do grupo';

  const head = cabecalho(botName, userName, titulo, '🏆', [descricao]);

  if (!top || !top.length) {
    const corpo = [
      abrirCategoria('SEM PONTOS', '💤'),
      '┃ Ninguém pontuou ainda por aqui.',
      '┃',
      '┃ 💡 Jogue !emojiquiz, !filme, !quemsoueu,',
      '┃    !quiz, !wordle ou !forca para pontuar!',
      fecharCategoria()
    ].join('\n');
    return { texto: `${head}\n\n${corpo}`, mentions: [] };
  }

  const mentions = top.map((x) => x.jid);
  const blocos = top.map((x, i) => {
    const medalha = MEDALHAS[i] || '🏅';
    const linhas = [`┃ ${medalha} *${i + 1}º* ${exibir(x.jid)}`];
    for (const jogo of jogos) {
      const valor = Number(x.jogos?.[jogo]) || 0;
      if (valor > 0) linhas.push(`┃     ${EMOJI_JOGO[jogo] || '🎮'} ${jogo}: ${valor}`);
    }
    linhas.push(`┃     💠 total: *${x.total}*`);
    return linhas.join('\n');
  });

  const corpo = [abrirCategoria('PONTOS', '🏆'), ...blocos, RODAPE_BLOCO].join('\n');
  return { texto: `${head}\n\n${corpo}`, mentions };
}

export default { montarRankBn, boldItalic };
