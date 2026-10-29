/**
 * STT do `!iap` (e do `!transcrever`) -- audio vira texto.
 *
 * ## Dois provedores, nesta ordem
 *
 * 1. **Gemini** (principal) — usa a chave do `!key`, a mesma dos outros comandos
 *    de IA. A requisicao vai pela **cadeia de modelos** do `ia.js`.
 * 2. **Groq Whisper** (reserva) — `whisper-large-v3-turbo` numa API compativel
 *    com OpenAI. So' entra quando o Gemini falha (timeout/rede/limite), o que
 *    garante que o agente nao fique mudo por causa de um provedor.
 *
 * ## O que foi MEDIDO nos logs do dono (e o que cada correcao resolve)
 *
 *     [Gemini API] modelo "gemini-2.5-flash" indisponível; tentando o próximo.
 *     [TRANSCREVER] falhou | motivo=rede | timeout of 90000ms exceeded
 *
 * - `motivo=rede` (nao `chave`) provou que a chave esta' OK — o que falha e' o
 *   TEMPO. O audio ia INTEIRO inline e o modelo padrao gasta tempo "pensando"
 *   antes de transcrever;
 * - o PRIMEIRO modelo da cadeia (`gemini-2.5-flash`) ja' deu 404, gastando uma
 *   rodada antes de chegar no que funciona.
 *
 * Correcoes: o modelo **preferido virou o alias rolante** (`gemini-flash-latest`,
 * que nao envelhece), o **thinking foi DESLIGADO** na transcricao
 * (`thinkingBudget: 0` — transcrever nao precisa de raciocinio, e a doc marca o
 * thinking como o caminho da LATENCIA), o timeout subiu e o **Groq entra como
 * reserva**.
 *
 * ## O que entra
 *
 * PCM 16 kHz mono (`Float32Array`), o mesmo formato que o motor entrega. Vira
 * WAV antes de sair (o cabecalho e' o que diz a taxa e os canais).
 */

import axios from 'axios';
import { spawn } from 'child_process';
import * as ia from '../funcs/private/ia.js';
import { pcmParaWav, TAXA_MOTOR } from './iapAudio.js';

/**
 * Modelo PREFERIDO do Gemini.
 *
 * O alias rolante (`gemini-flash-latest`) aponta para a release atual e NAO
 * envelhece — usar `gemini-2.5-flash` aqui custava uma rodada 404 antes de
 * achar um modelo bom (medido no log do dono).
 */
const MODELO_STT = process.env.IAP_STT_MODEL || 'gemini-flash-latest';

/** Modelo da reserva (Groq). */
const MODELO_GROQ = process.env.IAP_GROQ_STT_MODEL || 'whisper-large-v3-turbo';

/** Prompt da transcricao: so' o texto, sem comentario. */
const PROMPT_STT = 'Transcreva o audio a seguir em portugues do Brasil. '
  + 'Retorne APENAS a transcricao, sem comentarios, sem marcacoes e sem prefixo. '
  + 'Se nao houver fala inteligivel, retorne uma linha vazia.';

/** Teto de tempo do Gemini por modelo. Audio curto nao deveria passar disso. */
const TIMEOUT_GEMINI_MS = Number.parseInt(process.env.IAP_STT_TIMEOUT_MS || '45000', 10);

/** Teto de tempo do Groq. */
const TIMEOUT_GROQ_MS = Number.parseInt(process.env.IAP_GROQ_TIMEOUT_MS || '45000', 10);

/** Injetavel para os testes. */
let _httpPost = null;

/**
 * Troca o cliente HTTP (teste). Reusa o MESMO seam do `ia.js`, para a cadeia de
 * modelos ser exercitada sem rede.
 * @param {null|Function} postFn
 * @param {null|Function} [getFn]
 */
export function setIapHttpForTest(postFn, getFn) {
  _httpPost = typeof postFn === 'function' ? postFn : null;
  try { ia.setGeminiHttpForTest?.(_httpPost, typeof getFn === 'function' ? getFn : null); } catch { /* ok */ }
}

