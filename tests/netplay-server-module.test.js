/**
 * Teste do MODULO de netplay sob demanda (dados/src/funcs/utils/netplayServer.js).
 *
 * Puro: resolve configuracao a partir de env/json e decide se deve subir o
 * processo. NAO sobe nada aqui (o processo real e coberto por
 * tests/netplay-server.test.js).
 *
 * Uso: node tests/netplay-server-module.test.js
 */
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const mod = await import(new URL('../dados/src/funcs/utils/netplayServer.js', import.meta.url).href);

const RESULTS = [];
let CURRENT = null;
function test(name, fn) {
  CURRENT = { name, passed: 0, failed: 0, errors: [] };
  RESULTS.push(CURRENT);
  return Promise.resolve().then(fn)
    .catch((e) => { CURRENT.failed++; CURRENT.errors.push(`EXCEÇÃO: ${e?.stack || e}`); })
    .then(() => {
      console.log(`${CURRENT.failed === 0 ? '✅' : '❌'} ${CURRENT.name} (${CURRENT.passed} ok, ${CURRENT.failed} falhas)`);
      for (const e of CURRENT.errors) console.log(`   ↳ ${e}`);
    });
}
function ok(c, m) { if (c) CURRENT.passed++; else { CURRENT.failed++; CURRENT.errors.push(`ASSERT: ${m}`); } }

// ─────────────────────────── configuracao ───────────────────────────
await test('URL externa: configurado, NAO sobe processo local', () => {
  const c = mod.configNetplay({ EMUGAMES_NETPLAY_URL: 'https://netplay.exemplo.com/' }, {});
  ok(c.configurado, 'configurado');
  ok(c.url === 'https://netplay.exemplo.com', 'tira a barra final');
  ok(c.spawnar === false, 'URL externa nao sobe processo local');
  ok(c.porta === 3000, 'porta padrao 3000');
  ok(c.urlLocal === 'http://127.0.0.1:3000', 'url local para health check');
});

await test('URL local: sobe processo local', () => {
  const c = mod.configNetplay({ EMUGAMES_NETPLAY_URL: 'http://localhost:3210' }, {});
  ok(c.configurado, 'configurado');
  ok(c.spawnar === true, 'localhost sobe o processo');
  ok(c.porta === 3210, 'porta lida da URL do json/env');
});

await test('EMUGAMES_NETPLAY_SPAWN manda (0 desliga, 1 liga)', () => {
  ok(mod.configNetplay({ EMUGAMES_NETPLAY_URL: 'http://localhost:3000', EMUGAMES_NETPLAY_SPAWN: '0' }, {}).spawnar === false, '0 nao sobe');
  ok(mod.configNetplay({ EMUGAMES_NETPLAY_URL: 'https://netplay.exemplo.com', EMUGAMES_NETPLAY_SPAWN: '1' }, {}).spawnar === true, '1 sobe');
});

await test('EMUGAMES_NETPLAY_PORT muda a porta local', () => {
  const c = mod.configNetplay({ EMUGAMES_NETPLAY_URL: 'http://127.0.0.1', EMUGAMES_NETPLAY_PORT: '4555' }, {});
  ok(c.porta === 4555, 'porta da env');
  ok(c.urlLocal === 'http://127.0.0.1:4555', 'url local acompanha');
});

await test('o netplay.json e usado quando nao ha env', () => {
  const c = mod.configNetplay({}, { server: 'https://np.json.local', port: 7777 });
  ok(c.configurado && c.url === 'https://np.json.local', 'server do json');
  ok(c.porta === 7777, 'porta do json');
});

await test('env tem prioridade sobre o json', () => {
  const c = mod.configNetplay(
    { EMUGAMES_NETPLAY_URL: 'https://env.vence', EMUGAMES_NETPLAY_PORT: '9000' },
    { server: 'https://json.perde', port: 1111 }
  );
  ok(c.url === 'https://env.vence', 'env vence a URL');
  ok(c.porta === 9000, 'env vence a porta');
});

await test('sem URL nao esta configurado', () => {
  const c = mod.configNetplay({}, {});
  ok(c.configurado === false, 'nao configurado');
  ok(mod.netplayConfigurado({}) === false, 'helper concorda');
  ok(mod.netplayConfigurado({ EMUGAMES_NETPLAY_URL: 'https://x.com' }) === true, 'helper ve a env');
});

