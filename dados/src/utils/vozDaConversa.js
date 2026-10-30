/**
 * A VOZ da conversa — a Lizzy manda ÁUDIO no chat.
 *
 * ## O pedido do dono
 *
 * *"vamos pelo áudio, primeiro vamos configurar apenas o 'lizzy, manda um áudio
 * ai' só pra testar, depois automatizamos"* — e depois, descrevendo o que
 * queria: *"aquele áudio que o usuário grava e manda seco no grupo"*.
 *
 * Ou seja: o gatilho EXPLÍCITO é alguém PEDIR o áudio. Depois do teste, o dono
 * liberou o modo automático — ela também manda voz por conta própria, com uma
 * chance baixa (ver "Dois caminhos" abaixo).
 *
 * ## O que este módulo faz (e o que NÃO faz)
 *
 * Ele NÃO gera o texto — quem gera é a IA (`ia.js`), com a personalidade dela.
 * Aqui só:
 *   1. reconhece que a mensagem é um PEDIDO DE ÁUDIO;
 *   2. tira a "moldura" do pedido para virar o tema da fala
 *      ("manda um áudio sobre o jogo" -> "o jogo");
 *   3. sorteia se a resposta sai em áudio (`sortearModoDeResposta`);
 *   4. limpa a fala do que não se fala (`limparFala`);
 *   5. converte a fala em nota de voz (PCM -> WAV -> OGG/Opus).
 *
 * ## Dois caminhos (pedido do dono)
 *
 * 1. **PEDIDO EXPLÍCITO** ("Lizzy, manda um áudio aí") — responde em áudio
 *    **sempre** (100%). É o gatilho de teste.
 * 2. **ESPONTÂNEO** — ela manda voz por conta própria com **25%** de chance
 *    (`CHANCE_ESPONTANEA`). Pedido: *"vamos deixar ela usando o áudio
 *    naturalmente agora, deixa uma porcentagem de 25% de aleatoriedade com as
 *    respostas em áudio, mas quando alguém pede o áudio ela manda normalmente"*.
 *
 * O sorteio é **uma vez por resposta**, fora do fluxo da IA — não gasta chamada
 * extra de modelo.
 *
 * ## NOTA DE VOZ (é o que o dono quer — a "Opção A")
 *
 * O dono descreveu *"aquele áudio que o usuário grava e manda seco no grupo"* —
 * isso é a **nota de voz**: a bolha com o **desenho da onda** (waveform) e o
 * microfone. Foi a PRIMEIRA versão entregue (ele confirmou *"funcionou!!!!"*) e
 * é a que ele escolheu quando as duas formas foram apresentadas lado a lado.
 *
 * ## O que decide a forma é o FORMATO, não o `ptt`
 *
 * (Pesquisado em 3 projetos que usam Baileys, todos com o mesmo texto.)
 *
 *   **MP3**        -> bolha de MÚSICA (a "laranja", com a notinha) — é o `!play`
 *   **OGG/Opus**   -> NOTA DE VOZ (waveform) — o que queremos
 *
 * *"Transcode TTS audio (typically MP3) into OGG/Opus mono so Baileys can
 * deliver it as a WhatsApp voice note... Without this conversion WhatsApp
 * accepts the file but renders it as a music-player audio bubble."*
 *
 * Ou seja: só o `ptt: true` **não** faz a nota de voz — o container tem de ser
 * **OGG/Opus mono**. Por isso a cadeia PCM -> WAV -> OGG/Opus.
 *
 * Módulo PURO quanto ao reconhecimento (não abre socket nem arquivo); as
 * dependências entram por parâmetro, então dá para testar sem rede.
 */

/** Radicais que caracterizam um pedido de áudio (sem acento, minúsculas). */
const PEDIDO_AUDIO = [
  // "manda um áudio", "me manda áudio", "manda áudio aí"
  /(manda|mande|envia|envie|me\s+manda|me\s+envia)\s+(um\s+|o\s+|a\s+)?(audio|áudio|audios|áudios|voz|nota\s+de\s+voz)/,
  // "fala isso pra mim", "fala um pouco"
  /\b(fala|fale|diz|diga)\s+(isso\s+)?(pra|para)\s+mim\b/,
  // "quero ouvir sua voz", "manda sua voz"
  /(quero|queria)\s+ouvir\s+(sua\s+|a\s+sua\s+)?voz/,
  /(manda|mande|envia|envie)\s+(sua\s+|a\s+sua\s+)?voz/,
  // "grava um áudio"
  /(grava|grave)\s+(um\s+|o\s+)?(audio|áudio|voz)/
];

/** Normaliza (sem acento, minúsculo) — o mesmo corte do resto do bot. */
function normalizar(texto) {
  let s = String(texto || '');
  try { s = s.normalize('NFD').replace(/[\u0300-\u036f]/g, ''); } catch { /* ok */ }
  return s.toLowerCase().trim();
}

