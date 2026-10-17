#!/usr/bin/env node
/**
 * Atualizador da Lizzy — sincronização DETERMINÍSTICA com `origin/main`.
 *
 * Contrato (o que define "atualizado"):
 *   HEAD === origin/main   (comparado por SHA COMPLETO)
 *
 * O antigo `git pull` (merge) foi trocado por: fetch + comparação de SHA +
 * `git reset --hard origin/main` + restore do database + validação final de SHA.
 * Motivo: o pull podia "terminar sem erro" deixando a árvore fora do
 * `origin/main` (o bot tem estado local sujo no `dados/database` e o npm reescreve
 * o `package-lock.json`), e aí o bot ficava um commit atrasado para sempre.
 *
 * A interface do `!atualizar` consome as linhas `[UPDATE]` e as linhas
 * `UI:...` deste script. SHA só aparece nas linhas `[UPDATE]` (diagnóstico);
 * as linhas `UI:` carregam NOME de commit e nunca SHA.
 */

import { execFile } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { gitDependencyDrifts } from './git-drift.js';
import { sincronizarCodigo } from './git-sync.js';
import {
    DB_DIR,
    criarBackupDatabase,
    validarBackupDatabase,
    restaurarBackupDatabase,
    validarRestauracaoDatabase,
    descartarBackupDatabase
} from './database-backup.js';

// Origem esperada do CÓDIGO do bot. O padrão é o repositório oficial; um
// `LIZZY_UPDATE_REMOTE` permite rodar num fork/host próprio sem a validação
// recusar a origem legítima daquele deploy.
const REPO_FORK = 'Souzzaaxzy/baileys';
const REPO_BOT = process.env.LIZZY_UPDATE_REMOTE || 'Souzzaaxzy/Lizzy-V4';
const BRANCH = process.env.LIZZY_UPDATE_BRANCH || 'main';

const execAsync = (cmd, args = [], opts = {}) => new Promise((resolve, reject) => {
    execFile(cmd, args, { shell: true, timeout: 600000, ...opts }, (error, stdout, stderr) => {
        // stdout vai anexado mesmo no erro: `npm ls --all` sai com exit 1 quando há
        // problemas, mas ainda imprime o JSON que precisamos ler.
        if (error) reject(Object.assign(error, { stdout, stderr }));
        else resolve({ stdout, stderr });
    });
});

const spawnGit = (cmd, args, opts) => execAsync(cmd, args, opts);
const log = (linha) => console.log(linha);

/** Linha consumida pela interface (nunca contém SHA). */
const ui = (tipo, dados) => log(`UI:${tipo}:${JSON.stringify(dados)}`);

/** Saída estruturada de erro: a interface mostra a ETAPA que falhou. */
const falhar = (etapa, extra = {}) => {
    ui('ERRO', { etapa, repoBot: REPO_BOT, repoFork: REPO_FORK, branch: BRANCH, ...extra });
    process.exit(1);
};

async function isAvailable(cmd, args = ['--version']) {
    try {
        await execAsync(cmd, args, { timeout: 15000 });
        return true;
    } catch {
        return false;
    }
}

// ---------------------------------------------------------------------------
// Dependências Node (mantém a lógica anterior: drift de commit da fork)
// ---------------------------------------------------------------------------
async function nodeDeps() {
    // `npm ls --depth=0` não detecta dependência TRANSITIVA faltando (devolve
    // exit 0), então usamos a lista `problems` do `npm ls --all`, ignorando o
    // peer opcional `sharp@*` (não é instalado de propósito).
    let treeOk = false;
    try {
        let report;
        try {
            ({ stdout: report } = await execAsync('npm', ['ls', '--all', '--json'], { timeout: 120000 }));
        } catch (error) {
            report = error?.stdout;
        }
        const problems = report ? (JSON.parse(report).problems ?? []) : ['npm ls não retornou dados'];
        treeOk = problems.filter((p) => !String(p).includes('sharp')).length === 0;
    } catch {
        treeOk = false;
    }

    const drifts = fs.existsSync('node_modules') ? gitDependencyDrifts(process.cwd()) : [];

    if (treeOk && fs.existsSync('node_modules') && !drifts.length) {
        log('Dependências já atualizadas');
        return;
    }

    if (drifts.length) {
        log('Dependência(s) de git em commit desatualizado:');
        for (const d of drifts) {
            log(`  ${d.pacote}: instalado ${d.instalado} | esperado ${d.esperado}`);
        }
    }

    log('Instalando dependências');
    try {
        await execAsync('npm', ['install', '--legacy-peer-deps', '--allow-git=all'], { timeout: 600000 });
    } catch {
        await execAsync('npm', ['install', '--allow-git=all'], { timeout: 600000 });
    }
    // O npm NÃO cria `node_modules` quando não há nada a instalar. Exigir o
    // diretório sempre daria um falso "npm install falhou" num projeto sem
    // dependências — só faz sentido cobrá-lo se o package.json declarar alguma.
    if (temDependencias() && !fs.existsSync('node_modules')) {
        throw new Error('npm install terminou mas node_modules não foi criado');
    }
    log('Dependências instaladas');
}

