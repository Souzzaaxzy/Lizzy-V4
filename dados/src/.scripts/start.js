#!/usr/bin/env node

import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import { spawn, execSync } from 'child_process';
import readline from 'readline/promises';
import os from 'os';

const PROJECT_ROOT = process.cwd();
const CONFIG_PATH = path.join(PROJECT_ROOT, 'dados', 'src', 'config.json');
const NODE_MODULES_PATH = path.join(PROJECT_ROOT, 'node_modules');
const QR_CODE_DIR = path.join(PROJECT_ROOT, 'dados', 'database', 'qr-code');
const CONNECT_FILE = path.join(PROJECT_ROOT, 'dados', 'src', 'connect.js');
const PACKAGE_JSON = path.join(PROJECT_ROOT, 'package.json');
const BACKUP_DIR = path.join(PROJECT_ROOT, '.backup_temp');
const isWindows = os.platform() === 'win32';
const isTermux = fsSync.existsSync('/data/data/com.termux');

// Diretórios a fazer backup/restore
const BACKUP_DIRS = [
  'dados/database',
  'dados/midias'
];
const BACKUP_FILES = [
  'dados/src/config.json'
];

const colors = {
  reset: '\x1b[0m',
  green: '\x1b[1;32m',
  red: '\x1b[1;31m',
  blue: '\x1b[1;34m',
  yellow: '\x1b[1;33m',
  cyan: '\x1b[1;36m',
  bold: '\x1b[1m',
};

const mensagem = (text) => console.log(`${colors.green}${text}${colors.reset}`);
const aviso = (text) => console.log(`${colors.red}${text}${colors.reset}`);
const info = (text) => console.log(`${colors.cyan}${text}${colors.reset}`);
const separador = () => console.log(`${colors.blue}============================================${colors.reset}`);

// ============ FUNÇÕES DE BACKUP/RESTORE ============

async function createBackup() {
  info('💾 Criando backup dos dados...');
  
  try {
    // Criar diretório de backup
    await fs.mkdir(BACKUP_DIR, { recursive: true });
    
    // Copiar diretórios
    for (const dir of BACKUP_DIRS) {
      const source = path.join(PROJECT_ROOT, dir);
      const dest = path.join(BACKUP_DIR, dir);
      
      if (fsSync.existsSync(source)) {
        await fs.mkdir(path.dirname(dest), { recursive: true });
        await fs.cp(source, dest, { recursive: true });
        info(`  ✅ ${dir}/`);
      }
    }
    
    // Copiar arquivos
    for (const file of BACKUP_FILES) {
      const source = path.join(PROJECT_ROOT, file);
      const dest = path.join(BACKUP_DIR, file);
      
      if (fsSync.existsSync(source)) {
        await fs.mkdir(path.dirname(dest), { recursive: true });
        await fs.copyFile(source, dest);
        info(`  ✅ ${file}`);
      }
    }
    
    mensagem('💾 Backup criado com sucesso!');
  } catch (error) {
    aviso(`⚠️ Erro ao criar backup: ${error.message}`);
  }
}

function findLatestBackup() {
  // Procura diretórios de backup no formato backup_YYYY-MM-DD_THH-MM-SS
  const entries = fsSync.readdirSync(PROJECT_ROOT, { withFileTypes: true });
  const backupDirs = entries
    .filter(entry => entry.isDirectory() && entry.name.startsWith('backup_'))
    .map(entry => ({
      name: entry.name,
      path: path.join(PROJECT_ROOT, entry.name),
      date: new Date(entry.name.replace('backup_', '').replace(/_/g, ':').replace(/T/, ' '))
    }))
    .filter(backup => !isNaN(backup.date.getTime()))
    .sort((a, b) => b.date.getTime() - a.date.getTime());
  
  if (backupDirs.length > 0) {
    return backupDirs[0]; // Retorna o mais recente
  }
  return null;
}

