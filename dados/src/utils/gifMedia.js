/**
 * Conversão de GIF para MP4 — o que o WhatsApp precisa para animar.
 *
 * Por que existe: o WhatsApp não reproduz GIF como GIF. O que ele anima é um
 * **MP4** enviado com `gifPlayback: true`. Mandar os bytes do GIF (ou do WebP
 * animado) com o mimetype de origem faz o destino receber uma mídia que não
 * roda. Converter para MP4 gera bytes que o cliente aceita de fato,
 * independentemente do formato em que o GIF chegou.
 *
 * O módulo é isolado de propósito: só fala com o FFmpeg do sistema. Os
 * parâmetros são fixos (não vêm de entrada do usuário), então não há superfície
 * para injeção.
 */

import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';
const TIMEOUT_MS = 60_000;
const MAX_BYTES = 50 * 1024 * 1024;

/**
 * Roda o FFmpeg com args separados (sem shell), teto de tempo e limpeza.
 *
 * `detached` + `kill(-pid)` no Linux: o FFmpeg pode criar filhos; matar só o
 * pai deixaria órfãos. O grupo inteiro é encerrado.
 */
function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const detached = process.platform !== 'win32';
    let child;
    try {
      child = spawn(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', ...args], {
        stdio: ['ignore', 'ignore', 'pipe'],
        detached,
      });
    } catch (err) {
      reject(err);
      return;
    }

    let stderr = '';
    let terminado = false;
    const timer = setTimeout(() => {
      terminado = true;
      try {
        if (detached && child.pid) process.kill(-child.pid, 'SIGKILL');
        else child.kill('SIGKILL');
      } catch { /* já saiu */ }
      reject(new Error('timeout ao converter o GIF'));
    }, TIMEOUT_MS);

    child.stderr?.on('data', (d) => { stderr += d; });

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err.code === 'ENOENT'
        ? new Error('FFmpeg não encontrado no sistema (instale ffmpeg ou defina FFMPEG_PATH)')
        : err);
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (terminado) return;
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg saiu com código ${code}: ${stderr.slice(-300)}`));
    });
  });
}

/**
 * Converte um GIF (ou WebP animado) em MP4 H.264, que é o que o WhatsApp anima
 * com `gifPlayback`.
 *
 * `-movflags +faststart` põe o índice no início (o cliente começa a tocar antes
 * de baixar tudo). `-an` descarta áudio: GIF não tem faixa de áudio e deixar o
 * FFmpeg inventar uma resultaria em MP4 com trilha vazia.
 *
 * @param {Buffer} buffer bytes do GIF
 * @returns {Promise<Buffer>} bytes do MP4
 */
export async function converterGifParaMp4(buffer) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) {
    throw new Error('GIF vazio ou inválido');
  }
  if (buffer.length > MAX_BYTES) {
    throw new Error('GIF grande demais (máximo 50 MB)');
  }

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gif-mp4-'));
  const entrada = path.join(dir, 'entrada.gif');
  const saida = path.join(dir, 'saida.mp4');

  try {
    fs.writeFileSync(entrada, buffer);
    await runFfmpeg([
      '-i', entrada,
      '-an',
      // Duração par é exigida pelo yuv420p; o filtro ajusta e mantém as dimensões.
      '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2',
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart',
      saida,
    ]);
    const mp4 = fs.readFileSync(saida);
    if (!mp4.length) throw new Error('conversão gerou arquivo vazio');
    return mp4;
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

export default { converterGifParaMp4 };