/** O package.json declara dependências (deps, devDeps, optional, peer)? */
function temDependencias(cwd = process.cwd()) {
    try {
        const pkg = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf-8'));
        for (const campo of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
            if (pkg?.[campo] && Object.keys(pkg[campo]).length > 0) return true;
        }
        return false;
    } catch {
        return false;
    }
}

/**
 * Valida que TODAS as dependências git INSTALADAS estão no commit pedido pelo
 * `package-lock.json`.
 * `npm ls` compara versão, não commit — a fork do Baileys mantém `0.3.18-final`
 * e o `lizzy-call` mantém `0.2.0` entre commits, então esta é a única checagem
 * que pega uma dependência no commit errado.
 */
function validarForkInstalada() {
    const drifts = fs.existsSync('node_modules') ? gitDependencyDrifts(process.cwd()) : [];
    if (!drifts.length) {
        log('[UPDATE] Dependências git validadas');
        return true;
    }
    for (const d of drifts) {
        log(`[UPDATE] ${d.pacote} em commit diferente do esperado (${d.instalado} != ${d.esperado})`);
    }
    return false;
}

/**
 * Título do commit da fork pedido pelo `package-lock.json`.
 *
 * A fork não está clonada aqui (é dependência, não o repo do bot), então o
 * título é buscado na API pública do GitHub. É best-effort: sem rede/token o
 * rótulo fica genérico — e o SHA NUNCA vai para a UI, só o nome.
 */
async function nomeCommitFork() {
    // Commit da FORK especificamente: `gitDependencyDrift` agora varre TODAS as
    // dependências git, então pegar o `esperado` genérico poderia devolver o
    // commit do `lizzy-call` — e a API seria consultada no repositório errado.
    const esperado = (() => {
        try {
            const lock = JSON.parse(fs.readFileSync('package-lock.json', 'utf-8'));
            return lock?.packages?.['node_modules/@itsliaaa/baileys']?.resolved?.split('#')[1] || null;
        } catch { return null; }
    })();

    if (esperado) {
        try {
            const headers = { Accept: 'application/vnd.github+json' };
            if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
            const res = await fetch(`https://api.github.com/repos/${REPO_FORK}/commits/${esperado}`, {
                headers,
                signal: AbortSignal.timeout(15000)
            });
            if (res.ok) {
                const j = await res.json();
                const titulo = String(j?.commit?.message || '').split('\n')[0].trim();
                if (titulo) return titulo;
            }
        } catch { /* sem rede: cai no rótulo genérico */ }
    }
    return `Fork no commit esperado pelo package-lock`;
}

