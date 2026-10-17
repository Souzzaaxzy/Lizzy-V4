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
 * ## Todas as dependências git, não só a fork do Baileys
 *
 * A checagem nasceu focada na fork, mas o projeto tem OUTRA dependência git:
 * o `lizzy-call` (a pilha de mídia da call). Ele tem exatamente o mesmo
 * problema — a versão `0.2.0` não muda entre commits — e ficava sem checagem.
 * Resultado real: `!atualizar` dizia "100% sincronizado" e o `lizzy-call`
 * continuava no commit antigo, sem a correção. Por isso a varredura agora é
 * sobre todas as entradas `resolved` do tipo `git+...`, não uma lista fixa.
 *
 * Usado por `.scripts/config.js` (primeira instalação) e `.scripts/update.js`
 * (`!atualizar`) — a lógica fica num lugar só para não divergir.
 */

import fsSync from 'fs';
import path from 'path';

/** Prefixos de `resolved` que identificam uma dependência de git. */
const PREFIXOS_GIT = ['git+', 'git://', 'github:', 'gitlab:', 'bitbucket:'];

/** O `resolved` aponta para uma dependência git versionada por COMMIT? */
function ehDependenciaGit(resolved) {
  if (typeof resolved !== 'string' || !resolved) return false;
  if (!PREFIXOS_GIT.some((p) => resolved.startsWith(p))) return false;
  // Sem `#<sha>` não há commit para comparar (ex.: `github:user/repo` sem pin).
  return /#[0-9a-f]{7,40}$/i.test(resolved);
}

/** Nome do pacote a partir da chave `node_modules/<nome>` do lockfile. */
function nomeDoPacote(chave) {
  return chave.replace(/^.*node_modules\//, '');
}

/** Commit de um `resolved` git. `null` quando não for git ou não tiver pin. */
function commitDe(resolved) {
  return ehDependenciaGit(resolved) ? resolved.split('#').pop() : null;
}

/**
 * Todas as dependências git de um lockfile, como `{ nome -> commit }`.
 *
 * @param {string} lockPath caminho do lockfile
 * @returns {Map<string, string>} pacote -> commit (vazio se não der para ler)
 */
export function lerCommitsGit(lockPath) {
  try {
    const lock = JSON.parse(fsSync.readFileSync(lockPath, 'utf-8'));
    const mapa = new Map();
    for (const [chave, pkg] of Object.entries(lock?.packages || {})) {
      // Só entradas instaladas de verdade; a raiz (`""`) não tem `resolved` git.
      if (!chave.startsWith('node_modules/')) continue;
      const commit = commitDe(pkg?.resolved);
      if (commit) mapa.set(nomeDoPacote(chave), commit);
    }
    return mapa;
  } catch {
    return new Map();
  }
}

/** Lê o commit de UMA dependência git a partir de um lockfile. `null` se não der. */
export function lerCommitGit(lockPath, pacote = PACOTE_FORK) {
  return lerCommitsGit(lockPath).get(nomeDoPacote(pacote)) || null;
}

const PACOTE_FORK = 'node_modules/@itsliaaa/baileys';

/**
 * Compara o commit de CADA dependência git pedido pelo `package-lock.json` com o
 * que está instalado (`node_modules/.package-lock.json`).
 *
 * @param {string} raiz diretório do projeto (onde vivem os lockfiles)
 * @returns {Array<{pacote: string, esperado: string, instalado: string}>}
 *   Lista vazia quando está tudo em dia — ou quando não há dados confiáveis dos
 *   dois lados (melhor não forçar install do que reinstalar por engano).
 */
export function gitDependencyDrifts(raiz = process.cwd()) {
  const esperados = lerCommitsGit(path.join(raiz, 'package-lock.json'));
  const instalados = lerCommitsGit(path.join(raiz, 'node_modules', '.package-lock.json'));
  if (!esperados.size || !instalados.size) return [];

  const drifts = [];
  for (const [pacote, esperado] of esperados) {
    const instalado = instalados.get(pacote);
    // Pacote ausente do lado instalado já é acusado pelo `npm ls`; aqui só
    // interessa o caso que ele NÃO pega: presente, mas em outro commit.
    if (instalado && instalado !== esperado) {
      drifts.push({ pacote, esperado, instalado });
    }
  }
  return drifts;
}

/**
 * Compatibilidade: a primeira deriva encontrada, ou `null` se não houver.
 *
 * @returns {null | {pacote: string, esperado: string, instalado: string}}
 */
export function gitDependencyDrift(raiz = process.cwd()) {
  return gitDependencyDrifts(raiz)[0] || null;
}
