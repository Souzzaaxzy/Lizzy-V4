/**
 * A VOZ da conversa — a Lizzy manda ÁUDIO no chat.
 *
 * ## O pedido do dono
 *
 * *"vamos pelo áudio, primeiro vamos configurar apenas o 'lizzy, manda um áudio
 * ai' só pra testar, depois automatizamos"* — e depois: *"eu quero áudio normal
 * mesmo, sem nota de voz, aquele áudio que o usuário grava e manda seco no
 * grupo"*.
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
 * ## ÁUDIO NORMAL (não nota de voz)
 *
 * O dono pediu o áudio comum — *"aquele áudio que o usuário grava e manda seco
 * no grupo"*. Isso é `ptt: false` + `audio/mpeg` (a mesma forma do `!play`).
 *
 * **A nota de voz** seria `ptt: true` + OGG/Opus — o que sai com waveform e
 * botão de play. Não é o que ele quer.
 *
 * ## Sem ffmpeg neste caminho
 *
 * O `msedge-tts` já entrega **MP3 codificado** pelo próprio serviço, então aqui
 * não passa ffmpeg: o áudio sai mesmo num servidor sem o binário.
 *
 * Módulo PURO quanto ao reconhecimento (não abre socket nem arquivo); a
 * síntese recebe o TTS por parâmetro, então dá para testar sem rede.
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
 * Gera o ÁUDIO (MP3) que a Lizzy manda no chat.
 *
 * O `msedge-tts` entrega MP3 pronto — então aqui **não passa ffmpeg** e o
 * resultado é **áudio comum** (`ptt: false`), como o dono pediu.
 *
 * A dependência entra por parâmetro (`sintetizarMp3`) — assim o teste roda sem
 * rede.
 *
 * @param {object} p
 * @param {string} p.texto o que falar
 * @param {function} p.sintetizarMp3 `(texto) => Promise<{ok, mp3, fonte?, motivo?}>`
 * @returns {Promise<{ ok: boolean, mp3?: Buffer, fonte?: string, motivo?: string }>}
 */
export async function gerarAudio({ texto, sintetizarMp3 } = {}) {
  const limpo = String(texto || '').trim();
  if (!limpo) return { ok: false, motivo: 'texto_vazio' };
  if (typeof sintetizarMp3 !== 'function') return { ok: false, motivo: 'sem_dependencias' };

  let tts;
  try { tts = await sintetizarMp3(limpo); } catch { return { ok: false, motivo: 'tts_falhou' }; }
  if (!tts || !tts.ok || !tts.mp3 || !tts.mp3.length) {
    return { ok: false, motivo: tts?.motivo || 'tts_falhou' };
  }
  if (!Buffer.isBuffer(tts.mp3)) return { ok: false, motivo: 'audio_invalido' };
  return { ok: true, mp3: tts.mp3, fonte: tts.fonte || 'tts' };
}

/** A mensagem de erro, por motivo (o dono ve o que fazer). */
export function erroDaVoz(motivo) {
  const mapa = {
    tts_falhou: 'não consegui gerar a voz agora',
    sem_dependencias: 'a voz não está disponível neste servidor',
    texto_vazio: 'não tenho o que falar',
    audio_invalido: 'não consegui preparar o áudio',
    tts_desativado: 'a voz está desativada no servidor'
  };
  return mapa[motivo] || 'não consegui gerar o áudio agora';
}
