/**
 * Cliente do GROQ — o provedor de IA do `!iap` e do `!transcrever`.
 *
 * ## Por que o Groq (e nao o Gemini) nestes dois comandos
 *
 * Medido: o `!iap` faz DUAS chamadas por turno (ouvir e pensar). No Gemini as
 * duas saiam na MESMA cota, e era o STT que estourava o tempo (o modelo e' um
 * generativo fazendo trabalho de transcricao). O Groq resolve os dois lados:
 *
 *   - **ouvir**: `whisper-large-v3-turbo` — modelo DEDICADO a transcricao,
 *     ~200x o tempo real (o dono confirmou: "com o groq funcionou");
 *   - **pensar**: `openai/gpt-oss-120b` — conversa natural, e a API e'
 *     compativel com a da OpenAI.
 *
 * A API e' **OpenAI-compativel** (`https://api.groq.com/openai/v1`), entao o
 * mesmo formato de mensagens dos outros comandos serve.
 *
 * ## Os outros comandos de IA NAO mudam
 *
 * `!gemma`, `!phi`, `!qwen` e companhia continuam no Gemini (a chave do `!key`).
 * So' o `!iap` e o `!transcrever` usam este modulo.
 */

import axios from 'axios';
import { spawn } from 'child_process';
import { lerChaves, marcarEsgotada, primeiraDisponivel } from './groqKeys.js';

/** Base da API (compativel com OpenAI). */
const BASE = 'https://api.groq.com/openai/v1';

/** Modelo de transcricao (dedicado, rapido). */
const MODELO_STT = process.env.IAP_GROQ_STT_MODEL || 'whisper-large-v3-turbo';

/**
 * VIES de vocabulario para o Whisper (o campo `prompt`).
 *
 * ## Por que isto melhora o "entendimento"
 *
 * O Whisper trata o `prompt` como o TEXTO ANTERIOR da conversa, entao ele
 * enviesa a decodificacao para esse vocabulario. Colocando aqui os nomes dos
 * comandos e as palavras que ele costuma errar ("toca", "baixa", "figurinha",
 * "pinterest"), o reconhecimento acerta o que INTERESSA — sem trocar de modelo e
 * sem custo extra. Configuravel por `IAP_STT_PROMPT`.
 */
const PROMPT_STT = process.env.IAP_STT_PROMPT
  || 'Comandos: toca, tocar, baixa, baixar, procura, procurar, pesquisa, manda, '
   + 'figurinha, figurinha aleatoria, sticker, musica, video, tiktok, pinterest. '
   + 'Exemplos: "toca Evidencias", "baixa a musica X", "procura no pinterest gatos", '
   + '"manda uma figurinha aleatoria".';

/** Modelo de conversa (o agente de voz). */
const MODELO_LLM = process.env.IAP_GROQ_LLM_MODEL || 'openai/gpt-oss-120b';

/** Tetos de tempo. */
const TIMEOUT_STT_MS = Number.parseInt(process.env.IAP_GROQ_TIMEOUT_MS || '45000', 10);
const TIMEOUT_LLM_MS = Number.parseInt(process.env.IAP_GROQ_LLM_TIMEOUT_MS || '45000', 10);

/** Injetavel para os testes (sem rede). */
let _httpPost = null;
export function setGroqHttpForTest(fn) { _httpPost = typeof fn === 'function' ? fn : null; }
const post = (url, data, config) => (_httpPost ? _httpPost(url, data, config) : axios.post(url, data, config));

/**
 * A chave do Groq (do `!keygroq` ou do `.env`).
 * @returns {string}
 */
export function chaveGroq() {
  // A chave "de agora" e' a PRIMEIRA que ainda nao estourou a cota. Uma chave
  // esgotada nao e' mais tentada ate' o reset (a cota do Groq e' diaria).
  const lista = lerChaves();
  if (!lista.length) return '';
  const disp = primeiraDisponivel(lista);
  return disp ? disp.chave : '';
}

