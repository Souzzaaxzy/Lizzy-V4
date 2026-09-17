/**
 * Detecção de deriva (drift) de dependência de GIT.
 *
 * Por que existe: `npm ls` compara VERSÃO, não commit. A fork do Baileys
 * (@itsliaaa/baileys -> Souzzaaxzy/baileys) mantém `0.3.18-final` entre commits,
 * então trocar o commit no `package-lock.json` para pegar uma correção da fork
 * NÃO gera nenhum item em `problems`. O instalador concluía "árvore saudável",
 * pulava o `npm install` e a fork continuava no commit ANTIGO — um recurso novo
 * era silenciosamente ignorado, mesmo com o bot já atualizado no GitHub.
 *
 * O `node_modules/.package-lock.json` é a fonte da verdade: é ele que o npm usa
 * para decidir reinstalar. Se apontar para commit diferente do
 * `package-lock.json`, a árvore está desatualizada.
 *
 * Usado por `.scripts/config.js` (primeira instalação) e `.scripts/update.js`
 * (`!atualizar`) — a lógica fica num lugar só para não divergir.
 */

import fsSync from 'fs';
import path from 'path';

const PACOTE_FORK = 'node_modules/@itsliaaa/baileys';

/** Lê o commit de uma dependência git a partir de um lockfile. `null` se não der. */
export function lerCommitGit(lockPath) {
  try {
    const lock = JSON.parse(fsSync.readFileSync(lockPath, 'utf-8'));
    const pkg = lock?.packages?.[PACOTE_FORK];
    return pkg?.resolved?.split('#')[1] || null;
  } catch {
    return null;
  }
}

/**
 * Compara o commit pedido pelo `package-lock.json` com o que está instalado
 * (`node_modules/.package-lock.json`).
 *
 * @param {string} raiz diretório do projeto (onde vivem os lockfiles)
 * @returns {null | { esperado: string, instalado: string }} null quando batem,
 *   ou quando não há dados confiáveis dos dois lados (melhor não forçar install
 *   do que reinstalar por engano).
 */
export function gitDependencyDrift(raiz = process.cwd()) {
  const esperado = lerCommitGit(path.join(raiz, 'package-lock.json'));
  const instalado = lerCommitGit(path.join(raiz, 'node_modules', '.package-lock.json'));
  if (!esperado || !instalado) return null;
  return esperado === instalado ? null : { esperado, instalado };
}