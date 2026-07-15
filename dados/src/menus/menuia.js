export default async function menuIa(prefix, botName = "MeuBot", userName = "Usuário") {
    return `╭━━━〔 🤖 ${botName} • 𝐈𝐀 〕━━━╮
┃ 👋 Olá, @${userName}
┃ 🧠 Inteligência Artificial
┃ ✨ Ferramentas inteligentes
╰━━━━━━━━━━━━━━━━━━━━━━━━━╯


╭─❖ ✍️ GERAÇÃO DE TEXTO
│ 📝 ${prefix}cog
╰──────────────


╭─❖ 📐 MATEMÁTICA
│ 🧮 ${prefix}resolver
│ ➗ ${prefix}calc
╰──────────────


╭─❖ 🛠️ FERRAMENTAS DE IA
│ 💡 ${prefix}ideias
│ 📖 ${prefix}explicar
│ 📄 ${prefix}resumir
│ ✏️ ${prefix}corrigir
│ 🌐 ${prefix}resumirurl
│ 💬 ${prefix}resumirchat
│ 🎯 ${prefix}recomendar
│ 📷 ${prefix}ocr
╰──────────────


╭─❖ 💬 DEBATES & ARGUMENTAÇÃO
│ 🗣️ ${prefix}debater
╰──────────────


╭─❖ 📖 HISTÓRIAS INTERATIVAS
│ 📚 ${prefix}aventura
│ 🎲 ${prefix}aventura escolha
│ 📊 ${prefix}aventura status
│ 🚪 ${prefix}aventura sair
│ 🔖 Alias: ${prefix}historia
╰──────────────`;
}
