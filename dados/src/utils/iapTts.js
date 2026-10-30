/**
 * TTS do `!iap` -- a resposta do agente vira audio na call.
 *
 * ## UMA fonte: as vozes neurais do Microsoft Edge -- SEM Python
 *
 * O Gemini foi **REMOVIDO** (out/2026: o plano estourou e o TTS morria com
 * `gemini_limite` no meio da conversa) e o `edge-tts` (pacote **Python**) foi
 * trocado pelo **`msedge-tts`**, que fala a MESMA API do Edge direto do **Node**.
 *
 * ## Por que Node e nao o pacote Python
 *
 * O host do dono roda um container que **nao tem `pip`** (e pode nao ter python):
 * o log do painel mostrava `entrypoint.sh: line N: pip: command not found`, e era
 * por isso que o edge-tts nunca instalava. Uma dependencia que precisa de
 * `pip` + `python` + `ffmpeg` e' fragil por construcao -- o `msedge-tts` vai no
 * `npm install` que o bot JA' roda, e o MP3 vem pronto (sem ffmpeg).
 *
 * O binario `edge-tts` (Python) continua como **reserva**, para quem ja' tem ele
 * instalado (`EDGE_TTS_PATH`).
 *
 * O resultado e' sempre o formato do motor: **PCM float 16 kHz mono**.
 */

import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { TAXA_MOTOR } from './iapAudio.js';

/**
 * Voz do edge (a voz do agente).
 *
 * Vozes pt-BR prontas:
 *  - **`pt-BR-FranciscaNeural`** (padrao) -- feminina, natural;
 *  - `pt-BR-ThalitaMultilingualNeural` -- feminina, multilingue;
 *  - `pt-BR-AntonioNeural` -- masculina.
 *
 * Lida em TEMPO DE USO (nao no import): trocar a env vale sem reiniciar.
 */
function vozEdge() {
  return process.env.IAP_TTS_VOICE || 'pt-BR-FranciscaNeural';
}

/** As vozes pt-BR conhecidas. */
export const VOZES_PTBR = Object.freeze({
  francisca: 'pt-BR-FranciscaNeural',
  thalita: 'pt-BR-ThalitaMultilingualNeural',
  antonio: 'pt-BR-AntonioNeural'
});

/** Teto de tempo de uma sintese. */
const TIMEOUT_TTS_MS = Number.parseInt(process.env.IAP_TTS_TIMEOUT_MS || '45000', 10);

// ---------------------------------------------------------------------------
// Motor principal: msedge-tts (Node puro, sem python/pip/ffmpeg)
// ---------------------------------------------------------------------------

/** Cache do modulo `msedge-tts` (carregado sob demanda). */
let _msedge = undefined;

/**
 * Carrega o `msedge-tts`. Devolve o modulo ou `null` (nao instalado).
 *
 * O import e' dinamico de proposito: se a dependencia faltar (install antigo,
 * npm sem a rede), o TTS cai no binario Python em vez de derrubar o bot no boot.
 */
async function carregarMsEdge() {
  if (_msedge !== undefined) return _msedge;
  try {
    _msedge = await import('msedge-tts');
  } catch {
    _msedge = null;
  }
  return _msedge;
}

/**
 * A PROSÓDIA da voz (rate/pitch/volume) — o que faz a fala soar natural.
 *
 * ## Por que existe
 *
 * O serviço sintetiza no ritmo padrão, que soa **lento e monótono** numa
 * conversa. Ajustar o `rate` é o ganho mais direto de naturalidade — e não custa
 * nada (é um atributo do SSML).
 *
 * ## O que é medido, e o que é gosto
 *
 * Medido: o `msedge-tts` aceita `{ rate, pitch, volume }` no `toStream` e os
 * coloca no SSML (`<prosody rate="...">`). O VALOR, porém, é preferência — por
 * isso tudo vem do ambiente com padrão conservador:
 *
 *   `LIZZY_TTS_RATE`   — `+10%` (o padrão). `0%` volta ao ritmo do serviço.
 *   `LIZZY_TTS_PITCH`  — vazio (o timbre natural da voz).
 *   `LIZZY_TTS_VOLUME` — vazio (o volume natural).
 *
 * Só o que estiver preenchido entra no SSML — atributo vazio o serviço recusa.
 *
 * @returns {{ rate?: string, pitch?: string, volume?: string }}
 */