/**
 * Executa `fn(chave)` com a chave ATUAL e, se ela estourar cota ou for invalida,
 * tenta a PROXIMA — ate' acabar as chaves.
 *
 * ## Por que so' nesses dois motivos
 *
 * O Groq responde **401/403** (chave invalida) e **429** (cota). Nos dois,
 * tentar a mesma chave de novo nao adianta e a proxima resolve. Um erro de REDE
 * (timeout, DNS) nao diz nada sobre a chave — rotacionar ali queimaria a cota
 * das outras a toa.
 *
 * ## A chave esgotada NAO volta a ser tentada
 *
 * Ela e' MARCADA (no `groqKeys`, com estado em disco) e a proxima chamada ja'
 * comeca na seguinte. A "chave atual" e' sempre a primeira que ainda nao
 * estourou — nao existe ponteiro que possa ficar preso numa chave morta (era o
 * conflito: cada mensagem batia na primeira de novo).
 *
 * O estado reseta quando o DIA vira (a cota do Groq e' diaria), entao a chave 1
 * volta a valer as 00:00.
 *
 * @template T
 * @param {(chave: string) => Promise<T>} fn
 * @returns {Promise<T>} o resultado do primeiro que der certo
 * @throws o ultimo erro, quando todas falharem
 */
export async function comFailoverDeChave(fn) {
  const lista = lerChaves();
  if (!lista.length) throw new Error('sem_chave_groq');

  let ultimoErro = null;

  // Percorre da PRIMEIRA DISPONIVEL em diante. Cada chave que falha por cota ou
  // por ser invalida e' MARCADA como esgotada e nao volta a ser tentada.
  for (let i = 0; i < lista.length; i++) {
    const atual = primeiraDisponivel(lista, i);
    if (!atual) break;                       // todas as seguintes ja' estao esgotadas
    const { chave, slot } = atual;
    try {
      const r = await fn(chave);
      return r;                              // deu certo: essa e' a chave ativa
    } catch (e) {
      const tipo = classificarErroGroq(e).tipo;
      // So' cota (429) e chave invalida (401/403) marcam a chave. Rede/payload
      // nao dizem nada sobre ela — trocar ali queimaria a cota das outras.
      if (tipo !== 'chave' && tipo !== 'limite') throw e;
      ultimoErro = e;
      marcarEsgotada(slot);
    }
  }

  // Todas esgotadas: avisa que so' volta no reset (00:00).
  throw ultimoErro || new Error('sem_chave_groq');
}



/** Ha' chave configurada? */
export function temGroq() {
  return Boolean(chaveGroq());
}

/**
 * Classifica um erro da API do Groq (compativel com OpenAI).
 *
 * A forma e' `{ error: { message, type, code } }` — diferente da do Gemini, que
 * usa `details[].reason`. Olhar o CORPO (e nao so' o HTTP) e' o que evita o
 * erro de diagnostico que ja' aconteceu do outro lado.
 *
 * @param {any} e
 * @returns {{tipo: 'chave'|'limite'|'rede'|'payload'|'outro', http?: number, detalhe: string, mensagem: string}}
 */
export function classificarErroGroq(e) {
  const http = e?.response?.status;
  const dados = e?.response?.data?.error;
  const msg = String(dados?.message || e?.message || '').trim();
  const baixo = msg.toLowerCase();
  const detalhe = msg || `HTTP ${http ?? '?'}`;

  if (
    http === 401 || http === 403 ||
    /invalid api key|unauthorized|api key.*(invalid|expired)/i.test(msg)
  ) {
    return { tipo: 'chave', http, detalhe, mensagem: 'Chave do Groq inválida ou sem permissão.' };
  }
  if (http === 429 || /rate limit|too many requests|quota/i.test(baixo)) {
    return { tipo: 'limite', http, detalhe, mensagem: 'Limite de requisições do Groq atingido. Tente novamente.' };
  }
  if (
    !http || e?.code === 'ECONNABORTED' || e?.code === 'ETIMEDOUT' ||
    e?.code === 'ENOTFOUND' || e?.code === 'ECONNREFUSED' || e?.code === 'EAI_AGAIN' || http === 408
  ) {
    return {
      tipo: 'rede',
      http,
      detalhe,
      mensagem: /timeout|tempo|ECONNABORTED|ETIMEDOUT/i.test(baixo) || e?.code === 'ECONNABORTED' || e?.code === 'ETIMEDOUT'
        ? 'Tempo esgotado ao chamar o Groq.'
        : 'Falha de rede ao chamar o Groq.'
    };
  }
  if (http === 400 || http === 404 || http === 413 || http === 422) {
    return { tipo: 'payload', http, detalhe, mensagem: `Requisição recusada pelo Groq: ${detalhe}` };
  }
  return { tipo: 'outro', http, detalhe, mensagem: detalhe || 'Erro desconhecido no Groq.' };
}

