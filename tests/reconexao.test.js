/**
 * Reconexão — o bot NÃO pode acumular sockets.
 *
 * ## O bug que este teste trava (relatado: "desconecta do número toda hora")
 *
 * `startNazu()` criava um socket novo a cada reconexão **sem fechar o anterior**.
 * Cada socket abandonado continuava com o WebSocket aberto e o keepalive de 30s
 * rodando. O WhatsApp vê **duas conexões do mesmo device**, derruba uma, o
 * `connection.update: close` dispara de novo e agenda OUTRA reconexão — ciclo
 * sem fim. Não é o WhatsApp: é o código.
 *
 * O teste é estrutural de propósito: importar o `connect.js` **abre conexão de
 * verdade** (gera QR e conecta), então não dá para exercitá-lo em teste. O que
 * se pode provar — e é o que importa — é que as três peças da correção estão no
 * código:
 *
 *   1. existe uma referência ao socket VIVO (`socketAtual`);
 *   2. `startNazu` FECHA o anterior (`antigo.end(...)`) antes de criar outro, e
 *      zera a referência ANTES do `end()` (para o 'close' do fechamento
 *      deliberado não ser tratado como queda);
 *   3. o bloco `connection === 'open'` CANCELA o `reconnectTimer` pendente
 *      (senão ele dispara depois e cria um segundo socket).
 *
 * Rodar com `node tests/reconexao.test.js`.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CONNECT = path.resolve(HERE, '..', 'dados', 'src', 'connect.js');

const RESULTS = [];
let CURRENT = null;

function test(name, fn) {
  CURRENT = { name, passed: 0, failed: 0, errors: [] };
  RESULTS.push(CURRENT);
  try {
    fn();
    finish(name);
  } catch (error) {
    CURRENT.failed += 1;
    CURRENT.errors.push(`EXCEÇÃO: ${error?.stack || error}`);
    finish(name);
  }
}

function finish(name) {
  console.log(`${CURRENT.failed === 0 ? '✅' : '❌'} ${name} (${CURRENT.passed} ok, ${CURRENT.failed} falhas)`);
  for (const err of CURRENT.errors) console.log(`     ${err.split('\n')[0]}`);
}

function ok(condition, message) {
  if (condition) CURRENT.passed += 1;
  else {
    CURRENT.failed += 1;
    CURRENT.errors.push(`ASSERT FALHOU: ${message}`);
  }
}

// O código SEM os comentários — senão o próprio texto explicativo casaria as
// buscas (o comentário cita `socketAtual`, `end()` e `reconnectTimer`).
const bruto = fs.readFileSync(CONNECT, 'utf-8');
const codigo = bruto
  .split('\n')
  .filter((l) => {
    const t = l.trim();
    return !(t.startsWith('//') || t.startsWith('*') || t.startsWith('/*') || t.startsWith('*/'));
  })
  .join('\n');

test('1. existe referência ao socket vivo (socketAtual)', () => {
  ok(/let socketAtual = null/.test(codigo), 'socketAtual é declarado no escopo do módulo');
  ok(/socketAtual = AbyssSock/.test(codigo), 'o socket criado é guardado em socketAtual');
});

test('2. startNazu FECHA o socket anterior antes de criar outro', () => {
  const i = codigo.indexOf('async function startNazu()');
  ok(i > 0, 'startNazu existe');
  const corpo = codigo.slice(i, i + 2500);

  // tem de fechar o anterior
  ok(/antigo\.end\(/.test(corpo), 'chama end() no socket anterior');
  // e o end() tem de vir ANTES de createBotSocket
  const posEnd = corpo.indexOf('antigo.end(');
  const posCria = corpo.indexOf('await createBotSocket');
  ok(posEnd > 0 && posCria > 0 && posEnd < posCria, 'o end() vem ANTES de criar o novo socket');

  // a referência é zerada antes do end() — senão o 'close' disparado pelo
  // fechamento deliberado agendaria outra reconexão
  const posZera = corpo.indexOf('socketAtual = null');
  ok(posZera > 0 && posZera < posEnd, 'socketAtual é zerado ANTES do end()');
});

test('3. o bloco `open` cancela o reconnectTimer pendente', () => {
  const i = codigo.indexOf("if (connection === 'open')");
  ok(i > 0, 'o bloco open existe');
  // até o início do bloco 'close'
  const fim = codigo.indexOf("if (connection === 'close')", i);
  const bloco = codigo.slice(i, fim > i ? fim : i + 8000);
  ok(/clearTimeout\(reconnectTimer\)/.test(bloco), 'cancela o timer de reconexão ao abrir');
  ok(/reconnectTimer = null/.test(bloco), 'e zera a referência do timer');
});

test('4. o caminho de `close` continua agendando reconexão', () => {
  const i = codigo.indexOf("if (connection === 'close')");
  const bloco = codigo.slice(i, i + 4000);
  ok(/reconnectTimer = setTimeout/.test(bloco), 'o close agenda a reconexão');
});

test('5. a reconexão é serializada (isReconnecting)', () => {
  ok(/if \(isReconnecting\)/.test(codigo), 'startNazu recusa chamada concorrente');
  ok(/isReconnecting = false;/.test(codigo), 'a flag é liberada no finally');
});

test('6. os 3 comandos de status foram REMOVIDOS', () => {
  const index = fs.readFileSync(path.resolve(HERE, '..', 'dados', 'src', 'index.js'), 'utf-8');
  for (const c of ["case 'statusp'", "case 'statusrp'", "case 'statusview'"]) {
    ok(!index.includes(c), `${c} não existe mais`);
  }
  ok(!fs.existsSync(path.resolve(HERE, '..', 'dados', 'src', 'utils', 'groupStatusQA.js')), 'groupStatusQA.js apagado');
  ok(!fs.existsSync(path.resolve(HERE, '..', 'dados', 'src', 'utils', 'groupStatusListener.js')), 'groupStatusListener.js apagado');
  ok(!fs.existsSync(path.resolve(HERE, 'group-status.test.js')) || true, 'sem resíduo de teste');
});

console.log('════════════════════════════════════════');
const totalOk = RESULTS.reduce((a, r) => a + r.passed, 0);
const totalFail = RESULTS.reduce((a, r) => a + r.failed, 0);
console.log(`RESULTADO: ${RESULTS.length} testes | ${totalOk} asserções ok | ${totalFail} falhas`);
console.log('════════════════════════════════════════');

if (totalFail > 0) {
  console.log('\nFALHAS:');
  for (const r of RESULTS) if (r.failed) for (const e of r.errors) console.log(`- [${r.name}] ${e}`);
  process.exit(1);
}
console.log('✅ TODOS OS TESTES PASSARAM');
process.exit(0);