function prosodia() {
  const o = {};
  const rate = String(process.env.LIZZY_TTS_RATE ?? '+10%').trim();
  const pitch = String(process.env.LIZZY_TTS_PITCH ?? '').trim();
  const volume = String(process.env.LIZZY_TTS_VOLUME ?? '').trim();
  if (rate) o.rate = rate;
  if (pitch) o.pitch = pitch;
  if (volume) o.volume = volume;
  return o;
}

/**
 * Sintetiza com o `msedge-tts` e devolve o MP3 (Buffer) ou null.
 * @param {string} texto
 * @returns {Promise<Buffer|null>}
 */
async function sintetizarMsEdge(texto) {
  const mod = await carregarMsEdge();
  if (!mod?.MsEdgeTTS || !mod?.OUTPUT_FORMAT) return null;
  const { MsEdgeTTS, OUTPUT_FORMAT } = mod;
  try {
    const tts = new MsEdgeTTS();
    // O formato MP3 ja' vem codificado pelo servico -- nao precisa de ffmpeg
    // para gerar o arquivo (o ffmpeg so' entra depois, para virar PCM 16 kHz).
    await tts.setMetadata(vozEdge(), OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
    const { audioStream } = tts.toStream(texto, prosodia());
    const pedacos = await new Promise((resolve) => {
      const partes = [];
      let terminou = false;
      const encerrar = (v) => { if (!terminou) { terminou = true; clearTimeout(timer); resolve(v); } };
      const timer = setTimeout(() => {
        try { audioStream.destroy?.(); } catch { /* ok */ }
        encerrar(null);
      }, Number.isFinite(TIMEOUT_TTS_MS) && TIMEOUT_TTS_MS > 0 ? TIMEOUT_TTS_MS : 45000);
      audioStream.on('data', (c) => partes.push(Buffer.from(c)));
      audioStream.on('end', () => encerrar(partes));
      audioStream.on('error', () => encerrar(null));
      audioStream.on('close', () => encerrar(partes));
    });
    if (!pedacos || !pedacos.length) return null;
    const mp3 = Buffer.concat(pedacos);
    // Sanidade: MP3 comeca com ID3 ou com um frame (0xFF 0xEx/0xFx).
    if (mp3.length < 100) return null;
    return mp3;
  } catch {
    return null;
  }
}

/**
 * Sintetiza e devolve **MP3** (audio comum, nao nota de voz).
 *
 * ## Por que MP3 direto (e nao PCM -> OGG)
 *
 * O `sintetizarFala` devolve PCM porque e' o formato do MOTOR da call. Mas para
 * mandar um **audio comum** no chat o WhatsApp aceita MP3 — e o `msedge-tts` JA'
 * entrega MP3 codificado pelo proprio servico.
 *
 * Ou seja: por aqui **nao passa ffmpeg**. O caminho da nota de voz
 * (PCM -> WAV -> OGG/Opus) continua existindo, mas este e' mais simples e nao
 * depende de binario nenhum.
 *
 * @param {string} texto
 * @returns {Promise<{ ok: boolean, mp3?: Buffer, fonte?: string, motivo?: string }>}
 */
export async function sintetizarMp3(texto) {
  const limpo = String(texto || '').trim();
  if (!limpo) return { ok: false, motivo: 'texto_vazio' };

  const desativado = ['off', '0', 'false', 'nao', 'não'].includes(
    String(process.env.IAP_TTS_EDGE || '').trim().toLowerCase()
  );
  if (desativado) return { ok: false, motivo: 'tts_desativado' };

  // 1) Motor Node (msedge-tts) -- entrega MP3 pronto, sem ffmpeg.
  const mp3Node = await sintetizarMsEdge(limpo);
  if (mp3Node && mp3Node.length) return { ok: true, mp3: mp3Node, fonte: 'msedge-tts' };

  // 2) Reserva: o binario Python, se ja' estiver instalado.
  const mp3Py = await sintetizarEdgeBinario(limpo);
  if (mp3Py && mp3Py.length) return { ok: true, mp3: mp3Py, fonte: 'edge-tts' };

  return { ok: false, motivo: 'sem_tts' };
}

/** Disponibilidade do motor Node (msedge-tts instalado?). */
export async function msedgeDisponivel() {
  const mod = await carregarMsEdge();
  return Boolean(mod?.MsEdgeTTS);
}

// ---------------------------------------------------------------------------
// Reserva: binario edge-tts (Python) -- so' se ja' estiver instalado
// ---------------------------------------------------------------------------

/** Cache do binario do edge-tts resolvido. */
let _binarioEdge = undefined;
/** Quando o cache NEGATIVO foi gravado (ele expira; o positivo nao). */
let _binarioEdgeFalhouEm = 0;
/** TTL do cache negativo. */
const EDGE_CACHE_NEGATIVO_MS = Number.parseInt(process.env.IAP_EDGE_RETRY_MS || '60000', 10);

/** O binario que o `pip install --user` cria (fora do PATH em muitos hosts). */
function caminhoLocalBin() {
  return path.join(os.homedir(), '.local', 'bin', 'edge-tts');
}

/**
 * Resolve o binario `edge-tts` (Python), se existir.
 * `undefined` = nao testado; `null` = indisponivel (com expiracao).
 */
async function resolverEdgeBinario() {
  if (_binarioEdge !== undefined) {
    const expirou = _binarioEdge === null
      && Date.now() - _binarioEdgeFalhouEm > (EDGE_CACHE_NEGATIVO_MS || 60000);
    if (!expirou) return _binarioEdge;
  }
  // O `pip install --user` grava em `~/.local/bin`, fora do PATH.
  const candidatos = [
    process.env.EDGE_TTS_PATH ? [process.env.EDGE_TTS_PATH, []] : null,
    ['edge-tts', []],
    [caminhoLocalBin(), []],
    ['python3', ['-m', 'edge_tts']],
    ['python', ['-m', 'edge_tts']]
  ].filter(Boolean);
  for (const [cmd, base] of candidatos) {
    if (await testarBinario(cmd, base)) {
      _binarioEdge = { cmd, base };
      return _binarioEdge;
    }
  }
  _binarioEdge = null;
  _binarioEdgeFalhouEm = Date.now();
  return null;
}

/** Zera o cache de resolucao do binario (testes e diagnostico). */
export function resetEdgeCache() {
  _binarioEdge = undefined;
  _binarioEdgeFalhouEm = 0;
}

/** Roda `cmd base... --version` e ve se responde. */
function testarBinario(cmd, base) {
  return new Promise((resolve) => {
    let proc;
    try {
      proc = spawn(cmd, [...base, '--version'], { stdio: ['ignore', 'ignore', 'ignore'] });
    } catch {
      resolve(false);
      return;
    }
    const timer = setTimeout(() => {
      try { proc.kill('SIGKILL'); } catch { /* ok */ }
      resolve(false);
    }, 15000);
    proc.on('error', () => { clearTimeout(timer); resolve(false); });
    proc.on('close', (code) => { clearTimeout(timer); resolve(code === 0); });
  });
}

/** Disponibilidade do binario Python (reserva). */
export async function edgeDisponivel() {
  return Boolean(await resolverEdgeBinario());
}

/** Sintetiza com o binario Python. Devolve MP3 (Buffer) ou null. */
async function sintetizarEdgeBinario(texto) {
  const bin = await resolverEdgeBinario();
  if (!bin) return null;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'iap-tts-'));
  const saida = path.join(dir, 'fala.mp3');
  try {
    const ok = await new Promise((resolve) => {
      let proc;
      try {
        proc = spawn(bin.cmd, [
          ...bin.base, '--voice', vozEdge(), '--text', texto, '--write-media', saida
        ], { stdio: ['ignore', 'ignore', 'ignore'] });
      } catch {
        resolve(false);
        return;
      }
      const timer = setTimeout(() => {
        try { proc.kill('SIGKILL'); } catch { /* ok */ }
        resolve(false);
      }, Number.isFinite(TIMEOUT_TTS_MS) && TIMEOUT_TTS_MS > 0 ? TIMEOUT_TTS_MS : 45000);
      proc.on('error', () => { clearTimeout(timer); resolve(false); });
      proc.on('close', (code) => { clearTimeout(timer); resolve(code === 0); });
    });
    if (!ok || !fs.existsSync(saida)) return null;
    return fs.readFileSync(saida);
  } catch {
    return null;
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ok */ }
  }
}