/**
 * A mensagem é um PEDIDO DE ÁUDIO?
 *
 * @param {string} texto a mensagem já limpa (sem a menção do bot)
 * @returns {boolean}
 */
export function ehPedidoDeAudio(texto) {
  const t = normalizar(texto);
  if (!t) return false;
  return PEDIDO_AUDIO.some((re) => re.test(t));
}

/**
 * O TEMA da fala: a "moldura" do pedido sai e o que sobra é o assunto.
 *
 * Exemplos:
 *   "manda um áudio aí"            -> '' (sem tema: fala o que quiser)
 *   "manda um áudio sobre o jogo"  -> 'o jogo'
 *   "manda um áudio do flamengo"   -> 'o flamengo'
 *   "grava um áudio falando de mim"-> 'mim'
 *
 * @param {string} texto
 * @returns {string} o tema, ou '' quando não há
 */
export function temaDoAudio(texto) {
  let t = String(texto || '').trim();
  // Tira a moldura (na ordem: primeiro a mais específica).
  t = t.replace(/^.*?\b(manda|mande|envia|envie|grava|grave|me\s+manda|me\s+envia)\s+(um\s+|o\s+|a\s+)?(audio|áudio|audios|áudios|voz|nota\s+de\s+voz)\b/i, '');
  t = t.replace(/^.*?\b(quero|queria)\s+ouvir\s+(sua\s+|a\s+sua\s+)?voz\b/i, '');
  t = t.replace(/^.*?\b(fala|fale|diz|diga)\s+(isso\s+)?(pra|para)\s+mim\b/i, '');
  // Tira conectivos que sobram (em loop: "aí, sobre o jogo" tem dois).
  const LIXO = /^\s*(ai|aí|agora|entao|então|pfv|pf|por\s+favor|rapido|rápido|sobre|falando\s+de|de|do|da|dos|das)\b/i;
  for (let i = 0; i < 4; i++) {
    const antes = t;
    t = t.replace(LIXO, '');
    if (t === antes) break;
  }
  // Sobrou so' o verbo do pedido (nenhum tema): devolve vazio.
  if (/^(manda|mande|envia|envie|grava|grave|sua|a\s+sua|voz)\b/i.test(t.trim())) return '';
  // Conectivo solto (ex.: "ai" com acento que o \b nao separou).
  if (/^(ai|aí|agora|entao|então)$/i.test(t.trim())) return '';
  t = t.replace(/[?!.]+$/g, '').trim();
  return t;
}

/**
 * A FRASE da fala, a partir do tema.
 *
 * Sem tema, ela fala do jeito dela (o prompt manda ser natural). Com tema, o
 * pedido vira a instrução.
 *
 * @param {string} tema
 * @returns {string} o texto que vai para o TTS
 */
export function falaDoAudio(tema) {
  const t = String(tema || '').trim();
  if (!t) return 'Oi! Fala comigo.';
  return `Fala pra mim sobre ${t}.`;
}

/**
 * A chance (0..1) de a Lizzy responder em ÁUDIO por conta própria.
 *
 * O dono pediu **25%**. Configurável por `LIZZY_VOZ_ESPONTANEA` (aceita `0.25`
 * ou `25`); um valor fora da faixa cai no padrão.
 */
export const CHANCE_ESPONTANEA = (() => {
  const texto = String(process.env.LIZZY_VOZ_ESPONTANEA ?? '').trim();
  // Sem a env (string vazia) vale o padrao. `Number('')` e' 0, nao NaN — por
  // isso a checagem do texto vem ANTES, senao a ausencia viraria "0%".
  if (!texto) return 0.25;
  const bruto = Number(texto);
  if (!Number.isFinite(bruto) || bruto < 0) return 0.25;
  return bruto > 1 ? Math.min(bruto / 100, 1) : bruto;
})();

/**
 * O teto de caracteres da fala ESPONTÂNEA.
 *
 * Uma nota de voz natural é curta. Se a resposta da IA for longa (o texto do
 * chat não tem o teto de 3 frases da voz), falar tudo viraria uma nota enorme —
 * pouco natural e demorada de sintetizar. Acima deste teto, o caminho
 * espontâneo manda **texto**.
 *
 * **O pedido EXPLÍCITO não passa por aqui** — quem pediu, recebe áudio (e a
 * fala do pedido é curta por construção: `maxTokens: 90`).
 *
 * Configurável por `LIZZY_VOZ_MAX_CARACTERES`.
 */
export const FALA_MAX_CARACTERES = (() => {
  const texto = String(process.env.LIZZY_VOZ_MAX_CARACTERES ?? '').trim();
  if (!texto) return 400;
  const n = Number(texto);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 400;
})();

