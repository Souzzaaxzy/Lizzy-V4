/**
 * O LOG da chamada — limpo e com o que importa.
 *
 * O `lizzy-call` fala muito: cada stanza sinalizada, cada `ack` de keepalive,
 * cada estágio do relay. O pedido do dono: *"tira todas as logs, estão muito
 * bagunçadas (apenas do sistema do callp/vozp) e coloca log do que precisamos
 * saber"*.
 *
 * Este teste trava as duas regras: **ruído sai** e **repetição é colapsada**.
 *
 * Uso: node tests/call-log.test.js
 */

import { criarLogDaCall, ehRuido, PREFIXO } from '../dados/src/utils/callLog.js';

const RESULTS = [];
let CURRENT = null;
function test(name, fn) {
  CURRENT = { name, passed: 0, failed: 0, errors: [] };
  RESULTS.push(CURRENT);
  try { fn(); finish(name); } catch (e) {
    CURRENT.failed += 1; CURRENT.errors.push(`EXCEÇÃO: ${e?.stack || e}`); finish(name);
  }
}
function finish(name) {
  console.log(`${CURRENT.failed === 0 ? '✅' : '❌'} ${name} (${CURRENT.passed} ok, ${CURRENT.failed} falhas)`);
  for (const err of CURRENT.errors) console.log(`     ${err.split('\n')[0]}`);
}
function ok(cond, msg) {
  if (cond) CURRENT.passed += 1;
  else { CURRENT.failed += 1; CURRENT.errors.push(`ASSERT FALHOU: ${msg}`); }
}

/** Coleta o que o filtro deixou passar. */
function coletar(linhas, opts) {
  const saida = [];
  const log = criarLogDaCall({ escrever: (l) => saida.push(l), ...opts });
  for (const l of linhas) log(l);
  log.flush?.(); // fecha a sequencia, como o bot faz no fim do ciclo
  return saida;
}

// ============================================================================
// 1) O RUÍDO SAI
// ============================================================================

test('sinalizacao por stanza NAO aparece (era uma por mensagem)', () => {
  const saida = coletar(['[CALLP] sinalização -> 4ABD@call (107 bytes)']);
  ok(saida.length === 0, `nao passou (veio ${JSON.stringify(saida)})`);
});

test('acks de keepalive (relaylatency / peer_state) NAO aparecem', () => {
  const saida = coletar([
    '[CALLP] ack de relaylatency (id=1) error=0',
    '[CALLP] ack de peer_state (id=2) error=0'
  ]);
  ok(saida.length === 0, 'keepalive nao polui');
});

test('ACK COM ERRO passa (e noticia, nao rotina)', () => {
  const saida = coletar(['[CALLP] ack de peer_state (id=515) error=500']);
  ok(saida.length === 1, 'erro aparece');
  ok(saida[0].includes('error=500'), 'com o erro junto');
});

test('SEM ACK passa (e o setup que nao conclui)', () => {
  const saida = coletar(['[CALLP] SEM ACK para offer (id=9, destino=X@call)']);
  ok(saida.length === 1, 'o SEM ACK e diagnostico, fica');
});

test('estagios repetitivos do relay NAO aparecem', () => {
  const saida = coletar([
    '[RELAY] stun_alloc_visto — 1.2.3.4:3478',
    '[RELAY] transporte_iniciando — 1.2.3.4:3478',
    '[RELAY] relay_list_recebida — 1.2.3.4:3478'
  ]);
  ok(saida.length === 0, 'os estagios de rotina saem');
});

// ============================================================================
// 2) O QUE IMPORTA FICA
// ============================================================================

test('o que responde "onde parou" passa inteiro', () => {
  const uteis = [
    '[CALLP] mídia PRONTA no grupo 123@g.us',
    '[CALLP] mídia não ficou pronta em 30s (sem_remoto_conectado_com_pid)',
    '[CALLP] roster tx=11 participantes=3 conectados=1 midia=false',
    '[CALLP] a call ESTA CAINDO (encerrando)',
    '[CALLP] call encerrada pelo servidor',
    '[RELAY] udp cru: caminho de volta CONFIRMADO (40 bytes)',
    '[RELAY] conexao_falhou — state=ice_timeout'
  ];
  const saida = coletar(uteis);
  ok(saida.length === uteis.length, `todas passaram (${saida.length}/${uteis.length})`);
  ok(saida.every((l) => l.startsWith(PREFIXO)), 'todas com o prefixo unico');
});

test('o erro real (conexao_falhou / socket) nao e escondido', () => {
  const saida = coletar([
    '[RELAY] udp cru: connect falhou — ENOENT',
    '[RELAY] udp cru: erro no socket — ECONNREFUSED'
  ]);
  ok(saida.length === 2, 'erros de socket sao noticia');
});

// ============================================================================
// 3) REPETIÇÃO COLAPSADA
// ============================================================================

test('a MESMA linha seguida NAO reimprime: sai uma vez + a contagem', () => {
  const linha = '[CALLP] roster tx=11 participantes=3 conectados=1 midia=false';
  const saida = coletar([linha, linha, linha, linha]);
  // 4 repeticoes -> 2 linhas (a original + o aviso de repeticao), nao 4.
  ok(saida.length === 2, `duas linhas em vez de quatro (veio ${saida.length})`);
  ok(saida[0].includes('roster'), 'a primeira e a linha de verdade');
  ok(saida[1].includes('(x4)'), `a segunda diz a contagem (veio ${saida[1]})`);
});

test('linha que NAO repete nao ganha (xN)', () => {
  const saida = coletar(['[CALLP] a', '[CALLP] b']);
  ok(saida.length === 2 && !saida.join('').includes('(x'), 'sem contagem falsa');
});

test('alternar entre linhas nao colapsa (so a repeticao SEGUIDA)', () => {
  const a = '[CALLP] roster tx=1 conectados=1';
  const b = '[CALLP] roster tx=2 conectados=2';
  const saida = coletar([a, b, a]);
  ok(saida.length === 3, `cada troca imprime (veio ${saida.length})`);
});

// ============================================================================
// 4) ROBUSTEZ
// ============================================================================

test('entradas vazias/lixo nao quebram nem imprimem', () => {
  const saida = coletar(['', null, undefined, '   ', 0, {}]);
  ok(saida.length === 0, `nada saiu (veio ${saida.length})`);
});

test('ehRuido e util e previsivel', () => {
  ok(ehRuido('') === true, 'vazio e ruido');
  ok(ehRuido('[CALLP] sinalização -> x') === true, 'sinalizacao e ruido');
  ok(ehRuido('[CALLP] ack de peer_state error=0') === true, 'ack ok e ruido');
  ok(ehRuido('[CALLP] ack de peer_state error=500') === false, 'ack com erro NAO e ruido');
  ok(ehRuido('[CALLP] mídia PRONTA') === false, 'midia pronta NAO e ruido');
});

// ============================================================================

const totalOk = RESULTS.reduce((a, r) => a + r.passed, 0);
const totalFail = RESULTS.reduce((a, r) => a + r.failed, 0);
console.log('\n' + '='.repeat(40));
console.log(`RESULTADO: ${RESULTS.length} testes | ${totalOk} asserções ok | ${totalFail} falhas`);
console.log('='.repeat(40));
process.exit(totalFail > 0 ? 1 : 0);
