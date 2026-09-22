/**
 * Sincronização determinística com a `main` remota.
 *
 * Substitui o `git pull` do atualizador. Por que:
 * -----------------------------------------------------------------------------
 * `git pull` faz MERGE. Quando o bot tem estado local sujo (o próprio bot grava
 * em `dados/database`, e o `npm install` reescreve o `package-lock.json`), o
 * merge pode concluir "com sucesso" deixando a árvore num estado que NÃO é o
 * `origin/main` — e, pior, o pull seguinte parte desse estado intermediário.
 * Era a origem do sintoma "fica sempre um commit atrasado":
 *
 *     fork:  A → B → C → D
 *     bot :  A → B → C          (!atualizar não chega em D)
 *
 * Aqui o alvo é explícito: `HEAD === origin/main`, comparado por SHA COMPLETO,
 * e a sincronização é por `git reset --hard origin/main` (sem merge). O estado
 * do bot é preservado pelo backup do `dados/database`, não pelo merge.
 *
 * SHA x INTERFACE: o SHA é usado só internamente (comparação/log de
 * diagnóstico). O que aparece para o usuário é o NOME do commit, obtido com
 * `git log -1 --pretty=%s`.
 *
 * Módulo com I/O de processo (git) injetável — `exec` pode ser trocado nos
 * testes, então as decisões são testáveis sem tocar num repositório real.
 */

/** Executa git e devolve stdout cru (com trim). Erros viram `{ok:false}`. */
const gitRunner = (spawn) => async (args, opts = {}) => {
    try {
        const { stdout } = await spawn('git', args, opts);
        return { ok: true, stdout: String(stdout ?? '').trim() };
    } catch (e) {
        return {
            ok: false,
            error: e?.message || String(e),
            stdout: String(e?.stdout ?? '').trim(),
            stderr: String(e?.stderr ?? '').trim()
        };
    }
};

/**
 * Extrai `owner/repo` de uma URL de remote.
 *
 * Suporta `https://github.com/owner/repo(.git)` e `git@github.com:owner/repo.git`.
 * O HOST não entra no resultado (o primeiro candidato do regex antigo pegava
 * `github.com/owner/repo`, o que fazia a validação de remote recusar uma origem
 * correta). Pega sempre os dois últimos segmentos de caminho.
 *
 * @returns {string|null}
 */
