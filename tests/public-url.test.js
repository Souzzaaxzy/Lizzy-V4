/**
 * Testes da descoberta automática da URL pública HTTPS.
 *
 * O ponto que isto protege: o adaptador do AntiFantasma precisa de uma URL
 * absoluta, e exigir que o administrador a digite à mão é fonte de erro. A
 * detecção recebe o ambiente por parâmetro, então cada plataforma pode ser
 * testada sem tocar no processo.
 *
 * Uso: node tests/public-url.test.js
 */

import { fileURLToPath } from 'url';

const resultados = [];
let ok = 0;
let fail = 0;

function test(nome, fn) {
  try {
    fn();
    console.log(`✅ ${nome}`);
    resultados.push({ nome, ok: true });
  } catch (e) {
    fail += 1;
    console.log(`❌ ${nome}`);
    console.log(`     ${e.message}`);
    resultados.push({ nome, ok: false, erro: e.message });
  }
}

function eq(a, b, msg) {
  if (a !== b) throw new Error(`${msg ?? 'valores diferentes'} — obtido ${JSON.stringify(a)}, esperado ${JSON.stringify(b)}`);
}
function truthy(v, msg) {
  if (!v) throw new Error(msg ?? `esperado valor verdadeiro, obtido ${JSON.stringify(v)}`);
}

const m = await import(new URL('../dados/src/utils/publicUrl.js', import.meta.url).href);

// ============================================================================
// 1) PLATAFORMAS
// ============================================================================

test('OpenHands runtime (RUNTIME_URL) — o host deste ambiente', () => {
  eq(m.detectarUrlPublica({ RUNTIME_URL: 'https://abc.prod-runtime.all-hands.dev' }),
     'https://abc.prod-runtime.all-hands.dev');
});

test('portasPublicadas lê WORKER_1/WORKER_2', () => {
  eq(JSON.stringify(m.portasPublicadas({ WORKER_1: '12000', WORKER_2: '12001' })), '[12000,12001]');
  eq(JSON.stringify(m.portasPublicadas({ WORKER_1: '12000' })), '[12000]');
  eq(JSON.stringify(m.portasPublicadas({ WORKER_2: '12001' })), '[12001]');
  eq(JSON.stringify(m.portasPublicadas({})), '[]');
  eq(JSON.stringify(m.portasPublicadas({ WORKER_1: 'abc', WORKER_2: '-1' })), '[]', 'valores inválidos');
  eq(JSON.stringify(m.portasPublicadas(null)), '[]');
});

test('URL por PORTA: work-1 / work-2 (medido neste runtime)', () => {
  const env = {
    RUNTIME_URL: 'https://abc.prod-runtime.all-hands.dev',
    WORKER_1: '12000',
    WORKER_2: '12001',
  };
  eq(m.detectarUrlPublica(env, { porta: 12000 }), 'https://work-1-abc.prod-runtime.all-hands.dev');
  eq(m.detectarUrlPublica(env, { porta: 12001 }), 'https://work-2-abc.prod-runtime.all-hands.dev');
});

test('porta sem subdomínio cai na URL base do runtime', () => {
  const env = { RUNTIME_URL: 'https://abc.host.dev', WORKER_1: '12000', WORKER_2: '12001' };
  eq(m.detectarUrlPublica(env, { porta: 8080 }), 'https://abc.host.dev', 'porta 8080 não é publicada');
  eq(m.detectarUrlPublica(env, { porta: 0 }), 'https://abc.host.dev', 'sem porta -> base');
  eq(m.detectarUrlPublica(env, {}), 'https://abc.host.dev', 'sem opts -> base');
});

test('Pterodactyl / Bronxys: IP + SERVER_PORT (sem domínio, sem HTTPS)', () => {
  // Aqui NÃO existe domínio publicado nem TLS: o endereço é o próprio
  // http://<ip>:<porta> da alocação.
  eq(m.detectarUrlPublica({ SERVER_IP: '203.0.113.10', SERVER_PORT: '25565' }),
     'http://203.0.113.10:25565');
  eq(m.endpointAntiFantasma({ SERVER_IP: '203.0.113.10', SERVER_PORT: '25565' }),
     'http://203.0.113.10:25565/api/antifantasma/exec');

  // Portas padrão não levam sufixo.
  eq(m.detectarUrlPublica({ SERVER_IP: '1.2.3.4', SERVER_PORT: '80' }), 'http://1.2.3.4');
  // 443 pressupõe TLS — usar http falaria com um listener TLS e morreria.
  eq(m.detectarUrlPublica({ SERVER_IP: '1.2.3.4', SERVER_PORT: '443' }), 'https://1.2.3.4');
});

