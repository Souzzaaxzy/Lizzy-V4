/**
 * TTS do `!iap` -- a resposta do agente vira audio na call.
 *
 * ## UMA fonte: edge-tts (local, sem chave e sem limite)
 *
 * O Gemini foi **REMOVIDO** deste caminho (out/2026): o dono estourou o plano e
 * o TTS morria com `gemini_limite` no meio da conversa. As vozes neurais do
 * Microsoft Edge rodam como processo local -- **sem chave, sem cota e sem
 * billing** -- e dao as vozes pt-BR prontas:
 *
 *   - **`pt-BR-FranciscaNeural`** (padrao) -- feminina;
 *   - `pt-BR-ThalitaMultilingualNeural` -- feminina, multilingue;
 *   - `pt-BR-AntonioNeural` -- masculina.
 *
 * O resto do agente (ouvir e pensar) roda no **Groq**; o Groq nao tem TTS, entao
 * a VOZ e' o unico ponto que depende do edge-tts. Se ele faltar, o bot tenta
 * instalar sozinho (`garantirEdgeTts`) e, se nao conseguir, diz exatamente o que
 * fazer -- nunca fica mudo sem explicacao.
 *
 * O resultado e' sempre o formato do motor: **PCM float 16 kHz mono**.
 */

import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { TAXA_MOTOR } from './iapAudio.js';

/**
 * Voz do edge-tts (a voz do agente).
 *
 * ## Feminina por padrao
 *
 * O padrao anterior (`pt-BR-AntonioNeural`) era **MASCULINO** -- o dono pediu
 * voz de mulher. As vozes **femininas** pt-BR do edge-tts sao:
 *
 *  - **`pt-BR-FranciscaNeural`** (padrao) -- feminina, natural;
 *  - `pt-BR-ThalitaMultilingualNeural` -- feminina, multilingue.
 *
 * (O unico masculino e' o Antonio.)
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

/** Teto de tempo do edge-tts. */
const TIMEOUT_EDGE_MS = Number.parseInt(process.env.IAP_TTS_TIMEOUT_MS || '45000', 10);

/** Cache do binario do edge-tts resolvido (evita re-testar a cada fala). */
let _binarioEdge = undefined;
/** Quando o cache NEGATIVO foi gravado (ele expira; o positivo nao). */
let _binarioEdgeFalhouEm = 0;
/** TTL do cache negativo: se o edge-tts for instalado depois, volta a tentar. */
const EDGE_CACHE_NEGATIVO_MS = Number.parseInt(process.env.IAP_EDGE_RETRY_MS || '60000', 10);

/** O binario que o `pip install --user` cria (fora do PATH em muitos hosts). */
function caminhoLocalBin() {
  return path.join(os.homedir(), '.local', 'bin', 'edge-tts');
}

/**
 * Resolve como chamar o edge-tts: o executavel direto, ou via `python -m`.
 * `undefined` = ainda nao testado; `null` = indisponivel (com expiracao).
 */
async function resolverEdge() {
  // Cache POSITIVO: o binario nao some. Cache NEGATIVO: expira, senao instalar
  // o edge-tts (ou corrigir o PATH) depois nunca mais seria percebido.
  if (_binarioEdge !== undefined) {
    const expirou = _binarioEdge === null
      && Date.now() - _binarioEdgeFalhouEm > (EDGE_CACHE_NEGATIVO_MS || 60000);
    if (!expirou) return _binarioEdge;
  }
  // O `pip install --user` (o caminho sem root que o instalador usa) grava o
  // binario em `~/.local/bin`, que normalmente NAO esta no PATH. Sem este
  // candidato, o instalador dizia "edge-tts instalado" e o runtime respondia
  // `edge_indisponivel` -- o dono via a voz parar sem causa aparente.
  const candidatos = [
    process.env.EDGE_TTS_PATH ? [process.env.EDGE_TTS_PATH, []] : null,
    ['edge-tts', []],
    [caminhoLocalBin(), []],
    ['python3', ['-m', 'edge_tts']],
    ['python', ['-m', 'edge_tts']]
  ].filter(Boolean);

  for (const [cmd, base] of candidatos) {
    const ok = await testarBinario(cmd, base);
    if (ok) {
      _binarioEdge = { cmd, base };
      return _binarioEdge;
    }
  }
  _binarioEdge = null;
  _binarioEdgeFalhouEm = Date.now();
  return null;
}

/** Zera o cache de resolucao do edge-tts (testes e diagnostico). */
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

/** Disponibilidade do edge-tts (diagnostico/testes). */
export async function edgeDisponivel() {
  return Boolean(await resolverEdge());
}

/**
 * Roda um comando e devolve `{ ok, saida }` (sem lancar).
 * @returns {Promise<{ok: boolean, saida?: string}>}
 */
function rodar(cmd, args, timeoutMs = 300000) {
  return new Promise((resolve) => {
    let proc;
    try {
      proc = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      resolve({ ok: false, saida: String(e?.message || e) });
      return;
    }
    let saida = '';
    const timer = setTimeout(() => {
      try { proc.kill('SIGKILL'); } catch { /* ok */ }
      resolve({ ok: false, saida: saida + ' (timeout)' });
    }, timeoutMs);
    proc.stdout?.on('data', (d) => { saida += d.toString(); });
    proc.stderr?.on('data', (d) => { saida += d.toString(); });
    proc.on('error', (e) => { clearTimeout(timer); resolve({ ok: false, saida: String(e?.message || e) }); });
    proc.on('close', (code) => { clearTimeout(timer); resolve({ ok: code === 0, saida }); });
  });
}

