/**
 * Testes do modo PUSH do `!atualizar` (`dados/src/.scripts/git-push.js`).
 *
 * O `spawn` do git é INJETADO (fake com estado), então os cenários rodam sem
 * repositório real e sem tocar em credencial nenhuma. O que se verifica:
 *   - a credencial só entra na URL DURANTE o push e o remote é restaurado;
 *   - árvore limpa -> nada é commitado/enviado;
 *   - `.env` alterado aborta por segurança;
 *   - mensagem de commit é sanitizada (uma linha);
 *   - remoto à frente vira etapa PUSH com orientação de dar pull antes;
 *   - o token NUNCA aparece inteiro no log.
 *
 * Uso: node tests/update-push.test.js
 */

const push = await import(new URL('../dados/src/.scripts/git-push.js', import.meta.url).href);
import fs from 'fs';

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
 * Fake de git com ESTADO para o fluxo de push.
 *
 * `status` é o que `git status --porcelain` devolve (vazio = árvore limpa).
 * Registra `set-url` e `push` para inspecionar o que aconteceu.
 */
function fakeGit({
    status = ' M dados/src/index.js',
    remoteUrl = 'https://github.com/Souzzaaxzy/LizzyZap.git',
    branch = 'main',
    falhar = null
} = {}) {
    const st = { add: 0, commit: 0, push: 0, setUrl: [], pushUrl: null, head: 'cafe1234' };
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
        if (a === 'status --porcelain') return { stdout: status };
        if (a === 'add -A') { st.add += 1; return { stdout: '' }; }
        if (a.startsWith('commit -F')) { st.commit += 1; st.msgFile = args[args.length - 1]; return { stdout: '' }; }
        if (a === 'rev-parse HEAD') return { stdout: st.head };
        if (a.startsWith('log -1')) return { stdout: 'Publicar alterações locais' };
        if (a.startsWith('remote set-url')) { st.setUrl.push(args[3]); return { stdout: '' }; }
        if (a.startsWith('push ')) { st.push += 1; st.pushUrl = st.setUrl[st.setUrl.length - 1] || null; return { stdout: '' }; }
        throw new Error(`git ${a} não mockado`);
    };
    return { spawn, st };
}

const TOKEN = 'ghp_TesteTesteTesteTesteTesteTeste123456';

// ============================================================================
// 1) FLUXO COMPLETO — commit + push, remote restaurado
// ============================================================================
await test('PUSH 1 — árvore suja: commita, envia e RESTAURA o remote original', async () => {
    const g = fakeGit({ status: ' M dados/src/index.js\n M package.json' });
    const r = await push.publicar({ spawn: g.spawn, token: TOKEN, mensagem: 'fix: ajuste', repo: 'Souzzaaxzy/LizzyZap' });
    ok(r.ok === true, 'sucesso');
    ok(r.nada === false, 'publicou');
    eq(r.arquivos, 2, 'contou 2 arquivos');
    eq(g.st.add, 1, 'rodou add -A');
    eq(g.st.commit, 1, 'criou commit');
    eq(g.st.push, 1, 'fez push');
    // A credencial entrou na URL só durante o push...
    ok(g.st.pushUrl && g.st.pushUrl.includes(TOKEN), 'a URL do push carrega o token');
    ok(g.st.pushUrl.startsWith('https://'), 'a URL é https');
    // ...e o remote terminou no valor ORIGINAL (sem token no .git/config).
    const ultimo = g.st.setUrl[g.st.setUrl.length - 1];
    eq(ultimo, 'https://github.com/Souzzaaxzy/LizzyZap.git', 'remote restaurado sem token');
    ok(!g.st.setUrl.filter(Boolean).pop().includes(TOKEN), 'a ÚLTIMA set-url não tem o token');
});

// ============================================================================
// 2) ÁRVORE LIMPA — nada a publicar
// ============================================================================
await test('PUSH 2 — árvore limpa: nada é commitado nem enviado', async () => {
    const g = fakeGit({ status: '' });
    const r = await push.publicar({ spawn: g.spawn, token: TOKEN });
    ok(r.ok === true, 'sucesso');
    ok(r.nada === true, 'marcou nada-a-publicar');
    eq(g.st.commit, 0, 'nenhum commit');
    eq(g.st.push, 0, 'nenhum push');
    eq(g.st.add, 0, 'nenhum add');
});