test('Pterodactyl: exige IP E porta (não inventa endereço)', () => {
  // Só o IP: sem a porta a URL não leva a lugar nenhum.
  eq(m.detectarUrlPublica({ SERVER_IP: '1.2.3.4' }), null);
  // Só a porta: sem o IP não há host.
  eq(m.detectarUrlPublica({ SERVER_PORT: '25565' }), null);
  // Valores inválidos.
  eq(m.detectarUrlPublica({ SERVER_IP: '   ', SERVER_PORT: '25565' }), null);
  eq(m.detectarUrlPublica({ SERVER_IP: '1.2.3.4', SERVER_PORT: 'abc' }), null);
  eq(m.detectarUrlPublica({ SERVER_IP: '1.2.3.4', SERVER_PORT: '0' }), null);
  eq(m.detectarUrlPublica({ SERVER_IP: '1.2.3.4', SERVER_PORT: '-1' }), null);
});

test('escolherPorta reconhece a alocação do Pterodactyl', () => {
  eq(m.escolherPorta({ SERVER_IP: '1.2.3.4', SERVER_PORT: '25565' }), 25565);
  eq(m.escolherPorta({ ANTIFANTASMA_PORT: '9000', SERVER_PORT: '25565' }), 9000, 'override ganha');
});

test('override do admin vence o Pterodactyl (para quem tem domínio próprio)', () => {
  const env = {
    ANTIFANTASMA_PUBLIC_URL: 'https://meudominio.com',
    SERVER_IP: '1.2.3.4',
    SERVER_PORT: '25565',
  };
  eq(m.detectarUrlPublica(env), 'https://meudominio.com');
});

test('Pterodactyl ganha do runtime quando os dois existem (não mistura)', () => {
  // Se o runtime ganhasse primeiro, a porta do painel acabaria colada numa URL
  // `https://<runtime>` — endereço que não existe.
  const env = {
    RUNTIME_URL: 'https://abc.prod-runtime.all-hands.dev',
    WORKER_1: '12000',
    SERVER_IP: '203.0.113.10',
    SERVER_PORT: '25565',
  };
  eq(m.detectarUrlPublica(env), 'http://203.0.113.10:25565');
  eq(m.escolherPorta(env), 25565, 'a porta é a da alocação');

  // Sem os dados do Pterodactyl, o runtime volta a valer (sandbox de dev).
  const soRuntime = { RUNTIME_URL: 'https://abc.host.dev', WORKER_1: '12000' };
  eq(m.detectarUrlPublica(soRuntime, { porta: 12000 }), 'https://work-1-abc.host.dev');
});

test('fallback de HOST: RUNTIME_ID e HOSTNAME quando falta RUNTIME_URL', () => {
  // Sem RUNTIME_URL, o host é reconstruído — foi o cenário em que o comando
  // dizia "não consegui detectar a URL pública".
  const soId = { RUNTIME_ID: 'abc', WORKER_1: '12000' };
  eq(m.detectarUrlPublica(soId, { porta: 12000 }), 'https://work-1-abc.prod-runtime.all-hands.dev');
  eq(m.endpointAntiFantasma(soId, { porta: 12000 }),
     'https://work-1-abc.prod-runtime.all-hands.dev/api/antifantasma/exec');

  const soHostname = { HOSTNAME: 'runtime-abc-d865c869f-5m9lv', WORKER_1: '12000' };
  eq(m.detectarUrlPublica(soHostname, { porta: 12000 }), 'https://work-1-abc.prod-runtime.all-hands.dev');

  // RUNTIME_URL ausente E sem os fallbacks -> null (aí é caso de definir a env).
  eq(m.detectarUrlPublica({ WORKER_1: '12000' }, { porta: 12000 }), null);
  eq(m.detectarUrlPublica({ HOSTNAME: 'container-qualquer' }, {}), null, 'HOSTNAME fora do padrão não inventa host');
});

