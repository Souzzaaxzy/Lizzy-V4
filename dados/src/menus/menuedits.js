import { boldItalic } from './layout.js';

export default async function menuEdits(prefix, botName = "MeuBot", userName = "Usuário") {
    return `╭━━━꧁༺ ✦ ${botName} ✦ ༻꧂━━━╮
┃ 𖤐 𝐎𝐥á, @${userName}
┃ ✨ Edite imagens com efeitos
╰━━━꧁༺ ✦ ༻꧂━━━━━━━━━━━━━━╯


╭━━━꧁༺ ㅤ🖼️ ${boldItalic('EDIÇÕES DE IMAGEM')} 🖼️ㅤ ༻꧂━━━╮
│ 📰 ${prefix}jornal
│ 🎬 ${prefix}cinema
│ ⚫ ${prefix}blackwhite
│ 🌫️ ${prefix}desfoque
│ 😐 ${prefix}wojakreaction
╰━━━꧁༺ ✦ ༻꧂━━━━━━━━━━━━╯

╭─────────────────╮
╰─────────────────╯
`;
}
