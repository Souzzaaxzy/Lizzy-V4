#!/usr/bin/env node

import { execFile } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { gitDependencyDrift } from './git-drift.js';

const execAsync = (cmd, args = [], opts = {}) => new Promise((resolve, reject) => {
  execFile(cmd, args, { shell: true, timeout: 600000, ...opts }, (error, stdout, stderr) => {
    // stdout vai anexado mesmo no erro: `npm ls --all` sai com exit 1 quando há
    // problemas, mas ainda imprime o JSON que precisamos ler.
    if (error) reject(Object.assign(error, { stdout, stderr }));
    else resolve({ stdout, stderr });
  });
});

// Estado do bot (economia, grupos, contadores...). Relativo à raiz do projeto,
// que é o cwd com que o index.js sobe este script.
const DB_DIR = 'dados/database';

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

  // O bot grava o estado dele dentro de dados/database enquanto roda (economia,
  // contadores, grupos...). Se o commit que vem do GitHub mexer no MESMO arquivo
  // desses, o merge aborta com:
  //
  //   error: Your local changes to the following files would be overwritten by
  //   merge: dados/database/global.json
  //
  // Por isso o estado local é copiado para um diretório temporário antes do
  // pull e devolvido depois. Nada é descartado.
  const estado = await guardarEstadoLocal();

  console.log('Baixando a versão mais recente...');
  try {
    await execAsync('git', ['pull']);
  } catch (err) {
    // Segunda tentativa: se ainda houver conflito (ex.: arquivo de estado que
    // mudou dos dois lados), aceita a versão do repositório SÓ nos arquivos de
    // dados -- que são recriados/sobrescritos pelo bot de qualquer forma -- e
    // mantém o código atualizado.
    console.log('Aviso: pull encontrou conflito, tentando preservar o estado local...');
    await tentarPullPreservandoEstado();
  }
  console.log('Download concluído');

  await restaurarEstadoLocal(estado);
}

