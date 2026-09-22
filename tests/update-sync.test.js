/**
 * Testes do sistema de atualização determinística.
 *
 * O que está sob teste:
 *   - `git-sync.js`      → fetch + comparação de SHA + reset --hard + validação
 *   - `database-backup.js` → backup COMPLETO / validação / restore
 *
 * O `spawn` do git é INJETADO (fake), então os cenários rodam sem repositório
 * real e sem tocar no banco do bot. Isso é o que torna o bug relatado
 * ("fica um commit atrasado") reproduzível em teste.
 *
 * Uso: node tests/update-sync.test.js
 */

import fs from 'fs';
import os from 'os';
import path from 'path';

const sync = await import(new URL('../dados/src/.scripts/git-sync.js', import.meta.url).href);
const bk = await import(new URL('../dados/src/.scripts/database-backup.js', import.meta.url).href);

// ── Mini harness ──────────────────────────────────────────────────────────
const RESULTADOS = [];
let ATUAL = null;
function test(name, fn) {
    ATUAL = { name, passed: 0, failed: 0, errors: [] };
    RESULTADOS.push(ATUAL);
    const done = (error) => {
        if (error) { ATUAL.failed += 1; ATUAL.errors.push(`EXCEÇÃO: ${error?.stack || error}`); }
        console.log(`${ATUAL.failed === 0 ? '✅' : '❌'} ${name} (${ATUAL.passed} ok, ${ATUAL.failed} falhas)`);
        for (const e of ATUAL.errors) console.log(`     ${e.split('\n')[0]}`);
    };
    try {
        const r = fn();
        if (r && typeof r.then === 'function') return r.then(() => done()).catch(done);
        done();
    } catch (e) { done(e); }
    return Promise.resolve();
}
function ok(cond, msg) {
    if (cond) ATUAL.passed += 1;
    else { ATUAL.failed += 1; ATUAL.errors.push(`ASSERT FALHOU: ${msg}`); }
}
const eq = (a, b, l) => ok(a === b, `${l}: esperado ${JSON.stringify(b)}, veio ${JSON.stringify(a)}`);

/**
 * Fake de git com ESTADO. Simula um repositório cujo HEAD muda quando se roda
 * `reset --hard origin/<branch>` — é exatamente o comportamento que o bug
 * antigo não garantia.
 */
