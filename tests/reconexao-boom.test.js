/**
 * O código de desconexão NÃO pode ser inventado.
 *
 * ## O bug (relatado: "o bot desconecta e tenho que conectar toda hora")
 *
 * O log do dono dizia, a cada queda:
 *
 *   ❌ Conexão fechada. Código: 500 | Motivo: Sessão inválida
 *   🗑️ Pasta de autenticação (/home/container/dados/database/qr-code) excluída com sucesso.
 *   🔄 Nova autenticação será necessária na próxima inicialização.
 *
 * A causa: o bot lia o motivo com
 *
 *     const reason = new Boom(lastDisconnect?.error)?.output?.statusCode;
 *
 * `new Boom(x)` **não propaga** o código de `x` — ele CRIA um Boom novo, e sem
 * `statusCode` o padrão do @hapi/boom é **500**. Como `badSession` também é 500,
 * **qualquer** fechamento comum (rede, "Connection Terminated", stream:error)
 * era lido como "sessão inválida" — e o handler apagava o `qr-code/`.
 *
 * Resultado: o bot **perdia o pareamento** e o dono tinha que conectar de novo.
 *
 * ## A correção
 *
 * `isBoom(err) ? err.output.statusCode : (err?.statusCode ?? null)` — só um Boom
 * de verdade informa o código; qualquer outro erro cai em `null`, e o handler
 * apenas reconecta, **sem tocar na sessão**.
 *
 * Uso: node tests/reconexao-boom.test.js
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Boom, isBoom } from '@hapi/boom';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(HERE, '..');

const RESULTS = []; let CURRENT = null;
function test(n, fn) { CURRENT = { n, p: 0, f: 0, e: [] }; RESULTS.push(CURRENT);
  try { fn(); fin(); } catch (err) { CURRENT.f++; CURRENT.e.push('EXC: ' + (err?.stack || err)); fin(); } }
function fin() { console.log(`${CURRENT.f === 0 ? '✅' : '❌'} ${CURRENT.n} (${CURRENT.p} ok, ${CURRENT.f} falhas)`); for (const x of CURRENT.e) console.log('     ' + x.split('\n')[0]); }
function ok(c, m) { if (c) CURRENT.p++; else { CURRENT.f++; CURRENT.e.push('ASSERT: ' + m); } }

// A leitura ANTIGA (com bug) e a NOVA (correta), lado a lado.
const lerAntigo = (e) => new Boom(e)?.output?.statusCode;
const lerNovo = (e) => (isBoom(e) ? e.output.statusCode : (e?.statusCode ?? null));

const BAD_SESSION = 500;
const LOGGED_OUT = 401;
const apagaSessao = (r) => r === BAD_SESSION || r === LOGGED_OUT;

// ── O bug, medido ────────────────────────────────────────────────────────────

test('1. `new Boom(x)` INVENTA 500 — a causa raiz', () => {
  const genericos = [
    undefined, null,
    new Error('Connection Closed'),
    new Error('Connection Terminated'),
    new Error('stream:error'),
    { message: 'x' },
  ];
  for (const e of genericos) {
    ok(lerAntigo(e) === 500, `erro genérico -> 500 inventado (${String(e?.message ?? e)})`);
  }
  ok(apagaSessao(lerAntigo(new Error('Connection Closed'))) === true,
     'e 500 = badSession -> o handler APAGAVA a sessão');
});

test('2. a leitura NOVA não inventa nada', () => {
  ok(lerNovo(undefined) === null, 'undefined -> null');
  ok(lerNovo(null) === null, 'null -> null');
  ok(lerNovo(new Error('Connection Closed')) === null, 'erro genérico -> null');
  ok(lerNovo(new Error('Connection Terminated')) === null, 'Connection Terminated -> null');
  ok(apagaSessao(lerNovo(new Error('Connection Closed'))) === false,
     'com null NÃO apaga a sessão');
});

test('3. os códigos REAIS continuam passando', () => {
  // A correção não pode cegar o bot para os erros de verdade.
  const casos = [
    [408, 'connectionLost'],
    [401, 'loggedOut'],
    [500, 'badSession'],
    [515, 'restartRequired'],
    [440, 'connectionReplaced'],
    [403, 'forbidden'],
  ];
  for (const [code, nome] of casos) {
    const b = new Boom(nome, { statusCode: code });
    ok(isBoom(b) === true, `${nome} é Boom`);
    ok(lerNovo(b) === code, `${nome} -> ${code} (lido certo)`);
    ok(lerAntigo(b) === code, `${nome} -> o antigo também lia certo um Boom real`);
  }
  // e o comportamento que importa:
  ok(apagaSessao(lerNovo(new Boom('x', { statusCode: 401 }))) === true, '401 AINDA apaga (é logout de verdade)');
  ok(apagaSessao(lerNovo(new Boom('x', { statusCode: 500 }))) === true, '500 AINDA apaga (é badSession de verdade)');
  ok(apagaSessao(lerNovo(new Boom('x', { statusCode: 408 }))) === false, '408 (rede) NÃO apaga');
  ok(apagaSessao(lerNovo(new Boom('x', { statusCode: 515 }))) === false, '515 (restart) NÃO apaga');
});

test('4. um erro com statusCode próprio é respeitado', () => {
  const e = new Error('x'); e.statusCode = 401;
  ok(lerNovo(e) === 401, 'erro com statusCode 401 é lido como 401');
  ok(lerAntigo(e) === 500, 'o antigo ignorava e dizia 500');
});

// ── O código de produção tem de usar a leitura NOVA ──────────────────────────

test('5. connect.js lê o código pelo isBoom (não inventa)', () => {
  const src = fs.readFileSync(path.join(RAIZ, 'dados', 'src', 'connect.js'), 'utf-8');
  ok(!/new Boom\(lastDisconnect/.test(src), 'não usa mais `new Boom(lastDisconnect...)`');
  ok(/isBoom\(erroBruto\)/.test(src), 'usa isBoom(erroBruto)');
  ok(/const erroBruto = lastDisconnect\?\.error/.test(src), 'lê o erro bruto');
  ok(/import \{ isBoom \} from '@hapi\/boom'/.test(src), 'importa isBoom');
});

test('6. subBotManager.js tem a mesma correção (o mesmo bug estava lá)', () => {
  const src = fs.readFileSync(path.join(RAIZ, 'dados', 'src', 'utils', 'subBotManager.js'), 'utf-8');
  ok(!/new Boom\(lastDisconnect/.test(src), 'sub-bot não usa mais `new Boom(...)`');
  ok(/isBoom\(erroBruto\)/.test(src), 'usa isBoom(erroBruto)');
});

test('7. NENHUM lugar do projeto inventa código com new Boom(err)', () => {
  const arquivos = [];
  const varrer = (dir) => {
    for (const nome of fs.readdirSync(dir)) {
      const p = path.join(dir, nome);
      const st = fs.statSync(p);
      if (st.isDirectory()) { if (nome !== 'node_modules') varrer(p); }
      else if (nome.endsWith('.js')) arquivos.push(p);
    }
  };
  varrer(path.join(RAIZ, 'dados'));
  // Ignora comentários: o próprio código explica o bug citando `new Boom(x)`.
  // Remove blocos /* */ e linhas // antes de procurar.
  const semComentarios = (txt) => txt
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((l) => !l.trim().startsWith('//'))
    .join('\n');
  const infratores = arquivos.filter((f) => /new Boom\((?!.*statusCode)/.test(semComentarios(fs.readFileSync(f, 'utf-8'))));
  ok(infratores.length === 0, `nenhum arquivo inventa código: ${infratores.join(', ') || 'ok'}`);
});

console.log('════════════════════════════════════════');
const tOk = RESULTS.reduce((a, r) => a + r.p, 0), tF = RESULTS.reduce((a, r) => a + r.f, 0);
console.log(`RESULTADO: ${RESULTS.length} testes | ${tOk} asserções ok | ${tF} falhas`);
console.log('════════════════════════════════════════');
if (tF > 0) { console.log('\nFALHAS:'); for (const r of RESULTS) if (r.f) for (const e of r.e) console.log(`- [${r.n}] ${e}`); process.exit(1); }
console.log('✅ TODOS OS TESTES PASSARAM'); process.exit(0);
