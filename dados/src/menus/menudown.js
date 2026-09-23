import { boldItalic } from './layout.js';

export default async function menuDown(prefix, botName = "MeuBot", userName = "Usuário") {
    return `╭━━━꧁༺ ✦ ${botName} ✦ ༻꧂━━━╮
┃ 𖤐 𝐎𝐥á, @${userName}
┃ 📥 Pesquisas & downloads
╰━━━꧁༺ ✦ ༻꧂━━━━━━━━━━━━━━╯


╭━━━꧁༺ ㅤ🔍 ${boldItalic('PESQUISAS & CONSULTAS')} 🔍ㅤ ༻꧂━━━╮
│ 🌐 ${prefix}google
│ 📰 ${prefix}noticias
│ 📱 ${prefix}apps
│ 📖 ${prefix}dicionario
│ 📚 ${prefix}wikipedia
╰━━━꧁༺ ✦ ༻꧂━━━━━━━━━━━━╯


╭━━━꧁༺ ㅤ🎵 ${boldItalic('MÚSICA & ÁUDIO')} 🎵ㅤ ༻꧂━━━╮
│ 🎼 ${prefix}letra
│ ▶️ ${prefix}play
│ 🎧 ${prefix}play2
│ 🟢 ${prefix}spotify
│ ☁️ ${prefix}soundcloud
╰━━━꧁༺ ✦ ༻꧂━━━━━━━━━━━━╯


╭━━━꧁༺ ㅤ🎬 ${boldItalic('VÍDEOS & STREAMING')} 🎬ㅤ ༻꧂━━━╮
│ 🎥 ${prefix}playvid
╰━━━꧁༺ ✦ ༻꧂━━━━━━━━━━━━╯


╭━━━꧁༺ ㅤ📥 ${boldItalic('DOWNLOADS')} 📥ㅤ ༻꧂━━━╮
│ 🎵 ${prefix}tiktok
│ 📸 ${prefix}instagram
│ 🎬 ${prefix}kwai
│ 📖 ${prefix}igstory
│ 👍 ${prefix}facebook
│ ☁️ ${prefix}gdrive
│ 📦 ${prefix}mediafire
│ 🐦 ${prefix}twitter
╰━━━꧁༺ ✦ ༻꧂━━━━━━━━━━━━╯


╭━━━꧁༺ ㅤ📱 ${boldItalic('MÍDIAS SOCIAIS')} 📱ㅤ ༻꧂━━━╮
│ 📌 ${prefix}pinterest
╰━━━꧁༺ ✦ ༻꧂━━━━━━━━━━━━╯

╭─────────────────╮
╰─────────────────╯
`;
}
