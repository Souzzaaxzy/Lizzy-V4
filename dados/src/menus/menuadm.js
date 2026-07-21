export default async function menuadm(prefix, botName = "MeuBot", userName = "Usuário") {
    return `╭━━━〔 🛡️ ${botName} • 𝐀𝐃𝐌 〕━━━╮
┃ 👋 Olá, @${userName}
┃ 👑 Painel Administrativo
┃ ⚙️ Gerencie todo o grupo
╰━━━━━━━━━━━━━━━━━━━╯


╭─❖ 🏛️ SISTEMA DE ELEIÇÃO
│ 🗳 ${prefix}eleicao
│ 👤 ${prefix}cand
│ ⏱ ${prefix}tempeleicao
╰──────────────


╭─❖ 🛡️ GESTÃO DE USUÁRIOS
│ 🚫 ${prefix}ban
│ 🚫 ${prefix}bann @user1 @user2
│ ☠ ${prefix}bbn @user1 @user2 @user3
│ 🎲 ${prefix}roletaban
│ ⚡ ${prefix}ban2
│ 📊 ${prefix}enquete
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
╰──────────────


╭─❖ 🎯 METAS DE MENSAGENS
│ 🎯 ${prefix}setdiario
│ 📅 ${prefix}setsemanal
│ 📊 ${prefix}vermetas
╰──────────────


╭─❖ 🔒 CONTROLE DE ACESSO
│ 🚫 ${prefix}blockuser
│ ✅ ${prefix}unblockuser
│ 📋 ${prefix}listblockuser
│ 🚷 ${prefix}blockcmdgp
│ ✔ ${prefix}unblockcmdgp
│ 📂 ${prefix}blockmenugp
│ 📂 ${prefix}unblockmenugp
│ 📑 ${prefix}listblockmenugp
╰──────────────


╭─❖ 🛡️ CONTROLE LEGADO
│ 📋 ${prefix}listblocksgp
│ ➕ ${prefix}addblacklist
│ ➖ ${prefix}delblacklist
│ 📖 ${prefix}listblacklist
│ 🚫 ${prefix}blockcmd
│ ✅ ${prefix}unblockcmd
╰──────────────


╭─❖ 💬 GESTÃO DO GRUPO
│ 🗑 ${prefix}del
│ 🧹 ${prefix}limpar
│ 📢 ${prefix}marcar
│ 👻 ${prefix}hidetag
│ 🎲 ${prefix}sorteio
│ 📝 ${prefix}nomegp
│ 📄 ${prefix}descgrupo
│ 🖼 ${prefix}fotogrupo
│ ➕ ${prefix}addregra
│ ➖ ${prefix}delregra
│ 🗂 ${prefix}lixeira
│ ♻ ${prefix}restaurar
│ 🎭 ${prefix}role.criar
│ ✏ ${prefix}role.alterar
│ ❌ ${prefix}role.excluir
╰──────────────


╭─❖ ⚙️ GRUPO & PERMISSÕES
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
╰──────────────


╭─❖ 👥 MODERADORES
│ ➕ ${prefix}addmod
│ ➖ ${prefix}delmod
│ 📋 ${prefix}listmods
│ 🔑 ${prefix}grantmodcmd
│ ❌ ${prefix}revokemodcmd
│ 📖 ${prefix}listmodcmds
╰──────────────


╭─❖ 🐺 CARGO ALPHA
│ ➕ ${prefix}addalpha
│ ➖ ${prefix}delalpha
│ 📋 ${prefix}listalphas
│ 🔑 ${prefix}grantalphacmd
│ ❌ ${prefix}revokealphacmd
│ 📖 ${prefix}listalphacmds
╰──────────────


╭─❖ 🛡️ WHITELIST
│ ➕ ${prefix}wladd
│ ➖ ${prefix}wl.remove
│ 📋 ${prefix}wl.lista
╰──────────────


╭─❖ 🤝 PARCERIAS
│ 📋 ${prefix}parcerias
│ ➕ ${prefix}addparceria
│ ➖ ${prefix}delparceria
╰──────────────


╭─❖ 🔒 SEGURANÇA
│ 🌊 ${prefix}antiflood
│ 🕵 ${prefix}x9
│ 🔐 ${prefix}antiroubo
│ 🛡️ ${prefix}antis
│ 📄 ${prefix}antidoc
│ 📍 ${prefix}antiloc
│ 🖼 ${prefix}antifig
│ 🔘 ${prefix}antibtn
│ 🖼 ${prefix}antifoton
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
│ 👤 ${prefix}perm @user
│ 👤 ${prefix}delp @user
╰──────────────


╭─❖ 🎨 CONFIGURAÇÕES
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
│ 🖼 ${prefix}fotomenug
│ 🎥 ${prefix}videomenug
│ 🗑 ${prefix}removermediamenugrupo
╰──────────────


╭─❖ 💬 AUTO-RESPOSTAS
│ ➕ ${prefix}addautoadm
│ 🖼 ${prefix}addautoadmidia
│ 📋 ${prefix}listautoadm
│ ➖ ${prefix}delautoadm
│ 🤖 ${prefix}autorespostas
│ 🔄 ${prefix}autorepo
╰──────────────


╭─❖ ⚡ MODOS & ATIVAÇÕES
│ 📥 ${prefix}autodl
│ 📏 ${prefix}minmessage
│ 🤖 ${prefix}assistente
│ 🎉 ${prefix}modobn
│ 🤝 ${prefix}modoparceria
│ 🎮 ${prefix}modorpg
│ ⚽ ${prefix}modofut
│ 🌙 ${prefix}modolite
│ 👋 ${prefix}bemvindo
│ 👋 ${prefix}bemvindo2
│ 🚪 ${prefix}saida
│ 🏷 ${prefix}autosticker
│ 👑 ${prefix}soadm
│ 📊 ${prefix}cmdlimit
│ 🖼 ${prefix}fotomenugrupo
│ 📝 ${prefix}nomegp
│ 👤 ${prefix}infoperso
╰──────────────


╭─❖ 🤖 SISTEMA DE NPCs
│ ▶ ${prefix}npc on
│ ⏹ ${prefix}npc off
│ 📊 ${prefix}npc status
│ ⏱ ${prefix}npc cooldown
│ 📰 ${prefix}npc jornal on
│ 📰 ${prefix}npc jornal off
│ ⚙ ${prefix}npc config
╰──────────────


╭─❖ ☀️ SAUDAÇÕES EM GRUPO
│ 🌅 ${prefix}dia
│ 🌤️ ${prefix}tarde
│ 🌙 ${prefix}noite
╰──────────────

╭─────────────────╮
╰─────────────────╯
`;
}