/**
 * Conversa (LLM): texto -> resposta.
 *
 * ## `maxTokens`: o teto de 220 e' de VOZ
 *
 * A conversa de voz quer resposta curta (3 frases faladas). Mas este mesmo
 * cliente atende os comandos de TEXTO (`!resumir`, `!gerarhistoria`, `!ideia`),
 * onde 220 tokens truncariam a resposta no meio. Por isso o teto e' por chamada:
 * quem quer texto longo passa o seu.
 *
 * @param {object} p
 * @param {string} p.texto
 * @param {string} [p.sistema] prompt do sistema
 * @param {Array<{role:string, content:string}>} [p.historico]
 * @param {string} [p.modelo]
 * @param {number} [p.maxTokens] teto de tokens da resposta (padrao: 220, de voz)
 * @param {number} [p.temperatura]
 * @returns {Promise<{ ok: boolean, texto?: string, motivo?: string, detalhe?: string, modelo?: string }>}
 */
export async function groqChat({ texto, sistema, historico = [], modelo = MODELO_LLM, maxTokens, temperatura } = {}) {
  if (!chaveGroq()) return { ok: false, motivo: 'sem_chave_groq' };
  if (!texto) return { ok: false, motivo: 'texto_vazio' };

  const mensagens = [];
  if (sistema) mensagens.push({ role: 'system', content: sistema });
  for (const h of historico) {
    if (!h?.content) continue;
    mensagens.push({ role: h.role === 'assistant' ? 'assistant' : 'user', content: String(h.content) });
  }
  mensagens.push({ role: 'user', content: String(texto) });

  try {
    // O FAILOVER de chave: se esta estourou a cota (429) ou e' invalida
    // (401/403), a proxima assume na hora — e' o que faz o plano gratis durar.
    const resp = await comFailoverDeChave((apiKey) => post(`${BASE}/chat/completions`, {
      model: modelo,
      messages: mensagens,
      // Conversa de VOZ: resposta curta e' mais natural E mais rapida de
      // sintetizar. 400 tokens davam paragrafos; 220 cabe 3 frases faladas.
      temperature: Number.isFinite(temperatura)
        ? temperatura
        : Number.parseFloat(process.env.IAP_LLM_TEMP || '0.8'),
      max_tokens: Number.isFinite(maxTokens) && maxTokens > 0
        ? maxTokens
        : Number.parseInt(process.env.IAP_LLM_MAX_TOKENS || '220', 10)
    }, {
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      timeout: TIMEOUT_LLM_MS
    }));
    const resposta = resp?.data?.choices?.[0]?.message?.content;
    const limpo = typeof resposta === 'string' ? resposta.trim() : '';
    if (!limpo) return { ok: false, motivo: 'resposta_vazia' };
    return { ok: true, texto: limpo, modelo };
  } catch (e) {
    const r = classificarErroGroq(e);
    return { ok: false, motivo: r.tipo, detalhe: r.detalhe, mensagem: r.mensagem };
  }
}

// ───────────────────────────────────────────────────────────────────────────
// Transcricao (Whisper)
// ───────────────────────────────────────────────────────────────────────────

/**
 * Extensao de arquivo a partir do mimetype.
 *
 * ## O BUG que isto corrige
 *
 * O Groq decide o formato pela **EXTENSAO do nome do arquivo**, nao pelo
 * mimetype. Mandar o arquivo como `'audio'` (sem extensao) faz a API recusar:
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

/** Formatos que o Whisper aceita (a extensao decide). */
const EXTENSOES_OK = new Set(['flac', 'mp3', 'mp4', 'mpeg', 'mpga', 'm4a', 'ogg', 'opus', 'wav', 'webm']);

/**
 * Detecta o formato pelos BYTES INICIAIS (magic bytes).
 *
 * O mimetype que o WhatsApp manda **pode divergir** do arquivo. Ler o magic
 * byte faz a extensao descrever o que o arquivo **e'**, nao o que ele **diz**.
 *
 * @param {Buffer} b
 * @returns {string|null}
 */
export function extensaoPorConteudo(b) {
  if (!Buffer.isBuffer(b) || b.length < 4) return null;
  const h = b.toString('hex', 0, 4).toLowerCase();
  if (h.startsWith('4f676753')) return 'ogg';   // "OggS"
  if (h.startsWith('52494646')) return 'wav';   // "RIFF"
  if (h.startsWith('494433') || h.startsWith('fffb') || h.startsWith('fff3')) return 'mp3';
  if (h === '1a45dfa3') return 'webm';          // EBML
  if (h.startsWith('664c6143')) return 'flac';  // "fLaC"
  if (b.length >= 8 && b.toString('ascii', 4, 8) === 'ftyp') return 'm4a';
  return null;
}