// ============================================================================
// 3) SEGURANÇA — .env alterado aborta
// ============================================================================
await test('PUSH 3 — .env como alterado: aborta na etapa SEGURANÇA', async () => {
    const g = fakeGit({ status: ' M .env' });
    const r = await push.publicar({ spawn: g.spawn, token: TOKEN });
    ok(r.ok === false, 'falhou');
    eq(r.etapa, 'SEGURANÇA', 'etapa SEGURANÇA');
    eq(g.st.commit, 0, 'NÃO commitou');
    eq(g.st.push, 0, 'NÃO enviou');
});

await test('PUSH 3b — guard de .env: bloqueia variantes, libera .env.example', () => {
    ok(push.ehArquivoEnvSensivel(' M .env'), 'bloqueia .env (trim aplicado: "M .env")');
    ok(push.ehArquivoEnvSensivel('M .env'), 'bloqueia .env já trimado');
    ok(push.ehArquivoEnvSensivel('?? .env'), 'bloqueia .env untracked');
    ok(push.ehArquivoEnvSensivel(' M .env.local'), 'bloqueia .env.local');
    ok(push.ehArquivoEnvSensivel('?? sub/.env'), 'bloqueia .env em subpasta');
    ok(!push.ehArquivoEnvSensivel(' M .env.example'), 'libera .env.example');
    ok(!push.ehArquivoEnvSensivel(' M dados/src/index.js'), 'libera arquivo normal');
    ok(!push.ehArquivoEnvSensivel(' M docs/environment.md'), 'não confunde "environment"');
});

// ============================================================================
// 4) REMOTO À FRENTE — orienta pull antes
// ============================================================================
await test('PUSH 4 — push rejeitado (non-fast-forward): etapa PUSH com orientação', async () => {
    const g = fakeGit({ falhar: { quando: '^push ', stderr: '! [rejected] main -> main (non-fast-forward)' } });
    const r = await push.publicar({ spawn: g.spawn, token: TOKEN });
    ok(r.ok === false, 'falhou');
    eq(r.etapa, 'PUSH', 'etapa PUSH');
    ok(/atualizar|à frente|a frente/i.test(r.detalhe || ''), 'orienta dar pull antes');
});

// ============================================================================
// 5) SEM TOKEN — tenta mesmo assim, sem credencial na URL
// ============================================================================
await test('PUSH 5 — sem token: não injeta credencial, mas tenta o push', async () => {
    const g = fakeGit();
    const r = await push.publicar({ spawn: g.spawn, token: '' });
    ok(r.ok === true, 'segue o fluxo');
    eq(g.st.push, 1, 'tentou o push');
    eq(g.st.setUrl.length, 0, 'NENHUMA set-url (não inventou credencial)');
});

// ============================================================================
// 6) REMOTE INESPERADO — recusa antes de commitar
// ============================================================================
await test('PUSH 6 — remote inesperado: etapa REMOTE, nada destrutivo', async () => {
    const g = fakeGit({ remoteUrl: 'https://github.com/Outro/repo.git' });
    const r = await push.publicar({ spawn: g.spawn, token: TOKEN, repo: 'Souzzaaxzy/LizzyZap' });
    ok(r.ok === false, 'recusou');
    eq(r.etapa, 'REMOTE', 'etapa REMOTE');
    eq(g.st.commit, 0, 'não commitou');
});

// ============================================================================
// 7) GIT AUSENTE
// ============================================================================
await test('PUSH 7 — git ausente: etapa GIT', async () => {
    const spawn = async () => { throw new Error('ENOENT'); };
    const r = await push.publicar({ spawn, token: TOKEN });
    eq(r.etapa, 'GIT', 'etapa GIT');
});

