import { boldItalic } from './layout.js';

export default async function menuVip(prefix, botName = "MeuBot", userName = "Usuário") {
    return `╭━━━꧁༺ ✦ ${botName} ✦ ༻꧂━━━╮
┃ 𖤐 𝐎𝐥á, @${userName}
┃ 💎 Comandos exclusivos VIP
╰━━━꧁༺ ✦ ༻꧂━━━━━━━━━━━━━━╯


╭━━━꧁༺ ㅤ🌌 ${boldItalic('COMANDOS VIP')} 🌌ㅤ ༻꧂━━━╮
│ 📭 Nenhum comando cadastrado
│
│ 💡 Dono pode adicionar novos
│ ⚙️ Use:
│ 📍 !addcmdvip
╰━━━꧁༺ ✦ ༻꧂━━━━━━━━━━━━╯

╭─────────────────╮
╰─────────────────╯
`;
}
