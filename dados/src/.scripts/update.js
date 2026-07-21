#!/usr/bin/env node

import { exec } from 'child_process';

async function gitPull() {
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