export const extrairRepo = (url) => {
    if (!url) return null;
    const limpa = String(url).trim().replace(/\.git$/, '').replace(/\/+$/, '');
    // Depois do host: "https://host/a/b" -> "a/b"; "git@host:a/b" -> "a/b"
    const caminho = limpa.replace(/^[a-zA-Z]+:\/\/[^/]+\//, '').replace(/^[^@]+@[^:]+:/, '');
    const partes = caminho.split('/').filter(Boolean);
    if (partes.length < 2) return null;
    return `${partes[partes.length - 2]}/${partes[partes.length - 1]}`;
};

/**
 * Verifica se o git está disponível.
 * @returns {Promise<{ok: boolean, version?: string, reason?: string}>}
 */
export const validarGit = async (spawn) => {
    const git = gitRunner(spawn);
    const r = await git(['--version'], { timeout: 15000 });
    if (!r.ok) return { ok: false, reason: 'git_ausente' };
    return { ok: true, version: r.stdout };
};

/**
 * Descobre remote/branch e valida se o remote é o esperado.
 *
 * @returns {Promise<{ok: true, remoteUrl: string, repo: string|null, branch: string}
 *          | {ok: false, reason: string, detalhe?: string}>}
 */
export const identificarOrigem = async (spawn, { esperado = null } = {}) => {
    const git = gitRunner(spawn);

    const url = await git(['remote', 'get-url', 'origin']);
    if (!url.ok || !url.stdout) return { ok: false, reason: 'sem_remote', detalhe: url.error };

    const branch = await git(['branch', '--show-current']);
    if (!branch.ok || !branch.stdout) return { ok: false, reason: 'sem_branch', detalhe: branch.error };

    // Extrai owner/repo dos dois formatos:
    //   https://github.com/owner/repo(.git)
    //   git@github.com:owner/repo.git
    // Pega os DOIS últimos segmentos de caminho (o host não entra).
    const repo = extrairRepo(url.stdout);

    if (esperado && repo && repo.toLowerCase() !== String(esperado).toLowerCase()) {
        return { ok: false, reason: 'remote_inesperado', detalhe: `${repo} (esperado ${esperado})` };
    }

    return { ok: true, remoteUrl: url.stdout, repo, branch: branch.stdout };
};

/**
 * `git fetch origin <branch>` (com prune). Não faz merge de nada.
 */
export const fetchRemoto = async (spawn, branch = 'main') => {
    const git = gitRunner(spawn);
    const r = await git(['fetch', 'origin', branch, '--prune'], { timeout: 180000 });
    if (!r.ok) return { ok: false, reason: 'fetch_falhou', detalhe: r.stderr || r.error };
    return { ok: true };
};

/** Nome do commit (título) — fallback legível, nunca o SHA. */
export const nomeDoCommit = async (spawn, ref = 'HEAD') => {
    const git = gitRunner(spawn);
    const r = await git(['log', '-1', '--pretty=%s', ref]);
    if (!r.ok || !r.stdout) return 'Commit não identificado';
    return r.stdout;
};

/**
 * Lê o estado atual: SHA local, SHA remoto e os nomes dos dois commits.
 *
 * @returns {Promise<{ok:true, localSha:string, remoteSha:string,
 *                    localNome:string, remoteNome:string, sincronizado:boolean}>}
 */
export const lerEstado = async (spawn, branch = 'main') => {
    const git = gitRunner(spawn);
    const localSha = (await git(['rev-parse', 'HEAD'])).stdout || '';
    const remoteSha = (await git(['rev-parse', `origin/${branch}`])).stdout || '';
    const localNome = await nomeDoCommit(spawn, 'HEAD');
    const remoteNome = await nomeDoCommit(spawn, `origin/${branch}`);
    return {
        ok: true,
        localSha,
        remoteSha,
        localNome,
        remoteNome,
        sincronizado: Boolean(localSha) && localSha === remoteSha
    };
};

/**
 * Sincroniza a árvore com `origin/<branch>` exatamente (`reset --hard`).
 *
 * NÃO roda `git clean`: arquivos não rastreados do usuário não são apagados. O
 * `dados/database` é recuperado pelo backup fora daqui.
 */
export const sincronizarComRemoto = async (spawn, branch = 'main') => {
    const git = gitRunner(spawn);
    const r = await git(['reset', '--hard', `origin/${branch}`], { timeout: 120000 });
    if (!r.ok) return { ok: false, reason: 'reset_falhou', detalhe: r.stderr || r.error };
    return { ok: true };
};

/**
 * Fluxo completo de sincronização do CÓDIGO (sem tocar no database).
 *
 * O backup do database é responsabilidade do chamador: esta função nunca roda
 * antes de o backup existir e ser validado.
 *
 * @param {object} params
 * @param {Function} params.spawn exec injetável
 * @param {string} [params.branch]
 * @param {string|null} [params.remoteEsperado]
 * @param {Function} [params.log] log de diagnóstico (SHA pode aparecer aqui)
 * @param {Function} [params.onEtapa] callback `(etapa, dados)` p/ a interface
 * @returns {Promise<{ok:boolean, etapa?:string, ...}>}
 */
export const sincronizarCodigo = async ({
    spawn,
    branch = 'main',
    remoteEsperado = null,
    log = () => {},
    onEtapa = () => {}
}) => {
    const falhar = (etapa, extra = {}) => ({ ok: false, etapa, ...extra });

    // 1) GIT
    const git = await validarGit(spawn);
    if (!git.ok) return falhar('GIT');
    log(`[UPDATE] Git: ${git.version}`);

    // 2) REMOTE / BRANCH
    const origem = await identificarOrigem(spawn, { esperado: remoteEsperado });
    if (!origem.ok) return falhar('REMOTE', { detalhe: origem.detalhe });
    log(`[UPDATE] Remote: ${origem.remoteUrl}`);
    log(`[UPDATE] Branch: ${origem.branch}`);

    // 3) FETCH (sem merge)
    log('[UPDATE] Fetch iniciado');
    const fetch = await fetchRemoto(spawn, branch);
    if (!fetch.ok) return falhar('FETCH', { detalhe: fetch.detalhe });
    log('[UPDATE] Fetch concluído');

    // 4) ESTADO
    const antes = await lerEstado(spawn, branch);
    log(`[UPDATE] Local SHA: ${antes.localSha}`);
    log(`[UPDATE] Remote SHA: ${antes.remoteSha}`);
    log(`[UPDATE] Local commit name: ${antes.localNome}`);
    log(`[UPDATE] Remote commit name: ${antes.remoteNome}`);

    onEtapa('estado', {
        repo: origem.repo,
        branch,
        localNome: antes.localNome,
        remoteNome: antes.remoteNome,
        sincronizado: antes.sincronizado
    });

    // 5) JÁ SINCRONIZADO: nada destrutivo a fazer.
    if (antes.sincronizado) {
        log('[UPDATE] SHA validado (já sincronizado)');
        return { ok: true, jaAtualizado: true, ...origem, antes };
    }

    // 6) RESET --hard
    log(`[UPDATE] Reset para origin/${branch}`);
    const reset = await sincronizarComRemoto(spawn, branch);
    if (!reset.ok) return falhar('SINCRONIZAÇÃO', { detalhe: reset.detalhe, antes });

    // 7) VALIDAÇÃO FINAL (obrigatória)
    const depois = await lerEstado(spawn, branch);
    log(`[UPDATE] SHA final local: ${depois.localSha}`);
    log(`[UPDATE] SHA final remoto: ${depois.remoteSha}`);

    if (!depois.sincronizado) {
        return falhar('VALIDAÇÃO', { antes, depois });
    }
    log('[UPDATE] SHA validado');

    return { ok: true, jaAtualizado: false, ...origem, antes, depois };
};
