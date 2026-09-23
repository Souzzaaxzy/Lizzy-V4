/**
 * Menu 18 — conteúdo **+18**.
 *
 * O cabeçalho traz um aviso genérico de que aqui é área +18 — de propósito, ele
 * NÃO cita "plaquinha": o menu recebe mais categorias depois, e uma frase presa
 * a uma categoria específica envelheceria na primeira adição.
 *
 * O emoji é o mesmo que o resto do bot usa para esse tipo de conteúdo (`🔞`,
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
┃ 🔞 Área +18: aqui só tem coisa picante...
┃ 😈 Segura a vergonha e vem ver.
╰━━━꧁༺ ✦ ༻꧂━━━━━━━━━━━━━━╯


╭━━━꧁༺ ㅤ🔞 ${boldItalic('PLAQUINHA')} 🔞ㅤ ༻꧂━━━╮
${linhas.join('\n')}
╰━━━꧁༺ ✦ ༻꧂━━━━━━━━━━━━╯
`;
}