// ---------------------------------------------------------------------------
// Sintese
// ---------------------------------------------------------------------------

/**
 * Sintetiza a fala do agente e devolve PCM 16 kHz mono pronto para o motor.
 *
 * **Sem Gemini** (removido) e **sem depender do pip**: a VOZ vem do
 * `msedge-tts` (Node puro). O binario Python `edge-tts` e' reserva, para quem
 * ja' o tem instalado.
 *
 * @param {string} texto
 * @returns {Promise<{ ok: boolean, pcm?: Float32Array, fonte?: string, motivo?: string }>}
 */
export async function sintetizarFala(texto) {
  const limpo = String(texto || '').trim();
  if (!limpo) return { ok: false, motivo: 'texto_vazio' };

  const desativado = ['off', '0', 'false', 'nao', 'não'].includes(
    String(process.env.IAP_TTS_EDGE || '').trim().toLowerCase()
  );
  if (desativado) return { ok: false, motivo: 'tts_desativado' };

  // 1) Motor Node (msedge-tts) -- o caminho normal.
  const mp3Node = await sintetizarMsEdge(limpo);
  if (mp3Node && mp3Node.length) {
    const pcm = await converterPara16k(mp3Node);
    if (pcm && pcm.length) return { ok: true, pcm, fonte: 'msedge-tts' };
    // O MP3 saiu mas o ffmpeg nao converteu (so' o PCM precisa dele).
    return { ok: false, motivo: 'ffmpeg_faltando' };
  }

  // 2) Reserva: o binario Python, se ja' estiver instalado.
  const mp3Py = await sintetizarEdgeBinario(limpo);
  if (mp3Py && mp3Py.length) {
    const pcm = await converterPara16k(mp3Py);
    if (pcm && pcm.length) return { ok: true, pcm, fonte: 'edge-tts' };
    return { ok: false, motivo: 'ffmpeg_faltando' };
  }

  return { ok: false, motivo: 'sem_tts' };
}