// ---------------------------------------------------------------------------
// yt-dlp / FFmpeg (inalterado)
// ---------------------------------------------------------------------------
async function ytDlp() {
    const homeBin = path.join(os.homedir(), '.local', 'bin');
    const localBin = path.join(homeBin, 'yt-dlp');
    if (await isAvailable('yt-dlp')) { log('yt-dlp encontrado'); return; }
    if (await isAvailable('python3', ['-m', 'yt_dlp', '--version'])) { log('yt-dlp encontrado (python3 -m yt_dlp)'); return; }
    if (await isAvailable(localBin)) { log('yt-dlp encontrado (~/.local/bin)'); return; }

    const variant = (await isAvailable('python3')) ? 'python3' : (await isAvailable('python')) ? 'python' : null;
    if (variant) {
        log('Instalando yt-dlp');
        const pip = async (args) => { try { await execAsync(variant, args, { timeout: 300000 }); return true; } catch { return false; } };
        const pipOk =
            (await pip(['-m', 'pip', 'install', '-U', 'yt-dlp'])) ||
            (await pip(['-m', 'pip', 'install', '--user', '-U', 'yt-dlp'])) ||
            ((await pip(['-m', 'ensurepip', '--user'])) && (await pip(['-m', 'pip', 'install', '--user', '-U', 'yt-dlp'])));
        if (pipOk) { log('yt-dlp instalado'); return; }
        log('Aviso: pip indisponível — baixando binário standalone oficial...');
    }

    try {
        fs.mkdirSync(homeBin, { recursive: true });
        const url = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp';
        const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(120000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        fs.writeFileSync(localBin, Buffer.from(await res.arrayBuffer()), { mode: 0o755 });
        if (await isAvailable(localBin)) { log(`yt-dlp instalado (binário) em ${localBin}`); return; }
        throw new Error('binário baixado não executou');
    } catch (err) {
        log('Aviso: falha ao instalar yt-dlp automaticamente:', err.message);
    }
}

async function ffmpeg() {
    if (process.env.FFMPEG_PATH) { log('FFmpeg configurado via FFMPEG_PATH'); return; }
    if (await isAvailable('ffmpeg', ['-version'])) { log('FFmpeg encontrado'); return; }
    log('Aviso: FFmpeg não encontrado no PATH — instale pelo gerenciador de pacotes do sistema ou defina FFMPEG_PATH');
}

// ---------------------------------------------------------------------------
// Fluxo principal
// ---------------------------------------------------------------------------
async function main() {
    // ── BACKUP OBRIGATÓRIO DO DATABASE (antes de qualquer coisa destrutiva)
    log('[UPDATE] Backup database iniciado');
    const backup = criarBackupDatabase({ cwd: process.cwd(), dir: DB_DIR });
    if (!backup.ok) {
        log(`[UPDATE] Backup falhou: ${backup.detalhe || backup.reason}`);
        falhar('BACKUP', { detalhe: backup.detalhe });
    }
    log(`[UPDATE] Database encontrado (${backup.count} arquivo(s))`);

    const check = validarBackupDatabase(backup);
    if (!check.ok) {
        log(`[UPDATE] Backup inválido: ${check.reason}`);
        falhar('BACKUP', { detalhe: check.reason });
    }
    log(`[UPDATE] Arquivos preservados: ${check.count}`);
    log('[UPDATE] Backup database validado');
    ui('BACKUP', { count: check.count });

    // ── Sincronização determinística (fetch + reset --hard + validação de SHA)
    const sync = await sincronizarCodigo({
        spawn: spawnGit,
        branch: BRANCH,
        // A sincronização é do repositório do BOT (é ele que está clonado aqui);
        // REPO_FORK é a dependência, validada pelo gitDependencyDrift.
        remoteEsperado: REPO_BOT,
        log,
        onEtapa: (etapa, dados) => {
            if (etapa === 'estado') ui('ESTADO', dados);
        }
    });

    if (!sync.ok) {
        log('[UPDATE] Backup do database preservado');
        // O backup NÃO é apagado: a árvore pode ter mudado antes da falha.
        falhar(sync.etapa, {
            localNome: sync.antes?.localNome,
            remoteNome: sync.depois?.remoteNome || sync.antes?.remoteNome
        });
    }

    log(`[UPDATE] Repositório sincronizado (${sync.jaAtualizado ? 'já atualizado' : 'atualizado'})`);

    // ── RESTORE do database (o reset pode ter sobrescrito arquivos rastreados)
    log('[UPDATE] Restore database iniciado');
    const restore = restaurarBackupDatabase(backup, { cwd: process.cwd(), dir: DB_DIR });
    if (!restore.ok) {
        log(`[UPDATE] Restore falhou: ${restore.detalhe || restore.reason}`);
        log('[UPDATE] Backup do database preservado');
        falhar('RESTORE', { detalhe: restore.detalhe || restore.reason });
    }
    log(`[UPDATE] Arquivos restaurados: ${restore.count}`);
    log('[UPDATE] Database restaurado');

    const restaOk = validarRestauracaoDatabase(backup, { cwd: process.cwd(), dir: DB_DIR });
    if (!restaOk.ok) {
        log(`[UPDATE] Database inválido após restore: ${restaOk.reason}`);
        log('[UPDATE] Backup do database preservado');
        falhar('RESTORE', { detalhe: restaOk.reason });
    }
    log('[UPDATE] Database validado');
    ui('DATABASE', { count: restaOk.count });

    // ── Dependências (mantém a lógica de drift de commit da fork)
    try {
        await nodeDeps();
    } catch (e) {
        log('[UPDATE] Backup do database preservado');
        falhar('DEPENDÊNCIAS', { detalhe: e?.message });
    }

    if (!validarForkInstalada()) {
        log('[UPDATE] Backup do database preservado');
        falhar('BAILEYS', { detalhe: 'commit instalado difere do esperado pelo package-lock.json' });
    }

    // ── FFmpeg / yt-dlp (não abortam: são avisos, como antes)
    await ffmpeg();
    await ytDlp();

    // ── Tudo confirmado → o backup pode ser descartado.
    descartarBackupDatabase(backup);

    ui('OK', {
        repoBot: REPO_BOT,
        repoFork: REPO_FORK,
        branch: BRANCH,
        localNome: sync.depois?.localNome || sync.antes?.localNome,
        remoteNome: sync.depois?.remoteNome || sync.antes?.remoteNome,
        forkNome: await nomeCommitFork(),
        jaAtualizado: Boolean(sync.jaAtualizado),
        databaseArquivos: restaOk.count
    });
    log('Atualização aplicada');
    process.exit(0);
}

main().catch((error) => {
    console.error('Erro:', error.message);
    falhar('VALIDAÇÃO', { detalhe: error?.message });
});