test('API caída não perde o subdomínio (a porta é escolhida, não a em uso)', () => {
  // Cenário do erro relatado: a API não subiu, então `portaEmUso()` é 0. A URL
  // precisa continuar sendo a da porta publicada — antes caía na base, sem
  // subdomínio, e o adaptador do usuário não alcançava o serviço.
  const env = { RUNTIME_URL: 'https://abc.host.dev', WORKER_1: '12000', WORKER_2: '12001' };
  const porta = m.escolherPorta(env);
  eq(porta, 12000, 'porta escolhida mesmo com API caída');
  eq(m.endpointAntiFantasma(env, { porta }), 'https://work-1-abc.host.dev/api/antifantasma/exec');
});

test('escolherPorta: env explícita ganha; senão a primeira publicada', () => {
  eq(m.escolherPorta({ ANTIFANTASMA_PORT: '9000', WORKER_1: '12000' }), 9000, 'env explícita');
  eq(m.escolherPorta({ WORKER_1: '12000', WORKER_2: '12001' }), 12000, 'primeira publicada');
  eq(m.escolherPorta({ WORKER_2: '12001' }), 12001, 'só a segunda');
  eq(m.escolherPorta({}), 0, 'nenhuma');
});

test('endpoint respeita a porta', () => {
  const env = { RUNTIME_URL: 'https://abc.host.dev', WORKER_1: '12000' };
  eq(m.endpointAntiFantasma(env, { porta: 12000 }),
     'https://work-1-abc.host.dev/api/antifantasma/exec');
  eq(m.endpointAntiFantasma(env, { porta: 9999 }),
     'https://abc.host.dev/api/antifantasma/exec');
});

test('override do admin ignora o mapeamento de porta', () => {
  const env = {
    ANTIFANTASMA_PUBLIC_URL: 'https://meu.dominio.com',
    RUNTIME_URL: 'https://abc.host.dev',
    WORKER_1: '12000',
  };
  eq(m.detectarUrlPublica(env, { porta: 12000 }), 'https://meu.dominio.com');
});

test('Render, Railway, Vercel, Koyeb, Fly, Heroku, Azure', () => {
  eq(m.detectarUrlPublica({ RENDER_EXTERNAL_URL: 'https://x.onrender.com' }), 'https://x.onrender.com');
  eq(m.detectarUrlPublica({ RAILWAY_PUBLIC_DOMAIN: 'x.up.railway.app' }), 'https://x.up.railway.app');
  eq(m.detectarUrlPublica({ VERCEL_URL: 'x.vercel.app' }), 'https://x.vercel.app');
  eq(m.detectarUrlPublica({ KOYEB_PUBLIC_DOMAIN: 'x.koyeb.app' }), 'https://x.koyeb.app');
  eq(m.detectarUrlPublica({ FLY_APP_NAME: 'meubot' }), 'https://meubot.fly.dev');
  eq(m.detectarUrlPublica({ HEROKU_APP_NAME: 'meubot' }), 'https://meubot.herokuapp.com');
  eq(m.detectarUrlPublica({ WEBSITE_HOSTNAME: 'meubot.azurewebsites.net' }), 'https://meubot.azurewebsites.net');
});

test('override do administrador vence tudo', () => {
  eq(
    m.detectarUrlPublica({
      ANTIFANTASMA_PUBLIC_URL: 'https://meu.dominio.com',
      RUNTIME_URL: 'https://ignorado.example',
    }),
    'https://meu.dominio.com'
  );
  eq(m.detectarUrlPublica({ PUBLIC_URL: 'https://publico.example' }), 'https://publico.example');
});

// ============================================================================
// 2) NORMALIZAÇÃO — o ponto sensível
// ============================================================================

test('adiciona https quando falta o esquema', () => {
  eq(m.detectarUrlPublica({ PUBLIC_HOSTNAME: 'meu.host.com' }), 'https://meu.host.com');
});

test('http vira https em host público (a KEY não pode ir em claro)', () => {
  eq(m.detectarUrlPublica({ PUBLIC_URL: 'http://meu.host.com' }), 'https://meu.host.com');
});

