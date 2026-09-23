/**
 * Menu 18 — PLAQUINHAS (`!plaq1`..`!plaq10`).
 *
 * Menu de conteúdo **+18**: o cabeçalho traz uma mensagem safada dizendo isso, e
 * o emoji é o mesmo que o resto do bot usa para esse tipo de conteúdo (`🔞`,
 * como na categoria "INTERAÇÕES PICANTES" do `menubn`) — nada de símbolo
 * inventado que não comunica nada.
 *
 * Mesmo layout dos outros menus (cabeçalho `꧁༺ ✦ ༻꧂`, categoria com
 * `boldItalic`), e a mesma convenção de mídia: quem envia é o
 * `sendMenuWithMedia`, então o gif/foto/vídeo do menu é o do grupo/global
 * exatamente como nos demais.
 *
 * A categoria lista os 10 comandos com ✅ quando já existe arquivo em
 * `dados/src/plaq/` e ▫️ quando o comando ainda não tem mídia — assim o menu
 * diz o estado real em vez de prometer o que não existe.
 */

import { boldItalic } from './layout.js';
import { PLAQ_COMMANDS, findPlaqMedia } from '../funcs/utils/plaq.js';

export default async function menu18(prefix, botName = 'MeuBot', userName = 'Usuário') {
  const linhas = PLAQ_COMMANDS.map((cmd) => {
    const tem = findPlaqMedia(cmd) ? '✅' : '▫️';
    return `｜ ${tem} ${prefix}${cmd}`;
  });

  return `╭━━━꧁༺ ✦ ${botName} ✦ ༻꧂━━━╮
┃ 𖤐 𝐎𝐥á, @${userName}
┃ 🔞 Preparei umas plaquinhas bem safadas pra você...
┃ 😈 Aqui é só coisa +18, hein? Segura a vergonha.
╰━━━꧁༺ ✦ ༻꧂━━━━━━━━━━━━━━╯


╭━━━꧁༺ ㅤ🔞 ${boldItalic('PLAQUINHA')} 🔞ㅤ ༻꧂━━━╮
${linhas.join('\n')}
╰━━━꧁༺ ✦ ༻꧂━━━━━━━━━━━━╯
`;
}