/** Extrai o texto das partes da resposta do Gemini. */
function textoDaResposta(data) {
  const partes = data?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(partes)) return '';
  return partes.map((p) => (p && typeof p.text === 'string' ? p.text : '')).join('').trim();
}

/**
 * Chave do Groq (a reserva). Vem do `!keygroq` / `.env`.
 * @returns {string}
 */
export function chaveGroq() {
  return String(process.env.GROQ_API_KEY || '').trim();
}

/**
 * Extensao de arquivo a partir do mimetype.
 *
 * ## O BUG que isto corrige (o Groq recusou a transcricao)
 *
 * O Groq decide o formato do audio pela **EXTENSAO do nome do arquivo**, nao
 * pelo mimetype. O `!transcrever` mandava o arquivo chamado so' `'audio'` —
 * sem extensao — e a API recusou:
 *
 *     file must be one of the following types: [flac mp3 mp4 mpeg mpga m4a
 *     ogg opus wav webm]
 *
 * Uma nota de voz do WhatsApp e' OGG/Opus, entao o nome certo e' `audio.ogg`.
 *
 * @param {string} mimeType
 * @returns {string} extensao SEM ponto (ex.: 'ogg')
 */
export function extensaoDoAudio(mimeType) {
  const m = String(mimeType || '').toLowerCase().split(';')[0].trim();
  const mapa = {
    'audio/ogg': 'ogg',
    'audio/opus': 'opus',
    'audio/mpeg': 'mp3',
    'audio/mp3': 'mp3',
    'audio/mp4': 'm4a',
    'audio/m4a': 'm4a',
    'audio/x-m4a': 'm4a',
    'audio/wav': 'wav',
    'audio/wave': 'wav',
    'audio/x-wav': 'wav',
    'audio/webm': 'webm',
    'audio/flac': 'flac',
    'audio/x-flac': 'flac',
    'video/mp4': 'mp4',
    'video/mpeg': 'mpeg',
    'video/webm': 'webm'
  };
  return mapa[m] || 'ogg';
}

/** Formatos que o Groq Whisper aceita (a extensao decide). */
const EXTENSOES_GROQ = new Set(['flac', 'mp3', 'mp4', 'mpeg', 'mpga', 'm4a', 'ogg', 'opus', 'wav', 'webm']);

/**
 * Detecta o formato pelos BYTES INICIAIS (magic bytes).
 *
 * ## Por que NAO confiar no mimetype
 *
 * O Groq decide o formato pela **extensao**, e o mimetype que o WhatsApp manda
 * pode nao bater com o conteudo (ex.: um container marcado como `audio/ogg`).
 * Mandar a extensao errada faz a API recusar com *"file must be one of the
 * following types"* — foi o erro do log. Ler o magic byte resolve na origem:
 * a extensao passa a descrever o que o arquivo **e'**, nao o que ele **diz**.
 *
 * @param {Buffer} b
 * @returns {string|null} extensao, ou null se nao reconhecer
 */
export function extensaoPorConteudo(b) {
  if (!Buffer.isBuffer(b) || b.length < 4) return null;
  const h = b.toString('hex', 0, 4).toLowerCase();
  if (h.startsWith('4f676753')) return 'ogg';                 // "OggS"
  if (h.startsWith('52494646')) return 'wav';                 // "RIFF" (WAVE)
  if (h.startsWith('494433') || h.startsWith('fffb') || h.startsWith('fff3')) return 'mp3'; // ID3 / frame
  if (h === '1a45dfa3') return 'webm';                        // EBML (webm/mkv)
  if (h.startsWith('664c6143')) return 'flac';                // "fLaC"
  // MP4/M4A: "....ftyp" (o tamanho vem antes do 'ftyp').
  if (b.length >= 8 && b.toString('ascii', 4, 8) === 'ftyp') return 'm4a';
  return null;
}

