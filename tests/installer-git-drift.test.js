/**
 * Testes da detecção de deriva (drift) de dependência de GIT no instalador.
 *
 * Contexto (bug real): `!atualizar`/`config.js` só rodavam `npm install` quando o
 * `npm ls --all` acusava pacote FALTANDO. `npm ls` compara VERSÃO, não commit —
 * e a fork do Baileys mantém `0.3.18-final` entre commits. Então trocar o commit
 * no `package-lock.json` (para pegar uma correção da fork, como o suporte a
 * `canBeReshared` no status de grupo) NÃO gerava nenhum `problem`: a árvore
 * parecia saudável, o install era pulado e a fork continuava no commit ANTIGO.
 * Sintoma: recurso novo silenciosamente ignorado.
 *
 * Este teste roda o código REAL dos scripts (extraído do próprio arquivo) contra
 * um projeto temporário, sem tocar no node_modules de verdade.
 *
 * Uso: node tests/installer-git-drift.test.js
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

import { gitDependencyDrift } from '../dados/src/.scripts/git-drift.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.resolve(HERE, '..');

const RESULTS = [];
let CURRENT = null;

function test(name, fn) {
  CURRENT = { name, passed: 0, failed: 0, errors: [] };
  RESULTS.push(CURRENT);
  try {
    const result = fn();
    if (result && typeof result.then === 'function') {
      return result.then(() => finish(name)).catch((error) => {
        CURRENT.failed += 1;
        CURRENT.errors.push(`EXCEÇÃO: ${error?.stack || error}`);
        finish(name);
      });
    }
    finish(name);
  } catch (error) {
    CURRENT.failed += 1;
    CURRENT.errors.push(`EXCEÇÃO: ${error?.stack || error}`);
    finish(name);
  }
  return Promise.resolve();
}

function finish(name) {
  console.log(`${CURRENT.failed === 0 ? '✅' : '❌'} ${name} (${CURRENT.passed} ok, ${CURRENT.failed} falhas)`);
  for (const e of CURRENT.errors) console.log(`     ${e}`);
}

function ok(cond, msg) {
  if (cond) CURRENT.passed += 1;
  else {
    CURRENT.failed += 1;
    CURRENT.errors.push(`ASSERT FALHOU: ${msg}`);
  }
}

function includes(hay, needle, msg) {
  ok(String(hay).includes(needle), msg || `esperava conter "${needle}"`);
}

const OLD = '453ccf75da5996e160d3c8aecd22422631bbabc1';
const NEW = '09d78f495d2bc90d59258a53c29d7ee12faa1ee3';

/** Projeto temporário com os dois lockfiles apontando para commits escolhidos. */
function projetoCom({ commitEsperado, commitInstalado, lockValido = true }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lizzy-drift-'));
  fs.mkdirSync(path.join(dir, 'node_modules'), { recursive: true });

  const lock = (commit) => JSON.stringify({
    packages: {
      'node_modules/@itsliaaa/baileys': {
        version: '0.3.18-final',
        resolved: `git+ssh://git@github.com/Souzzaaxzy/baileys.git#${commit}`,
      },
    },
  });

  fs.writeFileSync(
    path.join(dir, 'package-lock.json'),
    lockValido ? lock(commitEsperado) : 'nao e json'
  );
  fs.writeFileSync(
    path.join(dir, 'node_modules', '.package-lock.json'),
    lockValido ? lock(commitInstalado) : '{}'
  );
  return dir;
}

const CONFIG = path.join(PROJECT, 'dados/src/.scripts/config.js');
const UPDATE = path.join(PROJECT, 'dados/src/.scripts/update.js');

// ============================================================================
// 1) O BUG: commits diferentes PRECISAM ser detectados
// ============================================================================

await test('detecta fork em commit desatualizado (o bug real)', async () => {
  const dir = projetoCom({ commitEsperado: NEW, commitInstalado: OLD });
  const drift = gitDependencyDrift(dir);
  ok(Boolean(drift), 'detectou a divergência (antes do fix isto era invisível)');
  includes(drift?.instalado, OLD, 'reporta o commit instalado');
  includes(drift?.esperado, NEW, 'reporta o commit esperado');
  fs.rmSync(dir, { recursive: true, force: true });
});

// ============================================================================
// 2) NÃO regredir: mesmo commit não pode forçar reinstalação à toa
// ============================================================================

await test('mesmo commit NÃO é tratado como desatualizado', async () => {
  const dir = projetoCom({ commitEsperado: NEW, commitInstalado: NEW });
  const drift = gitDependencyDrift(dir);
  ok(drift === null, 'sem deriva quando os commits batem (install segue idempotente)');
  fs.rmSync(dir, { recursive: true, force: true });
});

// ============================================================================
// 3) Robustez: não dá para afirmar deriva sem os dois lados
// ============================================================================

await test('lockfile ausente/ilegível não vira falsa reinstalação', async () => {
  const dir = projetoCom({ commitEsperado: NEW, commitInstalado: NEW, lockValido: false });
  ok(gitDependencyDrift(dir) === null, 'sem dados confiáveis, não força install');
  fs.rmSync(dir, { recursive: true, force: true });
});

await test('projeto sem node_modules não é tratado como deriva', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lizzy-drift-nonm-'));
  fs.writeFileSync(path.join(dir, 'package-lock.json'), JSON.stringify({
    packages: { 'node_modules/@itsliaaa/baileys': { resolved: `git+x#${NEW}` } },
  }));
  ok(gitDependencyDrift(dir) === null, 'sem node_modules não há o que comparar');
  fs.rmSync(dir, { recursive: true, force: true });
});

// ============================================================================
// 4) Os scripts realmente USAM a detecção (não basta a função existir)
// ============================================================================

await test('config.js: a checagem está ligada ao caminho de instalação', async () => {
  const src = fs.readFileSync(CONFIG, 'utf-8');
  includes(src, 'gitDependencyDrift', 'importa/chama a checagem');
  includes(src, 'if (drift)', 'usa o resultado para decidir reinstalar');
  includes(src, "from './git-drift.js'", 'usa o módulo compartilhado');
});

await test('update.js: a checagem está ligada ao nodeDeps', async () => {
  const src = fs.readFileSync(UPDATE, 'utf-8');
  includes(src, 'gitDependencyDrift(', 'chama a checagem');
  includes(src, '!drift', 'o install só é pulado quando não há deriva');
  includes(src, "from './git-drift.js'", 'usa o módulo compartilhado');
});

// ============================================================================
// RESULTADO
// ============================================================================

const totalOk = RESULTS.reduce((a, r) => a + r.passed, 0);
const totalFail = RESULTS.reduce((a, r) => a + r.failed, 0);
console.log('\n' + '='.repeat(40));
console.log(`RESULTADO: ${RESULTS.length} testes | ${totalOk} asserções ok | ${totalFail} falhas`);
console.log('='.repeat(40));
if (totalFail === 0) console.log('✅ TODOS OS TESTES PASSARAM');
else {
  console.log('FALHAS:');
  for (const r of RESULTS) for (const e of r.errors) console.log(`- [${r.name}] ${e}`);
  process.exitCode = 1;
}