/**
 * Garante um audio em formato aceito pelo Whisper.
 *
 * O CONTEUDO manda sobre o mimetype; se nao reconhecer (ex.: `amr`, `3gp`),
 * converte para **OGG/Opus** com o ffmpeg do sistema.
 *
 * @param {Buffer} arquivo
 * @param {string} extensaoDoMime
 * @returns {Promise<{ bytes: Buffer, extensao: string, convertido: boolean }>}
 */
export function normalizarParaGroq(arquivo, extensaoDoMime) {
  const porConteudo = extensaoPorConteudo(arquivo);
  if (porConteudo && EXTENSOES_OK.has(porConteudo)) {
    return Promise.resolve({ bytes: arquivo, extensao: porConteudo, convertido: false });
  }
  // Conteudo DESCONHECIDO: nao da' para confiar no mimetype (ele vira 'ogg' por
  // padrao e "passaria", mas o arquivo pode ser amr/3gp). Converter e' seguro.
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
 * Transcreve um ARQUIVO de audio (ou um WAV gerado do PCM).
 *
 * @param {Buffer} arquivo
 * @param {string} [mimeType]
 * @returns {Promise<{ ok: boolean, texto?: string, motivo?: string, detalhe?: string, modelo?: string }>}
 */
export async function groqTranscrever(arquivo, mimeType = 'audio/ogg', { prompt } = {}) {
  if (!arquivo || !arquivo.length) return { ok: false, motivo: 'audio_vazio' };
  if (!chaveGroq()) return { ok: false, motivo: 'sem_chave_groq' };

  const ext = extensaoDoAudio(mimeType);
  const pronto = await normalizarParaGroq(arquivo, ext);

  try {
    const form = new FormData();
    form.append('file', new Blob([pronto.bytes], { type: mimeType }), `audio.${pronto.extensao}`);
    form.append('model', MODELO_STT);
    form.append('language', 'pt');
    form.append('response_format', 'text');
    // TEMPERATURA 0: transcricao e' tarefa deterministica — sem isso o Whisper
    // "inventa" em audio ruim (alucinacao), e um comando vira frase aleatoria.
    form.append('temperature', '0');
    // PROMPT DE CONTEXTO: o Whisper usa o texto anterior como VIÉS do vocabulario.
    // Com os nomes dos comandos e as palavras que ele costuma errar (toca, baixa,
    // figurinha...), o reconhecimento acerta o que interessa. E' a melhoria de
    // "entendimento" sem trocar de modelo.
    const vies = prompt || PROMPT_STT;
    if (vies) form.append('prompt', vies);

    // Mesmo failover do chat: a chave que estourou sai, a proxima assume.
    const resp = await comFailoverDeChave((apiKey) => post(`${BASE}/audio/transcriptions`, form, {
      headers: { Authorization: `Bearer ${apiKey}` },
      timeout: TIMEOUT_STT_MS
    }));
    const bruto = typeof resp?.data === 'string' ? resp.data : (resp?.data?.text || '');
    const texto = String(bruto).trim();
    if (!texto) return { ok: false, motivo: 'sem_fala', modelo: MODELO_STT };
    return { ok: true, texto, modelo: MODELO_STT };
  } catch (e) {
    const r = classificarErroGroq(e);
    return { ok: false, motivo: r.tipo, detalhe: r.detalhe, mensagem: r.mensagem };
  }
}

/**
 * Reseta o estado das chaves (volta tudo para a primeira).
 *
 * E' o mesmo reset do dia (00:00) — usado pelo comando do dono e pelos testes.
 * @param {boolean} [apagarArquivo] `true` remove o arquivo do estado
 */
export { resetarEsgotadas, estaEsgotada, estadoDasChaves, diaDoEstado, situacaoDasChaves } from './groqKeys.js';

/** @deprecated Use `resetarEsgotadas`. Mantido para os testes antigos. */
export { resetarEsgotadas as resetarChaveGroq } from './groqKeys.js';

/** Modelos em uso (diagnostico/testes). */
export function configGroq() {
  return { stt: MODELO_STT, llm: MODELO_LLM, base: BASE };
}
