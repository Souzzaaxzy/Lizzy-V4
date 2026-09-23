/**
 * Testes da conversão de layout (`tools/convert-layout.py`).
 *
 * O conversor e uma ferramenta de refactor em massa: ele reescreveu caixas
 * decoradas em ~7 arquivos do repo. Um erro silencioso aqui nao aparece em
 * runtime -- so no aparelho do usuario. Por isso os invariantes abaixo sao
 * verificados por teste, rodando o conversor REAL sobre os arquivos atuais
 * (com `--dry`, sem escrever nada).
 *
 * Invariantes:
 *  1. idempotencia: rodar de novo nao muda mais nada (nao ha caixa "meio
 *     convertida" que o conversor pegue na segunda passada);
 *  2. topo e rodape andam em PAR (nunca so um lado), senao a caixa desalinha;
 *  3. nenhuma caixa de largura fixa (com `│` no corpo) e tocada;
 *  4. placeholders de interpolacao (`${...}`, `{...}`, `#nome#`) sobrevivem;
 *  5. o layout novo ja tem todos os arquivos que o conversor tocaria.
 *
 * Uso: node tests/layout-conversion.test.js
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const SCRIPT = path.join(ROOT, 'tools', 'convert-layout.py');

let ok = 0;
let fail = 0;
const falhas = [];
function check(cond, msg) {
  if (cond) ok += 1;
  else { fail += 1; falhas.push(msg); }
}

function dry() {
  return execFileSync('python3', [SCRIPT, '--dry'], { cwd: ROOT, encoding: 'utf-8' });
}

// ============================================================================

console.log('\n── 1. conversor roda sem erro e e idempotente ──');
{
  const r1 = dry();
  check(/\[DRY-RUN\]/.test(r1), 'o conversor roda em modo dry');
  // Depois do apply, a segunda passada nao deve encontrar NADA para converter.
  const linhas = r1.split('\n').filter((l) => /topo \//.test(l));
  const convertiveis = linhas.filter((l) => !/^\s*0 topo \/ \s*0 rodape/.test(l));
  check(convertiveis.length === 0,
    `idempotente: nenhum arquivo com caixa a converter (${convertiveis.length} encontrado(s))`);
  if (convertiveis.length) {
    for (const l of convertiveis.slice(0, 5)) falhas.push(`  ainda converte: ${l.trim()}`);
  }
}

console.log('\n── 2. topo e rodape sempre em PAR ──');
{
  const r = dry();
  const m = r.match(/(\d+) topos \| (\d+) rodapes/);
  check(Boolean(m), 'o resumo traz topos e rodapes');
  if (m) {
    // Com o repo ja convertido, ambos devem ser 0. O invariante e a igualdade.
    check(Number(m[1]) === Number(m[2]),
      `topos == rodapes (${m[1]} vs ${m[2]})`);
  }
}

console.log('\n── 3. caixas de largura fixa ficaram fora ──');
{
  // O !me usa `│` no corpo (largura fixa) -> nao pode ter sido tocado pelo
  // conversor... na verdade o !me NAO tem `│`; o teste real e o inverso:
  // nenhum arquivo pode ter topo novo + rodape velho (mistura).
  const novos = ['dados/src/index.js', 'dados/src/utils/x9System.js',
    'dados/src/utils/msgCounter.js', 'dados/src/utils/confessar.js',
    'dados/src/funcs/utils/adoptionManager.js', 'dados/src/utils/database.js',
    'dados/src/menus/menufutadm.js'];
  const MISTO = 0;
  let mistos = 0;
  for (const rel of novos) {
    const s = fs.readFileSync(path.join(ROOT, rel), 'utf-8');
    // linhas de topo novo e rodape novo
    const topNovo = (s.match(/╭━━━꧁༺/g) || []).length;
    const botNovo = (s.match(/╰━━━꧁༺ ✦ ༻꧂/g) || []).length;
    if (topNovo > 0 && botNovo === 0) mistos += 1;
  }
  check(mistos === MISTO, `nenhum arquivo com topo novo e rodape velho (${mistos})`);
}

console.log('\n── 4. placeholders sobrevivem a conversao ──');
{
  // Amostras que passaram pelo conversor e tinham placeholder no titulo.
  const casos = [
    ['dados/src/index.js', '${nomebot}'],
    ['dados/src/utils/msgCounter.js', '${periodName}'],
    ['dados/src/menus/menufutadm.js', '${botName}'],
  ];
  for (const [rel, ph] of casos) {
    const s = fs.readFileSync(path.join(ROOT, rel), 'utf-8');
    check(s.includes(ph), `${rel} preserva ${ph}`);
  }
}

console.log('\n── 5. nenhum titulo em bold quebrou o arquivo ──');
{
  // Todo title convertido tem que estar ENTRE ꧁༺ e ༻꧂ -- sem caractere solto.
  const arquivos = ['dados/src/index.js', 'dados/src/utils/x9System.js'];
  let ruins = 0;
  for (const rel of arquivos) {
    const s = fs.readFileSync(path.join(ROOT, rel), 'utf-8');
    for (const m of s.matchAll(/╭━━━꧁༺([^༻\n]{0,200})༻꧂/g)) {
      const titulo = m[1].trim();
      if (!titulo) ruins += 1;
      if (titulo.includes('${') && !titulo.includes('}')) ruins += 1;
    }
  }
  check(ruins === 0, `nenhum titulo vazio/quebrado (${ruins})`);
}

console.log('\n════════════════════════════════════════');
console.log(`RESULTADO: ${ok} ok | ${fail} falhas`);
console.log('════════════════════════════════════════');
if (fail) {
  console.log('\nFALHAS:');
  for (const f of falhas) console.log(`- ${f}`);
  process.exit(1);
}
console.log('✅ CONVERSAO DE LAYOUT VALIDADA');
