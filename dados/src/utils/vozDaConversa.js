/**
 * A VOZ da conversa — a Lizzy manda ÁUDIO no chat.
 *
 * ## O pedido do dono
 *
 * *"vamos pelo áudio, primeiro vamos configurar apenas o 'lizzy, manda um áudio
 * ai' só pra testar, depois automatizamos"* — e depois, descrevendo o que
 * queria: *"aquele áudio que o usuário grava e manda seco no grupo"*.
 *
 * Ou seja: nesta rodada o gatilho é **explícito** — alguém PEDE o áudio. Não é
 * automático (ela não decide sozinha mandar voz), e isso é de propósito: é o
 * teste antes de automatizar.
 *
 * ## O que este módulo faz (e o que NÃO faz)
 *
 * Ele NÃO gera o texto — quem gera é a IA (`ia.js`), com a personalidade dela.
 * Aqui só:
 *   1. reconhece que a mensagem é um PEDIDO DE ÁUDIO;
 *   2. tira a "moldura" do pedido para virar o tema da fala
 *      ("manda um áudio sobre o jogo" -> "o jogo");
 *   3. converte a fala em nota de voz (PCM -> WAV -> OGG/Opus).
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
 * Gera a NOTA DE VOZ (OGG/Opus mono) que a Lizzy manda no chat.
 *
 * A cadeia é **PCM -> WAV -> OGG/Opus**, a mesma do `!statusgrupo`:
 *
 *   1. `sintetizar(texto)` -> PCM 16 kHz (o formato do motor);
 *   2. `pcmParaWav(pcm)`   -> WAV (o ffmpeg não lê PCM cru por arquivo);
 *   3. `toOggOpus(wav)`    -> OGG/Opus mono (o container da nota de voz).
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
 * ffmpeg, no caminho de erro).
 *
 * @param {object} p
 * @param {string} p.texto o que falar
 * @param {function} p.sintetizar `(texto) => Promise<{ok, pcm, fonte?, motivo?}>`
 * @param {function} p.pcmParaWav `(pcm, taxa) => Buffer`
 * @param {function} p.toOggOpus `(buffer) => Promise<Buffer>`
 * @returns {Promise<{ ok: boolean, ogg?: Buffer, fonte?: string, motivo?: string }>}
 */
export async function gerarNotaDeVoz({ texto, sintetizar, pcmParaWav, toOggOpus } = {}) {
  const limpo = String(texto || '').trim();
  if (!limpo) return { ok: false, motivo: 'texto_vazio' };
  if (typeof sintetizar !== 'function' || typeof pcmParaWav !== 'function' || typeof toOggOpus !== 'function') {
    return { ok: false, motivo: 'sem_dependencias' };
  }

  // 1) TTS: PCM 16 kHz (o formato do motor).
  let tts;
  try { tts = await sintetizar(limpo); } catch { return { ok: false, motivo: 'tts_falhou' }; }
  if (!tts || !tts.ok || !tts.pcm || !tts.pcm.length) {
    return { ok: false, motivo: tts?.motivo || 'tts_falhou' };
  }

  // 2) PCM -> WAV (o ffmpeg não lê PCM cru por arquivo; o WAV tem cabeçalho).
  let wav;
  try { wav = pcmParaWav(tts.pcm); } catch { return { ok: false, motivo: 'wav_falhou' }; }
  if (!Buffer.isBuffer(wav) || !wav.length) return { ok: false, motivo: 'wav_falhou' };

  // 3) WAV -> OGG/Opus (o container da nota de voz).
  try {
    const ogg = await toOggOpus(wav);
    if (!Buffer.isBuffer(ogg) || !ogg.length) return { ok: false, motivo: 'opus_falhou' };
    return { ok: true, ogg, fonte: tts.fonte || 'tts' };
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
    tts_desativado: 'a voz está desativada no servidor'
  };
  return mapa[motivo] || 'não consegui gerar o áudio agora';
}
