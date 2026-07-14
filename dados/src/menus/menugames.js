/**
 * Menu Games - Menu de comandos de jogos
 */

export default async function menugames(prefix, botName = "MeuBot", userName = "Usuário") {
    return `╭──────────────────────────────────────────────╮
│              🎮 ${botName} - GAMES              ║
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
│ ⭐ BRAWL STARS
╰──────────────────────────────────────────────╯
│
│ ▸ ${prefix}bsperfil <#TAG>
│   Ver perfil do jogador
│
│ ▸ ${prefix}bsbatalhas <#TAG>
│   Ver batalhas recentes
│
│ ▸ ${prefix}bsclube <#TAG>
│   Ver informações do clube
│
│ ▸ ${prefix}bsranking
│   Ver top jogadores/clubes
│
╰──────────────────────────────────────────────╯

╭──────────────────────────────────────────────╮
│ 🏰 CLASH OF CLANS
╰──────────────────────────────────────────────╯
│
│ ▸ ${prefix}cocperfil <#TAG>
│   Ver perfil do jogador
│
│ ▸ ${prefix}cocclan <#TAG>
│   Ver informações do clã
│
│ ▸ ${prefix}cocguerra <#TAG>
│   Ver status da guerra
│
│ ▸ ${prefix}cocranking
│   Ver top jogadores/clãs
│
╰──────────────────────────────────────────────╯

╭──────────────────────────────────────────────╮
│ 🎮 ROBLOX
╰──────────────────────────────────────────────╯
│
│ ▸ ${prefix}rbxperfil <username>
│   Ver perfil do jogador
│
│ ▸ ${prefix}rbxstatus <username>
│   Ver status online/offline
│
│ ▸ ${prefix}rbxjogos <username>
│   Ver jogos favoritos
│
╰──────────────────────────────────────────────╯

💡 Use ${prefix}ajuda <comando> para mais informações.`;
}
