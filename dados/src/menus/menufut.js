import { boldItalic } from './layout.js';

export default async function menuFut(prefix, botName = "MeuBot", userName = "Usuário") {
    return `╭━━━꧁༺ ✦ ${botName} ✦ ༻꧂━━━╮
┃ 𖤐 𝐎𝐥á, @${userName}
┃ ⚽ Futebol global
╰━━━꧁༺ ✦ ༻꧂━━━━━━━━━━━━━━╯


╭━━━꧁༺ ㅤ👤 ${boldItalic('PERFIL & STATUS')} 👤ㅤ ༻꧂━━━╮
│ 👤 ${prefix}fut perfil
│ 📊 ${prefix}fut stats
│ 💰 ${prefix}fut saldo
│ ⚡ ${prefix}fut energia
╰━━━꧁༺ ✦ ༻꧂━━━━━━━━━━━━╯


╭━━━꧁༺ ㅤ🏋️ ${boldItalic('TREINAMENTO')} 🏋️ㅤ ༻꧂━━━╮
│ 🏋️ ${prefix}fut tre pac/sho/pas/dri/def/phy
│ 😴 ${prefix}fut descansar
╰━━━꧁༺ ✦ ༻꧂━━━━━━━━━━━━╯


╭━━━꧁༺ ㅤ⚔️ ${boldItalic('PARTIDAS & DESAFIOS')} ⚔️ㅤ ༻꧂━━━╮
│ 🎮 ${prefix}fut x1 @usuario
│ ✅ ${prefix}fut ax1
│ ❌ ${prefix}fut rx1
│ 🎯 ${prefix}fut solo [normal/dificil/extremo]
│ 🔥 ${prefix}fut rivalidade @user
╰━━━꧁༺ ✦ ༻꧂━━━━━━━━━━━━╯


╭━━━꧁༺ ㅤ🏆 ${boldItalic('TORNEIOS')} 🏆ㅤ ༻꧂━━━╮
│ 📋 ${prefix}fut torneio
│ 🎫 ${prefix}fut torneio entrar [ID]
╰━━━꧁༺ ✦ ༻꧂━━━━━━━━━━━━╯


╭━━━꧁༺ ㅤ📊 ${boldItalic('RANKINGS')} 📊ㅤ ༻꧂━━━╮
│ 🥇 ${prefix}fut divisoes
│ 📈 ${prefix}fut ranking
│ 🌍 ${prefix}fut topglobal
│ ⚽ ${prefix}fut rankingclubes
│ ⭐ ${prefix}fut soloscore
╰━━━꧁༺ ✦ ༻꧂━━━━━━━━━━━━╯


╭━━━꧁༺ ㅤ⭐ ${boldItalic('EVOLUÇÃO DO JOGADOR')} ⭐ㅤ ༻꧂━━━╮
│ 📊 ${prefix}fut xp
│ 💎 ${prefix}fut evoluir [attr] [pts]
│ 🎯 ${prefix}fut atributos
│ 🛒 ${prefix}fut hab
╰━━━꧁༺ ✦ ༻꧂━━━━━━━━━━━━╯


╭━━━꧁༺ ㅤ⚙️ ${boldItalic('CLUBE')} ⚙️ㅤ ༻꧂━━━╮
│ 🏗️ ${prefix}fut criar [nome]
│ 📋 ${prefix}fut clube
│ 👥 ${prefix}fut membros
│ 🚪 ${prefix}fut sair
│ ✏️ ${prefix}fut renomearclube [nome]
│ 💼 ${prefix}fut prop @user [salário]
╰━━━꧁༺ ✦ ༻꧂━━━━━━━━━━━━╯


╭━━━꧁༺ ㅤ💼 ${boldItalic('NEGOCIAÇÕES')} 💼ㅤ ༻꧂━━━╮
│ 📨 ${prefix}fut negs
│ ✅ ${prefix}fut ace [id]
│ ❌ ${prefix}fut repro [id]
╰━━━꧁༺ ✦ ༻꧂━━━━━━━━━━━━╯


╭━━━꧁༺ ㅤ🎁 ${boldItalic('RECOMPENSAS')} 🎁ㅤ ༻꧂━━━╮
│ 📦 ${prefix}fut diaria
│ 📅 ${prefix}fut semanal
│ 🎫 ${prefix}fut codigo [CODIGO]
╰━━━꧁༺ ✦ ༻꧂━━━━━━━━━━━━╯


╭━━━꧁༺ ㅤ🏅 ${boldItalic('EXTRAS')} 🏅ㅤ ༻꧂━━━╮
│ 🔥 ${prefix}fut forma
│ 🏆 ${prefix}fut conquistas
│ 👑 ${prefix}fut titulos
│ 🏅 ${prefix}fut temporada
│ ⭐ ${prefix}fut reputacao
│ ⚔️ ${prefix}fut rivalidades
╰━━━꧁༺ ✦ ༻꧂━━━━━━━━━━━━╯


╭━━━꧁༺ ㅤ⚠️ ${boldItalic('ADMINISTRAÇÃO')} ⚠️ㅤ ༻꧂━━━╮
│ ⚙️ ${prefix}futadmin
│ 🔒 Painel administrativo
│ 👑 Exclusivo para administradores
╰━━━꧁༺ ✦ ༻꧂━━━━━━━━━━━━╯


╭━━━꧁༺ ㅤ💡 ${boldItalic('INÍCIO RÁPIDO')} 💡ㅤ ༻꧂━━━╮
┃ ⚽ Use ${prefix}fut entrar
┃ 🏆 Comece sua carreira
┃ 🌍 Domine o Futebol Global
╰━━━꧁༺ ✦ ༻꧂━━━━━━━━━━━━╯

╭─────────────────╮
╰─────────────────╯
`;
}
