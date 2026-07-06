import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import os from 'os';

const execAsync = promisify(exec);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '../../..');
const MAIN_BRANCH = 'main';

class UpdateCommand {
  constructor() {
    this.isUpdating = false;
    this.processing = false;
  }

  /**
   * Verifica se o Git está instalado
   */
  async checkGitInstalled() {
    try {
      await execAsync('git --version');
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Verifica se existe conexão com o repositório remoto
   */
  async checkRemoteConnection() {
    try {
      await execAsync('git ls-remote --heads origin', { 
        timeout: 10000,
        cwd: PROJECT_ROOT
      });
      return true;
    } catch (error) {
      if (error.message.includes('Could not read from remote repository') ||
          error.message.includes('Connection refused') ||
          error.message.includes('ssh: Could not resolve hostname')) {
        throw new Error('❌ *Falha de conexão com o GitHub*\n\nVerifique sua conexão com a internet e tente novamente.');
      }
      throw error;
    }
  }

  /**
   * Verifica se há atualizações disponíveis
   */
  async checkForUpdates() {
    try {
      await execAsync('git fetch origin', { 
        cwd: PROJECT_ROOT,
        timeout: 30000
      });

      const { stdout: status } = await execAsync('git status', { cwd: PROJECT_ROOT });
      
      if (status.includes('Your branch is up to date') || 
          status.includes('Your branch is ahead')) {
        return { hasUpdates: false };
      }

      const { stdout } = await execAsync(`git log HEAD..origin/${MAIN_BRANCH} --oneline`, { 
        cwd: PROJECT_ROOT,
        timeout: 10000
      });

      const commits = stdout.trim().split('\n').filter(c => c.length > 0);
      return { hasUpdates: true, commits };
    } catch (error) {
      console.error('Erro ao verificar atualizações:', error.message);
      throw error;
    }
  }

  /**
   * Obtém informações detalhadas sobre as mudanças
   */
  async getChangesInfo() {
    try {
      const { stdout: diffSummary } = await execAsync(
        `git diff --stat origin/${MAIN_BRANCH}`,
        { cwd: PROJECT_ROOT, timeout: 30000 }
      );

      const { stdout: filesChanged } = await execAsync(
        `git diff --name-status origin/${MAIN_BRANCH}`,
        { cwd: PROJECT_ROOT, timeout: 30000 }
      );

      const lines = filesChanged.trim().split('\n').filter(l => l.length > 0);
      let added = [], modified = [], removed = [];

      for (const line of lines) {
        const [status, ...pathParts] = line.split('\t');
        const filePath = pathParts.join('\t');
        
        switch (status) {
          case 'A':
            added.push(filePath);
            break;
          case 'M':
            modified.push(filePath);
            break;
          case 'D':
            removed.push(filePath);
            break;
          case 'R':
            modified.push(filePath);
            break;
        }
      }

      const totalFiles = lines.length;

      return {
        totalFiles,
        added,
        modified,
        removed,
        diffSummary
      };
    } catch (error) {
      console.error('Erro ao obter informações das mudanças:', error.message);
      throw error;
    }
  }

  /**
   * Verifica se o package.json foi alterado
   */
  async checkPackageJsonChanged() {
    try {
      const { stdout } = await execAsync(
        `git diff --name-status origin/${MAIN_BRANCH} -- package.json package-lock.json yarn.lock`,
        { cwd: PROJECT_ROOT, timeout: 10000 }
      );
      return stdout.trim().length > 0;
    } catch (error) {
      return false;
    }
  }

  /**
   * Executa git pull com tratamento de erros
   */
  async performPull() {
    return new Promise((resolve, reject) => {
      const output = [];
      
      const gitProcess = spawn('git', ['pull', 'origin', MAIN_BRANCH], {
        cwd: PROJECT_ROOT,
        shell: os.platform() === 'win32',
        env: { ...process.env }
      });

      gitProcess.stdout.on('data', (data) => {
        output.push(data.toString());
      });

      gitProcess.stderr.on('data', (data) => {
        output.push(data.toString());
      });

      gitProcess.on('close', (code) => {
        const fullOutput = output.join('');
        
        if (code === 0) {
          resolve(fullOutput);
        } else {
          reject(new Error(fullOutput || `Git pull falhou com código ${code}`));
        }
      });

      gitProcess.on('error', (error) => {
        reject(new Error(`Erro ao executar git pull: ${error.message}`));
      });
    });
  }

  /**
   * Executa npm install
   */
  async runNpmInstall() {
    return new Promise((resolve, reject) => {
      const output = [];
      
      const npmProcess = spawn('npm', ['install'], {
        cwd: PROJECT_ROOT,
        shell: os.platform() === 'win32',
        env: { ...process.env }
      });

      npmProcess.stdout.on('data', (data) => {
        output.push(data.toString());
      });

      npmProcess.stderr.on('data', (data) => {
        output.push(data.toString());
      });

      npmProcess.on('close', (code) => {
        const fullOutput = output.join('');
        
        if (code === 0) {
          resolve(fullOutput);
        } else {
          reject(new Error(fullOutput || `npm install falhou com código ${code}`));
        }
      });

      npmProcess.on('error', (error) => {
        reject(new Error(`Erro ao executar npm install: ${error.message}`));
      });
    });
  }

  /**
   * Executa npm install usando yarn se preferir
   */
  async runYarnInstall() {
    return new Promise((resolve, reject) => {
      const output = [];
      
      const yarnProcess = spawn('yarn', ['install'], {
        cwd: PROJECT_ROOT,
        shell: os.platform() === 'win32',
        env: { ...process.env }
      });

      yarnProcess.stdout.on('data', (data) => {
        output.push(data.toString());
      });

      yarnProcess.stderr.on('data', (data) => {
        output.push(data.toString());
      });

      yarnProcess.on('close', (code) => {
        const fullOutput = output.join('');
        
        if (code === 0) {
          resolve(fullOutput);
        } else {
          reject(new Error(fullOutput || `yarn install falhou com código ${code}`));
        }
      });

      yarnProcess.on('error', (error) => {
        reject(new Error(`Erro ao executar yarn install: ${error.message}`));
      });
    });
  }

  /**
   * Instala dependências (npm ou yarn)
   */
  async installDependencies() {
    const hasYarn = fs.existsSync(path.join(PROJECT_ROOT, 'yarn.lock'));
    
    if (hasYarn) {
      return this.runYarnInstall();
    }
    return this.runNpmInstall();
  }

  /**
   * Analisa erros comuns de git
   */
  parseGitError(errorMessage) {
    const message = errorMessage.toLowerCase();

    if (message.includes('merge conflict') || message.includes('CONFLICT')) {
      return '⚠️ *Conflito de merge detectado*\n\n' +
             'Há conflitos de merge que precisam ser resolvidos manualmente.\n' +
             'Verifique os arquivos em conflito e resolva-os antes de tentar novamente.';
    }

    if (message.includes('local changes') || message.includes('please commit your changes') || 
        message.includes('would be overwritten')) {
      return '⚠️ *Alterações locais impedem o pull*\n\n' +
             'Você tem alterações não commitadas que seriam sobrescritas.\n' +
             'Faça commit ou stash das suas alterações antes de atualizar.';
    }

    if (message.includes('not a git repository') || message.includes('fatal: not a git repo')) {
      return '❌ *Repositório inexistente*\n\n' +
             'Este diretório não é um repositório Git válido.';
    }

    if (message.includes('could not resolve host') || message.includes('connection refused') ||
        message.includes('network') || message.includes('timeout')) {
      return '❌ *Falha de conexão com o GitHub*\n\n' +
             'Verifique sua conexão com a internet e tente novamente.';
    }

    if (message.includes('Permission denied') || message.includes('authentication failed')) {
      return '❌ *Erro de autenticação*\n\n' +
             'Não foi possível autenticar com o repositório remoto.\n' +
             'Verifique suas credenciais Git.';
    }

    if (message.includes('npm') && (message.includes('failed') || message.includes('error'))) {
      return '❌ *Falha ao executar npm install*\n\n' +
             'Ocorreu um erro durante a instalação das dependências.\n' +
             'Tente executar manualmente: `npm install`';
    }

    return `❌ *Erro durante a atualização*\n\n${errorMessage}`;
  }

  /**
   * Formata a lista de arquivos para exibição
   */
  formatFileList(files, maxDisplay = 10) {
    if (files.length === 0) return 'Nenhum';
    
    const displayList = files.slice(0, maxDisplay);
    const formatted = displayList.map(f => `  • \`${f}\``).join('\n');
    
    if (files.length > maxDisplay) {
      return `${formatted}\n  • ...e mais ${files.length - maxDisplay} arquivo(s)`;
    }
    
    return formatted;
  }

  /**
   * Executa o processo completo de atualização
   */
  async execute() {
    if (this.isUpdating) {
      throw new Error('🔄 Uma atualização já está em andamento!');
    }

    this.isUpdating = true;
    this.processing = true;

    try {
      // 1. Verificar Git instalado
      const gitInstalled = await this.checkGitInstalled();
      if (!gitInstalled) {
        return {
          success: false,
          message: '❌ *Git não instalado*\n\n' +
                   'O Git não está instalado neste sistema.\n' +
                   'Instale o Git para poder usar este comando.'
        };
      }

      // 2. Verificar conexão com repositório
      try {
        await this.checkRemoteConnection();
      } catch (connError) {
        return {
          success: false,
          message: this.parseGitError(connError.message)
        };
      }

      // 3. Verificar atualizações
      let updateInfo;
      try {
        updateInfo = await this.checkForUpdates();
      } catch (checkError) {
        return {
          success: false,
          message: this.parseGitError(checkError.message)
        };
      }

      // 4. Se não há atualizações
      if (!updateInfo.hasUpdates) {
        return {
          success: true,
          message: '✅ *O bot já está na versão mais recente.*\n\n' +
                   'Não há atualizações disponíveis no momento.'
        };
      }

      // 5. Obter informações das mudanças
      let changesInfo;
      try {
        changesInfo = await this.getChangesInfo();
      } catch (error) {
        return {
          success: false,
          message: this.parseGitError(error.message)
        };
      }

      // 6. Verificar se package.json foi alterado
      const packageJsonChanged = await this.checkPackageJsonChanged();

      // 7. Executar git pull
      let pullOutput;
      try {
        pullOutput = await this.performPull();
      } catch (pullError) {
        return {
          success: false,
          message: this.parseGitError(pullError.message)
        };
      }

      // 8. Se package.json mudou, executar npm install
      let npmOutput = null;
      if (packageJsonChanged) {
        try {
          await this.installDependencies();
        } catch (npmError) {
          return {
            success: false,
            message: this.parseGitError(npmError.message)
          };
        }
      }

      // 9. Preparar mensagem de sucesso com resumo
      let successMessage = '✅ *Atualização concluída com sucesso!*\n\n';
      successMessage += `📊 *Resumo da atualização:*\n`;
      successMessage += `━━━━━━━━━━━━━━━\n`;
      successMessage += `📁 Total de arquivos: ${changesInfo.totalFiles}\n`;
      
      if (changesInfo.added.length > 0) {
        successMessage += `\n🆕 *Adicionados (${changesInfo.added.length}):*\n`;
        successMessage += this.formatFileList(changesInfo.added) + '\n';
      }
      
      if (changesInfo.modified.length > 0) {
        successMessage += `\n📝 *Modificados (${changesInfo.modified.length}):*\n`;
        successMessage += this.formatFileList(changesInfo.modified) + '\n';
      }
      
      if (changesInfo.removed.length > 0) {
        successMessage += `\n🗑️ *Removidos (${changesInfo.removed.length}):*\n`;
        successMessage += this.formatFileList(changesInfo.removed) + '\n';
      }

      if (packageJsonChanged) {
        successMessage += `\n📦 *Dependências:*\n`;
        successMessage += `O package.json foi atualizado. Dependências foram reinstaladas.`;
      }

      successMessage += `\n━━━━━━━━━━━━━━━\n\n`;
      successMessage += `♻️ *Reiniciando o bot...*`;

      return {
        success: true,
        needsRestart: true,
        message: successMessage
      };

    } catch (error) {
      return {
        success: false,
        message: this.parseGitError(error.message)
      };
    } finally {
      this.isUpdating = false;
      this.processing = false;
    }
  }

  /**
   * Reinicia o bot
   */
  restartBot() {
    setTimeout(() => {
      console.log('[UPDATE] Reiniciando bot após atualização...');
      process.exit(0);
    }, 2000);
  }
}

export default UpdateCommand;
