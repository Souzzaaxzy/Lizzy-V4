/**
 * Testes do AntiFantasma — plugin remoto.
 *
 * O que este teste protege (o ponto crítico do pedido):
 *
 *   1. A API NUNCA devolve código. Nenhuma resposta pode conter o fonte do
 *      núcleo, nome de função interna, caminho de arquivo ou algoritmo — só o
 *      NOME da ação a executar.
 *   2. KEY inválida/revogada NÃO executa o núcleo (403) e não vaza nada.
 *   3. O adaptador só EXECUTA: ativar/desativar/estaAtivo, não chama a API
 *      quando desativado, e traduz os erros nas mensagens exatas.
 *   4. O núcleo decide as 3 ações (fechar/banir/reabrir) e respeita os guardas.
 *
 * Uso: node tests/antifantasma-plugin.test.js
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.resolve(HERE, '..');

const TMP_DB = fs.mkdtempSync(path.join(os.tmpdir(), 'lizzy-af-db-'));
process.env.DATABASE_PATH = TMP_DB;
fs.mkdirSync(path.join(TMP_DB, 'antifantasma'), { recursive: true });

const RESULTS = [];
let CURRENT = null;

function test(name, fn) {
  CURRENT = { name, passed: 0, failed: 0, errors: [] };
  RESULTS.push(CURRENT);
  const done = (error) => {
    if (error) {
      CURRENT.failed += 1;
      CURRENT.errors.push(`EXCEÇÃO: ${error?.stack || error}`);
    }
    console.log(`${CURRENT.failed === 0 ? '✅' : '❌'} ${name} (${CURRENT.passed} ok, ${CURRENT.failed} falhas)`);
    for (const err of CURRENT.errors) console.log(`     ${err.split('\n')[0]}`);
  };
  try {
    const result = fn();
    if (result && typeof result.then === 'function') return result.then(() => done()).catch(done);
    done();
  } catch (error) {
    done(error);
  }
  return Promise.resolve();
}

function ok(condition, message) {
  if (condition) CURRENT.passed += 1;
  else {
    CURRENT.failed += 1;
    CURRENT.errors.push(`ASSERT FALHOU: ${message}`);
  }
}

// ============================================================================
// IMPORTS
// ============================================================================

const core = await import(new URL('../dados/src/antifantasma/core.js', import.meta.url).href);
const api = await import(new URL('../dados/src/antifantasma/api.js', import.meta.url).href);
const keys = await import(new URL('../dados/src/antifantasma/keys.js', import.meta.url).href);

// Helper: cria uma key vinculada a um dono e devolve o SEGREDO (a string).
const novaKey = (owner = '5511999999999') => keys.criarKey({ owner }).key;

const { createRequire } = await import('module');
const require = createRequire(import.meta.url);
// O adaptador é CommonJS (é um arquivo entregue, deve rodar em qualquer bot).
// O adaptador e CommonJS (o `require('./antifantasma')` do bot do usuario).
// O repo da Lizzy e ESM, entao copiamos para .cjs e carregamos de la.
const ADAPTADOR_CJS = path.join(TMP_DB, 'antifantasma.cjs');
fs.copyFileSync(path.join(PROJECT, 'dados', 'src', 'antifantasma-cliente', 'antifantasma.js'), ADAPTADOR_CJS);
const adaptador = require(ADAPTADOR_CJS);

const CONTEXTO_ATAQUE = {
  isGroup: true,
  botIsAdmin: true,
  sender: '5511999999999@s.whatsapp.net',
  selectiveDistribution: true,
  undecryptableGroupMessage: true,
};

// ============================================================================
// 1) NÚCLEO PRIVADO — decisão
// ============================================================================

await test('núcleo: ataque de distribuição seletiva autoriza fechar+banir+reabrir', () => {
  const r = core.decidir(CONTEXTO_ATAQUE);
  ok(r.actions.length === 3, `três ações (${r.actions})`);
  ok(r.actions[0] === 'close_group', 'primeiro fecha');
  ok(r.actions[1] === 'ban_user', 'depois bane');
  ok(r.actions[2] === 'open_group', 'por fim reabre');
});

await test('núcleo: NÃO age sem os dois sinais juntos (evita falso positivo)', () => {
  // Só a marca de seletiva, sem mensagem não decifrável: não é ataque.
  const soSeletiva = core.decidir({ ...CONTEXTO_ATAQUE, undecryptableGroupMessage: false });
  ok(soSeletiva.actions.length === 0, 'só seletiva não basta');

  const soUndecryptable = core.decidir({ ...CONTEXTO_ATAQUE, selectiveDistribution: false });
  ok(soUndecryptable.actions.length === 0, 'só não-decifrável não basta');
});

await test('núcleo: guardas bloqueiam a punição', () => {
  ok(core.decidir({ ...CONTEXTO_ATAQUE, isGroup: false }).actions.length === 0, 'não é grupo');
  ok(core.decidir({ ...CONTEXTO_ATAQUE, fromMe: true }).actions.length === 0, 'mensagem própria');
  ok(core.decidir({ ...CONTEXTO_ATAQUE, botIsAdmin: false }).actions.length === 0, 'bot sem poder');
  ok(core.decidir({ ...CONTEXTO_ATAQUE, sender: '' }).actions.length === 0, 'autor desconhecido');
  ok(core.decidir({ ...CONTEXTO_ATAQUE, senderIsPrivileged: true }).actions.length === 0, 'autor privilegiado');
  ok(core.decidir({ ...CONTEXTO_ATAQUE, senderIsWhitelisted: true }).actions.length === 0, 'autor em whitelist');
  ok(core.decidir({ ...CONTEXTO_ATAQUE, alreadyPunished: true }).actions.length === 0, 'já punido');
});

await test('núcleo: pagamento zerado também é ataque', () => {
  const r = core.decidir({ ...CONTEXTO_ATAQUE, selectiveDistribution: false, undecryptableGroupMessage: false, zeroValuePayment: true });
  ok(r.actions.includes('ban_user'), 'bane o autor do pagamento zerado');
});

await test('núcleo: mensagem normal não gera ação', () => {
  const r = core.decidir({ isGroup: true, botIsAdmin: true, sender: 'x@s.whatsapp.net' });
  ok(r.actions.length === 0, 'nada a fazer');
  ok(r.reason === 'sem_ataque', `motivo sem_ataque (${r.reason})`);
});

await test('núcleo: entrada inválida não quebra', () => {
  for (const entrada of [null, undefined, 0, 'x', [], { sender: 123 }, { isGroup: 'sim' }]) {
    const r = core.decidir(entrada);
    ok(Array.isArray(r.actions) && r.actions.length === 0, `entrada ${JSON.stringify(entrada)} -> nenhuma ação`);
  }
});

// ============================================================================
// 2) API — KEY
// ============================================================================

await test('API: KEY válida processa e devolve só a AÇÃO', () => {
  const key = novaKey();
  const { status, body } = api.processarRequisicao({ key, context: CONTEXTO_ATAQUE });

  ok(status === 200, `status 200 (${status})`);
  ok(body.success === true, 'success true');
  ok(body.action === 'close_group', 'action = close_group (primeira)');
  ok(Array.isArray(body.actions) && body.actions.length === 3, 'lista de ações');
  ok(typeof body.notice === 'string' && body.notice.length > 0, 'notice presente');
});

await test('API: KEY inválida/ausente/revogada -> 403 e NÃO executa o núcleo', () => {
  const inexistente = api.processarRequisicao({ key: 'MTX-NAOEXISTE', context: CONTEXTO_ATAQUE });
  ok(inexistente.status === 403, `inexistente 403 (${inexistente.status})`);
  ok(inexistente.body.success === false, 'sem sucesso');
  ok(inexistente.body.actions === undefined, 'não devolve ações');

  const ausente = api.processarRequisicao({ context: CONTEXTO_ATAQUE });
  ok(ausente.status === 403, 'ausente 403');

  const revogavel = keys.criarKey({ owner: '5511999999999' });
  keys.revogarPorId(revogavel.id);
  const revogada = api.processarRequisicao({ key: revogavel.key, context: CONTEXTO_ATAQUE });
  ok(revogada.status === 403, `revogada 403 (${revogada.status})`);
  ok(revogada.body.actions === undefined, 'revogada não devolve ações');
});

await test('API: KEY de outro plugin é recusada', () => {
  // Uma key que existe no arquivo mas nunca foi registrada pelo plugin não
  // autoriza nada (o registro agora é por id/dono, não por um mapa solto).
  const r = api.processarRequisicao({ key: 'MTX-NAO-REGISTRADA', context: CONTEXTO_ATAQUE });
  ok(r.status === 403, `403 para key fora do registro (${r.status})`);
});

await test('API: sem ataque devolve sucesso sem ação (não revela o motivo)', () => {
  const key = novaKey();
  const { status, body } = api.processarRequisicao({ key, context: { isGroup: true, botIsAdmin: true, sender: 'x@s.whatsapp.net' } });
  ok(status === 200, '200');
  ok(body.success === true, 'success');
  ok(body.action === null && body.actions.length === 0, 'sem ação');
  ok(body.notice === undefined, 'não manda notice à toa');
});

// ============================================================================
// 3) A REGRA DE OURO — A API NUNCA DEVOLVE CÓDIGO
// ============================================================================

await test('API NUNCA vaza código, regra ou caminho interno', () => {
  const key = novaKey();
  const respostas = [
    api.processarRequisicao({ key, context: CONTEXTO_ATAQUE }),
    api.processarRequisicao({ key, context: {} }),
    api.processarRequisicao({ key: 'ruim', context: CONTEXTO_ATAQUE }),
  ];

  // Marcadores que denunciariam vazamento de implementação.
  const proibidos = [
    'function', '=>', 'require(', 'import ', 'module.exports',
    'core.js', 'src/', 'dados/', 'seletiva &&', 'selectiveDistribution',
    'undecryptable', 'alreadyPunished', 'normalizeContext', 'decidir(',
    'process.env', 'stack',
  ];

  for (const { body } of respostas) {
    const texto = JSON.stringify(body);
    const chaves = Object.keys(body);

    // Só pode conter chaves de resultado.
    for (const k of chaves) {
      ok(['success', 'error', 'action', 'actions', 'notice'].includes(k), `chave permitida (${k})`);
    }

    for (const p of proibidos) {
      ok(!texto.includes(p), `resposta não contém "${p}"`);
    }

    // As ações são apenas os três nomes conhecidos.
    for (const a of (body.actions || [])) {
      ok(['close_group', 'ban_user', 'open_group'].includes(a), `ação é do vocabulário (${a})`);
    }
  }
});

await test('nenhum endpoint serve o core: rota desconhecida responde 404', async () => {
  // Sobe o servidor numa porta efêmera e tenta buscar o código.
  const server = api.iniciarApi(0);
  ok(Boolean(server), 'servidor subiu');

  await new Promise((r) => setTimeout(r, 100));
  const porta = server.address().port;

  const tentar = (caminho) => new Promise((resolve) => {
    const http = require('node:http');
    const req = http.request({ hostname: '127.0.0.1', port: porta, path: caminho, method: 'GET' }, (res) => {
      let t = '';
      res.on('data', (d) => { t += d; });
      res.on('end', () => resolve({ status: res.statusCode, body: t }));
    });
    req.on('error', () => resolve({ status: 0, body: '' }));
    req.end();
  });

  for (const caminho of ['/core.js', '/api/antifantasma/source', '/api/antifantasma/code', '/antifantasma/core.js', '/api/antifantasma/exec']) {
    const r = await tentar(caminho);
    ok(r.status === 404, `${caminho} -> 404 (${r.status})`);
    ok(!r.body.includes('decidir') && !r.body.includes('function'), `${caminho} não devolve código`);
  }

  // E a rota real responde JSON de resultado.
  const real = await new Promise((resolve) => {
    const http = require('node:http');
    const key = novaKey();
    const corpo = JSON.stringify({ key, context: CONTEXTO_ATAQUE });
    const req = http.request(
      { hostname: '127.0.0.1', port: porta, path: '/api/antifantasma/exec', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(corpo) } },
      (res) => {
        let t = '';
        res.on('data', (d) => { t += d; });
        res.on('end', () => resolve({ status: res.statusCode, body: t }));
      }
    );
    req.on('error', () => resolve({ status: 0, body: '' }));
    req.end(corpo);
  });

  ok(real.status === 200, `rota real 200 (${real.status})`);
  const json = JSON.parse(real.body || '{}');
  ok(json.actions?.includes('ban_user'), 'devolve a ação via HTTP');
  ok(!real.body.includes('function'), 'HTTP também não devolve código');

  await new Promise((r) => server.close(r));
});

// ============================================================================
// 4) ADAPTADOR (o que o usuário recebe)
// ============================================================================

await test('adaptador: expõe a interface pública prometida', () => {
  for (const fn of ['ativar', 'desativar', 'estaAtivo', 'executar', 'iniciar']) {
    ok(typeof adaptador[fn] === 'function', `expõe ${fn}()`);
  }
});

await test('adaptador: estado local ativa/desativa/consulta', () => {
  adaptador.desativar();
  ok(adaptador.estaAtivo() === false, 'começa desativado após desativar()');
  adaptador.ativar();
  ok(adaptador.estaAtivo() === true, 'ativar() liga');
  adaptador.desativar();
  ok(adaptador.estaAtivo() === false, 'desativar() desliga');
});

await test('adaptador: DESATIVADO não faz chamada nenhuma', async () => {
  adaptador.desativar();
  // Aponta a API para um host que não existe: se tentasse chamar, demoraria/falharia.
  const r = await adaptador.executar({
    sock: { groupSettingUpdate: async () => { throw new Error('NAO DEVERIA CHAMAR'); } },
    grupo: 'g@g.us',
    autor: 'x@s.whatsapp.net',
    reply: async () => { throw new Error('NAO DEVERIA RESPONDER'); },
  });
  ok(r.ok === true, 'retorna ok sem fazer nada');
  ok(r.acoes.length === 0, 'nenhuma ação');
});

await test('adaptador: a lógica NÃO está no arquivo entregue', () => {
  const fonte = fs.readFileSync(path.join(PROJECT, 'dados', 'src', 'antifantasma-cliente', 'antifantasma.js'), 'utf-8');

  // O adaptador pode conhecer os NOMES das ações (precisa executá-las), mas não
  // pode conter os critérios que decidem quando cada uma acontece.
  const proibido = [
    'selectiveDistribution', 'undecryptableGroupMessage', 'zeroValuePayment',
    'alreadyPunished', 'senderIsPrivileged', 'senderIsWhitelisted',
    'normalizeContext', 'decidir',
  ];
  for (const p of proibido) {
    ok(!fonte.includes(p), `adaptador não contém "${p}"`);
  }

  // Não importa o núcleo de forma alguma.
  ok(!fonte.includes('core.js'), 'adaptador não referencia core.js');
  ok(!fonte.includes('require(\'./core'), 'adaptador não importa o núcleo');
});

await test('adaptador: executa as ações autorizadas via sock', async () => {
  // Servidor local fazendo o papel da API, respondendo uma sequência.
  const http = require('node:http');
  const chamadas = [];
  const server = http.createServer((req, res) => {
    let t = '';
    req.on('data', (d) => { t += d; });
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, action: 'close_group', actions: ['close_group', 'ban_user', 'open_group'], notice: '❌ tentou atacar' }));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const porta = server.address().port;

  // Adapta a URL do módulo para o servidor local (o arquivo é do usuário; aqui
  // só apontamos a API para o teste).
  const fonte = fs.readFileSync(path.join(PROJECT, 'dados', 'src', 'antifantasma-cliente', 'antifantasma.js'), 'utf-8');
  const adaptado = fonte.replace(
    /const API_URL = '[^']*';/,
    `const API_URL = 'http://127.0.0.1:${porta}/api/antifantasma/exec';`
  ).replace(/const KEY = '[^']*';/, "const KEY = 'MTX-TESTE';");

  const tmp = path.join(TMP_DB, 'adaptador-teste.cjs');
  fs.writeFileSync(tmp, adaptado);
  const mod = require(tmp);

  mod.ativar();
  const sock = {
    groupSettingUpdate: async (grupo, tipo) => { chamadas.push(`setting:${tipo}`); },
    groupParticipantsUpdate: async (grupo, alvos, acao) => { chamadas.push(`participants:${acao}`); },
    sendMessage: async () => { chamadas.push('aviso'); },
  };

  const r = await mod.executar({ sock, grupo: 'g@g.us', autor: '5511999999999@s.whatsapp.net' });

  ok(r.ok === true, 'executou');
  ok(chamadas.includes('setting:announcement'), 'fechou o grupo');
  ok(chamadas.includes('participants:remove'), 'baniu o usuário');
  ok(chamadas.includes('setting:not_announcement'), 'reabriu o grupo');
  ok(r.acoes.length === 3, `três ações executadas (${r.acoes})`);

  await new Promise((r2) => server.close(r2));
});

await test('adaptador: KEY inválida responde a mensagem certa', async () => {
  const http = require('node:http');
  const server = http.createServer((req, res) => {
    req.on('data', () => {});
    req.on('end', () => { res.writeHead(403, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ success: false, error: 'key_invalida' })); });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const porta = server.address().port;

  const fonte = fs.readFileSync(path.join(PROJECT, 'dados', 'src', 'antifantasma-cliente', 'antifantasma.js'), 'utf-8');
  const adaptado = fonte.replace(/const API_URL = '[^']*';/, `const API_URL = 'http://127.0.0.1:${porta}/x';`);
  const tmp = path.join(TMP_DB, 'adaptador-403.cjs');
  fs.writeFileSync(tmp, adaptado);
  const mod = require(tmp);
  mod.ativar();

  const respostas = [];
  const r = await mod.executar({ sock: {}, grupo: 'g@g.us', autor: 'x@s.whatsapp.net', reply: async (t) => respostas.push(t) });

  ok(r.ok === false, 'não executou');
  ok(respostas.some((t) => t.includes('KEY do AntiFantasma inválida')), `mensagem de KEY (${respostas})`);

  await new Promise((r2) => server.close(r2));
});

await test('adaptador: serviço indisponível responde a mensagem certa', async () => {
  const fonte = fs.readFileSync(path.join(PROJECT, 'dados', 'src', 'antifantasma-cliente', 'antifantasma.js'), 'utf-8');
  // Porta fechada -> conexão recusada.
  const adaptado = fonte.replace(/const API_URL = '[^']*';/, "const API_URL = 'http://127.0.0.1:1/x';");
  const tmp = path.join(TMP_DB, 'adaptador-off.cjs');
  fs.writeFileSync(tmp, adaptado);
  const mod = require(tmp);
  mod.ativar();

  const respostas = [];
  const r = await mod.executar({ sock: {}, grupo: 'g@g.us', autor: 'x@s.whatsapp.net', reply: async (t) => respostas.push(t) });

  ok(r.ok === false, 'não executou');
  ok(respostas.some((t) => t.includes('Serviço AntiFantasma indisponível')), `mensagem de indisponível (${respostas})`);
});

await test('adaptador: erro interno responde a mensagem certa', async () => {
  const http = require('node:http');
  const server = http.createServer((req, res) => {
    req.on('data', () => {});
    req.on('end', () => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ success: false, error: 'interno' })); });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const porta = server.address().port;

  const fonte = fs.readFileSync(path.join(PROJECT, 'dados', 'src', 'antifantasma-cliente', 'antifantasma.js'), 'utf-8');
  const adaptado = fonte.replace(/const API_URL = '[^']*';/, `const API_URL = 'http://127.0.0.1:${porta}/x';`);
  const tmp = path.join(TMP_DB, 'adaptador-500.cjs');
  fs.writeFileSync(tmp, adaptado);
  const mod = require(tmp);
  mod.ativar();

  const respostas = [];
  await mod.executar({ sock: {}, grupo: 'g@g.us', autor: 'x@s.whatsapp.net', reply: async (t) => respostas.push(t) });
  ok(respostas.some((t) => t.includes('Não foi possível processar')), `mensagem interna (${respostas})`);

  await new Promise((r2) => server.close(r2));
});

// ============================================================================

const totalOk = RESULTS.reduce((a, r) => a + r.passed, 0);
const totalFail = RESULTS.reduce((a, r) => a + r.failed, 0);
console.log('\n════════════════════════════════════════');
console.log(`RESULTADO: ${RESULTS.length} testes | ${totalOk} asserções ok | ${totalFail} falhas`);
console.log('════════════════════════════════════════');

fs.rmSync(TMP_DB, { recursive: true, force: true });

if (totalFail > 0) {
  console.log('\nFALHAS:');
  for (const r of RESULTS) if (r.failed) for (const e of r.errors) console.log(`- [${r.name}] ${e}`);
  process.exit(1);
}
console.log('✅ TODOS OS TESTES PASSARAM');
process.exit(0);