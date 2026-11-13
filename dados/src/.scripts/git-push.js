/**
 * Publicação (push) do estado local para a `main` remota.
 *
 * Por que existe: o `!atualizar` só PUBLICA o que já está na `main` (fetch +
 * reset --hard). Este módulo cobre o caminho inverso — enviar as alterações
 * locais para o remoto — reaproveitando o MESMO contrato do `git-sync.js`:
 * o `spawn` do git é INJETÁVEL, então as decisões são testáveis sem tocar num
 * repositório real, e o SHA só aparece no log interno (a interface mostra o
 * NOME do commit).
 *
 * ## Credencial (repositório privado)
 *
 * O repo do bot é privado, então o `git push` exige autenticação. O token vem
 * do `.env`/ambiente (`GITHUB_PUSH_TOKEN`, com fallback para os tokens que o
 * bot já usa), NUNCA do código. Ele monta a URL autenticada do remote SÓ
 * durante o push, e o remote ORIGINAL é restaurado no `finally` — o token não
 * fica gravado no `.git/config` (que iria para o backup de quem clonar a
 * pasta). Mesma estratégia do sync no boot (`start.js`).
 */

import { validarGit, extrairRepo, nomeDoCommit } from './git-sync.js';
import fs from 'fs';
import os from 'os';
import path from 'path';

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

/** O token nunca aparece inteiro no log. */
export const mascararToken = (t) => (t && t.length > 10 ? `${t.slice(0, 4)}...${t.slice(-4)}` : '(não definido)');

/**
 * Token de push, na ordem de prioridade do bot.
 *
 * `GITHUB_PUSH_TOKEN` é a variável dedicada (documentada no `.env.example`);
 * as outras são as que o bot já usa, para um deploy existente não precisar
 * configurar nada novo.
 */
export const resolverToken = (env = process.env) =>
    env.GITHUB_PUSH_TOKEN || env.GITHUB_SYNC_TOKEN || env.GITHUB_TOKEN || env.GITHUB_UPLOAD_TOKEN || '';

/**
 * Mensagem de commit limpa: uma linha só, sem espaços duplicados e com teto.
 * Um `\n` no `-m` viraria um corpo de commit acidental.
 */
export const limparMensagem = (msg = '', max = 200) => {
    const uma = String(msg).replace(/\s+/g, ' ').trim();
    return uma.length > max ? `${uma.slice(0, max - 1)}…` : uma;
};

/**
 * URL do remote com a credencial embutida, para o push num repo privado.
 *
 * @param {string} url remote atual (https ou ssh)
 * @param {string} token
 * @param {string|null} repo `owner/repo`
 * @returns {string|null} null quando não há como montar (sem token/repo)
 */
export const remoteComCredencial = (url, token, repo) => {
    if (!token || typeof url !== 'string') return null;
    // Preferência: injetar o token na URL https EXISTENTE (preserva host/caminho
    // reais — o guard de remote já validou que é o repositório esperado).
    if (/^https?:\/\//.test(url)) {
        return url.replace(/^https?:\/\/([^@/]+@)?/, `https://${token}@`);
    }
    // Remote ssh: monta a URL https autenticada a partir de `owner/repo`.
    if (/^(git@|ssh:\/\/)/.test(url) && repo) {
        return `https://${token}@github.com/${repo}.git`;
    }
    // Remote local (caminho ou file://) não precisa de credencial.
    return null;
};

/**
 * A linha do `status --porcelain` aponta para um arquivo de SEGREDO de ambiente?
 *
 * Bloqueia `.env` e variantes (`.env.local`, `sub/.env`), mas LIBERA o
 * `.env.example` (que é versionado de propósito). O `.env` guarda as chaves do
 * servidor; se algum dia sair do `.gitignore`, o commit não pode acontecer.
 */
export const ehArquivoEnvSensivel = (linha) => {
    // `status --porcelain` começa com 2 colunas de status + espaço, mas o stdout
    // do git passa por `trim()` no runner — então a coluna da esquerda pode
    // sumir (` M .env` -> `M .env`). Removemos um status de 1-2 chars de forma
    // tolerante, sem depender da largura exata nem do trim.
    const p = String(linha).replace(/^\s*[A-Z?!]{1,2}\s+/, '').replace(/^"(.*)"$/, '$1').trim();
    if (/(^|\/)\.env\.example$/.test(p)) return false;
    return /(^|\/)\.env(\.|$)/.test(p);
};

/**
 * Publica as alterações locais: stage + commit + push, com a credencial do
 * `.env`. Nunca publica o `.env`; restaura o remote original ao final.
 *
 * @param {object} params
 * @param {Function} params.spawn exec injetável (mesmo contrato do git-sync)
 * @param {string} [params.branch] branch esperada
 * @param {string|null} [params.repo] `owner/repo` esperado (valida o remote)
 * @param {string} [params.token] credencial de push
 * @param {string} [params.mensagem] mensagem de commit
 * @param {Function} [params.log] log de diagnóstico (SHA pode aparecer aqui)
 * @param {Function} [params.onEtapa] callback `(etapa, dados)` p/ a interface
 * @returns {Promise<{ok:boolean, etapa?:string, nada?:boolean, nome?:string,
 *                    sha?:string, arquivos?:number, repo?:string|null, branch?:string}>}
 */
