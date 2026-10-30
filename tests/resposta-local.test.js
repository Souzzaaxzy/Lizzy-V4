/**
 * A RESPOSTA LOCAL + o RECONHECIMENTO DOS PAIS.
 *
 * Dois pedidos do dono nesta rodada:
 *   1. *"eu quero que ela NUNCA fique sem resposta, ela tem que ter resposta
 *      pra literalmente TUDO"* — a resposta local (sem API) garante isso;
 *   2. *"ela nao reconhece os pais dela automaticamente"* — o contexto passa a
 *      dizer "X e' a sua PAI/MAE".
 *
 * Uso: node tests/resposta-local.test.js
 */

import fs from 'fs';
import os from 'os';
import path from 'path';

const TMP_DB = fs.mkdtempSync(path.join(os.tmpdir(), 'lizzy-rl-'));
process.env.DATABASE_PATH = TMP_DB;
process.env.CONFIG_PATH = path.join(TMP_DB, 'config.json');
fs.mkdirSync(path.join(TMP_DB, 'grupos'), { recursive: true });
fs.mkdirSync(path.join(TMP_DB, 'dono'), { recursive: true });
fs.writeFileSync(process.env.CONFIG_PATH, JSON.stringify({
  prefixo: '!', nomebot: 'Lizzy do privy', nomedono: 'Kannon',
  numerodono: '5511978819676', debug: false
}, null, 2));

const rl = await import(new URL('../dados/src/utils/respostaLocal.js', import.meta.url).href);
const ctx = await import(new URL('../dados/src/utils/contextoConversa.js', import.meta.url).href);

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

// ───────────────────────────────────────────────────────────────────────────
// 1) A RESPOSTA LOCAL — "nunca sem resposta"
// ───────────────────────────────────────────────────────────────────────────

await test('1. SEMPRE devolve uma resposta nao-vazia, para QUALQUER entrada', () => {
  const entradas = [
    'oi', 'olá', 'bom dia', 'eai', 'e ai',
    'qual seu nome?', 'quem é você', 'oq vc faz',
    'vai se ferrar', 'sua burra', 'vsf',
    'tchau', 'flw', 'vou dormir',
    '', '   ', null, undefined, 0, 123, {}, [],
    'uma frase longa que não é pergunta nem saudação nem nada disso aqui',
    '🤔', 'kkkk', 'asdkjhaskjd'
  ];
  let vazias = 0;
  for (const e of entradas) {
    const r = rl.respostaLocal({ texto: e });
    if (typeof r !== 'string' || !r.trim()) { vazias += 1; console.log(`     vazio para: ${JSON.stringify(e)}`); }
  }
  ok(vazias === 0, `nenhuma entrada ficou sem resposta (vazias: ${vazias})`);
});

await test('2. escolhe pela SITUACAO (saudacao, pergunta, xingamento, despedida)', () => {
  const semAleatorio = { aleatorio: () => 0 };
  const saud = rl.respostaLocal({ texto: 'oi', ...semAleatorio });
  ok(rl.frasesLocais('saudacao').includes(saud), `saudacao -> do balde certo (veio "${saud}")`);

  const perg = rl.respostaLocal({ texto: 'qual seu nome?', ...semAleatorio });
  ok(rl.frasesLocais('pergunta').includes(perg), `pergunta -> do balde certo (veio "${perg}")`);

  const xing = rl.respostaLocal({ texto: 'vai se ferrar', ...semAleatorio });
  ok(rl.frasesLocais('xingamento').includes(xing), `xingamento -> do balde certo (veio "${xing}")`);

  const desp = rl.respostaLocal({ texto: 'tchau', ...semAleatorio });
  ok(rl.frasesLocais('despedida').includes(desp), `despedida -> do balde certo (veio "${desp}")`);

  const semT = rl.respostaLocal({ texto: '', ...semAleatorio });
  ok(rl.frasesLocais('semTexto').includes(semT), `sem texto -> do balde certo (veio "${semT}")`);
});

