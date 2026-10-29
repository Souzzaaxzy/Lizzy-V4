/**
 * AS CHAVES DO GROQ (ate' 10) e a TROCA AUTOMATICA.
 *
 * O dono pediu: *"o plano e' gratis e acaba, quero adicionar mais de uma chave
 * para que quando uma acabar usar a proxima imediatamente"* — com os comandos
 * `!keygroq` ate' `!keygroq10`.
 *
 * Uso: node tests/groq-keys.test.js
 */

import fs from 'fs';
import os from 'os';
import path from 'path';

const TMP_DB = fs.mkdtempSync(path.join(os.tmpdir(), 'lizzy-gk-'));
// O estado das chaves (esgotadas) vive num arquivo — isola no tmp.
process.env.GROQ_KEYS_STATE_FILE = path.join(TMP_DB, 'groqKeysState.json');
process.env.DATABASE_PATH = TMP_DB;
process.env.CONFIG_PATH = path.join(TMP_DB, 'config.json');
fs.mkdirSync(path.join(TMP_DB, 'grupos'), { recursive: true });
fs.mkdirSync(path.join(TMP_DB, 'dono'), { recursive: true });
fs.writeFileSync(process.env.CONFIG_PATH, JSON.stringify({
  prefixo: '!', nomebot: 'Lizzy do privy', nomedono: 'Kannon',
  numerodono: '5511915323638', debug: false
}, null, 2));

const keys = await import(new URL('../dados/src/utils/groqKeys.js', import.meta.url).href);
const groq = await import(new URL('../dados/src/utils/groqClient.js', import.meta.url).href);

const RESULTS = [];
let CURRENT = null;
function test(name, fn) {
  CURRENT = { name, passed: 0, failed: 0, errors: [] };
  RESULTS.push(CURRENT);
  try {
    const r = fn();
    if (r && typeof r.then === 'function') {
      return r.then(() => finish(name)).catch((e) => { CURRENT.failed += 1; CURRENT.errors.push(`EXCECAO: ${e?.stack || e}`); finish(name); });
    }
    finish(name);
  } catch (e) { CURRENT.failed += 1; CURRENT.errors.push(`EXCECAO: ${e?.stack || e}`); finish(name); }
  return Promise.resolve();
}
function finish(name) {
  console.log(`${CURRENT.failed === 0 ? 'OK ' : 'ERR'} ${name} (${CURRENT.passed} ok, ${CURRENT.failed} falhas)`);
  for (const err of CURRENT.errors) console.log(`     ${err.split('\n')[0]}`);
}
function ok(c, m) { if (c) CURRENT.passed += 1; else { CURRENT.failed += 1; CURRENT.errors.push(`ASSERT FALHOU: ${m}`); } }
function contem(h, n, l) { ok(typeof h === 'string' && h.includes(n), `${l ?? n} — esperado conter "${n}"`); }

const INDEX = fs.readFileSync(new URL('../dados/src/index.js', import.meta.url), 'utf-8');

/** Limpa as chaves do ambiente E o estado (o teste controla o cenario). */
function limparEnv() {
  for (let i = 1; i <= 10; i++) delete process.env[keys.nomeDaVar(i)];
  keys._limparCacheDeEstado();
  keys.resetarEsgotadas(true);
}

/** Um erro do axios com status (o que o `classificarErroGroq` le'). */
function erroHttp(status, msg) {
  const e = new Error(`HTTP ${status}`);
  e.response = { status, data: { error: { message: msg || (status === 429 ? 'rate limit exceeded' : 'Invalid API Key') } } };
  return e;
}

// ---------------------------------------------------------------------------
// 1) OS NOMES E A LEITURA
// ---------------------------------------------------------------------------
console.log('\n=== 1) NOMES E LEITURA ===\n');