export const publicar = async ({
    spawn,
    branch = 'main',
    repo = null,
    token = '',
    mensagem = '',
    log = () => {},
    onEtapa = () => {}
}) => {
    const git = gitRunner(spawn);
    const falhar = (etapa, extra = {}) => ({ ok: false, etapa, ...extra });

    // 1) GIT
    const g = await validarGit(spawn);
    if (!g.ok) return falhar('GIT');
    log(`[UPDATE] Git: ${g.version}`);

    // 2) REMOTE / BRANCH
    const url = await git(['remote', 'get-url', 'origin']);
    if (!url.ok || !url.stdout) return falhar('REMOTE', { detalhe: url.error });

    const branchR = await git(['branch', '--show-current']);
    const branchAtual = (branchR.stdout || branch).trim();
    const repoAtual = extrairRepo(url.stdout);

    if (repo && repoAtual && repoAtual.toLowerCase() !== String(repo).toLowerCase()) {
        return falhar('REMOTE', { detalhe: `${repoAtual} (esperado ${repo})` });
    }
    log(`[UPDATE] Remote: ${repoAtual || url.stdout}`);
    log(`[UPDATE] Branch: ${branchAtual}`);

    // 3) O QUE MUDOU?
    const status = await git(['status', '--porcelain']);
    if (!status.ok) return falhar('STATUS', { detalhe: status.stderr || status.error });

    const linhas = status.stdout ? status.stdout.split('\n').filter(Boolean) : [];
    if (linhas.length === 0) {
        log('[UPDATE] Nada para publicar (árvore limpa)');
        return { ok: true, nada: true, repo: repoAtual, branch: branchAtual, arquivos: 0 };
    }
    const arquivos = linhas.length;
    log(`[UPDATE] Arquivos alterados: ${arquivos}`);

    // Trava de segurança: o `.env` guarda os segredos do servidor. Ele já está
    // no `.gitignore`, mas se algum dia sair de lá o commit não pode acontecer.
    if (linhas.some((l) => ehArquivoEnvSensivel(l))) {
        return falhar('SEGURANÇA', { detalhe: 'o .env apareceu como alterado — publicação abortada por segurança' });
    }

    // 4) STAGE + COMMIT
    const add = await git(['add', '-A'], { timeout: 60000 });
    if (!add.ok) return falhar('ADD', { detalhe: add.stderr || add.error });

    const titulo = limparMensagem(mensagem) || 'chore: publicar alterações locais via !atualizar';
    // A mensagem vai por ARQUIVO (`-F`), não por argumento: o spawn do git roda
    // com `shell: true` (contrato do `update.js`), e uma mensagem com espaços
    // seria quebrada em vários "pathspec" pela shell.
    const msgFile = path.join(os.tmpdir(), `lizzy-commit-${process.pid}-${Date.now()}.txt`);
    let commit;
    try {
        fs.writeFileSync(msgFile, `${titulo}\n`);
        commit = await git(['commit', '-F', msgFile], { timeout: 120000 });
    } finally {
        try { fs.rmSync(msgFile, { force: true }); } catch { /* best-effort */ }
    }
    if (!commit.ok) return falhar('COMMIT', { detalhe: commit.stderr || commit.error });

    const shaR = await git(['rev-parse', 'HEAD']);
    const sha = (shaR.stdout || '').slice(0, 7);
    const nome = await nomeDoCommit(spawn, 'HEAD');
    log(`[UPDATE] Commit criado: ${nome} (${sha})`);
    onEtapa('commit', { arquivos, nome });

    // 5) PUSH (com credencial temporária; remote restaurado no finally)
    const autenticada = remoteComCredencial(url.stdout, token, repoAtual || repo);
    if (token && autenticada) {
        log(`[UPDATE] Credencial: ${mascararToken(token)}`);
        const set = await git(['remote', 'set-url', 'origin', autenticada]);
        if (!set.ok) return falhar('REMOTE', { detalhe: set.stderr || set.error });
    } else if (!token) {
        log('[UPDATE] Aviso: nenhum token de push no ambiente (.env)');
    }

    let push;
    try {
        push = await git(['push', 'origin', branchAtual], { timeout: 180000 });
    } finally {
        if (token && autenticada) {
            // Best-effort: devolve o remote original (o token não fica no .git/config).
            await git(['remote', 'set-url', 'origin', url.stdout]);
        }
    }

    if (!push.ok) {
        const det = String(push.stderr || push.error || '');
        if (/rejected|non-fast-forward|fetch first|behind/i.test(det)) {
            return falhar('PUSH', { detalhe: 'o remoto está à frente — rode `!atualizar` (pull) antes de publicar' });
        }
        return falhar('PUSH', { detalhe: det });
    }

    log('[UPDATE] Push concluído');
    return { ok: true, nada: false, repo: repoAtual, branch: branchAtual, sha, nome, arquivos };
};