await test('3. NUNCA repete a frase anterior (o pedido de "nao repetir")', () => {
  // Percorre 40 vezes: com a ultima sendo a escolhida, a proxima tem de mudar.
  let repeticoes = 0;
  let ultima = null;
  for (let i = 0; i < 40; i++) {
    const r = rl.respostaLocal({ texto: 'oi', ultima });
    if (r === ultima) repeticoes += 1;
    ultima = r;
  }
  ok(repeticoes === 0, `nenhuma repeticao seguida (veio ${repeticoes})`);
});

await test('4. o balde tem VARIEDADE (nao e a mesma frase sempre)', () => {
  const vistas = new Set();
  for (let i = 0; i < 200; i++) vistas.add(rl.respostaLocal({ texto: 'qualquer coisa' }));
  ok(vistas.size >= 5, `pelo menos 5 frases diferentes (veio ${vistas.size})`);
});

await test('5. as frases nao tem emoji nem asterisco (a regra do prompt)', () => {
  const todas = ['saudacao', 'pergunta', 'xingamento', 'despedida', 'semTexto', 'generico']
    .flatMap((s) => rl.frasesLocais(s));
  const ruins = todas.filter((f) => /[*_~`]|\p{Extended_Pictographic}/u.test(f));
  ok(ruins.length === 0, `nenhuma com emoji/markdown (ruins: ${JSON.stringify(ruins)})`);
  ok(todas.length >= 30, `frases suficientes no total (veio ${todas.length})`);
});

await test('6. o aleatorio e injetavel (deterministico para teste)', () => {
  const a = rl.respostaLocal({ texto: 'oi', aleatorio: () => 0 });
  const b = rl.respostaLocal({ texto: 'oi', aleatorio: () => 0.999 });
  ok(a !== b, `extremos escolhem frases diferentes (${a} vs ${b})`);
  ok(rl.respostaLocal({ texto: 'oi', aleatorio: () => 0 }) === a, 'e e deterministico');
});

// ───────────────────────────────────────────────────────────────────────────
// 2) O RECONHECIMENTO DOS PAIS
// ───────────────────────────────────────────────────────────────────────────

const PAIS = [
  { papel: 'pai', lid: '23734744260711@lid', nome: '' },
  { papel: 'mae', lid: '18408649269356@lid', nome: 'Cangica' }
];

await test('7. casa pelo LID (o caso do config)', () => {
  const p = ctx.quemEhDosPais('23734744260711@lid', 'Kannon', PAIS);
  ok(p && p.papel === 'pai', `reconheceu o pai pelo LID (veio ${JSON.stringify(p)})`);
  const m = ctx.quemEhDosPais('18408649269356@lid', 'Cangica', PAIS);
  ok(m && m.papel === 'mae', `reconheceu a mae pelo LID (veio ${JSON.stringify(m)})`);
});

await test('8. casa pelo LID mesmo com device (`:N@lid`)', () => {
  const p = ctx.quemEhDosPais('23734744260711:14@lid', 'Kannon', PAIS);
  ok(p && p.papel === 'pai', `o device nao atrapalha (veio ${JSON.stringify(p)})`);
});

await test('9. casa pelo NOME quando nao ha LID', () => {
  const p = ctx.quemEhDosPais('999@s.whatsapp.net', 'Cangica', PAIS);
  ok(p && p.papel === 'mae', `casou pelo nome (veio ${JSON.stringify(p)})`);
});

await test('10. NAO casa quem nao e dos pais (sem falso positivo)', () => {
  ok(ctx.quemEhDosPais('5511999999999@s.whatsapp.net', 'Zé', PAIS) === null, 'desconhecido nao vira pai');
  ok(ctx.quemEhDosPais('', '', PAIS) === null, 'entrada vazia nao vira pai');
  ok(ctx.quemEhDosPais('23734744260711@lid', 'Kannon', []) === null, 'sem pais cadastrados, ninguem casa');
});

await test('11. o CONTEXTO diz que a pessoa e' + "'" + ' a PAI/MAE (o bug do dono)', () => {
  const txt = ctx.montarContextoDaConversa({
    nomeDeQuemFalou: 'Kannon',
    quemFalouId: '23734744260711@lid',
    paisAdotivos: PAIS,
    dadosDoGrupo: {}
  });
  ok(/e' a sua PAI/.test(txt) || /e' a sua PAI/.test(txt), `diz que e o PAI (txt: ${txt.slice(0, 200)})`);
  ok(/nao como qualquer pessoa/.test(txt), 'e trata como familia');
  ok(/Nada de flerte/.test(txt), 'e proibe flerte com os pais');
});

await test('12. sem pais no contexto, o texto NAO inventa parentesco', () => {
  const txt = ctx.montarContextoDaConversa({
    nomeDeQuemFalou: 'Zé', quemFalouId: '5511999999999@s.whatsapp.net', paisAdotivos: [], dadosDoGrupo: {}
  });
  ok(!/PAI|MAE/.test(txt), `nao inventa (txt: ${txt.slice(0, 160)})`);
  ok(/Quem esta' falando/.test(txt), 'mas ainda diz quem fala');
});

await test('13. o prompt manda a Lizzy nao repetir/puxar o assunto (anti-volei, anti-repeticao)', async () => {
  const g = await import(new URL('../dados/src/utils/iapGuarda.js', import.meta.url).href);
  const id = await import(new URL('../dados/src/utils/identidadeLizzy.js', import.meta.url).href);
  const bloco = id.blocoDeIdentidade(id.lerIdentidade());

  // VOLEI: o fato continua, mas sem "puxe o assunto".
  ok(/joga volei|joga vôlei/i.test(bloco), 'o fato (joga volei) continua');
  ok(/NAO puxe o assunto/.test(bloco), 'e NAO manda puxar o assunto');
  ok(!/Fale disso como quem vive disso/.test(bloco), 'saiu o "fale disso como quem vive disso" (era o gatilho)');
  ok(/NUNCA cite o mesmo assunto/.test(bloco), 'trava a repeticao do assunto');

  // ANTI-REPETICAO geral.
  ok(/NAO REPETIR/.test(bloco), 'tem o bloco NAO REPETIR');
  ok(/NAO faz a mesma pergunta duas vezes/.test(bloco), 'trava a pergunta repetida');

  // ANTI-ROBO no carater.
  const prompt = g.promptDaLizzy({});
  ok(/ANTI-ROBO/.test(prompt), 'tem o bloco ANTI-ROBO');
  ok(/NUNCA mande a mesma resposta duas vezes/.test(prompt), 'trava a resposta repetida');
});

await test('14. o historico NAO vai duplicado no prompt (economia de token)', () => {
  const INDEX = fs.readFileSync(new URL('../dados/src/index.js', import.meta.url), 'utf-8');
  const IA = fs.readFileSync(new URL('../dados/src/funcs/private/ia.js', import.meta.url), 'utf-8');
  // O userInput NAO pode mais carregar o historico (ele ja' vai como mensagens).
  ok(!/historico: historico\[userId\]/.test(IA), 'o userInput nao manda o historico de novo');
  ok(/historico\[userId\] \|\| \[\]/.test(IA), 'mas ele AINDA vai como mensagens (nao sumiu)');
  // E o handler tem o respondedor local ligado nos DOIS caminhos.
  ok(/respostaLocal\(\{/.test(INDEX), 'o handler usa a resposta local');
  ok(INDEX.includes("from './utils/respostaLocal.js'"), 'e o modulo esta importado');
});

console.log('\n============================================================');
const tot = RESULTS.reduce((s, r) => s + r.passed, 0);
const fal = RESULTS.reduce((s, r) => s + r.failed, 0);
console.log(`RESULTADO: ${RESULTS.length} testes | ${tot} asserções ok | ${fal} falhas`);
console.log('============================================================');
process.exit(fal ? 1 : 0);
