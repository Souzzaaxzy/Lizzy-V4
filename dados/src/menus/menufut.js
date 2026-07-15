export default async function menuFut(prefix, botName = "MeuBot", userName = "Usuário") {
    return `╭━━━〔 ⚽ ${botName} • 𝐅𝐔𝐓𝐄𝐁𝐎𝐋 𝐆𝐋𝐎𝐁𝐀𝐋 〕━━━╮
┃ 👋 Olá, @${userName}
┃ ⚽ Modo Futebol Ativo
┃ 🏆 Gerencie sua carreira e seu clube
╰━━━━━━━━━━━━━━━━━━━━━━━━━╯


╭─❖ 👤 PERFIL & STATUS
│ 👤 ${prefix}fut perfil
│ 📊 ${prefix}fut stats
│ 💰 ${prefix}fut saldo
│ ⚡ ${prefix}fut energia
╰──────────────


╭─❖ 🏋️ TREINAMENTO
│ 🏋️ ${prefix}fut tre pac/sho/pas/dri/def/phy
│ 😴 ${prefix}fut descansar
╰──────────────


╭─❖ ⚔️ PARTIDAS & DESAFIOS
│ 🎮 ${prefix}fut x1 @usuario
│ ✅ ${prefix}fut ax1
│ ❌ ${prefix}fut rx1
│ 🎯 ${prefix}fut solo [normal/dificil/extremo]
│ 🔥 ${prefix}fut rivalidade @user
╰──────────────


╭─❖ 🏆 TORNEIOS
│ 📋 ${prefix}fut torneio
│ 🎫 ${prefix}fut torneio entrar [ID]
╰──────────────


╭─❖ 📊 RANKINGS
│ 🥇 ${prefix}fut divisoes
│ 📈 ${prefix}fut ranking
│ 🌍 ${prefix}fut topglobal
│ ⚽ ${prefix}fut rankingclubes
│ ⭐ ${prefix}fut soloscore
╰──────────────


╭─❖ ⭐ EVOLUÇÃO DO JOGADOR
│ 📊 ${prefix}fut xp
│ 💎 ${prefix}fut evoluir [attr] [pts]
│ 🎯 ${prefix}fut atributos
│ 🛒 ${prefix}fut hab
╰──────────────


╭─❖ ⚙️ CLUBE
│ 🏗️ ${prefix}fut criar [nome]
│ 📋 ${prefix}fut clube
│ 👥 ${prefix}fut membros
│ 🚪 ${prefix}fut sair
│ ✏️ ${prefix}fut renomearclube [nome]
│ 💼 ${prefix}fut prop @user [salário]
╰──────────────


╭─❖ 💼 NEGOCIAÇÕES
│ 📨 ${prefix}fut negs
│ ✅ ${prefix}fut ace [id]
│ ❌ ${prefix}fut repro [id]
╰──────────────


╭─❖ 🎁 RECOMPENSAS
│ 📦 ${prefix}fut diaria
│ 📅 ${prefix}fut semanal
│ 🎫 ${prefix}fut codigo [CODIGO]
╰──────────────


╭─❖ 🏅 EXTRAS
│ 🔥 ${prefix}fut forma
│ 🏆 ${prefix}fut conquistas
│ 👑 ${prefix}fut titulos
│ 🏅 ${prefix}fut temporada
│ ⭐ ${prefix}fut reputacao
│ ⚔️ ${prefix}fut rivalidades
╰──────────────


╭─❖ ⚠️ ADMINISTRAÇÃO
│ ⚙️ ${prefix}futadmin
│ 🔒 Painel administrativo
│ 👑 Exclusivo para administradores
╰──────────────


╭━━━〔 💡 INÍCIO RÁPIDO 〕━━━╮
┃ ⚽ Use ${prefix}fut entrar
┃ 🏆 Comece sua carreira
┃ 🌍 Domine o Futebol Global
╰━━━━━━━━━━━━━━━━━━━━━━╯`;
}