/**
 * A fala que vai para o TTS, a partir de um TEXTO que a IA já escreveu.
 *
 * O texto do chat tem coisas que **não se falam** — e algumas quebram a voz:
 * `*negrito*`, `~riscado~`, `_itálico_`, emoji, `@menção` (o `@` fica órfão),
 * código, links e quebras de linha. Aqui elas viram fala.
 *
 * Não é um formatador de mensagem: é o mínimo para o TTS não ler asterisco nem
 * "arroba".
 *
 * @param {string} texto
 * @returns {string}
 */
export function limparFala(texto) {
  let t = String(texto || '');
  // Blocos de código saem inteiros (o TTS soletraria os marcadores).
  t = t.replace(/```[\s\S]*?```/g, ' ');
  t = t.replace(/`([^`]*)`/g, '$1');
  // Markdown: negrito/itálico/riscado ficam com o TEXTO, sem os marcadores.
  t = t.replace(/\*{1,3}([^*\n]+)\*{1,3}/g, '$1');
  t = t.replace(/_{1,3}([^_\n]+)_{1,3}/g, '$1');
  t = t.replace(/~{1,2}([^~\n]+)~{1,2}/g, '$1');
  // Títulos (`#`, `##`...) e citações (`>`) no início da linha.
  t = t.replace(/^\s{0,3}#{1,6}\s+/gm, '');
  t = t.replace(/^\s{0,3}>\s?/gm, '');
  // Links: `[texto](url)` -> `texto`; URL crua -> fora (o TTS soletraria).
  t = t.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
  t = t.replace(/https?:\/\/\S+/gi, ' ');
  // Menções e `@` órfãos.
  t = t.replace(/@\d{5,}/g, ' ');
  t = t.replace(/(^|\s)@(?=\s|$)/g, ' ');
  // Emoji e pictogramas (o TTS lê o nome do emoji, o que soa robótico).
  t = t.replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}]/gu, ' ');
  // Quebras de linha e espaços repetidos viram um espaço.
  t = t.replace(/\s+/g, ' ').trim();
  return t;
}

/**
 * Sorteia o MODO da resposta: áudio ou texto.
 *
 * O caminho explícito (`pedidoExplicito`) é **sempre** áudio — quem pediu,
 * manda. O espontâneo usa `CHANCE_ESPONTANEA`.
 *
 * `rng` entra por parâmetro para o teste ser determinístico.
 *
 * @param {object} p
 * @param {boolean} [p.pedidoExplicito] a mensagem é um pedido de áudio?
 * @param {number} [p.chance] 0..1 (padrão `CHANCE_ESPONTANEA`)
 * @param {() => number} [p.rng] fonte de aleatoriedade (padrão `Math.random`)
 * @returns {{ audio: boolean, motivo: 'pedido'|'sorteio'|'texto' }}
 */
export function sortearModoDeResposta({ pedidoExplicito = false, chance = CHANCE_ESPONTANEA, rng = Math.random } = {}) {
  if (pedidoExplicito) return { audio: true, motivo: 'pedido' };
  const c = Number.isFinite(chance) ? Math.min(Math.max(chance, 0), 1) : CHANCE_ESPONTANEA;
  const r = typeof rng === 'function' ? Number(rng()) : Math.random();
  return r < c ? { audio: true, motivo: 'sorteio' } : { audio: false, motivo: 'texto' };
}

/**
 * Gera a NOTA DE VOZ (OGG/Opus mono) que a Lizzy manda no chat.
 *
 * ## O caminho NÃO passa por 16 kHz (a causa do som "abafado")
 *
 * A primeira versão reusava a cadeia do MOTOR da call
 * (`PCM 16 kHz -> WAV -> OGG 48 kHz`). Medido na banda de 10-12 kHz, onde vive
 * o brilho da voz:
 *
 *   TTS do serviço (24 kHz) .......... -41.0 dB
 *   caminho ANTIGO (16 kHz no meio) .. **-51.0 dB**  <- 10 dB de agudo perdidos
 *   caminho NOVO (direto do MP3) ..... -40.9 dB      <- igual ao original
 *
 * O TTS entrega **MP3 a 24 kHz**; o Opus codifica em 48 kHz de qualquer forma,
 * então reamostrar para 16 kHz no meio só **cortava a metade superior da banda**
 * — o som de "telefone". Agora o MP3 vai direto para o Opus.
 *
 * ## Por que o CONTAINER importa (a causa de três rodadas)
 *
 * O WhatsApp decide a forma pelo **formato do áudio**:
 *
 *   MP3      -> bolha de MÚSICA (a "laranja", com a notinha) — igual ao `!play`
 *   OGG/Opus -> NOTA DE VOZ (o desenho da onda) — o que o dono quer
 *
 * Só o `ptt: true` **não** basta: com MP3 o cliente ainda desenha como música.
 * Por isso o transcode.
 *
 * As dependências entram por parâmetro — assim o teste roda sem rede (e sem
 * ffmpeg, no caminho de erro). Os dois formatos de entrada são aceitos:
 * `mp3` (o caminho novo, preferido) e `pcm`+`pcmParaWav` (compatibilidade).
 *
 * @param {object} p
 * @param {string} p.texto o que falar
 * @param {function} p.sintetizarMp3 `(texto) => Promise<{ok, mp3, fonte?, motivo?}>` (preferido)
 * @param {function} p.sintetizar `(texto) => Promise<{ok, pcm, fonte?, motivo?}>` (compatibilidade)
 * @param {function} [p.pcmParaWav] só no caminho `pcm`
 * @param {function} p.toOggOpus `(buffer) => Promise<Buffer>`
 * @param {string} [p.bitrate] bitrate do Opus (padrão `64k`)
 * @returns {Promise<{ ok: boolean, ogg?: Buffer, fonte?: string, motivo?: string }>}
 */
