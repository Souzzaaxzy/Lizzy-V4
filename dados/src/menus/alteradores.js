import { boldItalic, cabecalho, FECHO } from './layout.js';

export default async function menuAlterador(prefix, botName = "MeuBot", userName = "Usuário") {
    return `${cabecalho(botName, userName, 'ALTERADORES', '🎬', ['🎬 Efeitos de vídeo, áudio e imagem'])}


╭━━━꧁༺ ㅤ✂️ ${boldItalic('EDIÇÃO BÁSICA')} ✂️ㅤ ༻꧂━━━╮
│ ➜ ${prefix}cortarvideo <inicio> <fim>
│ ➜ ${prefix}tomp3
│    ╰ Converter para áudio
╰━━━꧁༺ ✦ ༻꧂━━━━━━━━━━━━╯


╭━━━꧁༺ ㅤ⏱️ ${boldItalic('VELOCIDADE')} ⏱️ㅤ ༻꧂━━━╮
│ ➜ ${prefix}videorapido
│ ➜ ${prefix}fastvid
│ ➜ ${prefix}videoslow
│ ➜ ${prefix}videolento
╰━━━꧁༺ ✦ ༻꧂━━━━━━━━━━━━╯


╭━━━꧁༺ ㅤ✨ ${boldItalic('EFEITOS')} ✨ㅤ ༻꧂━━━╮
│ ➜ ${prefix}videoreverso
│ ➜ ${prefix}videoloop
│ ➜ ${prefix}videomudo
│ ➜ ${prefix}videobw
│ ➜ ${prefix}pretoebranco
│ ➜ ${prefix}sepia
│ ➜ ${prefix}espelhar
│ ➜ ${prefix}rotacionar
│ ➜ ${prefix}rmbg
│ ➜ ${prefix}upscale
╰━━━꧁༺ ✦ ༻꧂━━━━━━━━━━━━╯


╭━━━꧁༺ ㅤ✂️ ${boldItalic('EDIÇÃO BÁSICA')} ✂️ㅤ ༻꧂━━━╮
│ ➜ ${prefix}cortaraudio <inicio> <fim>
│ ➜ ${prefix}velocidade <0.5-3.0>
│ ➜ ${prefix}speed <0.5-3.0>
│ ➜ ${prefix}normalizar
╰━━━꧁༺ ✦ ༻꧂━━━━━━━━━━━━╯


╭━━━꧁༺ ㅤ🎙️ ${boldItalic('MUDANÇA DE VOZ')} 🎙️ㅤ ༻꧂━━━╮
│ ➜ ${prefix}boyvoice
│ ➜ ${prefix}vozmenino
│ ➜ ${prefix}womenvoice
│ ➜ ${prefix}vozmulher
│ ➜ ${prefix}manvoice
│ ➜ ${prefix}vozhomem
│ ➜ ${prefix}childvoice
│ ➜ ${prefix}vozcrianca
╰━━━꧁༺ ✦ ༻꧂━━━━━━━━━━━━╯


╭━━━꧁༺ ㅤ⏩ ${boldItalic('EFEITOS DE VELOCIDADE')} ⏩ㅤ ༻꧂━━━╮
│ ➜ ${prefix}speedup
│ ➜ ${prefix}vozrapida
│ ➜ ${prefix}audiorapido
│ ➜ ${prefix}vozlenta
│ ➜ ${prefix}audiolento
╰━━━꧁༺ ✦ ༻꧂━━━━━━━━━━━━╯


╭━━━꧁༺ ㅤ🔊 ${boldItalic('EFEITOS DE BASS & GRAVE')} 🔊ㅤ ༻꧂━━━╮
│ ➜ ${prefix}bass
│ ➜ ${prefix}bass2
│ ➜ ${prefix}bass3
│ ➜ ${prefix}bassbn <1-20>
│ ➜ ${prefix}grave
│ ➜ ${prefix}vozgrave
╰━━━꧁༺ ✦ ༻꧂━━━━━━━━━━━━╯


╭━━━꧁༺ ㅤ🌈 ${boldItalic('EFEITOS ESPECIAIS')} 🌈ㅤ ༻꧂━━━╮
│ ➜ ${prefix}vozeco
│ ➜ ${prefix}eco
│ ➜ ${prefix}vozcaverna
│ ➜ ${prefix}reverb
│ ➜ ${prefix}reversobn
│ ➜ ${prefix}reverse
│ ➜ ${prefix}audioreverso
│ ➜ ${prefix}chorus
│ ➜ ${prefix}phaser
│ ➜ ${prefix}flanger
│ ➜ ${prefix}tremolo
│ ➜ ${prefix}vibrato
╰━━━꧁༺ ✦ ༻꧂━━━━━━━━━━━━╯


╭━━━꧁༺ ㅤ🎚️ ${boldItalic('VOLUME & EQUALIZAÇÃO')} 🎚️ㅤ ༻꧂━━━╮
│ ➜ ${prefix}volumeboost
│ ➜ ${prefix}aumentarvolume
│ ➜ ${prefix}equalizer
│ ➜ ${prefix}equalizar
│ ➜ ${prefix}overdrive
│ ➜ ${prefix}pitch
│ ➜ ${prefix}lowpass
╰━━━꧁༺ ✦ ༻꧂━━━━━━━━━━━━╯


${FECHO(botName)}
`;
}