/**
 * Garante que o edge-tts esteja disponivel, instalando se precisar.
 *
 * ## Por que instalar aqui tambem
 *
 * O `update.js` ja instala no `!atualizar`, mas ele pode ter falhado (rede,
 * `pip` bloqueado pelo PEP 668, usuario sem permissao) e o dono nao percebe ate'
 * o agente ficar mudo. Aqui a instalacao acontece na hora de LIGAR o agente, com
 * os fallbacks que cobrem os ambientes reais -- e o resultado e' devolvido para
 * o comando poder explicar o que faltou.
 *
 * @returns {Promise<{ ok: boolean, motivo?: string, detalhe?: string, instalado?: boolean }>}
 */
export async function garantirEdgeTts() {
  if (await edgeDisponivel()) return { ok: true };

  const py = (await rodar('python3', ['--version'], 10000)).ok ? 'python3'
    : (await rodar('python', ['--version'], 10000)).ok ? 'python'
    : null;
  if (!py) return { ok: false, motivo: 'sem_python', detalhe: 'nao encontrei python3 nem python' };

  // Ordem dos fallbacks: o mais seguro primeiro.
  //  - `--user`: instala em ~/.local (nao mexe no sistema);
  //  - `--break-system-packages`: vence o PEP 668 ("externally-managed");
  //  - `ensurepip --user`: quando o pip nem existe no python do host.
  const tentativas = [
    ['-m', 'pip', 'install', '--user', '-U', 'edge-tts'],
    ['-m', 'pip', 'install', '--user', '--break-system-packages', '-U', 'edge-tts'],
    ['-m', 'pip', 'install', '-U', 'edge-tts'],
    ['-m', 'pip', 'install', '--break-system-packages', '-U', 'edge-tts']
  ];
  let ultimo = '';
  for (const args of tentativas) {
    const r = await rodar(py, args);
    ultimo = r.saida || ultimo;
    if (!r.ok) continue;
    resetEdgeCache();
    if (await edgeDisponivel()) return { ok: true, instalado: true };
  }

  // Ultimo recurso: garantir o pip e tentar de novo.
  const boot = await rodar(py, ['-m', 'ensurepip', '--user'], 120000);
  if (boot.ok) {
    const r = await rodar(py, ['-m', 'pip', 'install', '--user', '-U', 'edge-tts']);
    if (r.ok) {
      resetEdgeCache();
      if (await edgeDisponivel()) return { ok: true, instalado: true };
    }
    ultimo = r.saida || ultimo;
  }

  return { ok: false, motivo: 'instalacao_falhou', detalhe: String(ultimo).slice(0, 300) };
}

/**
 * Sintetiza com o edge-tts. Devolve MP3 (Buffer) ou null.
 * @param {string} texto
 * @returns {Promise<Buffer|null>}
 */
async function sintetizarEdge(texto) {
  const bin = await resolverEdge();
  if (!bin) return null;

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'iap-tts-'));
  const saida = path.join(dir, 'fala.mp3');
  try {
    const ok = await new Promise((resolve) => {
      let proc;
      try {
        proc = spawn(bin.cmd, [
          ...bin.base,
          '--voice', vozEdge(),
          '--text', texto,
          '--write-media', saida
        ], { stdio: ['ignore', 'ignore', 'ignore'] });
      } catch {
        resolve(false);
        return;
      }
      const timer = setTimeout(() => {
        try { proc.kill('SIGKILL'); } catch { /* ok */ }
        resolve(false);
      }, Number.isFinite(TIMEOUT_EDGE_MS) && TIMEOUT_EDGE_MS > 0 ? TIMEOUT_EDGE_MS : 45000);
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

/**
 * Sintetiza a fala do agente e devolve PCM 16 kHz mono pronto para o motor.
 *
 * **So edge-tts** (o Gemini foi removido): sem chave, sem cota. Se o edge-tts
 * faltar, o motivo diz exatamente o que fazer -- `sem_edge_tts` (instalar) ou
 * `ffmpeg_faltando` (o MP3 saiu, mas o ffmpeg nao converteu).
 *
 * `IAP_TTS_EDGE=off` desliga (para diagnostico) e faz o caminho falhar rapido.
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
  if (desativado) return { ok: false, motivo: 'edge_desativado' };

  const mp3 = await sintetizarEdge(limpo);
  if (!mp3 || !mp3.length) return { ok: false, motivo: 'sem_edge_tts' };

  const pcm = await converterPara16k(mp3);
  if (pcm && pcm.length) return { ok: true, pcm, fonte: 'edge-tts' };
  // O edge-tts gerou o MP3 mas o ffmpeg nao converteu -- pista importante.
  return { ok: false, motivo: 'ffmpeg_faltando' };
}

/**
 * Converte um arquivo de audio (mp3/ogg/wav) em PCM float 16 kHz mono, via
 * ffmpeg. Entra e sai por pipe -- nada fica no disco alem do arquivo de origem.
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

/** Voz em uso (diagnostico/testes). */
export function configTts() {
  return { vozEdge: vozEdge() };
}
