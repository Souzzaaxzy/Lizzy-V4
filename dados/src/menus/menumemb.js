import { boldItalic } from './layout.js';

export default async function menuMembros(prefix, botName = "MeuBot", userName = "Usuário") {
    return `╭━━━꧁༺ ✦ ${botName} ✦ ༻꧂━━━╮
┃ 𖤐 𝐎𝐥á, @${userName}
┃ 👤 Perfil, status e ranking
╰━━━꧁༺ ✦ ༻꧂━━━━━━━━━━━━━━╯


╭━━━꧁༺ ㅤ👤 ${boldItalic('PERFIL & ESTATÍSTICAS')} 👤ㅤ ༻꧂━━━╮
│ 👤 ${prefix}perfil
│ 🙋 ${prefix}me
│ 🎵 ${prefix}ptiktok @user
│ 📸 ${prefix}pinsta @user
│ 𝕏 ${prefix}px @user
│ 🎧 ${prefix}pspotify @user
╰━━━꧁༺ ✦ ༻꧂━━━━━━━━━━━━╯


╭━━━꧁༺ ㅤ🤖 ${boldItalic('STATUS DO BOT')} 🤖ㅤ ༻꧂━━━╮
│ 📶 ${prefix}ping
│ 🤖 ${prefix}statusbot
│ 👥 ${prefix}statusgp
│ 📜 ${prefix}regras
│ 🎙 ${prefix}transcrever
╰━━━꧁༺ ✦ ༻꧂━━━━━━━━━━━━╯


╭━━━꧁༺ ㅤ⚙️ ${boldItalic('CONFIGURAÇÕES PESSOAIS')} ⚙️ㅤ ༻꧂━━━╮
│ 📢 ${prefix}mention
│ 🌙 ${prefix}afk
│ ☀️ ${prefix}voltei
╰━━━꧁༺ ✦ ༻꧂━━━━━━━━━━━━╯


╭━━━꧁༺ ㅤ👥 ${boldItalic('INTERAÇÃO SOCIAL')} 👥ㅤ ༻꧂━━━╮
│ 🎭 ${prefix}roles
│ ✅ ${prefix}role.vou
│ ❌ ${prefix}role.nvou
│ 📋 ${prefix}role.confirmados
╰━━━꧁༺ ✦ ༻꧂━━━━━━━━━━━━╯


╭━━━꧁༺ ㅤ🏆 ${boldItalic('RANKINGS & GAMIFICAÇÃO')} 🏆ㅤ ༻꧂━━━╮
│ 🥇 ${prefix}rankativo
│ 💤 ${prefix}rankinativo
│ 📊 ${prefix}rankativos
│ 📈 ${prefix}atividade
│ 👤 ${prefix}checkativo
│ 📋 ${prefix}meativo
│ ⚡ ${prefix}totalcmd
│ 🔥 ${prefix}topcmd
╰━━━꧁༺ ✦ ༻꧂━━━━━━━━━━━━╯


╭━━━꧁༺ ㅤ📊 ${boldItalic('ESTATÍSTICAS')} 📊ㅤ ༻꧂━━━╮
│ 📅 ${prefix}msgdiario
│ 📆 ${prefix}msgsemanal
│ 📈 ${prefix}estdia
│ 🏅 ${prefix}topdiario
│ 🏆 ${prefix}topsemanal
│ 👤 ${prefix}mediario
│ 👤 ${prefix}mesemanal
│ 🎯 ${prefix}pdiario
│ 🎯 ${prefix}psemanal
│ 💎 ${prefix}recorde
│ ⭐ ${prefix}merecorde
│ 🎯 ${prefix}vermetas
╰━━━꧁༺ ✦ ༻꧂━━━━━━━━━━━━╯


╭━━━꧁༺ ㅤ🎁 ${boldItalic('CONQUISTAS & INVENTÁRIO')} 🎁ㅤ ༻꧂━━━╮
│ 🏅 ${prefix}conquistas
│ 📦 ${prefix}caixa diaria
│ 🎁 ${prefix}caixa rara
│ 👑 ${prefix}caixa lendaria
│ 🎀 ${prefix}presente
│ 🎒 ${prefix}inv
╰━━━꧁༺ ✦ ༻꧂━━━━━━━━━━━━╯


╭━━━꧁༺ ㅤ⭐ ${boldItalic('REPUTAÇÃO')} ⭐ㅤ ༻꧂━━━╮
│ 👍 ${prefix}rep +
│ 👎 ${prefix}rep -
│ 👤 ${prefix}rep
│ 🏆 ${prefix}toprep
│ 🚨 ${prefix}denunciar
│ 📋 ${prefix}denuncias
╰━━━꧁༺ ✦ ༻꧂━━━━━━━━━━━━╯


╭━━━꧁༺ ㅤ📸 ${boldItalic('MOMENTOS')} 📸ㅤ ༻꧂━━━╮
│ 💾 ${prefix}salvarm
│ 🖼 ${prefix}moment
│ 🔎 ${prefix}m
│ 🗑 ${prefix}apm
╰━━━꧁༺ ✦ ༻꧂━━━━━━━━━━━━╯

╭─────────────────╮
╰─────────────────╯
`;
}
