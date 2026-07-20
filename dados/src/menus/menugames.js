/**
 * Menu Games - Menu de comandos de jogos
 */

export default async function menugames(prefix, botName = "MeuBot", userName = "Usuário") {
    return `╭━━━〔 🎮 ${botName} • 𝐆𝐀𝐌𝐄𝐒 〕━━━⬣
┃ 🕹️ Consulte perfis, rankings e estatísticas
┃ de diversos jogos em um só lugar.
╰━━━━━━━━━━━━━━━━━━━━━━━━━━⬣


╭─❖ 🔥 FREE FIRE
│ ➜ ${prefix}ffperfil <UID>
│    ╰ Ver perfil completo
│
│ ➜ ${prefix}ffstats <UID>
│    ╰ Estatísticas detalhadas
│
│ ➜ ${prefix}ffguilda <ID>
│    ╰ Informações da guilda
╰──────────────────────────⬣


╭─❖ 👑 CLASH ROYALE
│ ➜ ${prefix}crperfil <#TAG>
│    ╰ Perfil do jogador
│
│ ➜ ${prefix}crbatalhas <#TAG>
│    ╰ Batalhas recentes
│
│ ➜ ${prefix}crclan <#TAG>
│    ╰ Informações do clã
│
│ ➜ ${prefix}crranking
│    ╰ Ranking global
╰──────────────────────────⬣


╭─❖ ⭐ BRAWL STARS
│ ➜ ${prefix}bsperfil <#TAG>
│    ╰ Perfil do jogador
│
│ ➜ ${prefix}bsbatalhas <#TAG>
│    ╰ Histórico de batalhas
│
│ ➜ ${prefix}bsclube <#TAG>
│    ╰ Informações do clube
│
│ ➜ ${prefix}bsranking
│    ╰ Ranking global
╰──────────────────────────⬣


╭─❖ 🏰 CLASH OF CLANS
│ ➜ ${prefix}cocperfil <#TAG>
│    ╰ Perfil do jogador
│
│ ➜ ${prefix}cocclan <#TAG>
│    ╰ Informações do clã
│
│ ➜ ${prefix}cocguerra <#TAG>
│    ╰ Guerra atual
│
│ ➜ ${prefix}cocranking
│    ╰ Ranking global
╰──────────────────────────⬣


╭─❖ 🎮 ROBLOX
│ ➜ ${prefix}rbxperfil <username>
│    ╰ Perfil do usuário
│
│ ➜ ${prefix}rbxstatus <username>
│    ╰ Status online/offline
│
│ ➜ ${prefix}rbxjogos <username>
│    ╰ Jogos favoritos
╰──────────────────────────⬣


╭─❖ 🎯 VALORANT
│ ➜ ${prefix}vaperfil <Nome#TAG>
│    ╰ Perfil competitivo
│
│ ➜ ${prefix}vamatches <Nome#TAG>
│    ╰ Partidas recentes
│
│ ➜ ${prefix}varanking
│    ╰ Top jogadores
╰──────────────────────────⬣


╭─❖ 👑 LEAGUE OF LEGENDS
│ ➜ ${prefix}lolperfil <Nome>
│    ╰ Perfil do invocador
│
│ ➜ ${prefix}lolchallenger
│    ╰ Top Challenger
│
│ ➜ ${prefix}lolmaster
│    ╰ Top Master
╰──────────────────────────⬣


╭─❖ 🎪 PUBG
│ ➜ ${prefix}pubgperfil <Nome>
│    ╰ Perfil do jogador
│
│ ➜ ${prefix}pubgstats <Nome>
│    ╰ Estatísticas completas
│
│ ➜ ${prefix}pubgmatch <Nome>
│    ╰ Últimas partidas
╰──────────────────────────⬣


╭━━━━━━━━━━━━━━━━━━━━━━━━━━⬣
┃ 💡 Dica:
┃ Use *${prefix}ajuda <comando>* para
┃ visualizar exemplos e detalhes.
╰━━━━━━━━━━━━━━━━━━━━━━━━━━⬣

╭─────────────────╮
╰─────────────────╯
`;
}
