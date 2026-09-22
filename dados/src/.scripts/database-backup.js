/**
 * Backup COMPLETO de `dados/database` — criado antes de qualquer operação
 * destrutiva do atualizador (`git reset --hard`) e restaurado depois.
 *
 * Por que existe
 * --------------
 * `dados/database` guarda o estado operacional do bot (economia, grupos,
 * contadores, configs). Ele está parcialmente RASTREADO pelo Git, então um
 * `git reset --hard origin/main` sobrescreveria esse estado com o do repositório
 * — perda de dados. O backup preserva o estado REAL e o restore garante:
 *
 *     código  = origin/main
 *     database = estado anterior do bot
 *
 * Por que o backup é RECURSIVO (e não só a lista de `git status`)
 * ---------------------------------------------------------------
 * `git status` não enxerga arquivos IGNORADOS pelo `.gitignore` (e dentro de
 * `dados/database` existe muito arquivo assim). Um backup baseado só na lista do
 * Git perderia justamente esses. Aqui o diretório inteiro é copiado —
 * rastreados, não rastreados, novos, modificados e ignorados.
 *
 * Módulo puro (fs apenas), sem git e sem processo — testável direto.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';

/** Caminho do banco, relativo à raiz do projeto (cwd do atualizador). */
export const DB_DIR = 'dados/database';

/** Lista recursiva de arquivos (relativos), pulando nada. */
const listarArquivos = (raiz) => {
    const out = [];
    if (!fs.existsSync(raiz)) return out;
    const walk = (dir) => {
        for (const entrada of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entrada.name);
            if (entrada.isDirectory()) walk(full);
            else if (entrada.isFile()) out.push(path.relative(raiz, full));
        }
    };
    walk(raiz);
    return out;
};

/**
 * Cria um backup COMPLETO de `dados/database`.
 *
 * @param {object} [opts]
 * @param {string} [opts.cwd] raiz do projeto (padrão process.cwd())
 * @param {string} [opts.dir] diretório do banco, relativo a `cwd`
 * @returns {{ok: true, backupDir: string, count: number, arquivos: string[]}
 *          | {ok: false, reason: string, detalhe?: string}}
 */
export const criarBackupDatabase = (opts = {}) => {
    const cwd = opts.cwd || process.cwd();
    const dir = opts.dir || DB_DIR;
    const origem = path.join(cwd, dir);

    // O banco pode não existir ainda (bot recém-clonado). Isso não é falha do
    // backup — é ausência de estado a preservar. Vira um backup vazio válido.
    const arquivos = listarArquivos(origem);

    try {
        const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lizzy-db-backup-'));
        for (const rel of arquivos) {
            const destino = path.join(backupDir, rel);
            fs.mkdirSync(path.dirname(destino), { recursive: true });
            fs.copyFileSync(path.join(origem, rel), destino);
        }
        return { ok: true, backupDir, count: arquivos.length, arquivos };
    } catch (e) {
        return { ok: false, reason: 'backup_falhou', detalhe: e?.message || String(e) };
    }
};

/**
 * Valida um backup: existe, é um diretório e o número de arquivos bate.
 *
 * A validação compara a CONTAGEM com o que foi copiado — é o que prova que o
 * backup representa o estado, e não um diretório vazio por engano.
 *
 * @returns {{ok: boolean, count?: number, reason?: string}}
 */
export const validarBackupDatabase = (backup) => {
    if (!backup?.ok || !backup.backupDir) return { ok: false, reason: 'backup_inexistente' };
    try {
        if (!fs.existsSync(backup.backupDir) || !fs.statSync(backup.backupDir).isDirectory()) {
            return { ok: false, reason: 'diretorio_ausente' };
        }
        const count = listarArquivos(backup.backupDir).length;
        if (count !== backup.count) return { ok: false, reason: 'contagem_divergente', count };
        return { ok: true, count };
    } catch (e) {
        return { ok: false, reason: 'validacao_falhou', count: -1 };
    }
};

/**
 * Restaura o backup SOBRE `dados/database`.
 *
 * Não apaga o diretório antes: sobrescreve arquivo a arquivo, para que um
 * arquivo do banco que NÃO esteja no backup (criado pelo bot durante a
 * atualização) não seja removido por acidente.
 *
 * @returns {{ok: true, count: number} | {ok: false, reason: string, detalhe?: string}}
 */
export const restaurarBackupDatabase = (backup, opts = {}) => {
    const cwd = opts.cwd || process.cwd();
    const dir = opts.dir || DB_DIR;
    const destinoRaiz = path.join(cwd, dir);

    if (!backup?.ok || !backup.backupDir) return { ok: false, reason: 'backup_inexistente' };
    try {
        fs.mkdirSync(destinoRaiz, { recursive: true });
        let count = 0;
        for (const rel of backup.arquivos) {
            const origem = path.join(backup.backupDir, rel);
            if (!fs.existsSync(origem)) continue;
            const destino = path.join(destinoRaiz, rel);
            fs.mkdirSync(path.dirname(destino), { recursive: true });
            fs.copyFileSync(origem, destino);
            count += 1;
        }
        return { ok: true, count };
    } catch (e) {
        return { ok: false, reason: 'restore_falhou', detalhe: e?.message || String(e) };
    }
};

/**
 * Valida a restauração: o banco existe e os arquivos esperados estão lá.
 *
 * @returns {{ok: boolean, count?: number, faltando?: string[], reason?: string}}
 */
export const validarRestauracaoDatabase = (backup, opts = {}) => {
    const cwd = opts.cwd || process.cwd();
    const dir = opts.dir || DB_DIR;
    const raiz = path.join(cwd, dir);

    if (!backup?.ok) return { ok: false, reason: 'backup_inexistente' };
    if (!fs.existsSync(raiz)) return { ok: false, reason: 'banco_ausente' };

    const presentes = new Set(listarArquivos(raiz));
    const faltando = backup.arquivos.filter((rel) => !presentes.has(rel));
    if (faltando.length > 0) return { ok: false, reason: 'arquivos_faltando', faltando, count: presentes.size };
    return { ok: true, count: presentes.size };
};

/** Remove o backup (só após restore + validação de SHA). Nunca lança. */
export const descartarBackupDatabase = (backup) => {
    try {
        if (backup?.backupDir) fs.rmSync(backup.backupDir, { recursive: true, force: true });
        return true;
    } catch {
        return false;
    }
};
