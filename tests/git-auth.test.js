/**
 * Testes da autenticação git para dependências PRIVADAS (`git-auth.js`).
 *
 * O que se verifica:
 *   - a ordem de resolução do token (GITHUB_PUSH_TOKEN primeiro);
 *   - o `env` gerado configura `insteadOf` para TODOS os formatos de URL que o
 *     npm/lock usam (git+ssh, ssh, git+https, https, scp);
 *   - sem token, o ambiente NÃO ganha configuração nenhuma;
 *   - o token nunca é mascarado errado;
 *   - a integração: start.js/config.js/update.js usam `envComCredencialGit`.
 *
 * Uso: node tests/git-auth.test.js
 */

const auth = await import(new URL('../dados/src/.scripts/git-auth.js', import.meta.url).href);
import fs from 'fs';

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
    try { const r = fn(); if (r && typeof r.then === 'function') return r.then(() => done()).catch(done); done(); }
    catch (e) { done(e); }
    return Promise.resolve();
}
function ok(cond, msg) { if (cond) ATUAL.passed += 1; else { ATUAL.failed += 1; ATUAL.errors.push(`ASSERT FALHOU: ${msg}`); } }
const eq = (a, b, l) => ok(a === b, `${l}: esperado ${JSON.stringify(b)}, veio ${JSON.stringify(a)}`);

const TOKEN = 'ghp_TesteTesteTesteTesteTesteTeste123456';

// ============================================================================
await test('AUTH 1 — resolverTokenGit prioriza GITHUB_PUSH_TOKEN', () => {
    eq(auth.resolverTokenGit({ GITHUB_PUSH_TOKEN: 'a', GITHUB_SYNC_TOKEN: 'b' }), 'a', 'push vence');
    eq(auth.resolverTokenGit({ GITHUB_SYNC_TOKEN: 'b', GITHUB_TOKEN: 'c' }), 'b', 'sync é o 2º');
    eq(auth.resolverTokenGit({ GITHUB_UPLOAD_TOKEN: 'd' }), 'd', 'upload é o último');
    eq(auth.resolverTokenGit({}), '', 'sem nada -> vazio');
});

// ============================================================================
await test('AUTH 2 — sem token: ambiente NÃO ganha configuração', () => {
    const env = auth.envComCredencialGit('');
    ok(!('GIT_CONFIG_COUNT' in env) || env.GIT_CONFIG_COUNT === '0', 'não inventa GIT_CONFIG_COUNT');
    ok(!Object.keys(env).some((k) => k.startsWith('GIT_CONFIG_KEY_')), 'não inventa chaves');
});

// ============================================================================
await test('AUTH 3 — com token: cobre TODOS os formatos de URL', () => {
    const env = auth.envComCredencialGit(TOKEN, {});
    const n = Number(env.GIT_CONFIG_COUNT);
    ok(n >= 5, `configurou ${n} reescritas (>=5 formatos)`);
    const valores = [];
    for (let i = 0; i < n; i++) valores.push(env[`GIT_CONFIG_VALUE_${i}`]);
    for (const u of ['git+ssh://git@github.com/', 'ssh://git@github.com/', 'git+https://github.com/', 'https://github.com/', 'git@github.com:']) {
        ok(valores.includes(u), `cobre ${u}`);
    }
    // A chave aponta para a URL com token.
    ok(env.GIT_CONFIG_KEY_0 === `url.https://${TOKEN}@github.com/.insteadOf`, 'a chave usa a URL com token');
    ok(env.GIT_CONFIG_VALUE_0 === 'git+ssh://git@github.com/', 'a primeira reescrita é git+ssh (formato do lock)');
});

// ============================================================================
await test('AUTH 4 — preserva GIT_CONFIG_COUNT pré-existente', () => {
    const base = { GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'user.name', GIT_CONFIG_VALUE_0: 'x' };
    const env = auth.envComCredencialGit(TOKEN, base);
    eq(env.GIT_CONFIG_KEY_0, 'user.name', 'não sobrescreve a config anterior');
    ok(Number(env.GIT_CONFIG_COUNT) > 1, 'incrementa o contador');
    ok(env.GIT_CONFIG_KEY_1.startsWith('url.'), 'a nova entra depois');
});

// ============================================================================
await test('AUTH 5 — o ambiente base é preservado (cópia, não mutação)', () => {
    const base = { PATH: '/bin', FOO: 'bar' };
    const env = auth.envComCredencialGit(TOKEN, base);
    eq(env.PATH, '/bin', 'PATH preservado');
    eq(env.FOO, 'bar', 'outras vars preservadas');
    ok(!('GIT_CONFIG_COUNT' in base), 'o objeto base NÃO foi mutado');
});

// ============================================================================
await test('AUTH 6 — mascararToken não expõe o valor inteiro', () => {
    const m = auth.mascararToken(TOKEN);
    ok(!m.includes(TOKEN), 'não contém o token inteiro');
    eq(auth.mascararToken(''), '(não definido)', 'vazio tem rótulo');
});

// ============================================================================
await test('AUTH 7 — integração: os 3 scripts usam envComCredencialGit no npm install', () => {
    for (const f of ['start.js', 'config.js', 'update.js']) {
        const src = fs.readFileSync(new URL(`../dados/src/.scripts/${f}`, import.meta.url), 'utf8');
        ok(src.includes("from './git-auth.js'"), `${f} importa git-auth`);
        ok(src.includes('envComCredencialGit'), `${f} usa envComCredencialGit`);
        ok(!/ghp_[A-Za-z0-9]{20,}/.test(src), `${f} não tem token literal`);
    }
    // start.js passa o env no execSync do install
    const start = fs.readFileSync(new URL('../dados/src/.scripts/start.js', import.meta.url), 'utf8');
    ok(/execSync\(cmd,\s*\{[\s\S]{0,500}env:\s*envComCredencialGit/.test(start), 'start.js passa env no install');
});

// ============================================================================
const totalOk = RESULTADOS.reduce((a, r) => a + r.passed, 0);
const totalFail = RESULTADOS.reduce((a, r) => a + r.failed, 0);
console.log(`\n${'='.repeat(60)}`);
console.log(`Testes: ${RESULTADOS.length}  |  Asserções OK: ${totalOk}  |  Falhas: ${totalFail}`);
console.log('='.repeat(60));
process.exit(totalFail === 0 ? 0 : 1);
