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

💡 Use ${prefix}ajuda <comando> para mais informações.`;
}
