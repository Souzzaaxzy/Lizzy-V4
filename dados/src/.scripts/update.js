#!/usr/bin/env node

import { execFile } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const execAsync = (cmd, args = [], opts = {}) => new Promise((resolve, reject) => {
  execFile(cmd, args, { shell: true, timeout: 600000, ...opts }, (error, stdout, stderr) => {
    if (error) reject(Object.assign(error, { stderr }));
    else resolve({ stdout, stderr });
  });
});

async function isAvailable(cmd, args = ['--version']) {
  try {
    await execAsync(cmd, args, { timeout: 15000 });
    return true;
  } catch {
    return false;
  }
}

async function gitPull() {
  // Configurar git para usar merge em vez de rebase (evita erros de divergência)
  try {
    await execAsync('git', ['config', 'pull.rebase', 'false']);
  } catch {
    console.log('Aviso: não foi possível configurar git pull.rebase');
  }

  console.log('Baixando a versão mais recente...');
  await execAsync('git', ['pull']);
  console.log('Download concluído');
}

// Instala dependências Node somente se houver algo faltando.
async function nodeDeps() {
  try {
    await execAsync('npm', ['ls', '--depth=0'], { timeout: 120000 });
    if (!fs.existsSync('node_modules')) throw new Error('node_modules ausente');
    console.log('Dependências já atualizadas');
    return;
  } catch {
    /* há pacotes faltando: instala abaixo */
  }

  console.log('Instalando dependências');
  try {
    await execAsync('npm', ['install', '--legacy-peer-deps'], { timeout: 600000 });
  } catch {
    await execAsync('npm', ['install'], { timeout: 600000 });
  }
  if (!fs.existsSync('node_modules')) throw new Error('npm install terminou mas node_modules não foi criado');
  console.log('Dependências instaladas');
}

// yt-dlp local (download de YouTube). Instalação sem root/sudo:
// pip → ensurepip+pip → binário standalone oficial do GitHub em ~/.local/bin.
async function ytDlp() {
  const homeBin = path.join(os.homedir(), '.local', 'bin');
  const localBin = path.join(homeBin, 'yt-dlp');
  if (await isAvailable('yt-dlp')) {
    console.log('yt-dlp encontrado');
    return;
  }
  if (await isAvailable('python3', ['-m', 'yt_dlp', '--version'])) {
    console.log('yt-dlp encontrado (python3 -m yt_dlp)');
    return;
  }
  if (await isAvailable(localBin)) {
    console.log('yt-dlp encontrado (~/.local/bin)');
    return;
  }

  const variant = (await isAvailable('python3')) ? 'python3' : (await isAvailable('python')) ? 'python' : null;
  if (variant) {
    console.log('Instalando yt-dlp');
    const pip = async (args) => { try { await execAsync(variant, args, { timeout: 300000 }); return true; } catch { return false; } };
    const pipOk =
      (await pip(['-m', 'pip', 'install', '-U', 'yt-dlp'])) ||
      (await pip(['-m', 'pip', 'install', '--user', '-U', 'yt-dlp'])) ||
      ((await pip(['-m', 'ensurepip', '--user'])) && (await pip(['-m', 'pip', 'install', '--user', '-U', 'yt-dlp'])));
    if (pipOk) {
      console.log('yt-dlp instalado');
      return;
    }
    console.log('Aviso: pip indisponível — baixando binário standalone oficial...');
  }

  // Binário standalone (não precisa de pip nem root; o youtube.js procura ~/.local/bin)
  try {
    fs.mkdirSync(homeBin, { recursive: true });
    const url = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp';
    const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(120000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    fs.writeFileSync(localBin, Buffer.from(await res.arrayBuffer()), { mode: 0o755 });
    if (await isAvailable(localBin)) {
      console.log(`yt-dlp instalado (binário) em ${localBin}`);
      return;
    }
    throw new Error('binário baixado não executou');
  } catch (err) {
    console.log('Aviso: falha ao instalar yt-dlp automaticamente:', err.message);
  }
}

// FFmpeg (conversão/stickers). Não tenta instalar sozinho: nos Linux de hospedagem
// costuma ser pacote de sistema ou FFMPEG_PATH; apenas avisa se estiver ausente.
async function ffmpeg() {
  if (process.env.FFMPEG_PATH) {
    console.log('FFmpeg configurado via FFMPEG_PATH');
    return;
  }
  if (await isAvailable('ffmpeg', ['-version'])) {
    console.log('FFmpeg encontrado');
    return;
  }
  console.log('Aviso: FFmpeg não encontrado no PATH — instale pelo gerenciador de pacotes do sistema ou defina FFMPEG_PATH');
}

async function main() {
  try {
    await gitPull();
    await nodeDeps();
    await ffmpeg();
    await ytDlp();
    console.log('Atualização aplicada');
    process.exit(0);
  } catch (error) {
    console.error('Erro:', error.message);
    process.exit(1);
  }
}

main();