await test('1. o slot 1 mantem o nome antigo (quem ja configurou nao perde)', () => {
  ok(keys.nomeDaVar(1) === 'GROQ_API_KEY', 'slot 1 = GROQ_API_KEY');
  ok(keys.nomeDaVar(2) === 'GROQ_API_KEY_2', 'slot 2 = GROQ_API_KEY_2');
  ok(keys.nomeDaVar(10) === 'GROQ_API_KEY_10', 'slot 10 = GROQ_API_KEY_10');
});

await test('2. `!keygroq` = slot 1 e `!keygroqN` = slot N (ate 10)', () => {
  ok(keys.slotDoComando('keygroq') === 1, 'keygroq -> 1');
  ok(keys.slotDoComando('keygroq1') === 1, 'keygroq1 -> 1');
  ok(keys.slotDoComando('keygroq2') === 2, 'keygroq2 -> 2');
  ok(keys.slotDoComando('keygroq10') === 10, 'keygroq10 -> 10');
  ok(keys.slotDoComando('GROQKEY5') === 5, 'aceita maiuscula e o alias groqkey');
  ok(keys.slotDoComando('keygroq11') === null, 'acima de 10 -> null');
  ok(keys.slotDoComando('keygroq0') === null, 'zero -> null');
  ok(keys.slotDoComando('keygroqX') === null, 'letra -> null');
  ok(keys.slotDoComando('ping') === null, 'outro comando -> null');
});

await test('3. le as chaves NA ORDEM dos slots (buraco e ignorado)', () => {
  limparEnv();
  process.env.GROQ_API_KEY = 'k1';
  process.env.GROQ_API_KEY_3 = 'k3';
  process.env.GROQ_API_KEY_5 = 'k5';
  const lista = keys.lerChaves();
  ok(lista.length === 3, `3 chaves (veio ${lista.length})`);
  ok(JSON.stringify(lista.map((c) => c.slot)) === JSON.stringify([1, 3, 5]), 'os slots 1,3,5 (o 2 e o 4 vazios sao pulados)');
  ok(JSON.stringify(lista.map((c) => c.chave)) === JSON.stringify(['k1', 'k3', 'k5']), 'na ordem');
  limparEnv();
});

await test('4. a chave NUNCA aparece inteira (mascarar)', () => {
  const m = keys.mascarar('gsk_1234567890abcdef');
  ok(m === 'gsk_...cdef', `mostra so o comeco e o fim (veio ${m})`);
  ok(!m.includes('1234567890'), 'o meio nao aparece');
  ok(keys.mascarar('') === 'nao configurada', 'vazio');
});

await test('5. `atualizarEnv` troca, cria e REMOVE a linha do slot certo', () => {
  const base = 'OUTRA=1\nGROQ_API_KEY=antiga\nMAIS=2\n';

  const trocado = keys.atualizarEnv(base, 1, 'nova');
  ok(trocado.includes('GROQ_API_KEY=nova'), 'trocou o valor');
  ok(!trocado.includes('antiga'), 'o antigo saiu');
  ok(trocado.includes('OUTRA=1') && trocado.includes('MAIS=2'), 'nao mexeu nas outras linhas');

  const criado = keys.atualizarEnv(base, 4, 'quatro');
  ok(criado.includes('GROQ_API_KEY_4=quatro'), 'criou o slot 4');

  const removido = keys.atualizarEnv(base, 1, null);
  ok(!removido.includes('GROQ_API_KEY='), 'removeu a linha');
  ok(removido.includes('OUTRA=1') && removido.includes('MAIS=2'), 'e manteve o resto');
});

await test('6. atualizarEnv NAO confunde o slot 1 com o 10', () => {
  // A armadilha classica: um regex solto casaria `GROQ_API_KEY_10` ao mexer
  // no slot 1 (prefixo!). O `^nome=` exato evita isso.
  const base = 'GROQ_API_KEY=um\nGROQ_API_KEY_10=dez\n';
  const r = keys.atualizarEnv(base, 1, 'novo');
  ok(r.includes('GROQ_API_KEY=novo'), 'trocou o slot 1');
  ok(r.includes('GROQ_API_KEY_10=dez'), 'e NAO tocou no slot 10');
});

