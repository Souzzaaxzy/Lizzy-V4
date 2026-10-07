/**
 * Menu Arcade — jogos de emulador (EmuGames) que rodam no webview.
 *
 * Mesmo layout dos outros menus temáticos (cabeçalho `꧁༺ ✦ ༻꧂` + categoria com
 * `boldItalic`), e a mesma convenção de mídia: quem envia é o
 * `sendMenuWithMedia`, então o gif/foto/vídeo do menu é o do grupo/global como
 * nos demais. NÃO há sistema paralelo de mídia de menu.
 */

import { cabecalho, categoria, item } from './layout.js';

const JOGOS = [
  { cmd: 'kof', emoji: '🥊' },
  { cmd: 'metalslug', emoji: '🪖' },
  { cmd: 'topgear', emoji: '🏎️' },
];

export default async function menuArcade(prefix, botName = 'MeuBot', userName = 'Usuário') {
  const linhas = JOGOS.map(({ cmd, emoji }) => item(prefix, cmd, { emoji, marcador: '⟢' }));
  return `${cabecalho(botName, userName, 'ARCADE', '🕹️', [
    'Jogos de emulador direto no webview',
    'Escolha um jogo e toque em JOGAR',
  ])}


${categoria('ARCADE', '🕹️', linhas)}
`;
}
