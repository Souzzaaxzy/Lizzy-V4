export default async function menu(prefix, botName = "MeuBot", userName = "Usuário", {
    userCargo = "Membro",
    userVip = false,
    ping = 0,
    header = `╭━━━〔 🌌 ${botName} 〕━━━╮
┃ 👋 Olá, @${userName}
┃ 👤 Cargo: ${userCargo}
┃ 💎 VIP: ${userVip ? 'Sim' : 'Não'}
┃ ⚡ Ping: ${ping}ms
╰━━━━━━━━━━━━━━━━━━━╯`,
    menuTopBorder = "╭─❖",
    bottomBorder = "╰──────────────"
} = {}) {
    return `${header}

╭─❖ UTILIDADES
│ 🤖 ${prefix}menuia
│ 📥 ${prefix}menudown
│ 🛠 ${prefix}ferramentas
│ 🖼 ${prefix}menufig
╰──────────────

╭─❖ CRIAÇÃO
│ 🎨 ${prefix}menulogos
│ ✨ ${prefix}menuedits
│ 🔥 ${prefix}alteradores
╰──────────────

╭─❖ COMUNIDADE
│ 👥 ${prefix}menumemb
│ 🛡 ${prefix}menuadm
│ 👑 ${prefix}menudono
│ 🎉 ${prefix}menubn
╰──────────────

╭─❖ JOGOS
│ ⚽ ${prefix}menufut
│ 🎮 ${prefix}menurpg
│ 💎 ${prefix}menuvip
│ 🎯 ${prefix}menugames
╰──────────────

╭─────────────────╮
╰─────────────────╯
`;
}