// ---------------------------------------------------------------------------
// 2) O FAILOVER (o pedido central)
// ---------------------------------------------------------------------------
console.log('\n=== 2) A TROCA AUTOMATICA ===\n');

/** Dubla o HTTP e registra a chave usada em cada chamada. */
function dublar(comportamento) {
  const usadas = [];
  groq.setGroqHttpForTest(async (url, data, cfg) => {
    const chave = String(cfg?.headers?.Authorization || '').replace('Bearer ', '');
    usadas.push(chave);
    return comportamento(chave);
  });
  return usadas;
}

await test('7. cota estourada (429) na 1 -> a 2 assume NA HORA', async () => {
  limparEnv();
  process.env.GROQ_API_KEY = 'k1';
  process.env.GROQ_API_KEY_2 = 'k2';
  const usadas = dublar((chave) => {
    if (chave === 'k1') throw erroHttp(429);
    return { data: { choices: [{ message: { content: 'oi!' } }] } };
  });

  const r = await groq.groqChat({ texto: 'oi', sistema: 's' });
  ok(r.ok, 'a resposta veio');
  ok(r.texto === 'oi!', 'o texto veio da chave 2');
  ok(JSON.stringify(usadas) === JSON.stringify(['k1', 'k2']), `tentou a 1 e depois a 2 (veio ${JSON.stringify(usadas)})`);
  groq.setGroqHttpForTest(null);
});

await test('8. chave INVALIDA (401) tambem rotaciona', async () => {
  limparEnv();
  process.env.GROQ_API_KEY = 'k1';
  process.env.GROQ_API_KEY_2 = 'k2';
  const usadas = dublar((chave) => {
    if (chave === 'k1') throw erroHttp(401, 'Invalid API Key');
    return { data: { choices: [{ message: { content: 'ok' } }] } };
  });
  const r = await groq.groqChat({ texto: 'oi', sistema: 's' });
  ok(r.ok, 'a resposta veio');
  ok(JSON.stringify(usadas) === JSON.stringify(['k1', 'k2']), 'rotacionou');
  groq.setGroqHttpForTest(null);
});

await test('9. a chave que FUNCIONOU vira a atual (nao volta pra 1)', async () => {
  limparEnv();
  process.env.GROQ_API_KEY = 'k1';
  process.env.GROQ_API_KEY_2 = 'k2';
  process.env.GROQ_API_KEY_3 = 'k3';
  const usadas = dublar((chave) => {
    if (chave === 'k1') throw erroHttp(429);
    if (chave === 'k2') throw erroHttp(429);
    return { data: { choices: [{ message: { content: 'ok' } }] } };
  });

  await groq.groqChat({ texto: 'a', sistema: 's' });
  ok(groq.chaveGroq() === 'k3', `a atual e a 3 (veio ${groq.chaveGroq()})`);
  ok(JSON.stringify(keys.estadoDasChaves().esgotadas) === JSON.stringify([1, 2]),
    '1 e 2 ficaram marcadas como esgotadas');

  // A PROXIMA chamada nao pode tentar a 1 de novo (queimaria cota a toa).
  usadas.length = 0;
  const r = await groq.groqChat({ texto: 'b', sistema: 's' });
  ok(r.ok, 'a segunda resposta veio');
  ok(JSON.stringify(usadas) === JSON.stringify(['k3']), `a 2a chamada JA' comeca na 3 (veio ${JSON.stringify(usadas)})`);
  groq.setGroqHttpForTest(null);
});

