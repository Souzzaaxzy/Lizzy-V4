export default async function menuMembros(prefix, botName = "MeuBot", userName = "Usuário") {
    return `╭━━━〔 👥 ${botName} • 𝐌𝐄𝐌𝐁𝐑𝐎𝐒 〕━━━╮
┃ 👋 Olá, @${userName}
┃ 👤 Painel do Membro
┃ ✨ Recursos da comunidade
╰━━━━━━━━━━━━━━━━━━━━━━╯


╭─❖ 👤 PERFIL & ESTATÍSTICAS
│ 👤 ${prefix}perfil
│ 🙋 ${prefix}me
╰──────────────


╭─❖ 🤖 STATUS DO BOT
│ 📶 ${prefix}ping
│ 🤖 ${prefix}statusbot
│ 👥 ${prefix}statusgp
│ 📜 ${prefix}regras
│ 📦 ${prefix}zipbot
│ 🌐 ${prefix}gitbot
│ 🎙 ${prefix}transcrever
╰──────────────


╭─❖ ⚙️ CONFIGURAÇÕES PESSOAIS
│ 📢 ${prefix}mention
│ 🌙 ${prefix}afk
│ ☀️ ${prefix}voltei
╰──────────────


╭─❖ 👥 INTERAÇÃO SOCIAL
│ 🎭 ${prefix}roles
│ ✅ ${prefix}role.vou
│ ❌ ${prefix}role.nvou
│ 📋 ${prefix}role.confirmados
╰──────────────


╭─❖ 🏆 RANKINGS & GAMIFICAÇÃO
│ 🥇 ${prefix}rankativo
│ 💤 ${prefix}rankinativo
│ 📊 ${prefix}rankativos
│ 📈 ${prefix}atividade
│ 👤 ${prefix}checkativo
│ 📋 ${prefix}meativo
│ ⚡ ${prefix}totalcmd
│ 🔥 ${prefix}topcmd
╰──────────────


╭─❖ 📊 ESTATÍSTICAS
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
╰──────────────


╭─❖ 🎁 CONQUISTAS & INVENTÁRIO
│ 🏅 ${prefix}conquistas
│ 📦 ${prefix}caixa diaria
│ 🎁 ${prefix}caixa rara
│ 👑 ${prefix}caixa lendaria
│ 🎀 ${prefix}presente
│ 🎒 ${prefix}inv
╰──────────────


╭─❖ ⭐ REPUTAÇÃO
│ 👍 ${prefix}rep +
│ 👎 ${prefix}rep -
│ 👤 ${prefix}rep
│ 🏆 ${prefix}toprep
│ 🚨 ${prefix}denunciar
│ 📋 ${prefix}denuncias
╰──────────────


╭─❖ 📸 MOMENTOS
│ 💾 ${prefix}salvarm
│ 🖼 ${prefix}moment
│ 🔎 ${prefix}m
│ 🗑 ${prefix}apm
╰──────────────`;
}
