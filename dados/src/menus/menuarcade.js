/**
 * Menu Arcade — jogos de emulador (EmuGames) que rodam no webview.
 *
 * Mesmo layout dos outros menus temáticos (cabeçalho `꧁༺ ✦ ༻꧂` + categoria com
 * `boldItalic`), e a mesma convenção de mídia: quem envia é o
 * `sendMenuWithMedia`, então o gif/foto/vídeo do menu é o do grupo/global como
 * nos demais. NÃO há sistema paralelo de mídia de menu.
 */

import { cabecalho, categoria, item } from './layout.js';
import topgear from '../topgear/index.js';

// Comando curto por id do catálogo (jogos.json). O menu é gerado do catálogo,
// então adicionar um jogo lá já o faz aparecer aqui — sem lista paralela.
const COMANDO_POR_ID = {
  topgear2: 'topgear',
  metalslug: 'metalslug',
  kof97: 'kof',
};

function comandoDoJogo(jogo) {
  return COMANDO_POR_ID[jogo.id] || jogo.id;
}

export default async function menuArcade(prefix, botName = 'MeuBot', userName = 'Usuário') {
  const jogos = topgear.catalogo();
  const linhas = jogos.map((j) => item(prefix, comandoDoJogo(j), { emoji: j.emoji || '🎮', marcador: '⟢' }));
  return `${cabecalho(botName, userName, 'ARCADE', '🕹️', [
    'Jogos de emulador direto no webview',
    'Escolha um jogo e toque em JOGAR',
  ])}


${categoria('ARCADE', '🕹️', linhas)}
`;
}

