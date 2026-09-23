import { boldItalic } from './layout.js';

export default async function menuFerramentas(prefix, botName = "MeuBot", userName = "Usuário") {
    return `╭━━━꧁༺ ✦ ${botName} ✦ ༻꧂━━━╮
┃ 𖤐 𝐎𝐥á, @${userName}
┃ 🛠️ Utilidades diversas
╰━━━꧁༺ ✦ ༻꧂━━━━━━━━━━━━━━╯


╭━━━꧁༺ ㅤ📱 ${boldItalic('IDENTIDADE & NOMES')} 📱ㅤ ༻꧂━━━╮
│ 🎭 ${prefix}gerarnick
╰━━━꧁༺ ✦ ༻꧂━━━━━━━━━━━━╯


╭━━━꧁༺ ㅤ🖼️ ${boldItalic('CAPTURAS & QR CODE')} 🖼️ㅤ ༻꧂━━━╮
│ 🌐 ${prefix}ssweb
│ 📱 ${prefix}qrcode <texto>
│ 🔍 ${prefix}lerqr
╰━━━꧁༺ ✦ ༻꧂━━━━━━━━━━━━╯


╭━━━꧁༺ ㅤ🧮 ${boldItalic('CÁLCULOS & CONVERSÕES')} 🧮ㅤ ༻꧂━━━╮
│ ➗ ${prefix}calc <expressão>
│ 📐 ${prefix}calc converter <valor> <de> <para>
╰━━━꧁༺ ✦ ༻꧂━━━━━━━━━━━━╯


╭━━━꧁༺ ㅤ🔮 ${boldItalic('HORÓSCOPO & MISTICISMO')} 🔮ㅤ ༻꧂━━━╮
│ ♈ ${prefix}horoscopo <signo>
│ 🌟 ${prefix}signos
╰━━━꧁༺ ✦ ༻꧂━━━━━━━━━━━━╯


╭━━━꧁༺ ㅤ📝 ${boldItalic('NOTAS PESSOAIS')} 📝ㅤ ༻꧂━━━╮
│ ➕ ${prefix}nota add <texto>
│ 📋 ${prefix}notas
│ 👁️ ${prefix}nota ver <id>
│ 🗑️ ${prefix}nota del <id>
│ 📌 ${prefix}nota fixar <id>
│ 🔎 ${prefix}nota buscar <termo>
╰━━━꧁༺ ✦ ༻꧂━━━━━━━━━━━━╯


╭━━━꧁༺ ㅤ🌐 ${boldItalic('LINKS & UPLOADS')} 🌐ㅤ ༻꧂━━━╮
│ ✂️ ${prefix}encurtalink
│ ☁️ ${prefix}upload
╰━━━꧁༺ ✦ ༻꧂━━━━━━━━━━━━╯


╭━━━꧁༺ ㅤ🔒 ${boldItalic('SEGURANÇA')} 🔒ㅤ ༻꧂━━━╮
│ 🛡️ ${prefix}verificar <link>
╰━━━꧁༺ ✦ ༻꧂━━━━━━━━━━━━╯


╭━━━꧁༺ ㅤ🕒 ${boldItalic('TEMPO & CLIMA')} 🕒ㅤ ༻꧂━━━╮
│ 🕐 ${prefix}hora <cidade/país>
│ 🌦️ ${prefix}clima <cidade>
╰━━━꧁༺ ✦ ༻꧂━━━━━━━━━━━━╯


╭━━━꧁༺ ㅤ📚 ${boldItalic('DICIONÁRIO & TRADUÇÃO')} 📚ㅤ ༻꧂━━━╮
│ 📖 ${prefix}dicionario
│ 🌍 ${prefix}tradutor
╰━━━꧁༺ ✦ ༻꧂━━━━━━━━━━━━╯


╭━━━꧁༺ ㅤ⏰ ${boldItalic('LEMBRETES & ORGANIZAÇÃO')} ⏰ㅤ ༻꧂━━━╮
│ 🔔 ${prefix}lembrete
│ 📋 ${prefix}meuslembretes
│ ❌ ${prefix}apagalembrete
│ 🎂 ${prefix}aniversario
│ 📊 ${prefix}estatisticas
╰━━━꧁༺ ✦ ༻꧂━━━━━━━━━━━━╯

╭─────────────────╮
╰─────────────────╯
`;
}
