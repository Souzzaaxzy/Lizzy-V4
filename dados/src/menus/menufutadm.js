export default async function menuFutAdm(prefix, botName = "MeuBot", userName = "Usuário") {
    return `╭━━━〔 ⚙️ ${botName} • 𝐏𝐀𝐈𝐍𝐄𝐋 𝐅𝐔𝐓 𝐀𝐃𝐌 〕━━━╮
┃ 👋 Olá, @${userName}
┃ ⚙️ Painel administrativo do Futebol Global
┃ 🔒 Área exclusiva para administradores
╰━━━━━━━━━━━━━━━━━━━━━━━━━╯


╭─❖ 🔒 ÁREA RESTRITA
│ ⚠️ Apenas administradores do grupo
│ podem acessar este painel.
╰──────────────


╭─❖ 📋 CATEGORIAS DISPONÍVEIS
│ 💰 Moedas
│ 👤 Jogadores
│ ⭐ XP & Evolução
│ 🎯 Atributos
│ 🌟 Reputação
│ 🏆 Temporadas
│ 🎁 Códigos
│ 🏆 Torneios
│ 📊 Fut Solo
│ ⚔️ X1
│ 🏟️ Clubes
│ ☠️ Reset Global
╰──────────────


╭─❖ 💰 MOEDAS
│ 💵 ${prefix}futaddcoins @user [valor]
│ 💸 ${prefix}futremcoins @user [valor]
╰──────────────


╭─❖ 👤 JOGADORES
│ ⭐ ${prefix}futsetovr @user [1-99]
│ ⚡ ${prefix}futsetenergy @user [0-200]
│ 🏆 ${prefix}futsetdiv @user [divisão]
│ 🏅 ${prefix}futaddmvp @user [qtd]
│ 🔄 ${prefix}futresetplayer @user
╰──────────────


╭─❖ ⭐ XP & EVOLUÇÃO
│ 📈 ${prefix}futaddxp @user [valor]
│ 🎚️ ${prefix}futsetlevel @user [nível]
│ ⭐ ${prefix}futsetevo @user [pontos]
│ ➕ ${prefix}futaddevo @user [pontos]
│ 🔄 ${prefix}futresetxp @user
╰──────────────


╭─❖ 🎯 ATRIBUTOS
│ ⚽ ${prefix}futsettreino @user [attr] [1-99]
│
│ 📌 Atributos:
│ ⚡ pac • 🎯 sho • 🎮 pas
│ 🌀 dri • 🛡️ def • 💪 phy
╰──────────────


╭─❖ 🌟 REPUTAÇÃO
│ ⭐ ${prefix}futsetrep @user [valor]
│ 📊 ${prefix}futaddrep @user [+/-valor]
╰──────────────


╭─❖ 🏆 TEMPORADAS
│ 📅 ${prefix}futseason
│ 🔄 ${prefix}futseasonreset
│ ⚙️ ${prefix}futseasonconfig
╰──────────────


╭─❖ 🎁 CÓDIGOS PROMOCIONAIS
│ 📝 ${prefix}futcodigocriar [código] [valor]
│ 🎲 ${prefix}futcodigomisterioso
│ 📋 ${prefix}futcodigolistar
│ 📊 ${prefix}futcodigolog
│ 🚫 ${prefix}futcodigodesativar [código]
╰──────────────


╭─❖ 🏆 TORNEIOS
│ 🏗️ ${prefix}futtorneiocriar [nome] [formato]
│ ▶️ ${prefix}futtorneioiniciar [id]
│ ⚽ ${prefix}futtorneiojogar [id] [resultado]
│ 👀 ${prefix}futtorneiover [id]
│ ❌ ${prefix}futtorneiocancelar [id]
│ 📋 ${prefix}futtorneiolistar
╰──────────────


╭─❖ 📊 FUT SOLO
│ 🔄 ${prefix}futsetsolo @user reset
╰──────────────


╭─❖ ⚔️ X1
│ 🔄 ${prefix}futresetx1 @user
╰──────────────


╭─❖ 🏟️ CLUBES
│ 🔄 ${prefix}futclubereset @user
╰──────────────


╭─❖ ☠️ RESET GLOBAL
│ ⚠️ ${prefix}futresetall
│
│ 🚨 ATENÇÃO:
│ Este comando apaga todos os
│ dados dos jogadores!
╰──────────────


╭━━━〔 💡 AJUDA 〕━━━╮
┃ ⚙️ Use ${prefix}futadmin [comando]
┃ 📖 Para detalhes do comando
┃ 🔒 Acesso administrativo
╰━━━━━━━━━━━━━━━━━━╯

╭─────────────────╮
│ 📢 Canal Oficial da Lizzy
│ https://whatsapp.com/channel/0029Vb8VWbG3WHTWX9ZPnj0Y
╰─────────────────╯
`;
}
