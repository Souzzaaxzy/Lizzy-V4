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
function erroHttp(status, msg, retryAfter) {
  const e = new Error(`HTTP ${status}`);
  e.response = {
    status,
    headers: retryAfter != null ? { 'retry-after': String(retryAfter) } : {},
    data: { error: { message: msg || (status === 429 ? 'rate limit exceeded' : 'Invalid API Key') } }
  };
  return e;
}

/**
 * O 429 da COTA DO DIA (RPD) — a chave morre ate' o reset (00:00).
 * A mensagem e' a que o Groq manda de verdade.
 */
const erroCotaDoDia = (retryAfter) => erroHttp(429,
  'Rate limit reached for model `openai/gpt-oss-120b` on requests per day (RPD): Limit 1000, Used 1000.',
  retryAfter);

/**
 * O 429 do LIMITE POR MINUTO (RPM) — a chave esta' VIVA, volta em segundos.
 *
 * ## Era o bug da rotacao
 *
 * Os dois casos chegavam como "cota estourada" e a chave era marcada como
 * esgotada ate' a meia-noite. O dono via a rotacao pular chaves boas e, no fim,
 * tudo dizendo "cota esgotada" — e o `!keygroq reset` (que so' limpava a
 * marcacao errada) "consertava".
 */
const erroLimiteDoMinuto = (retryAfter = 30) => erroHttp(429,
  'Rate limit reached for model `openai/gpt-oss-120b` on requests per minute (RPM): Limit 30, Used 30.',
  retryAfter);

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

