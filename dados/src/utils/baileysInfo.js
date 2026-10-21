/**
 * Identifica a biblioteca do WhatsApp (fork do Baileys) REALMENTE instalada.
 *
 * O bot usa a fork `github:Souzzaaxzy/baileys` (publicada como
 * `@itsliaaa/baileys`). Nome e versão vivem no `package.json` do pacote; o
 * COMMIT instalado vive no `node_modules/.package-lock.json`, que é a fonte da
 * verdade do npm — é o único lugar que registra a revisão (a versão
 * `0.3.18-final` é a mesma em vários commits).
 *
 * Ler daqui, em vez de fixar uma string no código, evita o problema que originou
 * esta função: o boot anunciava uma biblioteca que não era mais a que estava
 * rodando. Como a leitura é do que está instalado, trocar o commit no lockfile e
 * reinstalar já muda o que aparece — sem editar nada.
 *
 * O módulo é puro (só lê arquivos, não abre socket) e NUNCA lança: na dúvida
 * devolve valores "desconhecida" em vez de derrubar o boot.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// utils/ -> src/ -> dados/ -> raiz do projeto
const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..');

/** Pacote que o projeto declara como dependência do WhatsApp. */
const PACOTE = '@itsliaaa/baileys';

const DESCONHECIDO = {
  name: PACOTE,
  version: 'desconhecida',
  commit: null,
  commitCurto: null,
  repo: null,
  label: `${PACOTE} (versão desconhecida)`,
};

const lerJson = (file) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch {
    return null;
  }
};

/**
 * Extrai `owner/repo` e o commit de uma URL resolvida do npm no formato git.
 *
 * Ex.: `git+ssh://git@github.com/Souzzaaxzy/baileys.git#d3692c7...`
 *  -> { repo: 'Souzzaaxzy/baileys', commit: 'd3692c7...' }
 */
const parseResolved = (resolved) => {
  if (typeof resolved !== 'string' || !resolved) return { repo: null, commit: null };
  const commit = resolved.includes('#') ? resolved.split('#').pop() : null;
  const semCommit = resolved.split('#')[0];
  const m = semCommit.match(/[/:]([^/:]+\/[^/]+?)(?:\.git)?$/);
  return { repo: m ? m[1] : null, commit };
};

/**
 * Lê um pacote git instalado e devolve nome, versão, repo e commit.
 *
 * Generaliza o que antes era só da fork do Baileys: o motor de mídia da call
 * (`@zapo-js/voip`) é outra dependência de git, e o mesmo defeito vale para ela —
 * a versão (`1.4.0`) é a MESMA entre commits, então só o commit identifica a
 * revisão instalada. Um pacote no commit errado faz o comportamento novo não
 * existir, e nada no boot dizia isso.
 *
 * @param {string} root raiz do projeto
 * @param {string} pacote nome do pacote
 * @returns {{name: string, version: string, commit: string|null,
 *            commitCurto: string|null, repo: string|null, label: string}}
 */
function lerPacoteGit(root, pacote) {
  const desconhecido = {
    name: pacote,
    version: 'desconhecida',
    commit: null,
    commitCurto: null,
    repo: null,
    label: `${pacote} (versão desconhecida)`,
  };
  try {
    const pkg = lerJson(path.join(root, 'node_modules', pacote, 'package.json'));
    if (!pkg) return desconhecido;

    const name = typeof pkg.name === 'string' && pkg.name.trim() ? pkg.name.trim() : pacote;
    const version = typeof pkg.version === 'string' && pkg.version.trim() ? pkg.version.trim() : 'desconhecida';

    // O commit só existe no lock do próprio node_modules.
    const lock = lerJson(path.join(root, 'node_modules', '.package-lock.json'));
    const entry = lock?.packages?.[`node_modules/${pacote}`];
    const { repo, commit } = parseResolved(entry?.resolved);
    const commitCurto = commit ? commit.slice(0, 7) : null;

    let label = `${name} ${version}`;
    if (repo || commitCurto) {
      label += ` (${repo || 'fork'}${commitCurto ? `@${commitCurto}` : ''})`;
    }

    return { name, version, commit, commitCurto, repo, label };
  } catch {
    return desconhecido;
  }
}

/**
 * Lê a fork do Baileys instalada.
 *
 * @param {string} [root] raiz do projeto (padrão: deduzida deste arquivo)
 * @returns {{name: string, version: string, commit: string|null,
 *            commitCurto: string|null, repo: string|null, label: string}}
 */
export function getWhatsAppLibrary(root = PROJECT_ROOT) {
  return lerPacoteGit(root, PACOTE);
}

/** Pacote do MOTOR DE MÍDIA da chamada (`!callp` / `!vozp` / `!musicap`). */
const PACOTE_MIDIA = '@zapo-js/voip';

/**
 * Lê o motor de mídia instalado.
 *
 * Existe pelo mesmo motivo da fork do Baileys: a versão é a mesma entre commits,
 * então uma correção pode estar no `package-lock.json` e NÃO estar rodando — o
 * bot sobe normalmente e o comportamento novo simplesmente não acontece.
 *
 * @param {string} [root] raiz do projeto
 * @returns {{name: string, version: string, commit: string|null,
 *            commitCurto: string|null, repo: string|null, label: string}}
 */
export function getMediaEngine(root = PROJECT_ROOT) {
  return lerPacoteGit(root, PACOTE_MIDIA);
}

export default getWhatsAppLibrary;
