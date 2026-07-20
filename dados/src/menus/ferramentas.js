export default async function menuFerramentas(prefix, botName = "MeuBot", userName = "Usuário") {
    return `╭━━━〔 🛠️ ${botName} • 𝐅𝐄𝐑𝐑𝐀𝐌𝐄𝐍𝐓𝐀𝐒 〕━━━╮
┃ 👋 Olá, @${userName}
┃ ⚙️ Utilidades para o dia a dia
┃ ✨ Ferramentas rápidas e práticas
╰━━━━━━━━━━━━━━━━━━━━━━━━━╯


╭─❖ 📱 IDENTIDADE & NOMES
│ 🎭 ${prefix}gerarnick
╰──────────────


╭─❖ 🖼️ CAPTURAS & QR CODE
│ 🌐 ${prefix}ssweb
│ 📱 ${prefix}qrcode <texto>
│ 🔍 ${prefix}lerqr
╰──────────────


╭─❖ 🧮 CÁLCULOS & CONVERSÕES
│ ➗ ${prefix}calc <expressão>
│ 📐 ${prefix}calc converter <valor> <de> <para>
╰──────────────


╭─❖ 🔮 HORÓSCOPO & MISTICISMO
│ ♈ ${prefix}horoscopo <signo>
│ 🌟 ${prefix}signos
╰──────────────


╭─❖ 📝 NOTAS PESSOAIS
│ ➕ ${prefix}nota add <texto>
│ 📋 ${prefix}notas
│ 👁️ ${prefix}nota ver <id>
│ 🗑️ ${prefix}nota del <id>
│ 📌 ${prefix}nota fixar <id>
│ 🔎 ${prefix}nota buscar <termo>
╰──────────────


╭─❖ 🌐 LINKS & UPLOADS
│ ✂️ ${prefix}encurtalink
│ ☁️ ${prefix}upload
╰──────────────


╭─❖ 🔒 SEGURANÇA
│ 🛡️ ${prefix}verificar <link>
╰──────────────


╭─❖ 🕒 TEMPO & CLIMA
│ 🕐 ${prefix}hora <cidade/país>
│ 🌦️ ${prefix}clima <cidade>
╰──────────────


╭─❖ 📚 DICIONÁRIO & TRADUÇÃO
│ 📖 ${prefix}dicionario
│ 🌍 ${prefix}tradutor
╰──────────────


╭─❖ ⏰ LEMBRETES & ORGANIZAÇÃO
│ 🔔 ${prefix}lembrete
│ 📋 ${prefix}meuslembretes
│ ❌ ${prefix}apagalembrete
│ 🎂 ${prefix}aniversario
│ 📊 ${prefix}estatisticas
╰──────────────

╭─────────────────╮
╰─────────────────╯
`;
}
