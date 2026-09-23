/**
 * Menu Games - Menu de comandos de jogos
 */

import { boldItalic } from './layout.js';

export default async function menugames(prefix, botName = "MeuBot", userName = "Usuário") {
    return `╭━━━꧁༺ ✦ ${botName} ✦ ༻꧂━━━╮
┃ 𖤐 𝐎𝐥á, @${userName}
┃ 🕹️ Perfis e rankings de jogos
╰━━━꧁༺ ✦ ༻꧂━━━━━━━━━━━━━━╯


╭━━━꧁༺ ㅤ🔥 ${boldItalic('FREE FIRE')} 🔥ㅤ ༻꧂━━━╮
│ ➜ ${prefix}ffperfil <UID>
│    ╰ Ver perfil completo
│
│ ➜ ${prefix}ffstats <UID>
│    ╰ Estatísticas detalhadas
│
│ ➜ ${prefix}ffguilda <ID>
│    ╰ Informações da guilda
╰━━━꧁༺ ✦ ༻꧂━━━━━━━━━━━━╯


╭━━━꧁༺ ㅤ👑 ${boldItalic('CLASH ROYALE')} 👑ㅤ ༻꧂━━━╮
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
╰━━━꧁༺ ✦ ༻꧂━━━━━━━━━━━━╯


╭━━━꧁༺ ㅤ⭐ ${boldItalic('BRAWL STARS')} ⭐ㅤ ༻꧂━━━╮
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
╰━━━꧁༺ ✦ ༻꧂━━━━━━━━━━━━╯


╭━━━꧁༺ ㅤ🏰 ${boldItalic('CLASH OF CLANS')} 🏰ㅤ ༻꧂━━━╮
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
╰━━━꧁༺ ✦ ༻꧂━━━━━━━━━━━━╯


╭━━━꧁༺ ㅤ🎮 ${boldItalic('ROBLOX')} 🎮ㅤ ༻꧂━━━╮
│ ➜ ${prefix}rbxperfil <username>
│    ╰ Perfil do usuário
│
│ ➜ ${prefix}rbxstatus <username>
│    ╰ Status online/offline
│
│ ➜ ${prefix}rbxjogos <username>
│    ╰ Jogos favoritos
╰━━━꧁༺ ✦ ༻꧂━━━━━━━━━━━━╯


╭━━━꧁༺ ㅤ🎯 ${boldItalic('VALORANT')} 🎯ㅤ ༻꧂━━━╮
│ ➜ ${prefix}vaperfil <Nome#TAG>
│    ╰ Perfil competitivo
│
│ ➜ ${prefix}vamatches <Nome#TAG>
│    ╰ Partidas recentes
│
│ ➜ ${prefix}varanking
│    ╰ Top jogadores
╰━━━꧁༺ ✦ ༻꧂━━━━━━━━━━━━╯


╭━━━꧁༺ ㅤ👑 ${boldItalic('LEAGUE OF LEGENDS')} 👑ㅤ ༻꧂━━━╮
│ ➜ ${prefix}lolperfil <Nome>
│    ╰ Perfil do invocador
│
│ ➜ ${prefix}lolchallenger
│    ╰ Top Challenger
│
│ ➜ ${prefix}lolmaster
│    ╰ Top Master
╰━━━꧁༺ ✦ ༻꧂━━━━━━━━━━━━╯


╭━━━꧁༺ ㅤ🎪 ${boldItalic('PUBG')} 🎪ㅤ ༻꧂━━━╮
│ ➜ ${prefix}pubgperfil <Nome>
│    ╰ Perfil do jogador
│
│ ➜ ${prefix}pubgstats <Nome>
│    ╰ Estatísticas completas
│
│ ➜ ${prefix}pubgmatch <Nome>
│    ╰ Últimas partidas
╰━━━꧁༺ ✦ ༻꧂━━━━━━━━━━━━╯


╭━━━꧁༺ ✦ ༻꧂━━━╮
┃ 💡 Dica:
┃ Use *${prefix}ajuda <comando>* para
┃ visualizar exemplos e detalhes.
╰━━━━━━━━━━━━━━━━━━━━━━━━━━⬣

╭─────────────────╮
╰─────────────────╯
`;
}