// ============================================================================
// 8) MENSAGEM SANITIZADA (uma linha)
// ============================================================================
await test('PUSH 8 — mensagem vira UMA linha, sem quebras nem excesso', () => {
    eq(push.limparMensagem('  fix:  algo\ncom quebra  '), 'fix: algo com quebra', 'colapsa espaços/quebras');
    const longa = push.limparMensagem('x'.repeat(500));
    ok(longa.length <= 200, 'respeita o teto de 200');
    ok(longa.endsWith('…'), 'indica truncamento');
    eq(push.limparMensagem(''), '', 'vazio continua vazio');
});

// ============================================================================
// 9) TOKEN NUNCA INTEIRO NO LOG
// ============================================================================
await test('PUSH 9 — mascararToken não expõe o valor inteiro', () => {
    const m = push.mascararToken(TOKEN);
    ok(!m.includes(TOKEN), 'não contém o token inteiro');
    ok(m.includes(TOKEN.slice(0, 4)) && m.includes(TOKEN.slice(-4)), 'mostra só as pontas');
    eq(push.mascararToken(''), '(não definido)', 'vazio tem rótulo');
});

// ============================================================================
// 10) RESOLUÇÃO DE TOKEN — ordem de prioridade
// ============================================================================
await test('PUSH 10 — resolverToken prioriza GITHUB_PUSH_TOKEN', () => {
    eq(push.resolverToken({ GITHUB_PUSH_TOKEN: 'a', GITHUB_SYNC_TOKEN: 'b' }), 'a', 'push vence');
    eq(push.resolverToken({ GITHUB_SYNC_TOKEN: 'b', GITHUB_TOKEN: 'c' }), 'b', 'sync é o 2º');
    eq(push.resolverToken({}), '', 'sem nada -> vazio');
});

// ============================================================================
// 11) remoteComCredencial — monta e NÃO monta
// ============================================================================
await test('PUSH 11 — remoteComCredencial monta a URL autenticada', () => {
    const u = push.remoteComCredencial('https://github.com/x/y.git', TOKEN, 'Souzzaaxzy/LizzyZap');
    eq(u, `https://${TOKEN}@github.com/x/y.git`, 'injeta o token na URL existente (preserva host)');
    eq(push.remoteComCredencial('https://github.com/x/y.git', '', 'x/y'), null, 'sem token -> null');
    eq(push.remoteComCredencial('git@github.com:x/y.git', TOKEN, null), null, 'ssh sem owner/repo não é adivinhado');
    eq(push.remoteComCredencial('git@github.com:x/y.git', TOKEN, 'x/y'), `https://${TOKEN}@github.com/x/y.git`, 'ssh COM repo vira https com token');
    eq(push.remoteComCredencial('/tmp/e2e/remoto.git', TOKEN, 'x/y'), null, 'remote local não recebe credencial');
    eq(push.remoteComCredencial('file:///tmp/e2e/remoto.git', TOKEN, 'x/y'), null, 'file:// não recebe credencial');
});

// ============================================================================
// 12) A CREDENCIAL NÃO VAZA PARA O ARQUIVO (integração estática)
// ============================================================================
await test('PUSH 12 — integração: update.js usa o modo e o token do .env', () => {
    const src = fs.readFileSync(new URL('../dados/src/.scripts/update.js', import.meta.url), 'utf8');
    ok(src.includes("from './git-push.js'"), 'update.js importa o módulo de push');
    ok(src.includes('publicarAlteracoes'), 'tem o fluxo de publicação');
    ok(src.includes("LIZZY_UPDATE_MODE === 'push'"), 'o modo vem de LIZZY_UPDATE_MODE');
    ok(src.includes('GITHUB_PUSH_TOKEN'), 'o .env.example documenta GITHUB_PUSH_TOKEN');
    // O token NÃO pode aparecer no código.
    ok(!/ghp_[A-Za-z0-9]{20,}/.test(src), 'nenhum token literal no código');
});

// ============================================================================
const totalOk = RESULTADOS.reduce((a, r) => a + r.passed, 0);
const totalFail = RESULTADOS.reduce((a, r) => a + r.failed, 0);
console.log(`\n${'='.repeat(60)}`);
console.log(`Testes: ${RESULTADOS.length}  |  Asserções OK: ${totalOk}  |  Falhas: ${totalFail}`);
console.log('='.repeat(60));
process.exit(totalFail === 0 ? 0 : 1);