/**
 * Garante um audio em formato aceito pelo Groq.
 *
 * Escolhe a extensao pelo CONTEUDO (magic bytes) e, so' se nao reconhecer,
 * cai no mimetype. Se mesmo assim o formato nao for aceito (ex.: `amr`, `3gp`),
 * converte para **OGG/Opus** com o ffmpeg do sistema — que o bot ja' exige.
 *
 * @param {Buffer} arquivo
 * @param {string} extensaoDoMime
 * @returns {Promise<{ bytes: Buffer, extensao: string, convertido: boolean }>}
 */
export function normalizarParaGroq(arquivo, extensaoDoMime) {
  const porConteudo = extensaoPorConteudo(arquivo);
  // Se o CONTEUDO foi reconhecido, ele manda (o mimetype pode mentir).
  if (porConteudo && EXTENSOES_GROQ.has(porConteudo)) {
    return Promise.resolve({ bytes: arquivo, extensao: porConteudo, convertido: false });
  }
  // Conteudo DESCONHECIDO: nao da' para confiar no mimetype (ele vira 'ogg' por
  // padrao e "passaria", mas o arquivo pode ser amr/3gp e o Groq recusaria).
  // Converter e' o caminho seguro.
  const ext = porConteudo || extensaoDoMime || 'desconhecido';
  return new Promise((resolve) => {
    let proc;
    try {
      proc = spawn(process.env.FFMPEG_PATH || 'ffmpeg', [
        '-hide_banner', '-loglevel', 'error',
        '-i', 'pipe:0',
        '-vn', '-c:a', 'libopus', '-b:a', '64k', '-ar', '48000', '-ac', '1',
        '-f', 'ogg', 'pipe:1'
      ], { stdio: ['pipe', 'pipe', 'ignore'] });
    } catch {
      resolve({ bytes: arquivo, extensao: ext, convertido: false });
      return;
    }
    const pedacos = [];
    let terminou = false;
    const encerrar = (v) => { if (!terminou) { terminou = true; clearTimeout(t); resolve(v); } };
    const t = setTimeout(() => { try { proc.kill('SIGKILL'); } catch { /* ok */ } encerrar({ bytes: arquivo, extensao: ext, convertido: false }); }, 60000);
    proc.on('error', () => encerrar({ bytes: arquivo, extensao: ext, convertido: false }));
    proc.stdout.on('data', (d) => pedacos.push(d));
    proc.stdout.on('end', () => {
      const b = Buffer.concat(pedacos);
      // So' aceita a conversao se ela realmente produziu audio.
      if (b.length > 100) encerrar({ bytes: b, extensao: 'ogg', convertido: true });
      else encerrar({ bytes: arquivo, extensao: ext, convertido: false });
    });
    try {
      proc.stdin.on('error', () => { /* EPIPE */ });
      proc.stdin.end(arquivo);
    } catch { encerrar({ bytes: arquivo, extensao: ext, convertido: false }); }
  });
}

/**
 * Transcreve pelo Groq Whisper (`/openai/v1/audio/transcriptions`).
 *
 * Multipart com o WAV — a API aceita 25 MB no plano gratis e devolve rapido
 * (o Whisper turbo roda ~200x o tempo real).
 *
 * @param {Buffer} wav
 * @param {string} apiKey
 * @returns {Promise<{ ok: boolean, texto?: string, motivo?: string, detalhe?: string }>}
 */
async function transcreverGroq(wav, apiKey) {
  if (!apiKey) return { ok: false, motivo: 'sem_chave_groq' };

  try {
    const form = new FormData();
    form.append('file', new Blob([wav], { type: 'audio/wav' }), 'audio.wav');
    form.append('model', MODELO_GROQ);
    form.append('language', 'pt');
    form.append('response_format', 'text');

    const config = {
      headers: { Authorization: `Bearer ${apiKey}` },
      timeout: TIMEOUT_GROQ_MS
    };
    const url = 'https://api.groq.com/openai/v1/audio/transcriptions';
    const resp = _httpPost
      ? await _httpPost(url, form, config)
      : await axios.post(url, form, config);

    // Com `response_format: text` o corpo JA' e' o texto.
    const bruto = typeof resp?.data === 'string' ? resp.data : (resp?.data?.text || '');
    const texto = String(bruto).trim();
    if (!texto) return { ok: false, motivo: 'sem_fala' };
    return { ok: true, texto };
  } catch (e) {
    const status = e?.response?.status;
    const detalhe = e?.response?.data?.error?.message || e?.message || String(e);
    if (status === 401 || status === 403) return { ok: false, motivo: 'chave_groq', detalhe };
    if (status === 429) return { ok: false, motivo: 'limite', detalhe };
    if (!status || e?.code === 'ECONNABORTED' || e?.code === 'ETIMEDOUT') {
      return { ok: false, motivo: 'rede', detalhe };
    }
    return { ok: false, motivo: 'falha', detalhe };
  }
}

