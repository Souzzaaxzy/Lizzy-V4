/**
 * Conversão de áudio para OGG/Opus — o formato que o WhatsApp exige.
 *
 * Por que existe: o áudio recebido pode estar em qualquer formato (mp3, m4a,
 * webm, o próprio ogg de outro codec...). Reenviar os bytes originais com o
 * mimetype de origem faz o status de áudio do grupo não renderizar — o cliente
 * mostra "áudio não disponível". O status precisa de OGG com o codec Opus,
 * mono, 48 kHz.
 *
 * Transcodificar gera bytes que o WhatsApp aceita de fato, independentemente do
 * formato em que a mídia chegou.
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

/**
 * Roda o FFmpeg com args separados (sem shell), teto de tempo e limpeza.
 *
 * `detached` + `kill(-pid)` no Linux: o FFmpeg pode criar filhos; matar só o
 * processo pai deixaria órfãos. O grupo inteiro é encerrado.
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
      reject(new Error('timeout ao converter o áudio'));
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
 * Converte um buffer de áudio para OGG/Opus (mono, 48 kHz).
 *
 * @param {Buffer} inputBuffer áudio em qualquer formato suportado pelo FFmpeg
 * @returns {Promise<Buffer>} OGG/Opus pronto para o status
 * @throws {Error} quando o buffer é inválido, o FFmpeg falta ou a conversão falha
 */
export async function toOggOpus(inputBuffer) {
  if (!Buffer.isBuffer(inputBuffer) || inputBuffer.length === 0) {
    throw new Error('áudio vazio');
  }

  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'status-audio-'));
  const inputPath = path.join(dir, 'in');
  const outputPath = path.join(dir, 'out.ogg');

  try {
    await fs.promises.writeFile(inputPath, inputBuffer);

    // `-vn` descarta eventual faixa de vídeo (um mp4 baixado pode ter imagem);
    // sem isso o FFmpeg tentaria muxar vídeo num container de áudio.
    await runFfmpeg([
      '-i', inputPath,
      '-vn',
      '-c:a', 'libopus',
      '-b:a', '64k',
      '-ar', '48000',
      '-ac', '1',
      '-avoid_negative_ts', 'make_zero',
      '-f', 'ogg',
      outputPath,
    ]);

    const convertido = await fs.promises.readFile(outputPath);
    if (!convertido || convertido.length === 0) {
      throw new Error('conversão produziu arquivo vazio');
    }
    return convertido;
  } finally {
    await fs.promises.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}