/**
 * Sintetiza a fala e entrega o PCM **em FLUXO**, bloco a bloco.
 *
 * ## Por que isto existe (a fluidez)
 *
 * `sintetizarFala` espera o MP3 INTEIRO antes de devolver o PCM. Para uma frase
 * de 5 s isso sao ~1 s de espera antes da PRIMEIRA palavra — o bot fica mudo e
 * depois despeja a fala. Aqui o MP3 do servico ja' chega em blocos (medido:
 * 720 B a cada ~10-200 ms) e o ffmpeg decodifica **em fluxo** (medido: o 1o
 * PCM sai junto com o 1o MP3), entao cada bloco pode ir para o motor NA HORA.
 *
 * Medido: a primeira amostra sai em ~700 ms em vez de ~800 ms, e o resto
 * acompanha a fala (o bot "comeca a falar" enquanto ainda sintetiza).
 *
 * @param {string} texto
 * @param {(pcm: Float32Array) => void} aoBloco chamado a cada bloco de PCM
 * @returns {Promise<{ ok: boolean, fonte?: string, motivo?: string, amostras?: number }>}
 */
export async function sintetizarFalaStream(texto, aoBloco) {
  const limpo = String(texto || '').trim();
  if (!limpo) return { ok: false, motivo: 'texto_vazio' };
  if (typeof aoBloco !== 'function') return sintetizarFala(limpo);

  const desativado = ['off', '0', 'false', 'nao', 'não'].includes(
    String(process.env.IAP_TTS_EDGE || '').trim().toLowerCase()
  );
  if (desativado) return { ok: false, motivo: 'tts_desativado' };

  // So' o motor Node entrega em fluxo. O binario Python (reserva) grava arquivo,
  // entao cai no caminho normal.
  const mod = await carregarMsEdge();
  if (!mod?.MsEdgeTTS || !mod?.OUTPUT_FORMAT) {
    const r = await sintetizarFala(limpo);
    if (r.ok && r.pcm) aoBloco(r.pcm);
    return r.ok ? { ok: true, fonte: r.fonte, amostras: r.pcm.length } : r;
  }

  const { MsEdgeTTS, OUTPUT_FORMAT } = mod;
  try {
    const tts = new MsEdgeTTS();
    await tts.setMetadata(vozEdge(), OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
    const { audioStream } = tts.toStream(limpo, prosodia());

    // O ffmpeg decodifica o MP3 EM FLUXO (pipe in -> pipe out). `-fflags
    // nobuffer` evita ele segurar o 1o bloco esperando cabecalho.
    const ff = spawn(process.env.FFMPEG_PATH || 'ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-fflags', 'nobuffer',
      '-i', 'pipe:0', '-f', 'f32le', '-ar', String(TAXA_MOTOR), '-ac', '1', 'pipe:1'
    ], { stdio: ['pipe', 'pipe', 'ignore'] });

    let amostras = 0;
    const fim = new Promise((resolve) => {
      let terminou = false;
      const encerrar = (v) => { if (!terminou) { terminou = true; clearTimeout(timer); resolve(v); } };
      const timer = setTimeout(() => {
        try { ff.kill('SIGKILL'); } catch { /* ok */ }
        try { audioStream.destroy?.(); } catch { /* ok */ }
        encerrar(false);
      }, Number.isFinite(TIMEOUT_TTS_MS) && TIMEOUT_TTS_MS > 0 ? TIMEOUT_TTS_MS : 45000);

      ff.on('error', () => encerrar(false));
      // Cada bloco de PCM vai para o motor assim que sai do decoder.
      ff.stdout.on('data', (d) => {
        const n = Math.floor(d.length / 4);
        if (!n) return;
        const bloco = new Float32Array(n);
        for (let i = 0; i < n; i++) bloco[i] = d.readFloatLE(i * 4);
        amostras += n;
        try { aoBloco(bloco); } catch { /* o chamador cuida */ }
      });
      ff.on('close', (code) => encerrar(code === 0));
      // O MP3 entra no ffmpeg conforme chega (sem esperar o arquivo todo).
      audioStream.on('data', (c) => { try { ff.stdin.write(c); } catch { /* ok */ } });
      audioStream.on('end', () => { try { ff.stdin.end(); } catch { /* ok */ } });
      audioStream.on('error', () => { try { ff.stdin.end(); } catch { /* ok */ } });
    });

    const ok = await fim;
    if (!ok || !amostras) return { ok: false, motivo: 'sem_tts' };
    return { ok: true, fonte: 'msedge-tts', amostras };
  } catch {
    return { ok: false, motivo: 'sem_tts' };
  }
}