test('http é mantido em localhost (desenvolvimento)', () => {
  eq(m.detectarUrlPublica({ PUBLIC_URL: 'http://localhost:3000' }), 'http://localhost:3000');
  eq(m.detectarUrlPublica({ PUBLIC_URL: 'http://127.0.0.1:8080' }), 'http://127.0.0.1:8080');
});

test('remove barra final (evita "//" no endpoint)', () => {
  eq(m.detectarUrlPublica({ PUBLIC_URL: 'https://x.com/' }), 'https://x.com');
  eq(m.detectarUrlPublica({ PUBLIC_URL: 'https://x.com///' }), 'https://x.com');
});

test('sem plataforma conhecida devolve null (não inventa host)', () => {
  eq(m.detectarUrlPublica({}), null);
  eq(m.detectarUrlPublica({ FOO: 'bar' }), null);
  eq(m.detectarUrlPublica({ RUNTIME_URL: '' }), null);
  eq(m.detectarUrlPublica({ RUNTIME_URL: '   ' }), null);
  eq(m.detectarUrlPublica(null), null);
});

test('valor inválido não quebra nem vira URL falsa', () => {
  const url = m.detectarUrlPublica({ RUNTIME_URL: '   ' });
  eq(url, null, 'espaços -> null');
  // Codespaces sem domínio de forwarding não monta URL.
  eq(m.detectarUrlPublica({ CODESPACE_NAME: 'x' }), null);
  eq(
    m.detectarUrlPublica({ CODESPACE_NAME: 'x', GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN: 'app.github.dev' }),
    'https://x-3000.app.github.dev'
  );
});

// ============================================================================
// 3) PORTA E ENDPOINT
// ============================================================================

test('portaConfigurada valida o valor', () => {
  eq(m.portaConfigurada({ ANTIFANTASMA_PORT: '8080' }), 8080);
  eq(m.portaConfigurada({ ANTIFANTASMA_PORT: '0' }), 0, 'zero = não configurada');
  eq(m.portaConfigurada({ ANTIFANTASMA_PORT: 'abc' }), 0);
  eq(m.portaConfigurada({ ANTIFANTASMA_PORT: '-5' }), 0);
  eq(m.portaConfigurada({}), 0);
});

test('endpointAntiFantasma monta o caminho certo', () => {
  eq(
    m.endpointAntiFantasma({ RUNTIME_URL: 'https://h.example' }),
    'https://h.example/api/antifantasma/exec'
  );
  eq(m.endpointAntiFantasma({}), null, 'sem URL não há endpoint');
});

// ============================================================================
// 4) LOG DO BOOT
// ============================================================================

test('resumoParaLog traz URL, porta e endpoint', () => {
  const r = m.resumoParaLog({ RUNTIME_URL: 'https://h.example', ANTIFANTASMA_PORT: '9000' });
  truthy(r, 'resumo presente');
  eq(r.url, 'https://h.example');
  eq(r.porta, 9000);
  eq(r.endpoint, 'https://h.example/api/antifantasma/exec');
  truthy(r.texto.includes('https://h.example'), 'texto mostra a URL');
  truthy(r.texto.includes('9000'), 'texto mostra a porta');
});

test('sem URL, o log orienta o administrador', () => {
  const r = m.resumoParaLog({ ANTIFANTASMA_PORT: '9000' });
  truthy(r, 'ainda há o que logar (porta definida)');
  // O caminho mais direto hoje é o comando; a variável de ambiente continua
  // valendo, mas quem lê o log precisa saber que dá para resolver ali mesmo.
  truthy(r.texto.includes('seturlghost'), 'aponta o comando !seturlghost');
});

test('sem nada configurado, não loga (não polui o boot)', () => {
  eq(m.resumoParaLog({}), null);
  eq(m.resumoParaLog({ FOO: 'bar' }), null);
});

// ============================================================================

console.log('\n════════════════════════════════════════');
const total = resultados.filter((r) => r.ok).length;
const falhas = resultados.filter((r) => !r.ok).length;
console.log(`RESULTADO: ${resultados.length} testes | ${total} ok | ${falhas} falhas`);
console.log('════════════════════════════════════════');

if (falhas) {
  console.log('\nFALHAS:');
  for (const r of resultados.filter((x) => !x.ok)) console.log(`- [${r.nome}] ${r.erro}`);
  process.exit(1);
}
console.log('✅ TODOS OS TESTES PASSARAM');
process.exit(0);