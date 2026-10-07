/**
 * Boot visual da SESSÃO JÁ PAREADA.
 *
 * Cobre dois blocos:
 *  1. o renderer (bootRenderer.js) — animação, estados reais, resumo, tela final,
 *     e que NADA é emitido (sem ANSI) quando não há terminal interativo;
 *  2. a separação dos fluxos no código — o boot novo só monta com
 *     LIZZY_SESSION_BOOT=1 E credenciais registradas, e o fluxo de PRIMEIRO LOGIN
 *     (QR/pairing) mantém a apresentação original intacta.
 *
 * O teste NÃO abre socket: importa o renderer e lê a fonte dos arquivos de fluxo.
 *
 * Uso: node tests/boot-session.test.js
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

import BootRenderer, { versaoDoProjeto, STAGES } from '../dados/src/utils/bootRenderer.js';
import { getJidLidCacheSize, initJidLidCache } from '../dados/src/utils/helpers.js';

// Inicializa o cache JID→LID de um arquivo temporário (o real só é carregado
// no boot do bot). Sem isso o tamanho seria 0 e o teste mediria nada.
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lizzy-boot-jidlid-'));
  const cacheFile = path.join(tmp, 'jid_lid_cache.json');
  fs.writeFileSync(cacheFile, JSON.stringify({ mappings: {
    '5511900000001@s.whatsapp.net': '111000000000001@lid',
    '5511900000002@s.whatsapp.net': '111000000000002@lid',
  } }));
  initJidLidCache(cacheFile);
}

const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => fs.readFileSync(path.join(HERE, '..', rel), 'utf8');

const RESULTS = [];
let CURRENT = null;
function test(name, fn) {
  CURRENT = { name, passed: 0, failed: 0, errors: [] };
  RESULTS.push(CURRENT);
  try {
    const r = fn();
    if (r && typeof r.then === 'function') {
      return r.then(() => finish()).catch((e) => { CURRENT.failed++; CURRENT.errors.push(`EXCEÇÃO: ${e?.stack || e}`); finish(); });
    }
    finish();
  } catch (e) {
    CURRENT.failed++; CURRENT.errors.push(`EXCEÇÃO: ${e?.stack || e}`); finish();
  }
  return Promise.resolve();
}
function finish() {
  console.log(`${CURRENT.failed === 0 ? '✅' : '❌'} ${CURRENT.name} (${CURRENT.passed} ok, ${CURRENT.failed} falhas)`);
  for (const e of CURRENT.errors) console.log(`   ↳ ${e}`);
}
function ok(c, m) { if (c) CURRENT.passed++; else { CURRENT.failed++; CURRENT.errors.push(`ASSERT: ${m}`); } }

/** Captura o que o renderer escreveu em stdout. */
async function capturar(fn) {
  const chunks = [];
  const orig = process.stdout.write;
  process.stdout.write = (s) => { chunks.push(String(s)); return true; };
  try {
    await fn();
  } finally {
    process.stdout.write = orig;
  }
  return chunks.join('');
}
const semAnsi = (s) => !/\x1b\[/.test(s);

// ───────────────────────────── renderer ─────────────────────────────

await test('renderer: enabled=false não emite nada', async () => {
  const r = new BootRenderer({ enabled: false });
  const out = await capturar(async () => { await r.intro(); r.step('core', 'online'); r.summary(); await r.finalize(); });
  ok(out === '', `não deveria emitir nada (obtido ${JSON.stringify(out.slice(0, 60))})`);
});

await test('renderer: sem TTY (enabled=true) não emite ANSI e confirma em texto', async () => {
  const r = new BootRenderer({ enabled: true, botName: 'Lizzy' });
  const out = await capturar(async () => { await r.intro(); r.summary(); await r.finalize(); });
  ok(semAnsi(out), 'não deveria ter sequência ANSI quando não é TTY');
  ok(out.includes('ONLINE') && out.includes('Lizzy'), 'deveria confirmar em texto');
});

await test('renderer: step guarda o estado real de cada etapa', () => {
  const r = new BootRenderer({ enabled: false });
  r.step('core', 'online');
  r.step('wa', 'connecting');
  r.step('ytdlp', 'failed');
  const inv = r.stages;
  ok(inv.get('core').state === 'online', 'core online');
  ok(inv.get('wa').state === 'connecting', 'wa connecting');
  ok(inv.get('ytdlp').state === 'failed', 'ytdlp failed');
  ok(inv.get('deps').state === 'pending', 'etapa não tocada continua pending');
});

await test('renderer: summary(error) NÃO falsifica sucesso', () => {
  const r = new BootRenderer({ enabled: false });
  r.step('core', 'online');
  r.step('wa', 'connecting');
  r.summary({ error: true });
  ok(r.stages.get('core').state === 'online', 'etapa concluída permanece concluída');
  ok(r.stages.get('wa').state === 'failed', 'etapa em andamento vira failed em erro');
  ok(r.stages.get('deps').state === 'failed', 'pendente vira failed em erro');
});

await test('renderer: setEnv/setQueue/setSubBots/setSystem guardam valores reais', () => {
  const r = new BootRenderer({ enabled: false });
  r.setEnv({ jidLid: 38, captcha: 0, serverIp: '1.2.3.4', waVersion: '2.3000.1' });
  r.setQueue('10 lotes de 2 mensagens (20 msgs paralelas)');
  r.setSubBots({ total: 2, active: 1 });
  r.setSystem({ messageCounter: 'active' });
  const s = r.snapshot;
  ok(s.jidLid === 38 && s.captcha === 0, 'jidLid/captcha reais');
  ok(s.serverIp === '1.2.3.4' && s.waVersion === '2.3000.1', 'ip/versão reais');
  ok(String(s.parallel).includes('20 msgs paralelas'), 'paralelismo real');
  ok(s.subBots.total === 2 && s.subBots.active === 1, 'sub-bots reais');
  ok(s.messageCounter === 'active', 'sistema real');
});

await test('versaoDoProjeto lê o package.json (sem hardcode)', () => {
  const pkg = JSON.parse(read('package.json'));
  const major = String(pkg.version).split('.')[0];
  ok(versaoDoProjeto() === major, `versaoDoProjeto() deveria ser ${major} (obtido ${versaoDoProjeto()})`);
});

await test('STAGES tem as 8 etapas esperadas e ids únicos', () => {
  ok(STAGES.length === 8, '8 etapas');
  ok(new Set(STAGES.map((s) => s.id)).size === 8, 'ids únicos');
  ok(STAGES.map((s) => s.id).join(',') === 'core,deps,ytdlp,abyss,wa,opt,plugins,subbots', 'ordem/ids');
  ok(STAGES.find((s) => s.id === 'abyss').label === 'LIZZY CORE', 'etapa 04 é LIZZY CORE');
});

await test('helpers: getJidLidCacheSize devolve número > 0', () => {
  const n = getJidLidCacheSize();
  ok(typeof n === 'number' && n > 0, `esperado número > 0 (obtido ${n})`);
});

// ───────────────────────────── separação dos fluxos ─────────────────────────────

await test('connect.js: boot só monta com LIZZY_SESSION_BOOT=1 E creds.registered', () => {
  const src = read('dados/src/connect.js');
  ok(/process\.env\.LIZZY_SESSION_BOOT === '1' && Boolean\(state\?\.creds\?\.registered\)/.test(src),
    'condição de sessão existente presente');
  ok(src.includes('new BootRenderer('), 'instancia o renderer');
  ok(src.includes('_bootTentado'), 'só monta uma vez por processo (não replay)');
});

await test('connect.js: etapas do boot acompanham os eventos reais', () => {
  const src = read('dados/src/connect.js');
  ok(src.includes("boot.step('abyss', 'online')"), 'abyss online ao conectar');
  ok(src.includes("boot.step('wa', 'connected')"), 'whatsapp connected ao abrir');
  ok(src.includes("boot.step('opt', 'active')"), 'otimização ativa');
  ok(src.includes('getJidLidCacheSize()'), 'JID-LID real');
  ok(/CaptchaIndex\.stats\(\)\.active/.test(src), 'captcha real');
  ok(src.includes('listSubBots()'), 'sub-bots reais');
  ok(src.includes('boot.summary('), 'resumo');
  ok(src.includes('boot.finalize()'), 'tela final');
});

await test('connect.js: QR de primeiro login NÃO é tocado', () => {
  const src = read('dados/src/connect.js');
  ok(src.includes("console.log('🔗 🌌 QR do Void gerado para autenticação:')"), 'QR original preservado');
  ok(src.includes('requestPairingCode'), 'pairing code original preservado');
  ok(/if \(boot\) \{ boot\.destroy\(\); _boot = null; \} \/\/ sessão inválida/.test(src), 'QR derruba o boot e volta ao fluxo original');
});

await test('connect.js: logs de boot originais ficam no caminho else (não no boot)', () => {
  const src = read('dados/src/connect.js');
  ok(/\} else \{\s*\n\s*console\.log\(`✅ Bot \$\{nomebot\} iniciado com sucesso/.test(src),
    'mensagem de sucesso original só fora do boot');
  ok(/\} else \{\s*\n\s*console\.log\(`🔄 Conexão aberta/.test(src),
    'log de conexão aberta só fora do boot');
});

await test('start.js: decide os DOIS fluxos e mantém o primeiro login intacto', () => {
  const src = read('dados/src/.scripts/start.js');
  ok(src.includes('temSessaoRegistrada()'), 'checagem real de credencial registrada');
  ok(src.includes('creds?.registered && creds?.me?.id'), 'registered + me.id');
  ok(src.includes('startBot(false, true)'), 'fluxo 1 inicia em modo sessão');
  ok(src.includes('await promptConnectionMethod()'), 'fluxo 2 continua perguntando o método');
  ok(src.includes("startBot(method === 'code', false)"), 'fluxo 2 continua igual');
  ok(src.includes("LIZZY_SESSION_BOOT: sessionMode ? '1' : '0'"), 'liga a flag só no fluxo de sessão');
});

await test('start.js: Termux/autostart silencioso só no fluxo de sessão', () => {
  const src = read('dados/src/.scripts/start.js');
  ok(src.includes('async function setupTermuxAutostart(quiet = false)'), 'aceita quiet');
  ok(src.includes("if (!quiet) info('📱 Não está rodando no Termux"), 'mensagem silenciada no fluxo de sessão');
  ok(src.includes('await setupTermuxAutostart(true)'), 'chamada quiet no fluxo 1');
});

await test('fdroidIndex: log do catálogo silenciado no fluxo de sessão (sistema continua)', () => {
  const src = read('dados/src/funcs/apk/fdroidIndex.js');
  ok(/if \(process\.env\.LIZZY_SESSION_BOOT !== '1'\) \{\s*\n\s*console\.log\(`\[APK\] catálogo F-Droid carregado/.test(src),
    'log gated pela flag de sessão');
  ok(src.includes('return catalog;'), 'continua devolvendo o catálogo (nada removido)');
});

// ───────────────────────────── render end-to-end (TTY) ─────────────────────────────

await test('render completo (TTY): painel, seções reais e tela ONLINE', async () => {
  const descritor = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY');
  Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
  try {
    const r = new BootRenderer({
      enabled: true, botName: 'Lizzy', prefix: '!', owner: 'Kannon', version: '4',
      baileys: { version: '0.3.18-final', repo: 'Souzzaaxzy/baileys' },
    });
    r.setEnv({ serverIp: '203.0.113.7', waVersion: '2.3000.1234567', jidLid: 38, captcha: 0 });
    r.step('core', 'online'); r.step('deps', 'ready'); r.step('ytdlp', 'ready');
    r.step('abyss', 'online'); r.step('wa', 'connected'); r.step('opt', 'active');
    r.step('plugins', 'ready'); r.step('subbots', 'ready');
    r.setSystem({ optimization: 'active', messageCounter: 'active', autoReset: 'active', pluginManager: 'ready' });
    r.setSubBots({ total: 0, active: 0 });
    r.setQueue('10 lotes de 2 mensagens (20 msgs paralelas)');

    const out = await capturar(async () => {
      await r.ready();          // animação + header (box + BOOT SEQUENCE)
      r.summary();
      await r.finalize();
    });
    const plain = out.replace(/\x1b\[[0-9;]*m/g, '');

    ok(plain.includes('L I Z Z Y'), 'nome no topo');
    ok(plain.includes('◈ BOOT SEQUENCE'), 'seção BOOT SEQUENCE');
    ok(plain.includes('LIZZY CORE'), 'etapa LIZZY CORE');
    ok(!plain.includes('ABYSS CORE'), 'não deve mais ter ABYSS CORE');
    ok(plain.includes('WHATSAPP ENGINE') && plain.includes('CONNECTED'), 'etapa WA conectada');
    ok(plain.includes('◈ ENVIRONMENT'), 'seção ENVIRONMENT');
    ok(plain.includes('203.0.113.7'), 'IP real');
    ok(plain.includes('https://github.com/Souzzaaxzy/baileys'), 'fork como link real');
    ok(plain.includes('0.3.18-final'), 'versão real do Baileys');
    ok(plain.includes('2.3000.1234567'), 'versão real do WhatsApp');
    ok(plain.includes('Nenhum sub-bot para inicializar.'), 'mensagem de sub-bot no layout');
    const envIdx = plain.indexOf('◈ ENVIRONMENT');
    const sysIdx = plain.indexOf('◈ SYSTEM');
    ok(envIdx !== -1 && sysIdx !== -1 && envIdx < sysIdx, 'ENVIRONMENT vem logo abaixo do BOOT SEQUENCE');
    const sysBlock = plain.slice(sysIdx);
    ok((sysBlock.match(/SUB-BOTS/g) || []).length === 0, 'SUB-BOTS não duplicado no SYSTEM');
    ok(plain.includes('◈ SESSION') && plain.includes('RESTORED') && plain.includes('AUTO CONNECT'), 'sessão restaurada');
    ok(plain.includes('38 ENTRIES'), 'JID-LID real');
    ok(plain.includes('0 PENDING'), 'captcha real');
    ok(plain.includes('◈ SYSTEM'), 'seção SYSTEM');
    ok(plain.includes('◈ BOT') && plain.includes('Lizzy') && plain.includes('!') && plain.includes('Kannon'), 'seção BOT com dados reais');
    ok(plain.includes('20 msgs paralelas'), 'paralelismo real');
    ok(plain.includes('ONLINE') && plain.includes('SYSTEM READY') && plain.includes('WAITING FOR COMMANDS'), 'tela final');
    ok(/L\s*I\s*Z\s*Z\s*Y/.test(plain), 'formação do nome na animação');
    ok(!plain.includes('QR'), 'sessão restaurada NÃO mostra QR');
    // Append-only: a PARTIR do painel nada é apagado/repintado (era o que sumia
    // no console). A animação de entrada antes do painel tem repaint próprio,
    // escopado ao bloco dela.
    const painelOut = out.slice(out.indexOf('\u25c8 BOOT SEQUENCE'));
    ok(!/\x1b\[0J/.test(painelOut), 'o painel não deve limpar a tela (\\x1b[0J)');
    ok(!/\x1b\[\d+A/.test(painelOut), 'o painel não deve mover o cursor para cima');
  } finally {
    if (descritor) Object.defineProperty(process.stdout, 'isTTY', descritor);
    else delete process.stdout.isTTY;
  }
});

await test('render (TTY) NÃO falsifica etapa pendente como ONLINE', async () => {
  const descritor = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY');
  Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
  try {
    const r = new BootRenderer({ enabled: true, botName: 'Lizzy', prefix: '!', owner: 'Kannon', version: '4' });
    r.step('core', 'online');
    r.step('wa', 'connecting'); // ainda conectando (real)
    const out = await capturar(() => { r.summary(); });
    const plain = out.replace(/\x1b\[[0-9;]*m/g, '');
    ok(plain.includes('CONNECTING'), 'etapa em andamento aparece como CONNECTING');
    ok(!/WHATSAPP ENGINE[^\n]*CONNECTED/.test(plain), 'não deve mostrar CONNECTED sem ter conectado');
  } finally {
    if (descritor) Object.defineProperty(process.stdout, 'isTTY', descritor);
    else delete process.stdout.isTTY;
  }
});

await test('finalize NÃO apaga o painel (ONLINE é anexado abaixo)', async () => {
  const descritor = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY');
  Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
  try {
    const r = new BootRenderer({
      enabled: true, botName: 'Lizzy', prefix: '!', owner: 'Kannon', version: '4',
      baileys: { version: '0.3.18-final', repo: 'Souzzaaxzy/baileys' },
    });
    r.setEnv({ serverIp: '203.0.113.7', waVersion: '2.3000.1', jidLid: 38, captcha: 0 });
    r.step('core', 'online'); r.step('abyss', 'online'); r.step('wa', 'connected');
    r.setSubBots({ total: 0, active: 0 });

    const painel = await capturar(async () => {
      await r.ready();
      r.summary();
    });
    // Captura o finalize ISOLADO: ele NÃO pode emitir cursor-para-cima nem
    // limpar tela (isso apagaria o painel — o bug reportado).
    const finalOut = await capturar(async () => { await r.finalize(); });

    const plain = (painel + finalOut).replace(/\x1b\[[0-9;]*m/g, '');
    ok(painel.includes('◈ ENVIRONMENT') && painel.includes('SERVER IP'), 'painel tem ENVIRONMENT antes do finalize');
    ok(plain.includes('Nenhum sub-bot para inicializar.'), 'a linha de sub-bots continua no painel');
    ok(plain.includes('WHATSAPP ENGINE READY'), 'a tela ONLINE aparece');
    ok(plain.indexOf('◈ ENVIRONMENT') < plain.indexOf('WHATSAPP ENGINE READY'), 'ENVIRONMENT antes da tela ONLINE');
    ok(!/\x1b\[0J/.test(finalOut), 'finalize NÃO limpa a tela (\\x1b[0J)');
    ok(!/\x1b\[\d*A/.test(finalOut), 'finalize NÃO move o cursor para cima');
  } finally {
    if (descritor) Object.defineProperty(process.stdout, 'isTTY', descritor);
    else delete process.stdout.isTTY;
  }
});

// ───────────────────────────── resumo ─────────────────────────────

console.log('\n' + '─'.repeat(60));
let passed = 0, failed = 0;
for (const r of RESULTS) { passed += r.passed; failed += r.failed; }
console.log(`Total: ${RESULTS.length} testes / ${passed} asserções ok, ${failed} falhas`);
process.exit(failed === 0 ? 0 : 1);