/** Guarda as alterações locais só de dados/database (sem tocar no resto). */
async function guardarEstadoLocal() {
  try {
    const { stdout } = await execAsync('git', ['status', '--porcelain', '--', DB_DIR]);
    // Formato de cada linha: "XY caminho" (XY = 2 chars de status + 1 espaço).
    // O corte dos 3 primeiros chars tem que vir ANTES do trim: o trim come o
    // espaço inicial e desloca o caminho (virava "ados/database/...").
    const linhas = stdout.split('\n').map((l) => l.replace(/\r$/, '')).filter((l) => l.trim());
    if (linhas.length === 0) return null;

    // Copia os arquivos alterados para um diretório temporário. É mais simples e
    // seguro que stash: funciona mesmo com arquivo novo, deletado ou conflitado.
    const backup = fs.mkdtempSync(path.join(os.tmpdir(), 'estado-bot-'));
    const arquivos = [];
    for (const linha of linhas) {
      const caminho = linha.slice(3).trim().replace(/^"|"$/g, '');
      const origem = path.join(process.cwd(), caminho);
      if (!fs.existsSync(origem) || !fs.statSync(origem).isFile()) continue;
      const destino = path.join(backup, caminho.replace(/\//g, '__'));
      fs.copyFileSync(origem, destino);
      arquivos.push({ caminho, destino });
    }
    if (arquivos.length === 0) {
      fs.rmSync(backup, { recursive: true, force: true });
      return null;
    }
    console.log(`Estado local preservado (${arquivos.length} arquivo(s) em ${DB_DIR})`);
    return { backup, arquivos };
  } catch (err) {
    console.log('Aviso: não foi possível preservar o estado local:', err.message);
    return null;
  }
}

/** Devolve os arquivos guardados por cima do que veio do repositório. */
async function restaurarEstadoLocal(estado) {
  if (!estado) return;
  try {
    let restaurados = 0;
    for (const { caminho, destino } of estado.arquivos) {
      try {
        fs.mkdirSync(path.dirname(path.join(process.cwd(), caminho)), { recursive: true });
        fs.copyFileSync(destino, path.join(process.cwd(), caminho));
        restaurados += 1;
      } catch {
        /* um arquivo que falhar não impede os outros */
      }
    }
    if (restaurados > 0) console.log(`Estado local restaurado (${restaurados} arquivo(s))`);
  } catch (err) {
    console.log('Aviso: falha ao restaurar o estado local:', err.message);
  } finally {
    try {
      fs.rmSync(estado.backup, { recursive: true, force: true });
    } catch { /* temporário */ }
  }
}

/**
 * Última tentativa de pull: guarda o estado, descarta as mudanças locais nos
 * arquivos GERADOS (`dados/database` e `package-lock.json`) e puxa de novo.
 *
 * Por que o lockfile entra aqui: o npm reescreve o `package-lock.json` a cada
 * `npm install` (ex.: ao expandir um hash de commit curto para o SHA completo).
 * Isso deixa o arquivo "modificado" na árvore de trabalho; se o commit que vem
 * do GitHub mexer no MESMO arquivo, o `git pull` aborta com
 *
 *   error: Your local changes to the following files would be overwritten by
 *   merge: package-lock.json
 *
 * e o bot NUNCA pega a atualização — era o sintoma "deu push e não chegou".
 * O lockfile é artefato de instalação (o conteúdo real é recriado a partir do
 * `package.json`), então descartá-lo é seguro; código e configs locais não são
 * tocados.
 */
async function tentarPullPreservandoEstado() {
  const estado = await guardarEstadoLocal();
  try {
    // Desfaz mudanças locais nos arquivos gerados, para o merge não abortar.
    // O estado do bot foi guardado acima; o lockfile é recriado no install.
    await execAsync('git', ['checkout', '--', DB_DIR]);
  } catch { /* nada rastreado modificado: segue */ }
  try {
    await execAsync('git', ['checkout', '--', 'package-lock.json']);
  } catch { /* não rastreado (ex.: destrackeado) ou sem mudança: segue */ }

  try {
    await execAsync('git', ['pull']);
  } catch (err) {
    console.log('Aviso: git pull ainda falhou:', err.stderr || err.message);
    // Mesmo falhando, devolve o estado local para não perder dados do bot.
    await restaurarEstadoLocal(estado);
    throw err;
  }

  await restaurarEstadoLocal(estado);
}

// Detecta dependência de GIT instalada em commit DIFERENTE do lockfile.
//
// Por que: `npm ls` compara VERSÃO, não commit. A fork do Baileys mantém
// `0.3.18-final` entre commits, então trocar o commit no package-lock (para
// pegar uma correção da fork) NÃO gera nenhum `problem` -- a árvore parecia
// saudável, o install era pulado e a fork continuava no código ANTIGO. Sintoma
// real: um recurso novo da fork (ex.: `canBeReshared` no status de grupo) era
// silenciosamente ignorado mesmo com o bot atualizado.
//
// A lógica fica em `git-drift.js` (mesma usada pelo `.scripts/config.js`).

// Instala dependências Node somente se houver algo faltando.
async function nodeDeps() {
  // `npm ls --depth=0` não detecta dependência TRANSITIVA faltando (devolve
  // exit 0), então usamos a lista `problems` do `npm ls --all`, ignorando o
  // peer opcional `sharp@*` (não é instalado de propósito).
  let treeOk = false;
  try {
    let report;
    try {
      ({ stdout: report } = await execAsync('npm', ['ls', '--all', '--json'], { timeout: 120000 }));
    } catch (error) {
      report = error?.stdout;
    }
    const problems = report ? (JSON.parse(report).problems ?? []) : ['npm ls não retornou dados'];
    treeOk = problems.filter((p) => !String(p).includes('sharp')).length === 0;
  } catch {
    treeOk = false;
  }

  const drift = fs.existsSync('node_modules') ? gitDependencyDrift(process.cwd()) : null;

  if (treeOk && fs.existsSync('node_modules') && !drift) {
    console.log('Dependências já atualizadas');
    return;
  }

  if (drift) {
    console.log('Dependência de git em commit desatualizado:');
    console.log(`  instalado: ${drift.instalado}`);
    console.log(`  esperado : ${drift.esperado}`);
  }

  console.log('Instalando dependências');
  try {
    await execAsync('npm', ['install', '--legacy-peer-deps', '--allow-git=all'], { timeout: 600000 });
  } catch {
    await execAsync('npm', ['install', '--allow-git=all'], { timeout: 600000 });
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