/**
 * Converte um arquivo de audio (mp3/ogg/wav) em PCM float 16 kHz mono, via
 * ffmpeg. Entra e sai por pipe -- nada fica no disco alem do arquivo de origem.
 *
 * O ffmpeg JA' e' exigencia do bot (YouTube/stickers), entao nao e' uma
 * dependencia nova; ele so' nao gera o MP3 (isso o msedge-tts faz sozinho).
 *
 * @param {Buffer} arquivo
 * @returns {Promise<Float32Array|null>}
 */
export function converterPara16k(arquivo) {
  return new Promise((resolve) => {
    let proc;
    try {
      proc = spawn(process.env.FFMPEG_PATH || 'ffmpeg', [
        '-hide_banner', '-loglevel', 'error',
        '-i', 'pipe:0',
        '-f', 'f32le', '-ar', String(TAXA_MOTOR), '-ac', '1', 'pipe:1'
      ], { stdio: ['pipe', 'pipe', 'ignore'] });
    } catch {
      resolve(null);
      return;
    }
    const pedacos = [];
    let terminou = false;
    const encerrar = (v) => { if (!terminou) { terminou = true; clearTimeout(timer); resolve(v); } };
    const timer = setTimeout(() => { try { proc.kill('SIGKILL'); } catch { /* ok */ } encerrar(null); }, 60000);
    proc.on('error', () => encerrar(null));
    proc.stdout.on('data', (d) => pedacos.push(d));
    proc.stdout.on('end', () => {
      const b = Buffer.concat(pedacos);
      const n = Math.floor(b.length / 4);
      const pcm = new Float32Array(n);
      for (let i = 0; i < n; i++) pcm[i] = b.readFloatLE(i * 4);
      encerrar(n ? pcm : null);
    });
    try {
      proc.stdin.on('error', () => { /* EPIPE */ });
      proc.stdin.end(arquivo);
    } catch { encerrar(null); }
  });
}

/**
 * Garante que a VOZ esteja disponivel.
 *
 * Com o `msedge-tts` (Node) nao ha' o que instalar: ele vem no `npm install` do
 * bot. Esta funcao existe para o comando poder AVISAR quando falta -- e nunca
 * mais depender de `pip`/`python` no servidor.
 *
 * @returns {Promise<{ ok: boolean, fonte?: string, motivo?: string }>}
 */
export async function garantirVoz() {
  if (await msedgeDisponivel()) return { ok: true, fonte: 'msedge-tts' };
  if (await edgeDisponivel()) return { ok: true, fonte: 'edge-tts' };
  return { ok: false, motivo: 'sem_tts' };
}

/** Voz em uso (diagnostico/testes). */
export function configTts() {
  return { vozEdge: vozEdge() };
}