await test('2b. o slot vem dos ARGS quando o numero nao esta no comando (o `off 2`)', () => {
  // O bug relatado: `!keygroq off 2` apagava o slot 1 (o comando) e o dono via
  // "o slot 1 ja esta vazio". O numero tem de ser lido de ONDE ELE ESTIVER.
  ok(keys.slotDoComando('keygroq', 'off 2') === 2, '`off 2` -> slot 2');
  ok(keys.slotDoComando('keygroq', '2 off') === 2, '`2 off` -> slot 2');
  ok(keys.slotDoComando('keygroq', 'remover 3') === 3, '`remover 3` -> slot 3');
  ok(keys.slotDoComando('keygroq', 'gsk_abc') === 1, 'sem numero -> o slot do comando (1)');
  ok(keys.slotDoComando('keygroq', 'off') === 1, '`off` sem numero -> slot 1');
  ok(keys.slotDoComando('keygroq2', 'off') === 2, 'o numero no COMANDO tem prioridade');
  ok(keys.slotDoComando('keygroq2', 'off 5') === 2, 'o comando vence o arg');
  ok(keys.slotDoComando('keygroq', 'off 11') === 1, 'numero fora da faixa -> cai no comando');
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
    if (chave === 'k1') throw erroCotaDoDia();
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
    if (chave === 'k1') throw erroCotaDoDia();
    if (chave === 'k2') throw erroCotaDoDia();
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
  const usadas = dublar(() => { throw erroCotaDoDia(); });

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
  const usadas = dublar(() => { throw erroCotaDoDia(); });
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
    if (chave === 'k1') throw erroCotaDoDia();
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
  // O bloco vai do `case 'keygroq'` ate' o proximo comando de VERDADE — pulando
  // os irmaos do mesmo grupo (`keygroq1`..`keygroq10`). Fatiar por um numero
  // fixo de chars ja' quebrou este teste quando o painel cresceu.
  let fim = i + 7000;
  const re = /\n\s*case '([a-z0-9_]+)':/gi;
  let m;
  while ((m = re.exec(INDEX)) !== null) {
    if (m.index < i) continue;
    if (!/^(?:keygroq|groqkey)\d*$/.test(m[1])) { fim = m.index; break; }
  }
  const bloco = INDEX.slice(i, fim);
  ok(bloco.includes('slotDoComando(command, q)'), 'descobre o slot pelo comando E pelos args (o `off 2`)');
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
    if (chave === 'k1' || chave === 'k2') throw erroCotaDoDia();
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
// 5) A DISTINCAO "SEM CHAVE" x "NO LIMITE" (o dono via a mensagem errada)
// ---------------------------------------------------------------------------
console.log('\n=== 5) SEM CHAVE x NO LIMITE ===\n');

await test('27. situacaoDasChaves distingue os TRES casos', () => {
  limparEnv();
  ok(keys.situacaoDasChaves() === 'sem_chave', 'sem chave nenhuma -> sem_chave');

  process.env.GROQ_API_KEY = 'k1';
  ok(keys.situacaoDasChaves() === 'ok', 'com chave disponivel -> ok');

  keys.marcarEsgotada(1);
  ok(keys.situacaoDasChaves() === 'todas_esgotadas', 'unica chave esgotada -> todas_esgotadas');

  process.env.GROQ_API_KEY_2 = 'k2';
  ok(keys.situacaoDasChaves() === 'ok', 'com uma viva -> ok de novo');
});

await test('28. o `!transcrever` e o `!iap` dizem QUAL dos dois e (nao "nao configurada")', () => {
  // A queixa: "mostra que a chave nao esta definida mesmo estando definida".
  const TR = INDEX.slice(INDEX.indexOf("case 'transcrever':"), INDEX.indexOf("case 'transcrever':") + 12000);
  contem(TR, 'situacaoDasChaves()', 'o `!transcrever` consulta a situacao');
  contem(TR, "'sem_chave'", 'ramo "nao configurada"');
  contem(TR, "'todas_esgotadas'", 'ramo "no limite de hoje"');
  contem(INDEX, 'chaves_no_limite:', 'o mapa do `!iap` tem o motivo novo');
});

await test('29. o `ia.js` (chat) tambem distingue, em vez de dizer sempre "nao configurada"', () => {
  const IA = fs.readFileSync(new URL('../dados/src/funcs/private/ia.js', import.meta.url), 'utf-8');
  contem(IA, 'situacaoDasChaves()', 'consulta a situacao antes de lancar');
  contem(IA, "'sem_chave'", 'ramo "nao configurada"');
  contem(IA, "'todas_esgotadas'", 'ramo "no limite"');
  contem(IA, 'limite de hoje', 'a mensagem do limite fala do limite (nao da chave)');
});

await test('30. o `iapSessao` recusa com o motivo CERTO quando todas estao no limite', () => {
  const SES = fs.readFileSync(new URL('../dados/src/utils/iapSessao.js', import.meta.url), 'utf-8');
  contem(SES, 'situacaoDasChaves', 'consulta a situacao');
  contem(SES, "motivo: 'sem_chave_groq'", 'sem chave -> sem_chave_groq');
  contem(SES, "motivo: 'chaves_no_limite'", 'no limite -> chaves_no_limite');
});

// ---------------------------------------------------------------------------
// 6) OS DOIS 429: COTA DO DIA x LIMITE POR MINUTO (o bug da rotacao)
// ---------------------------------------------------------------------------
console.log('\n=== 6) COTA DO DIA x LIMITE POR MINUTO ===\n');

await test('31. o classificador distingue o 429 do DIA do de MINUTO', () => {
  const dia = groq.classificarErroGroq(erroCotaDoDia());
  ok(dia.tipo === 'limite' && dia.escopo === 'dia', `RPD -> escopo dia (veio ${dia.tipo}/${dia.escopo})`);

  const min = groq.classificarErroGroq(erroLimiteDoMinuto());
  ok(min.tipo === 'limite' && min.escopo === 'minuto', `RPM -> escopo minuto (veio ${min.tipo}/${min.escopo})`);

  // A pista do TEXTO basta, mesmo sem o status HTTP (o corpo pode variar).
  const soTexto = groq.classificarErroGroq({
    response: { data: { error: { message: 'Rate limit reached for model `x` on requests per minute (RPM): Limit 30, Used 30.' } } }
  });
  ok(soTexto.tipo === 'limite' && soTexto.escopo === 'minuto', 'a mensagem "per minute" basta');

  // E o `retry-after` longo, sem pista de texto, inclina para o DIA.
  const espera = groq.classificarErroGroq(erroHttp(429, 'rate limit exceeded', 3600));
  ok(espera.escopo === 'dia', 'espera de 1h sem pista -> dia');
  const curta = groq.classificarErroGroq(erroHttp(429, 'rate limit exceeded', 5));
  ok(curta.escopo === 'minuto', 'espera de 5s -> minuto');
});

await test('32. 429 por MINUTO NAO queima a chave (era o bug)', async () => {
  limparEnv();
  process.env.GROQ_API_KEY = 'k1';
  process.env.GROQ_API_KEY_2 = 'k2';
  const usadas = dublar((chave) => {
    if (chave === 'k1') throw erroLimiteDoMinuto(30);
    return { data: { choices: [{ message: { content: 'ok' } }] } };
  });

  const r = await groq.groqChat({ texto: 'oi', sistema: 's' });

  // O CORACAO DO BUG (inalterado): a k1 NAO pode estar "esgotada" — ela volta.
  ok(!keys.estaEsgotada(1), 'a k1 NAO ficou marcada como esgotada');
  ok(keys.estadoDasChaves().esgotadas.length === 0, 'nenhuma chave morreu');
  // Mas fica de castigo por um tempo (nao bater nela de novo agora).
  ok(keys.emCooldown(1), 'a k1 ficou em castigo');
  ok(keys.segundosDeCooldown(1) > 0, 'com tempo restante');
  ok(keys.situacaoDasChaves() === 'ok', 'e a situacao continua ok (ela esta viva)');
  // A cota e' por ORGANIZACAO: a k2 (mesma conta) esta' tao estrangulada quanto
  // a k1, entao a conta inteira esfria — a mensagem nao sai na hora, mas
  // NENHUMA chave morreu e a cota compartilhada nao foi queimada duas vezes.
  ok(!r.ok && r.motivo === 'limite', `a conta esfriou (veio ${r.motivo})`);
  groq.setGroqHttpForTest(null);
});

await test('33. depois do castigo, a chave VOLTA sozinha (sem reset)', async () => {
  limparEnv();
  process.env.GROQ_API_KEY = 'k1';
  process.env.GROQ_API_KEY_2 = 'k2';
  dublar((chave) => {
    if (chave === 'k1') throw erroLimiteDoMinuto(1);
    return { data: { choices: [{ message: { content: 'ok' } }] } };
  });
  await groq.groqChat({ texto: 'a', sistema: 's' });
  ok(keys.emCooldown(1), 'a k1 esta de castigo agora');
  // A cota e' por ORGANIZACAO: a k2 esta' tao estrangulada quanto a k1, entao
  // ela TAMBEM entra em castigo (senao a proxima mensagem queimaria a mesma
  // cota compartilhada na k2).
  ok(keys.emCooldown(2), 'a k2 tambem (mesma conta)');
  ok(groq.chaveGroq() === '', 'nenhuma disponivel agora');

  // O castigo vence (1 segundo). Nao ha' reset nenhum — so' o tempo passar.
  await new Promise((r) => setTimeout(r, 1100));
  ok(!keys.emCooldown(1), 'o castigo venceu');
  ok(groq.chaveGroq() === 'k1', `a k1 VOLTOU sozinha (veio ${groq.chaveGroq()}) — sem reset`);
  groq.setGroqHttpForTest(null);
});

await test('34. um limite de MINUTO nao queima a cota das outras chaves (cota por ORGANIZACAO)', async () => {
  limparEnv();
  process.env.GROQ_API_KEY = 'k1';
  process.env.GROQ_API_KEY_2 = 'k2';
  // As duas estao' na MESMA conta: o Groq conta por ORGANIZACAO, entao a
  // segunda chave esta' tao estrangulada quanto a primeira.
  //
  // O comportamento ANTIGO tentava as duas (2 requisicoes da cota
  // COMPARTILHADA) e, com 5 chaves, gastava 5 — era o "com varias chaves
  // esgota em minutos o que uma aguentava por horas".
  const usadas = dublar(() => { throw erroLimiteDoMinuto(30); });

  const r = await groq.groqChat({ texto: 'oi', sistema: 's' });
  ok(usadas.length === 1, `UMA requisicao so' (nao N) — veio ${usadas.length}`);
  ok(usadas[0] === 'k1', `parou na primeira (veio ${JSON.stringify(usadas)})`);
  ok(!r.ok && r.motivo === 'limite', `o motivo e limite (veio ${r.motivo})`);
  ok(keys.estadoDasChaves().esgotadas.length === 0, 'nenhuma chave morreu (as duas voltam)');
  groq.setGroqHttpForTest(null);
});

await test('35. castigo de minuto NAO e reportado como "sem chave" (o diagnostico errado)', async () => {
  limparEnv();
  process.env.GROQ_API_KEY = 'k1';
  dublar(() => { throw erroLimiteDoMinuto(30); });

  const r = await groq.groqChat({ texto: 'oi', sistema: 's' });
  // Antes: `chaveGroq()` devolvia '' e o dono via "chave nao configurada".
  ok(r.motivo === 'limite', `motivo limite, NAO sem_chave_groq (veio ${r.motivo})`);
  ok(keys.situacaoDasChaves() === 'ok', 'a chave existe e esta viva');
  ok(groq.chaveGroq() === '', 'mas nao ha chave usavel AGORA (castigo)');
  groq.setGroqHttpForTest(null);
});

await test('36. a cota do DIA continua queimando a chave (nao afrouxou)', async () => {
  limparEnv();
  process.env.GROQ_API_KEY = 'k1';
  process.env.GROQ_API_KEY_2 = 'k2';
  const usadas = dublar((chave) => {
    if (chave === 'k1') throw erroCotaDoDia();
    return { data: { choices: [{ message: { content: 'ok' } }] } };
  });
  await groq.groqChat({ texto: 'a', sistema: 's' });
  ok(keys.estaEsgotada(1), 'a k1 (cota do dia) FICOU esgotada');
  ok(!keys.emCooldown(1), 'e nao e um castigo');
  usadas.length = 0;
  await groq.groqChat({ texto: 'b', sistema: 's' });
  ok(JSON.stringify(usadas) === JSON.stringify(['k2']), 'a proxima chamada nem tenta a k1');
  groq.setGroqHttpForTest(null);
});

await test('37. o painel mostra o castigo separado da cota do dia', () => {
  limparEnv();
  process.env.GROQ_API_KEY = 'k1';
  process.env.GROQ_API_KEY_2 = 'k2';
  keys.marcarEsgotada(2);
  keys.marcarCooldown(1, 45);
  const e = keys.estadoDasChaves();
  ok(JSON.stringify(e.esgotadas) === JSON.stringify([2]), 'a 2 e a cota do dia');
  ok(JSON.stringify(e.emCooldown) === JSON.stringify([1]), 'a 1 e castigo de minuto');
  const c1 = e.chaves.find((c) => c.slot === 1);
  ok(c1.emCooldown === true && c1.esgotada === false, 'slot 1: castigo, NAO esgotada');
  ok(c1.cooldownRestante > 0 && c1.cooldownRestante <= 45, `o restante (veio ${c1.cooldownRestante})`);
  ok(c1.ativa === false, 'e nao esta ativa agora');

  // O handler mostra as duas marcas (a linha da chave e o resumo).
  contem(INDEX, "c.emCooldown ? '\u23f3'", 'marca de castigo no painel');
  contem(INDEX, 'limite por minuto', 'texto explicando o castigo');
  contem(INDEX, 'cota do dia esgotada', 'texto explicando a cota do dia');
});

await test('38. o reset limpa TAMBEM os castigos (o `!keygroq reset` do dono)', () => {
  limparEnv();
  process.env.GROQ_API_KEY = 'k1';
  keys.marcarCooldown(1, 300);
  ok(keys.emCooldown(1), 'a chave esta de castigo');
  keys.resetarEsgotadas();
  ok(!keys.emCooldown(1), 'o reset limpou o castigo');
  ok(groq.chaveGroq() === 'k1', 'e a 1a voltou a ser usada');
});

// ---------------------------------------------------------------------------
// 7) OS HEADERS DO GROQ: a cota do DIA, o RESET certo e a ESPERA
// ---------------------------------------------------------------------------
console.log('\n=== 7) HEADERS, RESET E ESPERA ===\n');

/** O 429 da cota do DIA com os HEADERS (como o Groq manda de verdade). */
const erroDiaComHeaders = ({ restantes = 0, resetSegundos = 3600, retryAfter = 2 } = {}) => {
  const e = new Error('HTTP 429');
  e.response = {
    status: 429,
    headers: {
      'x-ratelimit-remaining-requests': String(restantes),
      'x-ratelimit-reset-requests': `${resetSegundos}s`,
      'retry-after': String(retryAfter)
    },
    data: { error: { message: 'Rate limit reached for model `x` on requests per day (RPD).' } }
  };
  return e;
};

/** O 429 do limite por MINUTO com os headers (a chave continua VIVA). */
const erroMinutoComHeaders = ({ restantes = 5000, retryAfter = 30 } = {}) => {
  const e = new Error('HTTP 429');
  e.response = {
    status: 429,
    headers: {
      'x-ratelimit-remaining-requests': String(restantes),
      'retry-after': String(retryAfter)
    },
    data: { error: { message: 'Rate limit reached for model `x` on requests per minute (RPM).' } }
  };
  return e;
};

await test('39. o HEADER `remaining-requests` MANDA sobre o texto do erro', () => {
  // A doc do Groq: `x-ratelimit-remaining-requests` refere-se SEMPRE a RPD.
  // O texto pode dizer uma coisa e o header outra — o header e' a verdade.
  const contradiz = groq.classificarErroGroq(erroDiaComHeaders({ restantes: 5000 }));
  ok(contradiz.escopo === 'minuto',
    `remaining=5000 -> minuto, mesmo com o texto dizendo "per day" (veio ${contradiz.escopo})`);

  const zero = groq.classificarErroGroq(erroDiaComHeaders({ restantes: 0 }));
  ok(zero.escopo === 'dia', `remaining=0 -> dia (veio ${zero.escopo})`);

  // E o instante do reset vem do proprio Groq.
  ok(zero.resetEm > Date.now(), 'o resetEm veio do header');
  const faltam = Math.round((zero.resetEm - Date.now()) / 1000);
  ok(faltam > 3500 && faltam <= 3600, `~1h de reset (veio ${faltam}s)`);
});

await test('40. a chave VOLTA no RESET do Groq — nao na nossa meia-noite', async () => {
  limparEnv();
  process.env.GROQ_API_KEY = 'k1';
  process.env.GROQ_API_KEY_2 = 'k2';
  // O Groq diz que a cota volta em 1s (nao em 24h).
  const usadas = dublar((chave) => {
    if (chave === 'k1') throw erroDiaComHeaders({ restantes: 0, resetSegundos: 1 });
    return { data: { choices: [{ message: { content: 'ok' } }] } };
  });
  await groq.groqChat({ texto: 'a', sistema: 's' });
  ok(keys.estaEsgotada(1), 'a k1 esgotou a cota do dia');
  ok(keys.segundosParaReset(1) <= 1, `o reset e' em ~1s (veio ${keys.segundosParaReset(1)}s)`);
  ok(groq.chaveGroq() === 'k2', 'e a k2 assume');

  // Passou o prazo que o GROQ informou (nao a meia-noite do bot).
  await new Promise((r) => setTimeout(r, 1200));
  ok(!keys.estaEsgotada(1), 'a k1 VOLTOU (o reset do Groq chegou)');
  ok(groq.chaveGroq() === 'k1', `e volta a ser a 1a (veio ${groq.chaveGroq()})`);
  groq.setGroqHttpForTest(null);
});

await test('41. sem o header de reset, a chave so volta na virada do dia', () => {
  limparEnv();
  process.env.GROQ_API_KEY = 'k1';
  keys.marcarEsgotada(1);   // sem `resetEm`
  ok(keys.estaEsgotada(1), 'esgotada');
  ok(keys.segundosParaReset(1) > 3600, `o reset fica longe (veio ${keys.segundosParaReset(1)}s)`);
  // O teto: nada de header maluco prender a chave para sempre.
  ok(keys.segundosParaReset(1) <= (2 * 24 * 60 * 60) + 5, 'no maximo 2 dias');
});

await test('42. o estado no disco e NORMALIZADO (uma fonte: `esgotadasAte`)', () => {
  limparEnv();
  process.env.GROQ_API_KEY = 'k1';
  keys.marcarEsgotada(1, Date.now() + 60000);
  const bruto = JSON.parse(fs.readFileSync(process.env.GROQ_KEYS_STATE_FILE, 'utf-8'));
  ok(bruto.esgotadasAte && typeof bruto.esgotadasAte === 'object', 'grava `esgotadasAte`');
  // `esgotadas` e' DERIVADA em memoria — nao vai para o disco (uma fonte so').
  ok(bruto.esgotadas === undefined, 'nao grava a lista derivada (evita desencontrar)');
  ok(JSON.stringify(keys.estadoDasChaves().esgotadas) === JSON.stringify([1]),
    'e a lista derivada aparece no painel');
});

await test('43. a chave com limite por MINUTO nao sai do rodizio (volta sozinha)', async () => {
  limparEnv();
  process.env.GROQ_API_KEY = 'k1';
  process.env.GROQ_API_KEY_2 = 'k2';
  const usadas = dublar((chave) => {
    if (chave === 'k1') throw erroMinutoComHeaders({ retryAfter: 1 });
    return { data: { choices: [{ message: { content: 'ok' } }] } };
  });
  await groq.groqChat({ texto: 'a', sistema: 's' });
  ok(!keys.estaEsgotada(1), 'a k1 NAO ficou esgotada (o limite era de minuto)');
  ok(keys.emCooldown(1), 'ela esta de castigo por 1s');

  await new Promise((r) => setTimeout(r, 1200));
  ok(!keys.emCooldown(1), 'o castigo venceu');
  ok(groq.chaveGroq() === 'k1', 'e a k1 VOLTA ao rodizio (sem reset do dono)');
  groq.setGroqHttpForTest(null);
});

await test('44. limite de MINUTO: esfria a CONTA e, apos a espera, retoma na mesma chave', async () => {
  limparEnv();
  process.env.GROQ_API_KEY = 'k1';
  process.env.GROQ_API_KEY_2 = 'k2';
  const usadas = [];
  const esperas = [];
  // A espera e' injetada (nao quero 2s de suite). Ela faz o que o tempo faria:
  // limpa o castigo — e registra quanto foi pedido.
  groq._setEsperaForTest(async (ms) => {
    esperas.push(ms);
    keys.limparCooldowns();
  });
  groq.setGroqHttpForTest(async (url, data, cfg) => {
    const chave = String(cfg?.headers?.Authorization || '').replace('Bearer ', '');
    usadas.push(chave);
    if (usadas.length === 1) throw erroMinutoComHeaders({ retryAfter: 2 });
    return { data: { choices: [{ message: { content: 'ok' } }] } };
  });

  const r = await groq.groqChat({ texto: 'a', sistema: 's' });
  ok(r.ok && r.texto === 'ok', 'a resposta veio depois da espera (nao falhou na hora)');
  ok(esperas.length === 1, `esperou UMA vez (veio ${esperas.length})`);
  ok(esperas[0] >= 2000 && esperas[0] <= 2300, `o prazo do castigo + uma folga (veio ${esperas[0]}ms)`);
  ok(JSON.stringify(usadas) === JSON.stringify(['k1', 'k1']),
    `retomou na MESMA chave (a conta e' uma so') — veio ${JSON.stringify(usadas)}`);
  ok(keys.estadoDasChaves().esgotadas.length === 0, 'e NENHUMA chave morreu');
  groq._setEsperaForTest(null);
  groq.setGroqHttpForTest(null);
});

await test('45. castigo LONGO demais nao vira espera (nao trava a mensagem)', async () => {
  limparEnv();
  process.env.GROQ_API_KEY = 'k1';
  const esperas = [];
  groq._setEsperaForTest(async (ms) => { esperas.push(ms); });
  dublar(() => { throw erroMinutoComHeaders({ retryAfter: 600 }); });   // 10 min

  const r = await groq.groqChat({ texto: 'a', sistema: 's' });
  ok(!r.ok && r.motivo === 'limite', `devolve o limite na hora (veio ${r.motivo})`);
  ok(esperas.length === 0, 'NAO esperou 10 minutos');
  ok(/~600s/.test(r.mensagem || ''), `diz quanto falta (veio "${r.mensagem}")`);
  groq._setEsperaForTest(null);
  groq.setGroqHttpForTest(null);
});

await test('46. quando a cota do DIA bate, a chave sai do rodizio de verdade', async () => {
  limparEnv();
  process.env.GROQ_API_KEY = 'k1';
  process.env.GROQ_API_KEY_2 = 'k2';
  const usadas = dublar((chave) => {
    if (chave === 'k1') throw erroDiaComHeaders({ restantes: 0, resetSegundos: 3600 });
    return { data: { choices: [{ message: { content: 'ok' } }] } };
  });
  await groq.groqChat({ texto: 'a', sistema: 's' });
  ok(keys.estaEsgotada(1), 'a k1 saiu (cota do dia)');
  ok(!keys.emCooldown(1), 'e nao e um castigo');

  usadas.length = 0;
  await groq.groqChat({ texto: 'b', sistema: 's' });
  ok(JSON.stringify(usadas) === JSON.stringify(['k2']), 'a proxima chamada nem tenta a k1');
  groq.setGroqHttpForTest(null);
});

await test('47. o painel diz QUANDO a cota do dia volta', () => {
  limparEnv();
  process.env.GROQ_API_KEY = 'k1';
  keys.marcarEsgotada(1, Date.now() + 90 * 1000);
  const c1 = keys.estadoDasChaves().chaves.find((c) => c.slot === 1);
  ok(c1.esgotada === true, 'esgotada');
  ok(c1.resetEmSegundos > 85 && c1.resetEmSegundos <= 90, `o painel tem o prazo (veio ${c1.resetEmSegundos})`);
  // E o handler mostra isso.
  contem(INDEX, 'resetEmSegundos', 'o painel usa o prazo do reset');
});

// ---------------------------------------------------------------------------
// ───────────────────────────────────────────────────────────────────────────
// O BUG DO DONO: "com varias chaves esgota em 10 minutos; com uma dura horas"
//
// A doc do Groq: *"Rate limits apply at the ORGANIZATION level, not individual
// users"*. Chaves da MESMA conta dividem a MESMA cota — entao rotacionar num
// limite TEMPORARIO nao da' cota nova, so' queima a compartilhada N vezes mais
// rapido. Medido antes do fix: 5 chaves = 5 requisicoes para UMA mensagem.
// ───────────────────────────────────────────────────────────────────────────
await test('49. N chaves NAO multiplicam o consumo da cota (o bug do dono)', async () => {
  const consumidas = async (nChaves) => {
    limparEnv();
    for (let i = 1; i <= nChaves; i++) process.env[keys.nomeDaVar(i)] = `gsk_${i}`;
    let reqs = 0;
    groq._setEsperaForTest(async () => { keys.limparCooldowns(); });
    groq.setGroqHttpForTest(async () => {
      reqs += 1;
      throw erroLimiteDoMinuto(60);   // limite por MINUTO (cota por ORGANIZACAO)
    });
    await groq.groqChat({ texto: 'oi' });
    groq._setEsperaForTest(null);
    groq.setGroqHttpForTest(null);
    return reqs;
  };
  const com1 = await consumidas(1);
  const com3 = await consumidas(3);
  const com5 = await consumidas(5);
  // Sem o fix: com1=2, com3=4, com5=6 (uma requisicao por chave).
  ok(com3 <= com1 + 1, `3 chaves consomem ~o mesmo que 1 (1ch=${com1}, 3ch=${com3})`);
  ok(com5 <= com1 + 1, `5 chaves consomem ~o mesmo que 1 (1ch=${com1}, 5ch=${com5})`);
  ok(com5 < 5, `5 chaves NAO consomem 5 requisicoes (veio ${com5})`);
});

await test('50. cota do DIA continua rotacionando (chave de outra conta ajuda)', async () => {
  limparEnv();
  process.env.GROQ_API_KEY = 'k1';
  process.env.GROQ_API_KEY_2 = 'k2';
  const usadas = [];
  groq.setGroqHttpForTest(async (url, data, cfg) => {
    const chave = String(cfg?.headers?.Authorization || '').replace('Bearer ', '');
    usadas.push(chave);
    if (chave === 'k1') throw erroCotaDoDia(0);   // a k1 morreu de verdade
    return { data: { choices: [{ message: { content: 'ok' } }] } };
  });
  const r = await groq.groqChat({ texto: 'oi' });
  ok(r.ok && r.texto === 'ok', 'a segunda chave respondeu');
  ok(JSON.stringify(usadas) === JSON.stringify(['k1', 'k2']),
    `rotacionou na cota do DIA (veio ${JSON.stringify(usadas)})`);
  ok(keys.estaEsgotada(1), 'a k1 ficou marcada como esgotada (o dia dela acabou)');
  groq.setGroqHttpForTest(null);
});

await test('51. GROQ_KEYS_MULTI_ORG=1 volta a rotacionar (chaves de CONTAS diferentes)', async () => {
  limparEnv();
  process.env.GROQ_KEYS_MULTI_ORG = '1';
  process.env.GROQ_API_KEY = 'k1';
  process.env.GROQ_API_KEY_2 = 'k2';
  const usadas = dublar(() => { throw erroLimiteDoMinuto(60); });
  await groq.groqChat({ texto: 'oi' });
  ok(usadas.length === 2, `com o opt-in, tenta as duas (veio ${usadas.length})`);
  delete process.env.GROQ_KEYS_MULTI_ORG;
  groq.setGroqHttpForTest(null);
});

// ───────────────────────────────────────────────────────────────────────────
// OS 4 LIMITES DO GROQ (o dono viu "limite por minuto — volta em 4000s")
//
// O rotulo era FIXO em "por minuto", mas o TPD (TOKENS do dia) tambem caia
// ali: o `remaining-requests` continua ALTO quando o que estourou sao os
// tokens, e o bot concluia "nao e o dia, logo e' o minuto".
// ───────────────────────────────────────────────────────────────────────────
const erro429 = (msg, headers) => {
  const e = new Error('429');
  e.response = { status: 429, headers, data: { error: { message: msg } } };
  return e;
};

await test('52. os 4 limites do Groq sao classificados pelo nome certo', () => {
  const rpm = groq.classificarErroGroq(erro429(
    'Rate limit reached on requests per minute (RPM): Limit 30',
    { 'x-ratelimit-remaining-requests': '950', 'x-ratelimit-reset-requests': '2m59s', 'retry-after': '20' }));
  ok(rpm.escopo === 'minuto' && rpm.limite === 'rpm', `RPM (veio ${rpm.escopo}/${rpm.limite})`);

  const rpd = groq.classificarErroGroq(erro429(
    'Rate limit reached on requests per day (RPD): Limit 1000',
    { 'x-ratelimit-remaining-requests': '0', 'x-ratelimit-reset-requests': '3600s', 'retry-after': '3600' }));
  ok(rpd.escopo === 'dia' && rpd.limite === 'rpd', `RPD (veio ${rpd.escopo}/${rpd.limite})`);

  const tpm = groq.classificarErroGroq(erro429(
    'Rate limit reached on tokens per minute (TPM): Limit 8000',
    { 'x-ratelimit-remaining-requests': '900', 'x-ratelimit-remaining-tokens': '0', 'x-ratelimit-reset-tokens': '30s', 'retry-after': '30' }));
  ok(tpm.escopo === 'minuto' && tpm.limite === 'tpm', `TPM (veio ${tpm.escopo}/${tpm.limite})`);
});

await test('53. TPD (TOKENS do dia) NAO e tratado como "por minuto" (o bug)', () => {
  // O caso do dono: retry de 4000s com o `remaining-requests` AINDA alto.
  const tpd = groq.classificarErroGroq(erro429(
    'Rate limit reached on tokens per day (TPD): Limit 200000',
    { 'x-ratelimit-remaining-requests': '900', 'x-ratelimit-remaining-tokens': '4000', 'x-ratelimit-reset-tokens': '4000s', 'retry-after': '4000' }));
  ok(tpd.escopo === 'dia', `o TPD e' do DIA (veio ${tpd.escopo})`);
  ok(tpd.limite === 'tpd', `e o rotulo diz TOKENS (veio ${tpd.limite})`);
  ok(tpd.resetEm > 0, 'tem um reset (o dia volta)');
  ok(/TOKENS/.test(tpd.mensagem), `a mensagem fala de tokens (${tpd.mensagem.slice(0, 60)})`);
  ok(!/por agora|instantes/.test(tpd.mensagem), 'e NAO diz "temporario/instantes"');
});

await test('54. a mensagem explica que o reset e JANELA MOVEL (nao meia-noite)', () => {
  const rpd = groq.classificarErroGroq(erro429(
    'Rate limit reached on requests per day (RPD): Limit 1000',
    { 'x-ratelimit-remaining-requests': '0', 'x-ratelimit-reset-requests': '4000s', 'retry-after': '4000' }));
  ok(/janela movel|janela móvel/i.test(rpd.mensagem), `explica a janela (${rpd.mensagem.slice(0, 80)})`);
  ok(rpd.resetSegundos === 4000, `traz os segundos do reset (veio ${rpd.resetSegundos})`);
});

const tot = RESULTS.reduce((a, r) => a + r.passed, 0);
const fal = RESULTS.reduce((a, r) => a + r.failed, 0);
console.log(`RESULTADO: ${RESULTS.length} testes | ${tot} asserções ok | ${fal} falhas`);
console.log('='.repeat(60));
process.exit(fal ? 1 : 0);