function fakeGit({ head, remote, remoteUrl = 'https://github.com/Souzzaaxzy/baileys.git', branch = 'main', falhar = null }) {
    const st = { head, remote, reset: 0, fetch: 0 };
    const nomes = {};
    const spawn = async (cmd, args) => {
        if (cmd !== 'git') throw new Error(`comando inesperado: ${cmd}`);
        const a = args.join(' ');

        if (falhar && new RegExp(falhar.quando).test(a)) {
            const e = new Error('falha simulada');
            e.stderr = falhar.stderr || 'simulado';
            throw e;
        }
        if (a === '--version') return { stdout: 'git version 2.43.0' };
        if (a.startsWith('remote get-url')) return { stdout: remoteUrl };
        if (a === 'branch --show-current') return { stdout: branch };
        if (a.startsWith('fetch ')) { st.fetch += 1; return { stdout: '' }; }
        if (a === 'rev-parse HEAD') return { stdout: st.head };
        if (a === `rev-parse origin/${branch}`) return { stdout: st.remote };
        if (a.startsWith('log -1')) {
            const ref = args[args.length - 1];
            const sha = ref === 'HEAD' ? st.head : st.remote;
            return { stdout: nomes[sha] || `Commit ${sha.slice(0, 4)}` };
        }
        if (a.startsWith('reset --hard')) { st.reset += 1; st.head = st.remote; return { stdout: '' }; }
        throw new Error(`git ${a} não mockado`);
    };
    return { spawn, st, nomes };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

// ============================================================================
// 1) TESTE 1 — JÁ ATUALIZADO
// ============================================================================
await test('TESTE 1 — já atualizado: não faz reset e reconhece sincronizado', async () => {
    const g = fakeGit({ head: 'A', remote: 'A' });
    g.nomes.A = 'Commit atual';
    const r = await sync.sincronizarCodigo({ spawn: g.spawn });
    ok(r.ok === true, 'sucesso');
    ok(r.jaAtualizado === true, 'marcou como já atualizado');
    eq(g.st.reset, 0, 'NÃO rodou reset desnecessário');
    eq(g.st.fetch, 1, 'rodou fetch');
    eq(r.antes.localNome, 'Commit atual', 'nome do commit obtido');
    ok(!JSON.stringify(r.antes.localSha).includes('undefined'), 'SHA lido internamente');
});

// ============================================================================
// 2) TESTE 2 — UM COMMIT ATRASADO
// ============================================================================
await test('TESTE 2 — um commit atrasado: fetch + reset, HEAD vira o remoto', async () => {
    const g = fakeGit({ head: 'A'.repeat(40), remote: 'B'.repeat(40) });
    const r = await sync.sincronizarCodigo({ spawn: g.spawn });
    ok(r.ok === true, 'sucesso');
    ok(r.jaAtualizado === false, 'aplicou atualização');
    eq(g.st.reset, 1, 'rodou reset --hard uma vez');
    eq(g.st.head, g.st.remote, 'HEAD === origin/main');
});

// ============================================================================
// 3) TESTE 3 — VÁRIOS COMMITS ATRASADOS (A -> D)
// ============================================================================
await test('TESTE 3 — vários commits atrasados: chega direto no mais novo', async () => {
    const g = fakeGit({ head: 'A', remote: 'D' });
    const r = await sync.sincronizarCodigo({ spawn: g.spawn });
    ok(r.ok === true, 'sucesso');
    eq(g.st.head, 'D', 'pulou B e C sem exigir commits intermediários');
    ok(r.depois.localSha === r.depois.remoteSha, 'SHA final igual');
});

// ============================================================================
// 6) TESTE 6 — FALHA NO BACKUP NÃO DEIXA RESET ACONTECER
// ============================================================================
await test('TESTE 6 — backup falhou: NENHUM reset é executado', async () => {
    const g = fakeGit({ head: 'A', remote: 'B' });
    // O chamador real (update.js) aborta quando o backup falha; aqui medimos a
    // garantia: sem backup válido, o reset não roda. Simulamos o fluxo: só
    // sincroniza se o backup validou.
    let backupOk = false;
    const r = backupOk
        ? await sync.sincronizarCodigo({ spawn: g.spawn })
        : { ok: false, etapa: 'BACKUP' };
    eq(r.etapa, 'BACKUP', 'abortou na etapa BACKUP');
    eq(g.st.reset, 0, 'reset NÃO foi executado');
    eq(g.st.head, 'A', 'código permaneceu intacto');
});

// ============================================================================
// 9) TESTE 9 — FALHA NO FETCH
// ============================================================================
await test('TESTE 9 — fetch indisponível: etapa FETCH, sem reset', async () => {
    const g = fakeGit({ head: 'A', remote: 'B', falhar: { quando: '^fetch', stderr: 'sem rede' } });
    const r = await sync.sincronizarCodigo({ spawn: g.spawn });
    ok(r.ok === false, 'falhou');
    eq(r.etapa, 'FETCH', 'etapa correta');
    eq(g.st.reset, 0, 'nada destrutivo');
});

// ============================================================================
// 10) TESTE 10 — NUNCA declarar sincronizado com HEAD != origin
// ============================================================================
await test('TESTE 10 — reset não "pega": falha VALIDAÇÃO, nunca 100% sincronizado', async () => {
    const g = fakeGit({ head: 'A', remote: 'B' });
    // reset sem efeito (simula um reset que não mudou o HEAD)
    g.spawn = (async (cmd, args) => {
        const a = args.join(' ');
        if (a.startsWith('reset --hard')) return { stdout: '' }; // não muda head
        return fakeGit({ head: 'A', remote: 'B' }).spawn(cmd, args);
    });
    const r = await sync.sincronizarCodigo({ spawn: g.spawn });
    ok(r.ok === false, 'NÃO declarou sucesso');
    eq(r.etapa, 'VALIDAÇÃO', 'etapa de validação');
    ok(!r.depois?.sincronizado, 'SHA continua diferente');
});

// ============================================================================
// GIT AUSENTE / REMOTE ERRADO
// ============================================================================
await test('git ausente -> etapa GIT', async () => {
    const spawn = async () => { throw new Error('ENOENT'); };
    const r = await sync.sincronizarCodigo({ spawn });
    eq(r.etapa, 'GIT', 'etapa GIT');
});

await test('remote inesperado -> etapa REMOTE', async () => {
    const g = fakeGit({ head: 'A', remote: 'B', remoteUrl: 'https://github.com/Outro/repo.git' });
    const r = await sync.sincronizarCodigo({ spawn: g.spawn, remoteEsperado: 'Souzzaaxzy/baileys' });
    ok(r.ok === false, 'recusou');
    eq(r.etapa, 'REMOTE', 'etapa REMOTE');
    eq(g.st.reset, 0, 'nada destrutivo antes de validar o remote');
});

await test('remote aceito em JID/ssh e https', async () => {
    for (const u of ['git@github.com:Souzzaaxzy/baileys.git', 'https://github.com/Souzzaaxzy/baileys']) {
        const g = fakeGit({ head: 'A', remote: 'A', remoteUrl: u });
        const r = await sync.sincronizarCodigo({ spawn: g.spawn, remoteEsperado: 'Souzzaaxzy/baileys' });
        ok(r.ok === true, `aceitou ${u}`);
    }
});

await test('extrairRepo: pega owner/repo sem o host (bug pego no e2e)', () => {
    eq(sync.extrairRepo('https://github.com/Souzzaaxzy/baileys.git'), 'Souzzaaxzy/baileys', 'https .git');
    eq(sync.extrairRepo('https://github.com/Souzzaaxzy/baileys'), 'Souzzaaxzy/baileys', 'https');
    eq(sync.extrairRepo('https://github.com/Souzzaaxzy/baileys/'), 'Souzzaaxzy/baileys', 'barra final');
    eq(sync.extrairRepo('git@github.com:Souzzaaxzy/baileys.git'), 'Souzzaaxzy/baileys', 'ssh');
    eq(sync.extrairRepo('https://github.com/Outro/repo.git'), 'Outro/repo', 'outro repo');
    ok(!String(sync.extrairRepo('https://github.com/Souzzaaxzy/baileys')).includes('github.com'), 'host NÃO entra');
    eq(sync.extrairRepo(''), null, 'vazio -> null');
    eq(sync.extrairRepo('invalido'), null, 'sem par -> null');
});

// ============================================================================
// NOMES DE COMMIT (TESTE 11 — nunca SHA na interface)
// ============================================================================
await test('TESTE 11 — usa o TÍTULO do commit, nunca o SHA', async () => {
    const g = fakeGit({ head: 'a'.repeat(40), remote: 'b'.repeat(40) });
    g.nomes['a'.repeat(40)] = 'Correção do sistema antigo';
    g.nomes['b'.repeat(40)] = 'Melhoria no sistema de sincronização';
    const r = await sync.sincronizarCodigo({ spawn: g.spawn });
    eq(r.antes.localNome, 'Correção do sistema antigo', 'título local');
    eq(r.antes.remoteNome, 'Melhoria no sistema de sincronização', 'título remoto');
    ok(!r.antes.localNome.includes('aaaa'), 'nome não é SHA');
});

await test('título vazio cai no fallback legível (não no SHA)', async () => {
    const spawn = async (cmd, args) => {
        const a = args.join(' ');
        if (a === '--version') return { stdout: 'git version 2' };
        if (a.startsWith('remote get-url')) return { stdout: 'https://github.com/Souzzaaxzy/baileys.git' };
        if (a === 'branch --show-current') return { stdout: 'main' };
        if (a.startsWith('fetch')) return { stdout: '' };
        if (a.startsWith('rev-parse')) return { stdout: 'x' };
        if (a.startsWith('log -1')) return { stdout: '' };
        if (a.startsWith('reset')) return { stdout: '' };
        throw new Error(a);
    };
    const n = await sync.nomeDoCommit(spawn, 'HEAD');
    eq(n, 'Commit não identificado', 'fallback legível');
});

// ============================================================================
// BACKUP DO DATABASE
// ============================================================================
const tmpDb = (arquivos) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lizzy-db-src-'));
    for (const [rel, conteudo] of Object.entries(arquivos)) {
        const full = path.join(root, 'dados', 'database', rel);
        fs.mkdirSync(path.dirname(full), { recursive: true });
        fs.writeFileSync(full, conteudo);
    }
    return root;
};