await test('10. TODAS estouradas -> erro controlado e TODAS ficam marcadas', async () => {
  limparEnv();
  process.env.GROQ_API_KEY = 'k1';
  process.env.GROQ_API_KEY_2 = 'k2';
  const usadas = dublar(() => { throw erroHttp(429); });

  const r = await groq.groqChat({ texto: 'oi', sistema: 's' });
  ok(!r.ok, 'nao deu ok');
  ok(r.motivo === 'limite', `o motivo e' limite (veio ${r.motivo})`);
  ok(usadas.length === 2, `tentou as duas (veio ${usadas.length})`);
  // Agora as duas ficam MARCADAS: nao voltam a ser tentadas hoje.
  ok(JSON.stringify(keys.estadoDasChaves().esgotadas) === JSON.stringify([1, 2]),
    `as duas marcadas (veio ${JSON.stringify(keys.estadoDasChaves().esgotadas)})`);
  ok(groq.chaveGroq() === '', 'sem chave disponivel');
  groq.setGroqHttpForTest(null);
});

await test('11. erro de REDE nao queima outra chave', async () => {
  limparEnv();
  process.env.GROQ_API_KEY = 'k1';
  process.env.GROQ_API_KEY_2 = 'k2';
  const usadas = dublar(() => { const e = new Error('timeout'); e.code = 'ECONNABORTED'; throw e; });

  const r = await groq.groqChat({ texto: 'oi', sistema: 's' });
  ok(!r.ok && r.motivo === 'rede', `motivo rede (veio ${r.motivo})`);
  ok(usadas.length === 1, `tentou SO' uma chave (veio ${usadas.length}) — rotacionar ali queimaria cota a toa`);
  groq.setGroqHttpForTest(null);
});

await test('12. UMA chave so, cota estourada -> o erro dela (sem loop)', async () => {
  limparEnv();
  process.env.GROQ_API_KEY = 'k1';
  const usadas = dublar(() => { throw erroHttp(429); });
  const r = await groq.groqChat({ texto: 'oi', sistema: 's' });
  ok(r.motivo === 'limite', 'o motivo');
  ok(usadas.length === 1, 'tentou uma vez (nao fica em loop)');
  groq.setGroqHttpForTest(null);
});

await test('13. SEM chave nenhuma -> sem_chave_groq', async () => {
  limparEnv();
  const r = await groq.groqChat({ texto: 'oi', sistema: 's' });
  ok(!r.ok && r.motivo === 'sem_chave_groq', `veio ${r.motivo}`);
  ok(groq.chaveGroq() === '', 'chaveGroq vazia');
});

await test('14. a TRANSCRICAO tambem rotaciona', async () => {
  limparEnv();
  process.env.GROQ_API_KEY = 'k1';
  process.env.GROQ_API_KEY_2 = 'k2';
  const usadas = dublar((chave) => {
    if (chave === 'k1') throw erroHttp(429);
    return { data: 'transcricao ok' };
  });
  const wav = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(60)]);
  const r = await groq.groqTranscrever(wav, 'audio/wav', {});
  ok(r.ok, `a transcricao veio (motivo: ${r.motivo || '-'})`);
  ok(r.texto === 'transcricao ok', 'o texto');
  ok(JSON.stringify(usadas) === JSON.stringify(['k1', 'k2']), 'rotacionou na transcricao tambem');
  groq.setGroqHttpForTest(null);
});

// ---------------------------------------------------------------------------
// 3) OS COMANDOS NO HANDLER
// ---------------------------------------------------------------------------
console.log('\n=== 3) OS COMANDOS ===\n');

await test('15. os 10 comandos existem no handler', () => {
  for (const nome of ['keygroq', 'keygroq1', 'keygroq2', 'keygroq10']) {
    ok(INDEX.includes(`case '${nome}':`), `existe o case '${nome}'`);
  }
  // A faixa inteira: 1 a 10.
  for (let i = 1; i <= 10; i++) {
    const nome = i === 1 ? 'keygroq' : `keygroq${i}`;
    ok(INDEX.includes(`case '${nome}':`), `slot ${i} -> ${nome}`);
  }
});