await test('portaNetplay devolve a porta efetiva', () => {
  ok(mod.portaNetplay({ EMUGAMES_NETPLAY_PORT: '1234' }) === 1234, 'porta da env');
  ok(mod.portaNetplay({}) === 3000, 'padrao');
});

// ─────────────────────────── deteccao automatica ───────────────────────────
await test('portasPublicadas le WORKER_1/WORKER_2', () => {
  ok(JSON.stringify(mod.portasPublicadas({ WORKER_1: '12000', WORKER_2: '12001' })) === '[12000,12001]', 'le as duas');
  ok(mod.portasPublicadas({}).length === 0, 'sem worker nao ha porta publicada');
  ok(mod.portasPublicadas({ WORKER_1: 'abc' }).length === 0, 'valor invalido e ignorado');
});

await test('detectarUrlPublica monta o subdominio HTTPS', () => {
  const env = { WORKER_1: '12000', WORKER_2: '12001', RUNTIME_URL: 'https://abc123.prod-runtime.all-hands.dev' };
  ok(mod.detectarUrlPublica(env, 12000) === 'https://work-1-abc123.prod-runtime.all-hands.dev', 'work-1 para a 1a porta');
  ok(mod.detectarUrlPublica(env, 12001) === 'https://work-2-abc123.prod-runtime.all-hands.dev', 'work-2 para a 2a porta');
  ok(mod.detectarUrlPublica(env, 9999) === '', 'porta nao publicada -> vazio');
});

await test('detectarUrlPublica cai para RUNTIME_ID/HOSTNAME', () => {
  ok(mod.detectarUrlPublica({ WORKER_1: '12000', RUNTIME_ID: 'zz9' }, 12000).includes('work-1-zz9'), 'usa RUNTIME_ID');
  ok(mod.detectarUrlPublica({ WORKER_1: '12000', HOSTNAME: 'runtime-qq7-abc-def' }, 12000).includes('work-1-qq7'), 'usa HOSTNAME');
  ok(mod.detectarUrlPublica({ WORKER_1: '12000' }, 12000) === '', 'sem id nao inventa host');
});

await test('SEM configuracao: detecta a URL e sobe o processo', () => {
  const env = { WORKER_1: '12000', RUNTIME_URL: 'https://abc.prod-runtime.all-hands.dev' };
  const c = mod.configNetplay(env, {});
  ok(c.configurado === true, 'fica configurado sozinho');
  ok(c.auto === true, 'marcado como automatico');
  ok(c.url.startsWith('https://work-1-'), 'URL publica detectada (HTTPS)');
  ok(c.porta === 12000, 'porta = a publicada');
  ok(c.spawnar === true, 'sobe o processo local');
  ok(mod.netplayConfigurado(env) === true, 'helper concorda');
});

await test('URL explicita VENCE a deteccao', () => {
  const env = { WORKER_1: '12000', RUNTIME_URL: 'https://abc.prod-runtime.all-hands.dev', EMUGAMES_NETPLAY_URL: 'https://meu.dominio.com' };
  const c = mod.configNetplay(env, {});
  ok(c.url === 'https://meu.dominio.com', 'usa a explicita');
  ok(c.auto === false, 'nao e automatico');
  ok(c.spawnar === false, 'URL externa nao sobe processo');
});

// ─────────────────────────── garantirNetplay ───────────────────────────
await test('garantirNetplay sem URL: falha clara, sem lancar', async () => {
  const r = await mod.garantirNetplay({});
  ok(r.ok === false, 'nao ok');
  ok(typeof r.motivo === 'string' && r.motivo.length > 0, 'tem motivo');
  ok(r.motivo.includes('EMUGAMES_NETPLAY_URL'), 'motivo cita a env');
});

await test('garantirNetplay com URL externa: ok sem subir processo', async () => {
  const r = await mod.garantirNetplay({ EMUGAMES_NETPLAY_URL: 'https://netplay.exemplo.com' });
  ok(r.ok === true, 'ok');
  ok(r.url === 'https://netplay.exemplo.com', 'devolve a URL');
});

// ─────────────────────────── resumo ───────────────────────────
console.log('\n' + '─'.repeat(60));
let passed = 0, failed = 0;
for (const r of RESULTS) { passed += r.passed; failed += r.failed; }
console.log(`Total: ${RESULTS.length} testes / ${passed} asserções ok, ${failed} falhas`);
process.exit(failed === 0 ? 0 : 1);