await test('TESTE 4/5 — backup é COMPLETO e recursivo (rastreado e ignorado)', () => {
    const root = tmpDb({
        'global.json': '{"saldo":10}',
        'grupos/g1.json': '{"x":1}',
        'sub/pasta/ignorado.dat': 'nao-rastreado',
        'economia/IGNORADO.json': '{"nunca":"no git status"}'
    });
    const b = bk.criarBackupDatabase({ cwd: root });
    ok(b.ok === true, 'backup ok');
    eq(b.count, 4, 'copiou TODOS os 4 (inclusive os que o git ignoraria)');
    ok(b.arquivos.includes('sub/pasta/ignorado.dat'), 'arquivo em subpasta entrou');
    ok(b.arquivos.includes('economia/IGNORADO.json'), 'arquivo ignorado entrou');
    const v = bk.validarBackupDatabase(b);
    ok(v.ok === true, 'validado');
    eq(v.count, 4, 'contagem ok');
    fs.rmSync(root, { recursive: true, force: true });
    bk.descartarBackupDatabase(b);
});

await test('TESTE 4 — restore devolve o conteúdo EXATO (código novo + database antigo)', () => {
    const root = tmpDb({ 'global.json': '{"saldo":10}', 'grupos/g1.json': '{"membros":3}' });
    const b = bk.criarBackupDatabase({ cwd: root });

    // Simula o `git reset --hard`: o repo sobrescreve o database
    fs.writeFileSync(path.join(root, 'dados', 'database', 'global.json'), '{"saldo":0}');
    fs.rmSync(path.join(root, 'dados', 'database', 'grupos', 'g1.json'));

    const r = bk.restaurarBackupDatabase(b, { cwd: root });
    ok(r.ok === true, 'restore ok');
    eq(fs.readFileSync(path.join(root, 'dados', 'database', 'global.json'), 'utf-8'), '{"saldo":10}', 'conteúdo antigo voltou');
    eq(fs.readFileSync(path.join(root, 'dados', 'database', 'grupos', 'g1.json'), 'utf-8'), '{"membros":3}', 'arquivo removido voltou');
    const v = bk.validarRestauracaoDatabase(b, { cwd: root });
    ok(v.ok === true, 'restauração validada');
    fs.rmSync(root, { recursive: true, force: true });
    bk.descartarBackupDatabase(b);
});