await test('16. o comando usa os helpers (nada de logica duplicada)', () => {
  const i = INDEX.indexOf("case 'keygroq':");
  const bloco = INDEX.slice(i, i + 4200);
  ok(bloco.includes('slotDoComando(command)'), 'descobre o slot pelo comando');
  ok(bloco.includes('lerChaves()'), 'le as chaves configuradas');
  ok(bloco.includes('atualizarEnv('), 'grava no .env pelo helper (nao por regex solto)');
  ok(bloco.includes('mascarar('), 'mostra mascarada');
  ok(bloco.includes('podeDonoTotal()'), 'so o dono');
  ok(bloco.includes('off'), 'tem como remover');
});

await test('17. o `!key` (Gemini) NAO apaga as chaves do Groq', () => {
  // Regressao do bug real: o `!key` removia a linha GROQ_API_KEY.
  const i = INDEX.indexOf("case 'key':");
  const bloco = INDEX.slice(i, i + 2500);
  ok(!/replace\([^)]*GROQ_API_KEY/.test(bloco), 'o `!key` nao mexe em GROQ_API_KEY');
});

await test('18. o .env.example documenta os 10 slots', () => {
  const env = fs.readFileSync(new URL('../.env.example', import.meta.url), 'utf-8');
  ok(env.includes('GROQ_API_KEY='), 'o slot 1');
  ok(env.includes('# GROQ_API_KEY_2='), 'o slot 2 (comentado)');
  ok(env.includes('# GROQ_API_KEY_10='), 'o slot 10 (comentado)');
  ok(env.includes('keygroq10'), 'cita o comando do slot 10');
});

// ---------------------------------------------------------------------------
// 4) O ESTADO (esgotadas) E O RESET DIARIO
// ---------------------------------------------------------------------------
console.log('\n=== 4) ESTADO E RESET DIARIO ===\n');

await test('19. a chave esgotada NAO e tentada de novo (o conflito relatado)', async () => {
  limparEnv();
  process.env.GROQ_API_KEY = 'k1';
  process.env.GROQ_API_KEY_2 = 'k2';
  process.env.GROQ_API_KEY_3 = 'k3';
  const usadas = dublar((chave) => {
    if (chave === 'k1' || chave === 'k2') throw erroHttp(429);
    return { data: { choices: [{ message: { content: 'ok' } }] } };
  });

  await groq.groqChat({ texto: 'a', sistema: 's' });
  ok(usadas.length === 3, `1a chamada tenta as 3 (veio ${usadas.length})`);

  // O CONFLITO: antes, cada chamada recomecava da 1. Agora nao.
  usadas.length = 0;
  await groq.groqChat({ texto: 'b', sistema: 's' });
  ok(JSON.stringify(usadas) === JSON.stringify(['k3']),
    `a 2a chamada usa SO a chave viva (veio ${JSON.stringify(usadas)})`);
  groq.setGroqHttpForTest(null);
});

await test('20. o estado SOBREVIVE ao restart (esta no disco)', () => {
  limparEnv();
  process.env.GROQ_API_KEY = 'k1';
  process.env.GROQ_API_KEY_2 = 'k2';
  keys.marcarEsgotada(1);
  ok(keys.estaEsgotada(1), 'marcou o slot 1');

  // Simula o processo reiniciando: limpa o cache em memoria (le do disco).
  keys._limparCacheDeEstado();
  ok(keys.estaEsgotada(1), 'depois do "restart" continua marcada (leu do arquivo)');
  ok(!keys.estaEsgotada(2), 'o slot 2 segue livre');
});

await test('21. a chave ATIVA e a primeira que sobrou (sem ponteiro preso)', () => {
  limparEnv();
  process.env.GROQ_API_KEY = 'k1';
  process.env.GROQ_API_KEY_2 = 'k2';
  process.env.GROQ_API_KEY_3 = 'k3';
  ok(groq.chaveGroq() === 'k1', 'comeca na 1');
  keys.marcarEsgotada(1);
  ok(groq.chaveGroq() === 'k2', 'esgotou a 1 -> vira a 2');
  keys.marcarEsgotada(2);
  ok(groq.chaveGroq() === 'k3', 'esgotou a 2 -> vira a 3');
  keys.marcarEsgotada(3);
  ok(groq.chaveGroq() === '', 'todas esgotadas -> nenhuma (so volta no reset)');
});