/**
 * Transcreve um ARQUIVO de audio (ja' baixado) pelo Groq Whisper.
 *
 * E' a porta que o `!transcrever` usa: ele tem o arquivo original do WhatsApp,
 * nao o PCM — entao nao passa por `transcreverPcm`.
 *
 * @param {Buffer} arquivo bytes do audio
 * @param {string} [mimeType]
 * @returns {Promise<{ ok: boolean, texto?: string, motivo?: string, detalhe?: string }>}
 */
export async function transcreverArquivoGroq(arquivo, mimeType = 'audio/ogg') {
  if (!arquivo || !arquivo.length) return { ok: false, motivo: 'audio_vazio' };
  const apiKey = chaveGroq();
  if (!apiKey) return { ok: false, motivo: 'sem_chave_groq' };

  // O nome do arquivo precisa ter a EXTENSAO certa: o Groq decide o formato por
  // ela, nao pelo mimetype. Sem isso a API recusa ("file must be one of the
  // following types: [...]").
  const ext = extensaoDoAudio(mimeType);
  const pronto = await normalizarParaGroq(arquivo, ext);

  try {
    const form = new FormData();
    form.append('file', new Blob([pronto.bytes], { type: mimeType }), `audio.${pronto.extensao}`);
    form.append('model', MODELO_GROQ);
    form.append('language', 'pt');
    form.append('response_format', 'text');

    const config = {
      headers: { Authorization: `Bearer ${apiKey}` },
      timeout: TIMEOUT_GROQ_MS
    };
    const url = 'https://api.groq.com/openai/v1/audio/transcriptions';
    const resp = _httpPost
      ? await _httpPost(url, form, config)
      : await axios.post(url, form, config);

    const bruto = typeof resp?.data === 'string' ? resp.data : (resp?.data?.text || '');
    const texto = String(bruto).trim();
    if (!texto) return { ok: false, motivo: 'sem_fala' };
    return { ok: true, texto };
  } catch (e) {
    const status = e?.response?.status;
    const detalhe = e?.response?.data?.error?.message || e?.message || String(e);
    if (status === 401 || status === 403) return { ok: false, motivo: 'chave_groq', detalhe };
    if (status === 429) return { ok: false, motivo: 'limite', detalhe };
    if (!status || e?.code === 'ECONNABORTED' || e?.code === 'ETIMEDOUT') {
      return { ok: false, motivo: 'rede', detalhe };
    }
    return { ok: false, motivo: 'falha', detalhe };
  }
}

/**
 * Transcreve um bloco de PCM 16 kHz mono.
 *
 * ## A ordem (e por que o Groq vem PRIMEIRO quando existe)
 *
 * `IAP_STT_ENGINE` decide: `auto` (padrao) | `gemini` | `groq`.
 *
 * No `auto`, **com chave do Groq**, a transcricao vai pelo **Groq Whisper** —
 * por tres razoes medidas:
 *
 *  1. **e' um modelo DEDICADO a transcricao** (o Gemini usa um generativo para
 *     o mesmo trabalho, e era ele que estourava o tempo);
 *  2. **nao gasta a cota do Gemini**, que fica livre para o que ele faz melhor:
 *     PENSAR (o agente faz DUAS chamadas por turno — ouvir e pensar — e as duas
 *     saiam na mesma cota);
 *  3. e' **~200x o tempo real**, entao a resposta sai antes.
 *
 * Se o Groq falhar, cai no **Gemini** — e vice-versa. Os dois lados tem reserva,
 * entao nenhum provedor fora do ar deixa o agente mudo.
 *
 * @param {Float32Array} pcm
 * @param {object} [opts]
 * @param {string} [opts.apiKey] chave do Gemini
 * @param {string} [opts.groqKey] chave do Groq
 * @param {string} [opts.modelo]
 * @returns {Promise<{ ok: boolean, texto?: string, motivo?: string, detalhe?: string, fonte?: string, modelo?: string }>}
 */
