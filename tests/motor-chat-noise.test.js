/**
 * MOTOR DA CALL — o ruido de CHAT que travava o bot.
 *
 * O sintoma que este teste trava (relatado pelo dono, com os logs na mao):
 *
 *   failed to send retry receipt for decrypt failure { ... }
 *   offline batch request failed, giving up { attempts: 5, remainingStanzas: 12462 }
 *   noise session is not established
 *   addon parent message secret not found { ... }
 *   wa client error { ... }
 *
 * Essas mensagens NAO sao do Baileys: sao do `zapo-js` (o client separado da
 * call). Ele e' um client COMPLETO e, sem configuracao, processava TODO o
 * trafego da sessao — historico, mensagens de grupo, addons — na MESMA thread
 * do bot. O `!vozp` subia e o bot inteiro parava.
 *
 * Uso: node tests/motor-chat-noise.test.js
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const RESULTS = [];
let CURRENT = null;

function test(name, fn) {
  CURRENT = { name, passed: 0, failed: 0, errors: [] };
  RESULTS.push(CURRENT);
  try {
    const r = fn();
    if (r && typeof r.then === 'function') {
      return r.then(() => finish(name)).catch((e) => {
        CURRENT.failed += 1; CURRENT.errors.push(`EXCEÇÃO: ${e?.stack || e}`); finish(name);
      });
    }
    finish(name);
  } catch (e) {
    CURRENT.failed += 1; CURRENT.errors.push(`EXCEÇÃO: ${e?.stack || e}`); finish(name);
  }
  return Promise.resolve();
}
function finish(name) {
  console.log(`${CURRENT.failed === 0 ? '✅' : '❌'} ${name} (${CURRENT.passed} ok, ${CURRENT.failed} falhas)`);
  for (const err of CURRENT.errors) console.log(`     ${err.split('\n')[0]}`);
}
function ok(cond, msg) {
  if (cond) CURRENT.passed += 1;
  else { CURRENT.failed += 1; CURRENT.errors.push(`ASSERT FALHOU: ${msg}`); }
}
function includes(hay, needle, label) {
  ok(typeof hay === 'string' && hay.includes(needle),
    `${label ?? needle} — esperado conter "${needle}"`);
}

// ============================================================================

const motor = await import(new URL('../dados/src/utils/motorLogger.js', import.meta.url).href);
const SRC = fs.readFileSync(new URL('../dados/src/funcs/utils/zapoCall.js', import.meta.url), 'utf8');

// ============================================================================
// 1) LOGGER DO MOTOR — silencia o ruido, mantem o que importa
// ============================================================================

await test('ehRuidoDoMotor: reconhece as frases EXATAS do log do dono', () => {
  for (const frase of [
    'failed to send retry receipt for decrypt failure',
    'offline batch request failed, giving up',
    'noise session is not established',
    'noise session not ready',
    'addon parent message secret not found',
    'wa client error'
  ]) {
    ok(motor.ehRuidoDoMotor(frase), `reconhece: ${frase}`);
  }
  // O que NAO e' ruido (e' da call) tem de passar.
  ok(!motor.ehRuidoDoMotor('offer refused by the server, call ended'), 'erro de call não é ruído');
  ok(!motor.ehRuidoDoMotor('noise session established'), 'handshake OK não é ruído');
  ok(!motor.ehRuidoDoMotor('offline resume complete'), 'fim do offline não é ruído');
});

await test('criarLoggerDoMotor: NÃO imprime o ruido (o log fica limpo)', () => {
  const linhas = [];
  const log = motor.criarLoggerDoMotor({ nivel: 'warn', escrever: (m) => linhas.push(m) });
  log.warn('failed to send retry receipt for decrypt failure');
  log.warn('offline batch request failed, giving up');
  log.warn('noise session is not established');
  log.warn('addon parent message secret not found');
  log.warn('wa client error');
  ok(linhas.length === 0, `nada foi impresso (${linhas.length} linhas)`);
});

await test('criarLoggerDoMotor: o que é da CALL continua saindo', () => {
  const linhas = [];
  const log = motor.criarLoggerDoMotor({ nivel: 'warn', escrever: (m) => linhas.push(m) });
  log.warn('offer refused by the server, call ended');
  log.warn('raw udp leg rolled back, no media on the return path');
  ok(linhas.length === 2, `as duas linhas de call saíram (${linhas.length})`);
});

await test('criarLoggerDoMotor: ERROR passa SEMPRE (não silenciar erro de verdade)', () => {
  const linhas = [];
  const log = motor.criarLoggerDoMotor({ nivel: 'warn', escrever: (m) => linhas.push(m) });
  log.error('wa client error');
  ok(linhas.length === 1, 'erro passou mesmo casando com o filtro de ruído');
});

await test('criarLoggerDoMotor: respeita o nível mínimo', () => {
  const linhas = [];
  const log = motor.criarLoggerDoMotor({ nivel: 'warn', escrever: (m) => linhas.push(m) });
  log.debug('qualquer coisa');
  log.info('qualquer coisa');
  ok(linhas.length === 0, 'debug/info abaixo de warn não saem');
  log.warn('call active');
  ok(linhas.length === 1, 'warn sai');
});

await test('criarLoggerDoMotor: tem a interface do Logger do zapo-js', () => {
  const log = motor.criarLoggerDoMotor();
  for (const m of ['trace', 'debug', 'info', 'warn', 'error']) {
    ok(typeof log[m] === 'function', `tem ${m}()`);
  }
  ok(typeof log.child === 'function', 'tem child()');
  ok(log.level === 'warn', 'expõe o level');
  ok(typeof log.child({ x: 1 }).warn === 'function', 'o filho também loga');
});

// ============================================================================
// 2) O MOTOR ESTÁ CONFIGURADO PARA SÓ A CALL
// ============================================================================

await test('o motor NÃO baixa histórico (history.enabled false)', () => {
  includes(SRC, 'history: { enabled: false }', 'history desligado');
  // A razão: o bot não persiste mailbox — o download só queima banda.
  includes(SRC, "messages: 'none'", 'não persiste mailbox (a razão do desligamento)');
});

await test('o motor NÃO decifra addons (reação/edição/voto)', () => {
  includes(SRC, 'addons: { autoDecrypt: false }', 'addons desligados');
});

await test('o motor usa o logger FILTRADO, não o ConsoleLogger cru', () => {
  includes(SRC, 'criarLoggerDoMotor', 'cria o logger filtrado');
  includes(SRC, 'loggerDoMotor', 'passa o logger filtrado ao WaClient');
  // O `ConsoleLogger` cru imprimia tudo — se voltar, o log volta a encher.
  ok(!/new ConsoleLogger\(/.test(SRC), 'não instancia o ConsoleLogger cru');
});

await test('o motor instala o filtro de stanzas de CHAT', () => {
  includes(SRC, 'registerIncomingStanzaFilter(ehStanzaDeChat)', 'usa o filtro de stanza do lowlevel');
  includes(SRC, 'ehStanzaDeChat', 'a regra vem do módulo (testável)');
  ok(!/only: \['message', 'notification'\]/.test(SRC),
    'não usa o `only` cru (droparia a notificação de pareamento)');
});

// ============================================================================
// 3) A REGRA DO FILTRO (pura — mede o que dropa e o que PRESERVA)
// ============================================================================

await test('ehStanzaDeChat DROPA mensagem e notificação de CONTEÚDO', () => {
  ok(motor.ehStanzaDeChat({ tag: 'message', attrs: { from: 'g@g.us' } }) === true,
    'mensagem de chat é dropada');
  for (const tipo of ['w:gp2', 'business', 'newsletter', 'picture', 'mediaretry', 'encrypt']) {
    ok(motor.ehStanzaDeChat({ tag: 'notification', attrs: { type: tipo } }) === true,
      `notificação de conteúdo dropada: ${tipo}`);
  }
});

await test('ehStanzaDeChat PRESERVA a notificação de PARECIMENTO (não pode quebrar o pareamento)', () => {
  // `passkey_prologue_request` e `companion_reg_refresh` são do fluxo de
  // pareamento — dropar travaria o login do dispositivo.
  for (const tipo of ['passkey_prologue_request', 'crsc_continuation', 'companion_reg_refresh', 'registration', 'devices', 'server', 'account_sync']) {
    ok(motor.ehStanzaDeChat({ tag: 'notification', attrs: { type: tipo } }) === false,
      `preserva notificação de infra: ${tipo}`);
  }
});

await test('ehStanzaDeChat PRESERVA a sinalização da call e a infra do protocolo', () => {
  ok(motor.ehStanzaDeChat({ tag: 'call', attrs: { from: 'x@lid' } }) === false,
    'a stanza <call> passa (offer/accept/enc_rekey/group_update)');
  for (const tag of ['ack', 'receipt', 'iq', 'success', 'failure', 'ib', 'presence', 'chatstate']) {
    ok(motor.ehStanzaDeChat({ tag, attrs: {} }) === false, `passa: <${tag}>`);
  }
  // Notificação sem `type` (não classificável) passa — na dúvida, não dropa.
  ok(motor.ehStanzaDeChat({ tag: 'notification', attrs: {} }) === false,
    'notificação sem type passa');
});

await test('a lista de tipos de chat é a esperada (não cresceu por engano)', () => {
  const tipos = motor.TIPOS_NOTIFICACAO_DE_CHAT;
  ok(Array.isArray(tipos) && tipos.length === 6, `6 tipos (${tipos.length})`);
  for (const t of ['w:gp2', 'business', 'newsletter', 'picture', 'mediaretry', 'encrypt']) {
    ok(tipos.includes(t), `inclui ${t}`);
  }
});

// ============================================================================

let totalOk = 0, totalFail = 0;
for (const r of RESULTS) { totalOk += r.passed; totalFail += r.failed; }
console.log('\n' + '='.repeat(60));
console.log(`TOTAL: ${RESULTS.length} testes | ${totalOk} asserções ok | ${totalFail} falhas`);
console.log('='.repeat(60));
process.exit(totalFail === 0 ? 0 : 1);
