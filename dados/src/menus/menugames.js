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

╭──────────────────────────────────────────────╮
│ 🎯 VALORANT
╰──────────────────────────────────────────────╯
│
│ ▸ ${prefix}vaperfil Nome#TAG
│   Ver perfil do jogador
│
│ ▸ ${prefix}vamatches Nome#TAG
│   Ver partidas recentes
│
│ ▸ ${prefix}varanking
│   Ver top jogadores
│
╰──────────────────────────────────────────────╯

╭──────────────────────────────────────────────╮
│ 👑 LEAGUE OF LEGENDS
╰──────────────────────────────────────────────╯
│
│ ▸ ${prefix}lolperfil <nome>
│   Ver perfil do invocador
│
│ ▸ ${prefix}lolchallenger
│   Ver top challenger
│
│ ▸ ${prefix}lolmaster
│   Ver top master
│
╰──────────────────────────────────────────────╯

╭──────────────────────────────────────────────╮
│ 🎪 PUBG
╰──────────────────────────────────────────────╯
│
│ ▸ ${prefix}pubgperfil <nome>
│   Ver perfil do jogador
│
│ ▸ ${prefix}pubgstats <nome>
│   Ver estatísticas detalhadas
│
│ ▸ ${prefix}pubgmatch <nome>
│   Ver partidas recentes
│
╰──────────────────────────────────────────────╯

💡 Use ${prefix}ajuda <comando> para mais informações.`;
}