async function restoreBackup() {
  // Primeiro tenta restaurar do backup temporário
  let backupPath = BACKUP_DIR;
  let foundBackup = false;
  
  // Se não existe backup temporário, procura o último backup
  if (!fsSync.existsSync(backupPath)) {
    info('🔍 Procurando último backup...');
    const latestBackup = findLatestBackup();
    
    if (latestBackup) {
      backupPath = latestBackup.path;
      info(`📁 Backup encontrado: ${latestBackup.name}`);
      foundBackup = true;
    }
  } else {
    foundBackup = true;
  }
  
  if (!foundBackup) {
    aviso('❌ Nenhum backup encontrado!');
    return;
  }
  
  info('📦 Restaurando dados do backup...');
  
  try {
    // Restaurar diretórios
    for (const dir of BACKUP_DIRS) {
      const source = path.join(backupPath, dir);
      const dest = path.join(PROJECT_ROOT, dir);
      
      if (fsSync.existsSync(source)) {
        await fs.mkdir(path.dirname(dest), { recursive: true });
        await fs.cp(source, dest, { recursive: true });
        info(`  ✅ ${dir}/`);
      }
    }
    
    // Restaurar arquivos
    for (const file of BACKUP_FILES) {
      const source = path.join(backupPath, file);
      const dest = path.join(PROJECT_ROOT, file);
      
      if (fsSync.existsSync(source)) {
        await fs.mkdir(path.dirname(dest), { recursive: true });
        await fs.copyFile(source, dest);
        info(`  ✅ ${file}`);
      }
    }
    
    mensagem('📦 Backup restaurado com sucesso!');
  } catch (error) {
    aviso(`⚠️ Erro ao restaurar backup: ${error.message}`);
  }
}

async function cleanupBackup() {
  try {
    if (fsSync.existsSync(BACKUP_DIR)) {
      await fs.rm(BACKUP_DIR, { recursive: true, force: true });
    }
  } catch (error) {
    // Ignora erros na limpeza
  }
}

const getVersion = () => {
  try {
    const packageJson = JSON.parse(fsSync.readFileSync(PACKAGE_JSON, 'utf8'));
    return packageJson.version || 'Desconhecida';
  } catch {
    return 'Desconhecida';
  }
};

let botProcess = null;
const version = getVersion();