export async function gerarNotaDeVoz({ texto, sintetizarMp3, sintetizar, pcmParaWav, toOggOpus, limite = 0, bitrate = '64k' } = {}) {
  const limpo = String(texto || '').trim();
  if (!limpo) return { ok: false, motivo: 'texto_vazio' };
  // Teto opcional da fala ESPONTANEA: acima dele o chamador manda texto.
  if (Number.isFinite(limite) && limite > 0 && limpo.length > limite) {
    return { ok: false, motivo: 'fala_longa' };
  }
  if (typeof toOggOpus !== 'function') return { ok: false, motivo: 'sem_dependencias' };

  // 1) TTS. O caminho PREFERIDO e' o MP3 (24 kHz, sem reamostragem no meio).
  let fonte = 'tts';
  let entrada = null;
  if (typeof sintetizarMp3 === 'function') {
    let tts;
    try { tts = await sintetizarMp3(limpo); } catch { return { ok: false, motivo: 'tts_falhou' }; }
    if (tts?.ok && tts.mp3?.length) {
      entrada = tts.mp3;
      fonte = tts.fonte || 'tts';
    } else if (!sintetizar) {
      return { ok: false, motivo: tts?.motivo || 'tts_falhou' };
    }
  }

  // 2) Compatibilidade: o caminho antigo (PCM -> WAV). Ele reamostra para
  // 16 kHz, entao e' o de PIOR qualidade — fica so' para quem ja' chamava assim.
  if (!entrada) {
    if (typeof sintetizar !== 'function' || typeof pcmParaWav !== 'function') {
      return { ok: false, motivo: 'sem_dependencias' };
    }
    let tts;
    try { tts = await sintetizar(limpo); } catch { return { ok: false, motivo: 'tts_falhou' }; }
    if (!tts || !tts.ok || !tts.pcm || !tts.pcm.length) {
      return { ok: false, motivo: tts?.motivo || 'tts_falhou' };
    }
    try { entrada = pcmParaWav(tts.pcm); } catch { return { ok: false, motivo: 'wav_falhou' }; }
    if (!Buffer.isBuffer(entrada) || !entrada.length) return { ok: false, motivo: 'wav_falhou' };
    fonte = tts.fonte || 'tts';
  }

  // 3) -> OGG/Opus (o container da nota de voz).
  try {
    const ogg = await toOggOpus(entrada, { bitrate });
    if (!Buffer.isBuffer(ogg) || !ogg.length) return { ok: false, motivo: 'opus_falhou' };
    return { ok: true, ogg, fonte };
  } catch (e) {
    const msg = String(e?.message || '');
    return { ok: false, motivo: /ffmpeg|FFmpeg/i.test(msg) ? 'sem_ffmpeg' : 'opus_falhou' };
  }
}

/** A mensagem de erro, por motivo (o dono ve o que fazer). */
export function erroDaVoz(motivo) {
  const mapa = {
    sem_ffmpeg: 'preciso do FFmpeg instalado no servidor para gerar a nota de voz',
    // O TTS também usa o ffmpeg (MP3 do msedge -> PCM 16 kHz). Sem ele o motivo
    // chega aqui, e não como 'sem_ffmpeg'.
    ffmpeg_faltando: 'preciso do FFmpeg instalado no servidor para gerar a nota de voz',
    tts_falhou: 'não consegui gerar a voz agora',
    sem_dependencias: 'a voz não está disponível neste servidor',
    texto_vazio: 'não tenho o que falar',
    wav_falhou: 'não consegui preparar o áudio',
    opus_falhou: 'não consegui converter o áudio',
    tts_desativado: 'a voz está desativada no servidor',
    fala_longa: 'a resposta é longa demais para falar'
  };
  return mapa[motivo] || 'não consegui gerar o áudio agora';
}
