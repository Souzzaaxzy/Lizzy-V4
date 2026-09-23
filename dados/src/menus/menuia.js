import { boldItalic } from './layout.js';

export default async function menuIa(prefix, botName = "MeuBot", userName = "Usuário") {
    return `╭━━━꧁༺ ✦ ${botName} ✦ ༻꧂━━━╮
┃ 𖤐 𝐎𝐥á, @${userName}
┃ ✨ Inteligência artificial
╰━━━꧁༺ ✦ ༻꧂━━━━━━━━━━━━━━╯


╭━━━꧁༺ ㅤ✍️ ${boldItalic('GERAÇÃO DE TEXTO')} ✍️ㅤ ༻꧂━━━╮
│ 📝 ${prefix}cog
╰━━━꧁༺ ✦ ༻꧂━━━━━━━━━━━━╯


╭━━━꧁༺ ㅤ🎨 ${boldItalic('GERAÇÃO DE IMAGEM')} 🎨ㅤ ༻꧂━━━╮
│ 🖼️ ${prefix}imagine
╰━━━꧁༺ ✦ ༻꧂━━━━━━━━━━━━╯


╭━━━꧁༺ ㅤ📐 ${boldItalic('MATEMÁTICA')} 📐ㅤ ༻꧂━━━╮
│ 🧮 ${prefix}resolver
│ ➗ ${prefix}calc
╰━━━꧁༺ ✦ ༻꧂━━━━━━━━━━━━╯


╭━━━꧁༺ ㅤ🛠️ ${boldItalic('FERRAMENTAS DE IA')} 🛠️ㅤ ༻꧂━━━╮
│ 💡 ${prefix}ideias
│ 📖 ${prefix}explicar
│ 📄 ${prefix}resumir
│ ✏️ ${prefix}corrigir
│ 🌐 ${prefix}resumirurl
│ 💬 ${prefix}resumirchat
│ 🎯 ${prefix}recomendar
╰━━━꧁༺ ✦ ༻꧂━━━━━━━━━━━━╯


╭━━━꧁༺ ㅤ💬 ${boldItalic('DEBATES & ARGUMENTAÇÃO')} 💬ㅤ ༻꧂━━━╮
│ 🗣️ ${prefix}debater
╰━━━꧁༺ ✦ ༻꧂━━━━━━━━━━━━╯


╭━━━꧁༺ ㅤ📖 ${boldItalic('HISTÓRIAS INTERATIVAS')} 📖ㅤ ༻꧂━━━╮
│ 📚 ${prefix}aventura
│ 🎲 ${prefix}aventura escolha
│ 📊 ${prefix}aventura status
│ 🚪 ${prefix}aventura sair
│ 🔖 Alias: ${prefix}historia
╰━━━꧁༺ ✦ ༻꧂━━━━━━━━━━━━╯

╭─────────────────╮
╰─────────────────╯
`;
}