export async function transcreverPcm(pcm, { apiKey, groqKey, modelo = MODELO_STT } = {}) {
  if (!pcm || !pcm.length) return { ok: false, motivo: 'audio_vazio' };

  const wav = pcmParaWav(pcm, TAXA_MOTOR);
  const chaveG = groqKey || chaveGroq();
  const motor = String(process.env.IAP_STT_ENGINE || 'auto').toLowerCase();

  // Quem vai PRIMEIRO.
  const groqPrimeiro = motor === 'groq' || (motor === 'auto' && Boolean(chaveG));

  const tentarGemini = async () => {
    if (!apiKey) return { ok: false, motivo: 'sem_chave' };
    const r = await ia.geminiRequestMultimodal({
      apiKey,
      modelo,
      timeoutMs: TIMEOUT_GEMINI_MS,
      corpo: {
        contents: [{
          parts: [
            { text: PROMPT_STT },
            { inlineData: { mimeType: 'audio/wav', data: wav.toString('base64') } }
          ]
        }],
        // TRANSCREVER NAO PRECISA DE RACIOCINIO. Desligar o thinking corta a
        // latencia (era o timeout de 90s) sem perder qualidade na transcricao.
        generationConfig: { thinkingConfig: { thinkingBudget: 0 } }
      }
    });
    if (!r.ok) return { ok: false, motivo: r.motivo, detalhe: r.detalhe, fonte: 'gemini' };
    const texto = textoDaResposta(r.data);
    if (!texto) return { ok: false, motivo: 'sem_fala', fonte: 'gemini', modelo: r.modeloUsado };
    return { ok: true, texto, fonte: 'gemini', modelo: r.modeloUsado };
  };

  const tentarGroq = async () => {
    const r = await transcreverGroq(wav, chaveG);
    return r.ok ? { ...r, fonte: 'groq' } : r;
  };

  const primeiro = groqPrimeiro ? tentarGroq : tentarGemini;
  const segundo = groqPrimeiro ? tentarGemini : tentarGroq;

  const r1 = await primeiro();
  // `sem_fala` = o audio nao tinha fala. Nao e' falha de provedor: tentar o
  // outro so' gastaria cota.
  if (r1.ok || r1.motivo === 'sem_fala') return r1;

  const r2 = await segundo();
  if (r2.ok) return r2;

  // Nenhum dos dois: devolve o motivo do PRIMEIRO + o do segundo.
  return {
    ok: false,
    motivo: r1.motivo,
    detalhe: `${r1.detalhe || ''}${r2.motivo ? ` | reserva: ${r2.motivo}` : ''}`.trim(),
    fonte: r1.fonte
  };
}

/** O modelo preferido do Gemini (diagnostico/testes). */
export function modeloStt() {
  return MODELO_STT;
}

/** O modelo do Groq (diagnostico/testes). */
export function modeloGroq() {
  return MODELO_GROQ;
}

/**
 * Qual motor de STT esta' em uso agora (`auto` resolvido).
 * @returns {'groq'|'gemini'|'nenhum'}
 */
export function motorSttAtivo() {
  const motor = String(process.env.IAP_STT_ENGINE || 'auto').toLowerCase();
  const temGroq = Boolean(chaveGroq());
  const temGemini = Boolean(process.env.GEMINI_API_KEY);
  if (motor === 'groq') return temGroq ? 'groq' : (temGemini ? 'gemini' : 'nenhum');
  if (motor === 'gemini') return temGemini ? 'gemini' : (temGroq ? 'groq' : 'nenhum');
  if (temGroq) return 'groq';
  return temGemini ? 'gemini' : 'nenhum';
}
