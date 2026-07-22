#!/usr/bin/env node

import { exec } from 'child_process';

const execAsync = (cmd) => new Promise((resolve, reject) => {
  exec(cmd, (error, stdout, stderr) => {
    if (error) reject(error);
    else resolve(stdout);
  });
});

async function gitPull() {
  // Configurar git para usar merge em vez de rebase (evita erros de divergência)
  try {
    await execAsync('git config pull.rebase false');
  } catch (configError) {
    console.log('Aviso: não foi possível configurar git pull.rebase');
  }
  
  return new Promise((resolve, reject) => {
    exec('git pull', (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr || error.message));
        return;
      }
      resolve(stdout);
    });
  });
}

async function main() {
  try {
    await gitPull();
    process.exit(0);
  } catch (error) {
    console.error('Erro:', error.message);
    process.exit(1);
  }
}

main();
