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
 */

import { boldItalic } from './layout.js';
import { PLAQ_COMMANDS } from '../funcs/utils/plaq.js';

// Comandos da categoria BRINCADEIRAS do menu +18.
// `vab18` é o "Isso ou Aquilo" picante e `eununca18` o "Eu nunca" picante —
// mesma mecânica das versões normais, só a lista muda. `hotseat` é o jogo da
// cadeira quente (5 perguntas SIM/NÃO/PULAR respondidas por mensagem normal).
const BRINCADEIRA_COMMANDS = [
  { cmd: 'vab18', emoji: '😈' },
  { cmd: 'eununca18', emoji: '🔞' },
  { cmd: 'hotseat', emoji: '🔥' },
];

export default async function menu18(prefix, botName = 'MeuBot', userName = 'Usuário') {
  // Uma linha por comando, só com o emoji de imagem. Antes havia também um ✅/▫️
  // indicando se a mídia já existia — saiu a pedido do dono: o menu lista os
  // comandos, não é painel de status do configuração.
  const linhas = PLAQ_COMMANDS.map((cmd) => `｜ 🖼️ ${prefix}${cmd}`);
  const linhasBrincadeira = BRINCADEIRA_COMMANDS.map(
    ({ cmd, emoji }) => `｜ ${emoji} ${prefix}${cmd}`
  );

  return `╭━━━꧁༺ ✦ ${botName} ✦ ༻꧂━━━╮
┃ 𖤐 𝐎𝐥á, @${userName}
┃ 🔞 Área +18: aqui só tem coisa picante...
┃ 😈 Segura a vergonha e vem ver.
╰━━━꧁༺ ✦ ༻꧂━━━━━━━━━━━━━━╯


╭━━━꧁༺ ㅤ🔞 ${boldItalic('PLAQUINHA')} 🔞ㅤ ༻꧂━━━╮
${linhas.join('\n')}
╰━━━꧁༺ ✦ ༻꧂━━━━━━━━━━━━╯


╭━━━꧁༺ ㅤ😈 ${boldItalic('BRINCADEIRAS')} 😈ㅤ ༻꧂━━━╮
${linhasBrincadeira.join('\n')}
╰━━━꧁༺ ✦ ༻꧂━━━━━━━━━━━━╯
`;
}
