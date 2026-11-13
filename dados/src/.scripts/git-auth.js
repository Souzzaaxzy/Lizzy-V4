/**
 * Autenticação de GIT para as dependências privadas do bot.
 *
 * ## Por que existe
 *
 * O `package.json` (e o `package-lock.json`) instala TRÊS dependências direto do
 * GitHub — `baileys`, `zapo` e `lizzy-call`. Quando esses repositórios são
 * PRIVADOS, o `npm install` precisa de credencial:
 *
 *   - o lock guarda a URL como `git+ssh://git@github.com/...` (o npm expande
 *     `git+https` para ssh ao escrever o lock), e SSH sem chave morre com
 *     `ssh: not found` / `Could not read from remote repository`;
 *   - `https://github.com/...` sem token dá `403` num repo privado.
 *
 * ## Como resolve
 *
 * Reescreve a URL via `git insteadOf`, injetado em VARIÁVEIS DE AMBIENTE
 * (`GIT_CONFIG_COUNT`/`GIT_CONFIG_KEY_n`/`GIT_CONFIG_VALUE_n`). Assim o token
 * NUNCA é gravado em arquivo (`~/.gitconfig`, `.npmrc`), não sobrevive ao
 * processo e não vaza para o `git config` de quem clonar a pasta.
 *
 * A credencial vem do `.env`/ambiente, NUNCA do código — mesma ordem do
 * `git-push.js`: `GITHUB_PUSH_TOKEN` → `GITHUB_SYNC_TOKEN` → `GITHUB_TOKEN`
 * → `GITHUB_UPLOAD_TOKEN`.
 */

/** O token nunca aparece inteiro no log. */
export const mascararToken = (t) => (t && t.length > 10 ? `${t.slice(0, 4)}...${t.slice(-4)}` : '(não definido)');

/** Token de git, na ordem de prioridade do bot. */
export const resolverTokenGit = (env = process.env) =>
    env.GITHUB_PUSH_TOKEN || env.GITHUB_SYNC_TOKEN || env.GITHUB_TOKEN || env.GITHUB_UPLOAD_TOKEN || '';

/** Prefixos de URL do GitHub que precisam virar `https://<token>@github.com/`. */
const PREFIXOS = [
    'git+ssh://git@github.com/',
    'ssh://git@github.com/',
    'git+https://github.com/',
    'https://github.com/',
    'git@github.com:'
];

/**
 * Devolve uma CÓPIA do ambiente com a reescrita `insteadOf` configurada.
 *
 * Sem token, devolve o ambiente intacto (o install segue e falha com o erro
 * normal do git — que é mais claro do que um token vazio na URL).
 *
 * @param {string} token
 * @param {NodeJS.ProcessEnv} [baseEnv]
 * @returns {NodeJS.ProcessEnv}
 */
export const envComCredencialGit = (token, baseEnv = process.env) => {
    const env = { ...baseEnv };
    if (!token) return env;

    const base = `https://${token}@github.com/`;
    // Preserva uma configuração GIT_CONFIG_* já existente (não sobrescreve).
    let n = Number.parseInt(env.GIT_CONFIG_COUNT || '0', 10);
    if (!Number.isFinite(n) || n < 0) n = 0;

    for (const prefixo of PREFIXOS) {
        env[`GIT_CONFIG_KEY_${n}`] = `url.${base}.insteadOf`;
        env[`GIT_CONFIG_VALUE_${n}`] = prefixo;
        n += 1;
    }
    env.GIT_CONFIG_COUNT = String(n);
    return env;
};