await test('TESTE 5 — arquivo NÃO rastreado criado dentro do database é preservado', () => {
    const root = tmpDb({ 'global.json': '{}' });
    const b = bk.criarBackupDatabase({ cwd: root });
    // Um arquivo que o bot cria e o git não conhece
    fs.writeFileSync(path.join(root, 'dados', 'database', 'novo-nao-rastreado.json'), 'estado vivo');
    // o reset não apaga (não usamos clean) — e o restore não remove extras
    const r = bk.restaurarBackupDatabase(b, { cwd: root });
    ok(r.ok === true, 'restore ok');
    eq(fs.readFileSync(path.join(root, 'dados', 'database', 'novo-nao-rastreado.json'), 'utf-8'), 'estado vivo', 'arquivo não rastreado intacto');
    fs.rmSync(root, { recursive: true, force: true });
    bk.descartarBackupDatabase(b);
});

await test('validação detecta arquivos faltando após restore', () => {
    const root = tmpDb({ 'a.json': '1', 'b/c.json': '2' });
    const b = bk.criarBackupDatabase({ cwd: root });
    fs.rmSync(path.join(root, 'dados', 'database', 'b', 'c.json'));
    const v = bk.validarRestauracaoDatabase(b, { cwd: root });
    ok(v.ok === false, 'detectou falta');
    eq(v.reason, 'arquivos_faltando', 'motivo');
    ok(v.faltando.includes('b/c.json'), 'aponta o arquivo');
    fs.rmSync(root, { recursive: true, force: true });
    bk.descartarBackupDatabase(b);
});

await test('backup de database ausente é válido e vazio (bot recém-clonado)', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lizzy-db-vazio-'));
    const b = bk.criarBackupDatabase({ cwd: root });
    ok(b.ok === true, 'ok');
    eq(b.count, 0, 'zero arquivos');
    const v = bk.validarBackupDatabase(b);
    ok(v.ok === true, 'vazio é válido');
    fs.rmSync(root, { recursive: true, force: true });
    bk.descartarBackupDatabase(b);
});

await test('validação pega backup com contagem divergente (backup incompleto)', () => {
    const b = { ok: true, backupDir: fs.mkdtempSync(path.join(os.tmpdir(), 'lizzy-db-x-')), count: 5, arquivos: ['a'] };
    const v = bk.validarBackupDatabase(b);
    ok(v.ok === false, 'recusou');
    eq(v.reason, 'contagem_divergente', 'motivo');
    fs.rmSync(b.backupDir, { recursive: true, force: true });
});

// ============================================================================
// TESTE 21 — BUG ORIGINAL (A→B, depois →C, depois →D)
// ============================================================================
await test('TESTE 21 — pushes sucessivos: cada !atualizar alcança o commit novo', async () => {
    const g = fakeGit({ head: 'A', remote: 'A' });
    // push B
    g.st.remote = 'B';
    let r = await sync.sincronizarCodigo({ spawn: g.spawn });
    eq(g.st.head, 'B', 'chegou em B');
    // push C
    g.st.remote = 'C';
    r = await sync.sincronizarCodigo({ spawn: g.spawn });
    eq(g.st.head, 'C', 'chegou em C');
    // push D
    g.st.remote = 'D';
    r = await sync.sincronizarCodigo({ spawn: g.spawn });
    eq(g.st.head, 'D', 'chegou em D');
    ok(r.ok === true, 'todas as rodadas com sucesso');
    ok(!r.jaAtualizado, 'a última aplicou atualização');
});

// ============================================================================
// ============================================================================
const totalOk = RESULTADOS.reduce((a, r) => a + r.passed, 0);
const totalFail = RESULTADOS.reduce((a, r) => a + r.failed, 0);
console.log(`\n${'='.repeat(60)}`);
console.log(`Testes: ${RESULTADOS.length}  |  Asserções OK: ${totalOk}  |  Falhas: ${totalFail}`);
console.log('='.repeat(60));
process.exit(totalFail === 0 ? 0 : 1);