async function setupTermuxAutostart() {
  if (!isTermux) {
    info('📱 Não está rodando no Termux. Ignorando configuração de autostart.');
    return;
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const answer = await rl.question(`${colors.yellow}📱 Detectado ambiente Termux. Deseja configurar inicialização automática? (s/n): ${colors.reset}`);
  rl.close();

  if (answer.trim().toLowerCase() !== 's') {
    info('📱 Configuração de autostart ignorada pelo usuário.');
    return;
  }

  info('📱 Configurando inicialização automática no Termux...');

  try {
    const termuxProperties = path.join(process.env.HOME, '.termux', 'termux.properties');
    await fs.mkdir(path.dirname(termuxProperties), { recursive: true });
    if (!fsSync.existsSync(termuxProperties)) {
      await fs.writeFile(termuxProperties, '');
    }
    execSync(`sed '/^# *allow-external-apps *= *true/s/^# *//' ${termuxProperties} -i && termux-reload-settings`, { stdio: 'inherit' });
    mensagem('📝 Configuração de termux.properties concluída.');

    const bashrcPath = path.join(process.env.HOME, '.bashrc');
    const termuxServiceCommand = `
am startservice --user 0 \\
  -n com.termux/com.termux.app.RunCommandService \\
  -a com.termux.RUN_COMMAND \\
  --es com.termux.RUN_COMMAND_PATH '/data/data/com.termux/files/usr/bin/npm' \\
  --esa com.termux.RUN_COMMAND_ARGUMENTS 'start' \\
  --es com.termux.RUN_COMMAND_SESSION_NAME 'Nazuna Bot' \\
  --es com.termux.RUN_COMMAND_WORKDIR '${PROJECT_ROOT}' \\
  --ez com.termux.RUN_COMMAND_BACKGROUND 'false' \\
  --es com.termux.RUN_COMMAND_SESSION_ACTION '0'
`.trim();

    let bashrcContent = '';
    if (fsSync.existsSync(bashrcPath)) {
      bashrcContent = await fs.readFile(bashrcPath, 'utf8');
    }

    if (!bashrcContent.includes(termuxServiceCommand)) {
      await fs.appendFile(bashrcPath, `\n${termuxServiceCommand}\n`);
      mensagem('📝 Comando am startservice adicionado ao ~/.bashrc');
    } else {
      info('📝 Comando am startservice já presente no ~/.bashrc');
    }

    mensagem('📱 Configuração de inicialização automática no Termux concluída!');
  } catch (error) {
    aviso(`❌ Erro ao configurar autostart no Termux: ${error.message}`);
  }
}

function setupGracefulShutdown() {
  const shutdown = () => {
    mensagem('🛑 Encerrando o Nazuna... Até logo!');
    if (botProcess) {
      botProcess.removeAllListeners();
      botProcess.kill();
    }
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  if (isWindows) {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.on('SIGINT', shutdown);
  }
}

async function displayHeader() {
  const header = [
    `${colors.bold}🚀 Nazuna - Conexão WhatsApp${colors.reset}`,
    `${colors.bold}📦 Versão: ${version}${colors.reset}`,
  ];

  separador();
  for (const line of header) {
    console.log(line);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  separador();
  console.log();
}

async function checkPrerequisites() {
  // PASSO 0: Verificar se há algum backup para restaurar
  const latestBackup = findLatestBackup();
  if (latestBackup) {
    info('💾 Backup encontrado! Restaurando dados...');
    info(`📁 Backup: ${latestBackup.name}`);
    
    // Salvar o path do backup antes de qualquer operação
    const restoreFromPath = latestBackup.path;
    
    // PASSO 1: Atualizar código do git
    info('🔄 Atualizando projeto...');
    
    try {
      console.log(`${colors.cyan}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}`);
      info('📥 git fetch origin');
      execSync('git fetch origin', { 
        stdio: 'inherit', 
        shell: true,
        cwd: PROJECT_ROOT
      });
      
      info('📦 git reset --hard origin/main');
      execSync('git reset --hard origin/main', { 
        stdio: 'inherit', 
        shell: true,
        cwd: PROJECT_ROOT
      });
      console.log(`${colors.cyan}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}`);
      mensagem('✅ Projeto atualizado!');
    } catch (error) {
      aviso(`⚠️ Erro ao atualizar: ${error.message}`);
    }
    
    // PASSO 2: Restaurar do backup encontrado
    info('📦 Restaurando dados do backup...');
    
    try {
      for (const dir of BACKUP_DIRS) {
        const source = path.join(restoreFromPath, dir);
        const dest = path.join(PROJECT_ROOT, dir);
        
        if (fsSync.existsSync(source)) {
          await fs.mkdir(path.dirname(dest), { recursive: true });
          await fs.cp(source, dest, { recursive: true });
          info(`  ✅ ${dir}/`);
        }
      }
      
      for (const file of BACKUP_FILES) {
        const source = path.join(restoreFromPath, file);
        const dest = path.join(PROJECT_ROOT, file);
        
        if (fsSync.existsSync(source)) {
          await fs.mkdir(path.dirname(dest), { recursive: true });
          await fs.copyFile(source, dest);
          info(`  ✅ ${file}`);
        }
      }
      
      mensagem('📦 Backup restaurado com sucesso!');
    } catch (error) {
      aviso(`⚠️ Erro ao restaurar backup: ${error.message}`);
    }
  } else {
    // PASSO 1: Fazer backup se não existir nenhum
    info('💾 Nenhum backup encontrado. Fazendo backup primeiro...');
    await createBackup();
    
    // PASSO 2: Atualizar código do git
    info('🔄 Atualizando projeto...');
    
    try {
      console.log(`${colors.cyan}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}`);
      info('📥 git fetch origin');
      execSync('git fetch origin', { 
        stdio: 'inherit', 
        shell: true,
        cwd: PROJECT_ROOT
      });
      
      info('📦 git reset --hard origin/main');
      execSync('git reset --hard origin/main', { 
        stdio: 'inherit', 
        shell: true,
        cwd: PROJECT_ROOT
      });
      console.log(`${colors.cyan}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}`);
      mensagem('✅ Projeto atualizado!');
    } catch (error) {
      aviso(`⚠️ Erro ao atualizar: ${error.message}`);
    }
    
    // PASSO 3: Restaurar backup DEPOIS do git reset
    info('📦 Restaurando dados...');
    await restoreBackup();
    await cleanupBackup();
  }
  
  // PASSO 3/4: Instalar/atualizar dependências
  info('📦 Instalando dependências...');
  
  if (!fsSync.existsSync(PACKAGE_JSON)) {
    aviso(`❌ Arquivo package.json não encontrado em: ${PROJECT_ROOT}`);
    process.exit(1);
  }
  
  const installCommands = [
    'npm install --legacy-peer-deps',
    'npm install --force',
    'npm install'
  ];
  
  let installed = false;
  
  for (const cmd of installCommands) {
    try {
      info(`⏳ Executando: ${cmd}`);
      console.log(`${colors.yellow}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}`);
      
      execSync(cmd, { 
        stdio: 'inherit', 
        shell: true,
        cwd: PROJECT_ROOT,
        env: { ...process.env }
      });
      
      console.log(`${colors.yellow}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}`);
      mensagem(`✅ Dependências instaladas com sucesso!`);
      installed = true;
      break;
    } catch (error) {
      aviso(`⚠️ Falhou: ${cmd}`);
    }
  }
  
  if (!installed) {
    aviso('❌ Não foi possível instalar as dependências.');
    process.exit(1);
  }
  
  // PASSO 5: Verificar config.json
  if (!fsSync.existsSync(CONFIG_PATH)) {
    aviso('⚠️ Arquivo de configuração (config.json) não encontrado!');
    try {
      const configProcess = spawn('npm', ['run', 'config'], { 
        stdio: 'inherit', 
        shell: true,
        cwd: PROJECT_ROOT 
      });
      configProcess.on('close', (code) => {
        if (code !== 0) {
          aviso('⚠️ Configuração não foi concluída. Você pode configurar manualmente depois.');
        }
      });
      await new Promise((resolve) => configProcess.on('close', resolve));
    } catch (error) {
      aviso(`⚠️ Não foi possível executar a configuração: ${error.message}`);
    }
  }
  
  // PASSO 6: Verificar arquivo de conexão
  if (!fsSync.existsSync(CONNECT_FILE)) {
    aviso(`❌ Arquivo de conexão não encontrado: ${CONNECT_FILE}`);
    process.exit(1);
  }
}

async function getServerIP() {
  try {
    const response = await fetch('https://api.ipify.org?format=json', { timeout: 5000 });
    const data = await response.json();
    return data.ip;
  } catch {
    return 'Não foi possível obter';
  }
}

async function startBot(codeMode = false) {
  const args = ['--expose-gc', CONNECT_FILE];
  if (codeMode) args.push('--code');

  // Mostrar IP do servidor
  const serverIP = await getServerIP();
  info(`🌐 IP do Servidor: ${colors.yellow}${serverIP}${colors.reset}`);
  info(`📷 Iniciando com ${codeMode ? 'código de pareamento' : 'QR Code'}`);

  botProcess = spawn('node', args, {
    stdio: 'inherit',
    env: { ...process.env, FORCE_COLOR: '1' },
  });

  botProcess.on('error', (error) => {
    aviso(`❌ Erro ao iniciar o processo do bot: ${error.message}`);
    restartBot(codeMode);
  });

  botProcess.on('close', (code) => {
    if (code === 0) {
      info(`✅ O bot terminou normalmente (código: ${code}). Reiniciando...`);
    } else {
      aviso(`⚠️ O bot terminou com erro (código: ${code}). Reiniciando...`);
    }
    restartBot(codeMode);
  });

  return botProcess;
}

function restartBot(codeMode) {
  aviso('🔄 Reiniciando o bot em 500ms...');
  setTimeout(() => {
    if (botProcess) botProcess.removeAllListeners();
    startBot(codeMode);
  }, 500);
}

async function checkAutoConnect() {
  try {
    if (!fsSync.existsSync(QR_CODE_DIR)) {
      await fs.mkdir(QR_CODE_DIR, { recursive: true });
      return false;
    }
    const files = await fs.readdir(QR_CODE_DIR);
    return files.length > 2;
  } catch (error) {
    aviso(`❌ Erro ao verificar diretório de QR Code: ${error.message}`);
    return false;
  }
}

async function promptConnectionMethod() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log(`${colors.yellow}🔧 Escolha o método de conexão:${colors.reset}`);
  console.log(`${colors.yellow}1. 📷 Conectar via QR Code${colors.reset}`);
  console.log(`${colors.yellow}2. 🔑 Conectar via código de pareamento${colors.reset}`);
  console.log(`${colors.yellow}3. 🚪 Sair${colors.reset}`);

  const answer = await rl.question('➡️ Digite o número da opção desejada: ');
  console.log();
  rl.close();

  switch (answer.trim()) {
    case '1':
      mensagem('📷 Iniciando conexão via QR Code...');
      return { method: 'qr' };
    case '2':
      mensagem('🔑 Iniciando conexão via código de pareamento...');
      return { method: 'code' };
    case '3':
      mensagem('👋 Encerrando... Até mais!');
      process.exit(0);
    default:
      aviso('⚠️ Opção inválida! Usando conexão via QR Code como padrão.');
      return { method: 'qr' };
  }
}

async function main() {
  try {
    setupGracefulShutdown();
    await displayHeader();
    await checkPrerequisites();
    await setupTermuxAutostart();

    const hasSession = await checkAutoConnect();
    if (hasSession) {
      mensagem('📷 Sessão de QR Code detectada. Conectando automaticamente...');
      startBot(false);
    } else {
      const { method } = await promptConnectionMethod();
      startBot(method === 'code');
    }
  } catch (error) {
    aviso(`❌ Erro inesperado: ${error.message}`);
    process.exit(1);
  }
}

(async () => {
  await main();
})();