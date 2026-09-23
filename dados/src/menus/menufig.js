import { boldItalic } from './layout.js';

export default async function menuFig(prefix, botName = "MeuBot", userName = "Usuário") {
    return `╭━━━꧁༺ ✦ ${botName} ✦ ༻꧂━━━╮
┃ 𖤐 𝐎𝐥á, @${userName}
┃ 🖼️ Crie e gerencie figurinhas
╰━━━꧁༺ ✦ ༻꧂━━━━━━━━━━━━━━╯


╭━━━꧁༺ ㅤ🎨 ${boldItalic('CRIAÇÃO DE FIGURINHAS')} 🎨ㅤ ༻꧂━━━╮
│ 😀 ${prefix}emojimix
│ 📝 ${prefix}ttp
│ ✨ ${prefix}attp
│ 🖼️ ${prefix}sticker
│ 📸 ${prefix}sticker2
│ 🌄 ${prefix}sbg
│ 🪄 ${prefix}sfundo
│ 💬 ${prefix}qc
╰━━━꧁༺ ✦ ༻꧂━━━━━━━━━━━━╯


╭━━━꧁༺ ㅤ⚙️ ${boldItalic('GERENCIAMENTO DE FIGURINHAS')} ⚙️ㅤ ༻꧂━━━╮
│ 🎲 ${prefix}figualeatoria
│ 📚 ${prefix}figurinhas
│ ✏️ ${prefix}rename
│ 🏷️ ${prefix}rgtake
│ 📌 ${prefix}take
│ 🖼️ ${prefix}toimg
│ 😎 ${prefix}brat
│ 🎥 ${prefix}bratvid
╰━━━꧁༺ ✦ ༻꧂━━━━━━━━━━━━╯

╭─────────────────╮
╰─────────────────╯
`;
}
