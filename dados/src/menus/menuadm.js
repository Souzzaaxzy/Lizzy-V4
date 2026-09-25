import { boldItalic } from './layout.js';

export default async function menuadm(prefix, botName = "MeuBot", userName = "Usuário") {
    return `╭━━━꧁༺ ✦ ${botName} ✦ ༻꧂━━━╮
┃ 𖤐 𝐎𝐥á, @${userName}
┃ 🛡️ Gestão do grupo
╰━━━꧁༺ ✦ ༻꧂━━━━━━━━━━━━━━╯


╭━━━꧁༺ ㅤ🏛️ ${boldItalic('SISTEMA DE ELEIÇÃO')} 🏛️ㅤ ༻꧂━━━╮
│ 🗳 ${prefix}eleicao
│ 👤 ${prefix}cand
│ ⏱ ${prefix}tempeleicao
╰━━━꧁༺ ✦ ༻꧂━━━━━━━━━━━━╯


╭━━━꧁༺ ㅤ🛡️ ${boldItalic('GESTÃO DE USUÁRIOS')} 🛡️ㅤ ༻꧂━━━╮
│ 🚫 ${prefix}ban
│ 🚫 ${prefix}bann @user1 @user2
│ ☠ ${prefix}bbn @user1 @user2 @user3
│ 🎲 ${prefix}roletaban
│ ⚡ ${prefix}ban2
│ 📊 ${prefix}enquete
│ 🖼️ ${prefix}enqueteimg <pergunta>|1|2|3
│ 📢 ${prefix}chamar @user <qtd>
│ 🎭 ${prefix}bam
│ 💬 ${prefix}setbammsg
│ 🗑 ${prefix}dbb
│ ⬆ ${prefix}promover
│ ⬇ ${prefix}rebaixar
│ 🔇 ${prefix}mute
│ 🔊 ${prefix}desmute
│ 🔒 ${prefix}mute2
│ 🔓 ${prefix}desmute2
│ ⏳ ${prefix}mutet
│ 🔓 ${prefix}unmutet
│ ⚠ ${prefix}adv
│ ❌ ${prefix}rmadv
│ 📋 ${prefix}listadv
│ 🧹 ${prefix}limparrank
│ ♻ ${prefix}resetrank
│ 📈 ${prefix}mantercontador
│ 📊 ${prefix}atividade
│ 👤 ${prefix}checkativo
│ 🖼 ${prefix}getpp
╰━━━꧁༺ ✦ ༻꧂━━━━━━━━━━━━╯


╭━━━꧁༺ ㅤ🎯 ${boldItalic('METAS DE MENSAGENS')} 🎯ㅤ ༻꧂━━━╮
│ 🎯 ${prefix}setdiario
│ 📅 ${prefix}setsemanal
│ 📊 ${prefix}vermetas
╰━━━꧁༺ ✦ ༻꧂━━━━━━━━━━━━╯


╭━━━꧁༺ ㅤ🔒 ${boldItalic('CONTROLE DE ACESSO')} 🔒ㅤ ༻꧂━━━╮
│ 🚫 ${prefix}blockuser
│ ✅ ${prefix}unblockuser
│ 📋 ${prefix}listblockuser
│ 🚷 ${prefix}blockcmdgp
│ ✔ ${prefix}unblockcmdgp
│ 📂 ${prefix}blockmenugp
│ 📂 ${prefix}unblockmenugp
│ 📑 ${prefix}listblockmenugp
╰━━━꧁༺ ✦ ༻꧂━━━━━━━━━━━━╯


╭━━━꧁༺ ㅤ🛡️ ${boldItalic('CONTROLE LEGADO')} 🛡️ㅤ ༻꧂━━━╮
│ 📋 ${prefix}listblocksgp
│ ➕ ${prefix}addblacklist
│ ➖ ${prefix}delblacklist
│ 📖 ${prefix}listblacklist
│ 🚫 ${prefix}blockcmd
│ ✅ ${prefix}unblockcmd
╰━━━꧁༺ ✦ ༻꧂━━━━━━━━━━━━╯


╭━━━꧁༺ ㅤ💬 ${boldItalic('GESTÃO DO GRUPO')} 💬ㅤ ༻꧂━━━╮
│ 🗑 ${prefix}del
│ 🧹 ${prefix}limpar
│ 📢 ${prefix}marcar
│ 👻 ${prefix}hidetag
│ 🎲 ${prefix}sorteio
│ 📝 ${prefix}nomegp
│ 📄 ${prefix}descgrupo
│ 🖼 ${prefix}fotogrupo
│ 🧑‍🧑‍🧒 ${prefix}statusgrupo
│ ➕ ${prefix}addregra
│ ➖ ${prefix}delregra
│ 🗂 ${prefix}lixeira
│ ♻ ${prefix}restaurar
│ 🎭 ${prefix}role.criar
│ ✏ ${prefix}role.alterar
│ ❌ ${prefix}role.excluir
╰━━━꧁༺ ✦ ༻꧂━━━━━━━━━━━━╯


╭━━━꧁༺ ㅤ⚙️ ${boldItalic('GRUPO & PERMISSÕES')} ⚙️ㅤ ༻꧂━━━╮
│ 🔗 ${prefix}linkgp
│ 🔓 ${prefix}grupo A/F
│ 🕒 ${prefix}opengp
│ 🌙 ${prefix}closegp
│ 💬 ${prefix}automsg
│ 👻 ${prefix}banghost
│ 📏 ${prefix}limitmessage
│ 🗑 ${prefix}dellimitmessage
│ 📥 ${prefix}solicitacoes
│ ✅ ${prefix}aprovar
│ ☑ ${prefix}aprovar all
│ ❌ ${prefix}recusarsolic
╰━━━꧁༺ ✦ ༻꧂━━━━━━━━━━━━╯


╭━━━꧁༺ ㅤ👥 ${boldItalic('MODERADORES')} 👥ㅤ ༻꧂━━━╮
│ ➕ ${prefix}addmod
│ ➖ ${prefix}delmod
│ 📋 ${prefix}listmods
│ 🔑 ${prefix}grantmodcmd
│ ❌ ${prefix}revokemodcmd
│ 📖 ${prefix}listmodcmds
╰━━━꧁༺ ✦ ༻꧂━━━━━━━━━━━━╯


╭━━━꧁༺ ㅤ🐺 ${boldItalic('CARGO ALPHA')} 🐺ㅤ ༻꧂━━━╮
│ ➕ ${prefix}addalpha
│ ➖ ${prefix}delalpha
│ 📋 ${prefix}listalphas
│ 🔑 ${prefix}grantalphacmd
│ ❌ ${prefix}revokealphacmd
│ 📖 ${prefix}listalphacmds
╰━━━꧁༺ ✦ ༻꧂━━━━━━━━━━━━╯


╭━━━꧁༺ ㅤ🛡️ ${boldItalic('WHITELIST')} 🛡️ㅤ ༻꧂━━━╮
│ ➕ ${prefix}wladd
│ ➖ ${prefix}wl.remove
│ 📋 ${prefix}wl.lista
╰━━━꧁༺ ✦ ༻꧂━━━━━━━━━━━━╯


╭━━━꧁༺ ㅤ🤝 ${boldItalic('PARCERIAS')} 🤝ㅤ ༻꧂━━━╮
│ 📋 ${prefix}parcerias
│ ➕ ${prefix}addparceria
│ ➖ ${prefix}delparceria
╰━━━꧁༺ ✦ ༻꧂━━━━━━━━━━━━╯


╭━━━꧁༺ ㅤ🔒 ${boldItalic('SEGURANÇA')} 🔒ㅤ ༻꧂━━━╮
│ 🌊 ${prefix}antiflood
│ 🕵 ${prefix}x9
│ 🃏 ${prefix}card on/off
│ 🔐 ${prefix}antiroubo
│ 🛡️ ${prefix}antis
│ 📄 ${prefix}antidoc
│ 📍 ${prefix}antiloc
│ 🖼 ${prefix}antifig
│ 🔘 ${prefix}antibtn
│ 🖼 ${prefix}antimidia
│ 🎤 ${prefix}antiaudio
│ ✨ ${prefix}antistickerplus
│ 🔗 ${prefix}antilinkgp
│ 📢 ${prefix}antilinkcanal
│ 🚫 ${prefix}antilinkhard
│ ⚠ ${prefix}antilinksoft
│ 🔞 ${prefix}antiporn
│ 📲 ${prefix}antistatus
│ ☣ ${prefix}antitoxic
│ ⚙ ${prefix}antitoxic config
│ 🎚 ${prefix}antitoxic sensibilidade
│ 💬 ${prefix}antipalavra
│ 🌐 ${prefix}antisocial
│ 👤 ${prefix}perm @user
│ 👤 ${prefix}delp @user
╰━━━꧁༺ ✦ ༻꧂━━━━━━━━━━━━╯


╭━━━꧁༺ ㅤ🎨 ${boldItalic('CONFIGURAÇÕES')} 🎨ㅤ ༻꧂━━━╮
│ 💬 ${prefix}legendasaiu
│ 👋 ${prefix}legendabv
│ 📥 ${prefix}legendaentrada
│ 📄 ${prefix}legendasimples
│ 🖼 ${prefix}fotobv
│ 📸 ${prefix}set-fotobv
│ 🖼 ${prefix}set-bannerbv
│ ❌ ${prefix}rmfotobv
│ 📤 ${prefix}fotosaiu
│ 🗑 ${prefix}rmfotosaiu
│ ⚡ ${prefix}setprefix
│ 🗑 ${prefix}removermediamenugrupo
╰━━━꧁༺ ✦ ༻꧂━━━━━━━━━━━━╯


╭━━━꧁༺ ㅤ💬 ${boldItalic('AUTO-RESPOSTAS')} 💬ㅤ ༻꧂━━━╮
│ ➕ ${prefix}addautoadm
│ 🖼 ${prefix}addautoadmidia
│ 📋 ${prefix}listautoadm
│ ➖ ${prefix}delautoadm
│ 🤖 ${prefix}autorespostas
│ 🔄 ${prefix}autorepo
╰━━━꧁༺ ✦ ༻꧂━━━━━━━━━━━━╯


╭━━━꧁༺ ㅤ⚡ ${boldItalic('MODOS & ATIVAÇÕES')} ⚡ㅤ ༻꧂━━━╮
│ 📥 ${prefix}autodl
│ 📏 ${prefix}minmessage
│ 🤖 ${prefix}assistente
│ 🎉 ${prefix}modobn
│ 🤝 ${prefix}modoparceria
│ 🎮 ${prefix}modorpg
│ ⚽ ${prefix}modofut
│ 🖼 ${prefix}modofig
│    > Ativa/desativa a conversão automática de fotos e vídeos de até 9 segundos em figurinhas.
│ 🌙 ${prefix}modolite
│ 🔞 ${prefix}modo18
│ 👋 ${prefix}bemvindo
│ 👋 ${prefix}bemvindo2
│ 🚪 ${prefix}saida
│ 🏷 ${prefix}autosticker
│ 👑 ${prefix}soadm
│ 📊 ${prefix}cmdlimit
│ 🖼 ${prefix}fotomenugrupo
│ 📝 ${prefix}nomegp
│ 👤 ${prefix}infoperso
╰━━━꧁༺ ✦ ༻꧂━━━━━━━━━━━━╯


╭━━━꧁༺ ㅤ🤖 ${boldItalic('SISTEMA DE NPCs')} 🤖ㅤ ༻꧂━━━╮
│ ▶ ${prefix}npc on
│ ⏹ ${prefix}npc off
│ 📊 ${prefix}npc status
│ ⏱ ${prefix}npc cooldown
│ 📰 ${prefix}npc jornal on
│ 📰 ${prefix}npc jornal off
│ ⚙ ${prefix}npc config
╰━━━꧁༺ ✦ ༻꧂━━━━━━━━━━━━╯


╭━━━꧁༺ ㅤ☀️ ${boldItalic('SAUDAÇÕES EM GRUPO')} ☀️ㅤ ༻꧂━━━╮
│ 🌅 ${prefix}dia
│ 🌤️ ${prefix}tarde
│ 🌙 ${prefix}noite
│ 🌑 ${prefix}madrugada
│ 🚨 ${prefix}cvc1
│ 📢 ${prefix}cvc2
│ 💀 ${prefix}cvc3
│ ⚠️ ${prefix}cvc4
╰━━━꧁༺ ✦ ༻꧂━━━━━━━━━━━━╯

╭─────────────────╮
╰─────────────────╯
`;
}
