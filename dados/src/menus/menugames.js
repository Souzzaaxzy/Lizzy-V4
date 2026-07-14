/**
 * Menu Games - Menu de comandos de jogos
 */

export default async function menugames(prefix, botName = "MeuBot", userName = "Usuário") {
    return `╭──────────────────────────────────────────────╮
│              🎮 ${botName} - GAMES              ║
╰──────────────────────────────────────────────╯

╭──────────────────────────────────────────────╮
│ ◈ Menu Games - Comandos de Jogos             │
╰──────────────────────────────────────────────╯

╭──────────────────────────────────────────────╮
│ 🔥 FREE FIRE
╰──────────────────────────────────────────────╯
│
│ ▸ ${prefix}ffperfil <UID>
│   Ver perfil completo do jogador
│
│ ▸ ${prefix}ffstats <UID>
│   Ver estatísticas detalhadas
│
│ ▸ ${prefix}ffguilda <ID da guilda>
│   Ver informações da guilda
│
╰──────────────────────────────────────────────╯

╭──────────────────────────────────────────────╮
│ 👑 CLASH ROYALE
╰──────────────────────────────────────────────╯
│
│ ▸ ${prefix}crperfil <#TAG>
│   Ver perfil do jogador
│
│ ▸ ${prefix}crbatalhas <#TAG>
│   Ver batalhas recentes
│
│ ▸ ${prefix}crclan <#TAG>
│   Ver informações do clã
│
│ ▸ ${prefix}crranking
│   Ver top jogadores/clãs
│
╰──────────────────────────────────────────────╯

╭──────────────────────────────────────────────╮
│ 📌 Em breve
╰──────────────────────────────────────────────╯
│
│ 🎯 Valorant
│ ⭐ Brawl Stars
│ 🟦 Roblox
│ 🪂 PUBG
│
╰──────────────────────────────────────────────╯

💡 Use ${prefix}ajuda <comando> para mais informações.`;
}