await test('22. o RESET devolve tudo para a primeira (o que roda as 00:00)', () => {
  limparEnv();
  process.env.GROQ_API_KEY = 'k1';
  process.env.GROQ_API_KEY_2 = 'k2';
  keys.marcarEsgotada(1);
  keys.marcarEsgotada(2);
  ok(groq.chaveGroq() === '', 'sem chave antes do reset');

  keys.resetarEsgotadas();
  ok(groq.chaveGroq() === 'k1', 'depois do reset, a 1a volta');
  ok(keys.estadoDasChaves().esgotadas.length === 0, 'a lista zerou');
});

await test('23. o reset e AUTOMATICO quando o DIA vira (sem cron)', () => {
  limparEnv();
  process.env.GROQ_API_KEY = 'k1';
  process.env.GROQ_API_KEY_2 = 'k2';
  keys.marcarEsgotada(1);

  // Escreve um estado com data ANTIGA — e' o que esta no disco quando o bot
  // dorme e acorda no dia seguinte.
  const arquivo = process.env.GROQ_KEYS_STATE_FILE;
  fs.writeFileSync(arquivo, JSON.stringify({ dia: '01/01/2020', esgotadas: [1, 2] }));
  keys._limparCacheDeEstado();

  ok(keys.estadoDasChaves().esgotadas.length === 0,
    'estado de outro dia foi descartado (reset automatico)');
  ok(groq.chaveGroq() === 'k1', 'e a 1a chave voltou');
});

await test('24. o painel mostra quem esta esgotada e quem esta em uso', () => {
  limparEnv();
  process.env.GROQ_API_KEY = 'k1';
  process.env.GROQ_API_KEY_2 = 'k2';
  keys.marcarEsgotada(1);
  const e = keys.estadoDasChaves();
  ok(e.esgotadas.includes(1), 'a 1 aparece como esgotada');
  const c1 = e.chaves.find((c) => c.slot === 1);
  const c2 = e.chaves.find((c) => c.slot === 2);
  ok(c1.esgotada === true && c1.ativa === false, 'slot 1: esgotada, nao ativa');
  ok(c2.esgotada === false && c2.ativa === true, 'slot 2: ativa');
  ok(typeof e.dia === 'string' && e.dia.length > 0, 'o dia do estado');
});

await test('25. o handler tem o painel com estado, o reset e o cron 00:00', () => {
  contem(INDEX, 'estadoDasChaves(chaves)', 'o painel le o estado');
  contem(INDEX, "'▶️'", 'marca a ativa');
  contem(INDEX, "'⛔'", 'marca a esgotada');
  contem(INDEX, 'keygroq reset', 'o reset manual');
  contem(INDEX, "cron.schedule('0 0 * * *'", 'o cron da meia-noite');
  contem(INDEX, 'resetarEsgotadas(true)', 'o cron chama o reset');
  contem(INDEX, "timezone: 'America/Sao_Paulo'", 'no fuso do Brasil');
});

await test('26. a memoria do chat subiu (a causa do "nao lembra")', () => {
  const IA = fs.readFileSync(new URL('../dados/src/funcs/private/ia.js', import.meta.url), 'utf-8');
  ok(!/length > 12/.test(IA), 'nao tem mais o limite de 12');
  contem(IA, 'IA_HISTORICO', 'configuravel');
});

// ---------------------------------------------------------------------------
console.log('\n' + '='.repeat(60));
const tot = RESULTS.reduce((a, r) => a + r.passed, 0);
const fal = RESULTS.reduce((a, r) => a + r.failed, 0);
console.log(`RESULTADO: ${RESULTS.length} testes | ${tot} asserções ok | ${fal} falhas`);
console.log('='.repeat(60));
process.exit(fal ? 1 : 0);
