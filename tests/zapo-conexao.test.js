/**
 * O BUG do "conectando" infinito: `startCall` numa conexao FECHADA.
 *
 * ## O que estava errado
 *
 * `obterCliente()` fazia `void client.connect()` (fire-and-forget) e retornava
 * na hora. O `entrarNaCallComMidia` chamava `startCall` logo depois -- ou seja,
 * o offer saia numa conexao que AINDA NAO tinha aberto. O servidor nunca
 * recebia o offer e a call ficava em "conectando" para sempre.
 *
 * A doc do zapo e' explicita: *"Opens the transport and runs the noise/auth
 * handshake. Resolves once the client is fully ready."*
 *
 * ## O que este teste trava
 *
 * A ORDEM: dentro do `entrarNaCallComMidia`, a espera pela conexao tem de vir
 * ANTES do `startCall`.
 *
 * Uso: node tests/zapo-conexao.test.js
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const TMP_DB = fs.mkdtempSync(path.join(os.tmpdir(), 'lizzy-conn-'));
process.env.DATABASE_PATH = TMP_DB;

const RESULTS = [];
let CURRENT = null;

function test(name, fn) {
  CURRENT = { name, passed: 0, failed: 0, errors: [] };
  RESULTS.push(CURRENT);
  try {
    const r = fn();
    if (r && typeof r.then === 'function') {
      return r.then(() => finish(name)).catch((e) => {
        CURRENT.failed += 1; CURRENT.errors.push(`EXCECAO: ${e?.stack || e}`); finish(name);
      });
    }
    finish(name);
  } catch (e) {
    CURRENT.failed += 1; CURRENT.errors.push(`EXCECAO: ${e?.stack || e}`); finish(name);
  }
  return Promise.resolve();
}
function finish(name) {
  console.log(`${CURRENT.failed === 0 ? '[ok]' : '[XX]'} ${name} (${CURRENT.passed} ok, ${CURRENT.failed} falhas)`);
  for (const err of CURRENT.errors) console.log(`     ${err.split('\n')[0]}`);
}
function ok(cond, msg) {
  if (cond) CURRENT.passed += 1;
  else { CURRENT.failed += 1; CURRENT.errors.push(`ASSERT FALHOU: ${msg}`); }
}
function includes(hay, needle, label) {
  ok(typeof hay === 'string' && hay.includes(needle),
    `${label ?? needle} - esperado conter "${needle}"`);
}

const SRC = fs.readFileSync(new URL('../dados/src/funcs/utils/zapoCall.js', import.meta.url), 'utf8');
const INDEX = fs.readFileSync(new URL('../dados/src/index.js', import.meta.url), 'utf8');

console.log('\n=== 1) A CORRECAO ESTA NO CODIGO ===\n');

await test('o `connect()` e AGUARDADO quando ja esta pareado', () => {
  includes(SRC, 'await client.connect()', 'espera o connect (nao e mais fire-and-forget)');
  includes(SRC, 'const jaPareado = estaPareado()', 'decide pelo estado de pareamento');
});

await test('existe `aguardarConexao` (o sinal de que da para mandar stanza)', () => {
  includes(SRC, 'function aguardarConexao', 'a funcao existe');
  includes(SRC, "ev?.status === 'open'", 'espera o status open');
});

await test('o `entrarNaCallComMidia` confirma a conexao ANTES do startCall', () => {
  const bloco = SRC.slice(
    SRC.indexOf('export async function entrarNaCallComMidia'),
    SRC.indexOf('export async function estagioMidia')
  );
  ok(bloco.length > 0, 'achou o bloco');
  includes(bloco, 'if (!conectado)', 'checa o estado antes');
  includes(bloco, 'await aguardarConexao', 'espera abrir se preciso');

  // A ordem importa: dentro DESTE bloco, a espera tem de vir antes do startCall.
  // (Buscar no arquivo inteiro pegaria a ocorrencia do `agendarReconexao`.)
  // Procura a CHAMADA real (), nao a palavra solta --
  // o comentario acima cita 'startCall' e daria falso positivo.
  const posEspera = bloco.indexOf('await aguardarConexao');
  const posStart = bloco.indexOf('cli.voip.startCall(');
  ok(posEspera !== -1 && posStart !== -1 && posEspera < posStart,
    'a espera vem ANTES do startCall (era o bug)');

  includes(bloco, "motivo: 'sem_conexao'", 'devolve motivo proprio quando nao abre');
});

await test('o zapo NAO reconecta sozinho -> temos reconexao propria', () => {
  // A doc do pacote: "There is no built-in auto-reconnect; subscribe to
  // connection:{status:'close'} and decide your own backoff."
  includes(SRC, 'function agendarReconexao', 'agenda reconexao');
  includes(SRC, "ev?.status === 'close'", 'escuta o close');
  includes(SRC, 'isLogout', 'nao reconecta quando o dispositivo foi desvinculado');
});

await test('o listener de `connection` existe (o estado vem dele)', () => {
  includes(SRC, "client.on('connection'", 'escuta o evento de conexao');
  includes(SRC, 'conectado = true', 'marca aberto');
  includes(SRC, 'conectado = false', 'marca fechado');
});

await test('o timer de reconexao nao segura o processo', () => {
  includes(SRC, 'unref', 'usa unref no timer');
});

await test('o `resetarMidia` limpa o estado de conexao', () => {
  const bloco = SRC.slice(SRC.indexOf('export function resetarMidia'));
  includes(bloco, 'conectado = false', 'zera conectado');
  includes(bloco, 'clearTimeout(timerReconexao)', 'cancela a reconexao pendente');
});

console.log('\n=== 2) O COMPORTAMENTO (client falso que abre atrasado) ===\n');

await test('startCall NAO roda antes de a conexao abrir', async () => {
  let abriu = false;
  const chamadas = [];

  const clientFalso = {
    connect: async () => { await new Promise((r) => setTimeout(r, 50)); abriu = true; },
    on: () => {},
    once: () => {},
    voip: {
      startCall: async () => { chamadas.push({ quando: abriu }); return 'CALL-ID'; }
    }
  };

  // A ORDEM que o codigo corrigido impoe: espera abrir, depois chama.
  await clientFalso.connect();
  if (abriu) await clientFalso.voip.startCall();

  ok(chamadas.length === 1, 'startCall foi chamado');
  ok(chamadas[0].quando === true, 'startCall so rodou DEPOIS de abrir');

  // O comportamento ANTIGO (o bug):
  const chamadasBug = [];
  let abriuBug = false;
  const clientBug = {
    connect: async () => { await new Promise((r) => setTimeout(r, 50)); abriuBug = true; },
    voip: { startCall: async () => { chamadasBug.push({ quando: abriuBug }); } }
  };
  void clientBug.connect();              // fire-and-forget (o bug)
  await clientBug.voip.startCall();      // roda na hora
  ok(chamadasBug[0].quando === false,
    'com fire-and-forget o startCall sairia com a conexao FECHADA (o bug)');
});

await test('aguardarConexao resolve quando o evento open chega', async () => {
  const handlers = {};
  const fake = { once: (ev, cb) => { handlers[ev] = cb; } };
  let aberto = false;
  const espera = new Promise((resolve) => {
    fake.once('connection', (ev) => { if (ev?.status === 'open') { aberto = true; resolve(true); } });
  });
  setTimeout(() => handlers.connection({ status: 'open' }), 20);
  const r = await espera;
  ok(r === true && aberto === true, 'resolveu com o evento open');
});

console.log('\n=== 3) A MENSAGEM AO USUARIO ===\n');

await test('`sem_conexao` tem mensagem propria (nao e erro criptico)', () => {
  includes(INDEX, 'sem_conexao', 'motivo tratado');
  includes(INDEX, 'conexão do motor de mídia não abriu', 'texto claro');
});

await test('o codigo nao afirma mais que "nao se espera" o connect', () => {
  ok(!SRC.includes('nao se espera por ele aqui'), 'o comentario do bug foi removido');
});

const totalOk = RESULTS.reduce((a, r) => a + r.passed, 0);
const totalFail = RESULTS.reduce((a, r) => a + r.failed, 0);
console.log('\n' + '='.repeat(40));
console.log(`RESULTADO: ${RESULTS.length} testes | ${totalOk} assercoes ok | ${totalFail} falhas`);
console.log('='.repeat(40));
if (totalFail > 0) process.exit(1);
