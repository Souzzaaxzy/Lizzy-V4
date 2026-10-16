/**
 * Sistema de musica da call: FILA + CONTROLES.
 *
 * ## O que este teste protege
 *
 * O sistema tem tres pecas:
 *   - `musicQueue`  — estado puro (fila por grupo, dono de cada faixa)
 *   - `callPlayer`  — a ponte com o motor (tocar/pular/parar, avancar)
 *   - `callCache`   — os arquivos, por grupo (com teto e limpeza)
 *
 * E quatro regras que o dono pediu:
 *   1. quem pediu a musica e' quem controla ela;
 *   2. `!callp`/`encerrar` sao de ADMIN; `!callp status` e' de TODOS;
 *   3. `!musicap` e' de MEMBRO (o gate de dono nao vale aqui);
 *   4. ao encerrar a call, a fila e o cache do grupo saem.
 *
 * Uso: node tests/music-queue.test.js
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'lizzy-mq-'));
process.env.DATABASE_PATH = TMP;
process.env.CALL_CACHE_DIR = path.join(TMP, 'call-cache');
process.env.ZAPO_DISABLE_CONNECT = '1';

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

const fila = await import(new URL('../dados/src/funcs/utils/musicQueue.js', import.meta.url).href);
const cache = await import(new URL('../dados/src/utils/callCache.js', import.meta.url).href);
const SRC = fs.readFileSync(new URL('../dados/src/index.js', import.meta.url), 'utf8');

const G1 = '111@g.us';
const G2 = '222@g.us';
const EU = 'eu@s.whatsapp.net';
const OUTRO = 'outro@s.whatsapp.net';

console.log('\n=== 1) A FILA (estado puro) ===\n');

await test('enfileirar / atual / proxima / listar', () => {
  fila.limparTudo();
  ok(fila.atual(G1) === null, 'começa vazia');

  fila.enfileirar(G1, { caminho: '/a.wav', titulo: 'A', donoId: EU });
  fila.enfileirar(G1, { caminho: '/b.wav', titulo: 'B', donoId: OUTRO });

  ok(fila.atual(G1)?.titulo === 'A', 'a atual é a primeira');
  ok(fila.proxima(G1)?.titulo === 'B', 'a próxima é a segunda');
  ok(fila.tamanho(G1) === 2, 'tamanho 2');
  ok(fila.listar(G1).length === 2, 'lista as duas');
});

await test('a fila é POR GRUPO (não vaza entre grupos)', () => {
  fila.limparTudo();
  fila.enfileirar(G1, { caminho: '/a.wav', titulo: 'A', donoId: EU });
  ok(fila.tamanho(G2) === 0, 'o outro grupo está vazio');
  ok(fila.atual(G2) === null, 'sem atual no outro grupo');
});

await test('avancar anda e esvazia no fim', () => {
  fila.limparTudo();
  fila.enfileirar(G1, { caminho: '/a.wav', titulo: 'A', donoId: EU });
  fila.enfileirar(G1, { caminho: '/b.wav', titulo: 'B', donoId: EU });

  ok(fila.avancar(G1)?.titulo === 'B', 'avançou para B');
  ok(fila.avancar(G1) === null, 'depois de B, acabou');
  ok(fila.tamanho(G1) === 0, 'a fila foi limpa ao terminar');
});

await test('removerAtual (o "parar") deixa a próxima no lugar', () => {
  fila.limparTudo();
  fila.enfileirar(G1, { caminho: '/a.wav', titulo: 'A', donoId: EU });
  fila.enfileirar(G1, { caminho: '/b.wav', titulo: 'B', donoId: EU });

  ok(fila.removerAtual(G1)?.titulo === 'B', 'B ficou como atual');
  ok(fila.tamanho(G1) === 1, 'sobrou 1');
  ok(fila.removerAtual(G1) === null, 'remover a última esvazia');
});

await test('limpar devolve os CAMINHOS (para apagar do cache)', () => {
  fila.limparTudo();
  fila.enfileirar(G1, { caminho: '/a.wav', titulo: 'A', donoId: EU });
  fila.enfileirar(G1, { caminho: '/b.wav', titulo: 'B', donoId: EU });

  const r = fila.limpar(G1);
  ok(r.removidas === 2, '2 removidas');
  ok(r.caminhos.includes('/a.wav') && r.caminhos.includes('/b.wav'), 'devolveu os dois caminhos');
  ok(fila.tamanho(G1) === 0, 'fila vazia');
});

console.log('\n=== 2) O DONO DA FAIXA (quem controla) ===\n');

await test('só o dono da faixa pode controlar', () => {
  fila.limparTudo();
  fila.enfileirar(G1, { caminho: '/a.wav', titulo: 'A', donoId: EU });

  ok(fila.podeControlar(G1, EU).ok === true, 'o dono pode');
  const r = fila.podeControlar(G1, OUTRO);
  ok(r.ok === false && r.motivo === 'nao_e_dono', 'outro NÃO pode');
  ok(r.titulo === 'A', 'diz qual música');
});

await test('o dono do bot sempre pode (não fica travado)', () => {
  fila.limparTudo();
  fila.enfileirar(G1, { caminho: '/a.wav', titulo: 'A', donoId: OUTRO });
  ok(fila.podeControlar(G1, EU, { ehDonoDoBot: true }).ok === true, 'dono do bot passa');
});

await test('a comparação usa idsMatch (LID x número)', () => {
  fila.limparTudo();
  fila.enfileirar(G1, { caminho: '/a.wav', titulo: 'A', donoId: '111@lid' });
  // Mesmo usuário, forma diferente: o index passa `idsMatch`.
  const mesmoId = (a, b) => String(a).split('@')[0] === String(b).split('@')[0];
  ok(fila.podeControlar(G1, '111@s.whatsapp.net', { mesmoId }).ok === true,
    'reconhece LID e número como a mesma pessoa');
});

await test('sem música, ninguém controla', () => {
  fila.limparTudo();
  const r = fila.podeControlar(G1, EU);
  ok(r.ok === false && r.motivo === 'sem_musica', 'sem música');
});

console.log('\n=== 3) O CACHE (por grupo, com teto) ===\n');

await test('caminhoNovo cria a pasta do grupo', () => {
  const c = cache.caminhoNovo(G1, '.wav');
  ok(c.endsWith('.wav'), 'extensão .wav');
  ok(fs.existsSync(path.dirname(c)), 'a pasta do grupo existe');
  fs.writeFileSync(c, 'x');
  ok(fs.existsSync(c), 'grava');
});

await test('o nome do arquivo NÃO usa o título (acento/emoji quebrariam)', () => {
  const c = cache.caminhoNovo(G1, '.wav');
  const nome = path.basename(c);
  ok(!nome.includes(' '), 'sem espaço');
  ok(/^[a-z0-9-]+\.wav$/i.test(nome), `nome seguro: ${nome}`);
});

await test('apagar e limparGrupo removem do disco', () => {
  const g = '333@g.us';
  const c1 = cache.caminhoNovo(g, '.wav');
  fs.writeFileSync(c1, 'x');
  ok(cache.apagar(c1) === true, 'apagar devolve true');
  ok(!fs.existsSync(c1), 'arquivo sumiu');

  const c2 = cache.caminhoNovo(g, '.wav');
  fs.writeFileSync(c2, 'x');
  ok(cache.limparGrupo(g) >= 1, 'limparGrupo apagou');
  ok(!fs.existsSync(c2), 'arquivo do grupo sumiu');
});

await test('podar respeita o teto e NÃO apaga a protegida', () => {
  const g = '444@g.us';
  const antes = process.env.CALL_CACHE_MAX_MB;
  process.env.CALL_CACHE_MAX_MB = '0'; // teto mínimo: força podar

  const a = cache.caminhoNovo(g, '.wav');
  fs.writeFileSync(a, Buffer.alloc(1024));
  const b = cache.caminhoNovo(g, '.wav');
  fs.writeFileSync(b, Buffer.alloc(1024));

  cache.podar(g, b); // b protegida
  ok(fs.existsSync(b), 'a protegida sobreviveu');

  process.env.CALL_CACHE_MAX_MB = antes;
});

await test('a raiz do cache é configurável (teste não escreve no repo)', () => {
  ok(cache.raizCache().includes(TMP) || cache.raizCache() === process.env.CALL_CACHE_DIR,
    'respeita CALL_CACHE_DIR');
});

console.log('\n=== 4) OS COMANDOS (handler real) ===\n');

await test('!musicap tem os subcomandos pedidos', () => {
  includes(SRC, "sub === 'pular'", 'pular');
  includes(SRC, "sub === 'parar'", 'parar');
  includes(SRC, "sub === 'atual'", 'atual');
  includes(SRC, "sub === 'limpar'", 'limpar');
  includes(SRC, "sub === 'adicionar'", 'adicionar');
});

await test('!fila existe', () => {
  includes(SRC, "case 'fila':", 'a case');
  includes(SRC, 'musicQueue.listar(from)', 'usa a fila real');
});

await test('!callp status existe', () => {
  includes(SRC, "subCallp === 'status'", 'o subcomando');
  // O titulo sai em MATHEMATICAL BOLD; desbolda antes de comparar.
  const desbold = (t) => t.replace(/[\uD835][\uDC00-\uDFFF]/g, (m) => String.fromCharCode(0x41 + (m.codePointAt(0) - 0x1D400)));
  includes(desbold(SRC), 'STATUS DA CHAMADA', 'o layout');
});

await test('!callp/!callp encerrar são de ADMIN (gate de dono)', () => {
  // O callp usa podeDonoTotal() desde a rodada das permissoes.
  const i = SRC.indexOf("case 'callp':");
  const bloco = SRC.slice(i, i + 400);
  includes(bloco, 'podeDonoTotal()', 'o gate de dono está no callp');
});

await test('!musicap NÃO tem gate de dono (membro pode usar)', () => {
  const i = SRC.indexOf("case 'musicap':");
  const j = SRC.indexOf("case 'antifantasma':");
  const bloco = SRC.slice(i, j);
  ok(bloco.length > 0, 'achou o bloco');
  ok(!/if \(!podeDonoTotal\(\)\)/.test(bloco), 'não exige dono');
  ok(!/if \(!isGroupAdmin\)/.test(bloco), 'não exige admin do grupo');
});

await test('a música vem por NOME igual ao !play (reusa youtube)', () => {
  includes(SRC, 'youtube.search(termo)', 'busca igual ao !play');
  includes(SRC, 'youtube.mp3(videoUrl, 128)', 'baixa igual ao !play');
  includes(SRC, 'prepararWav16k', 'prepara 16 kHz (helper local que existe)');
});

console.log('\n=== 5) A FILA ANDA SOZINHA (o evento do motor) ===\n');

await test('o zapoCall escuta "audio terminou"', () => {
  const Z = fs.readFileSync(new URL('../dados/src/funcs/utils/zapoCall.js', import.meta.url), 'utf8');
  includes(Z, "voip_call_outbound_audio_finished", 'escuta o evento do motor');
  includes(Z, 'aoTerminarAudio', 'expõe a API de inscrição');
});

await test('o index registra o callback que avança', () => {
  includes(SRC, 'aoTerminarAudio(from', 'registra por grupo');
  includes(SRC, 'callPlayer.tocarProxima(g)', 'avança a fila');
});

await test('o listener é registrado no reset (não vaza)', () => {
  const Z = fs.readFileSync(new URL('../dados/src/funcs/utils/zapoCall.js', import.meta.url), 'utf8');
  includes(Z, 'aoTerminarPorGrupo.clear()', 'limpa no resetarMidia');
});

console.log('\n=== 6) LIMPEZA AO ENCERRAR A CALL ===\n');

await test('encerrar limpa a fila E o cache do grupo', () => {
  const i = SRC.indexOf("case 'callp':");
  const bloco = SRC.slice(i, i + 6000); // o bloco tem pareamento + status antes do encerrar
  includes(bloco, 'musicQueue.limpar(from)', 'limpa a fila');
  includes(bloco, 'callCache.limparGrupo(from)', 'limpa o cache');
  includes(bloco, 'callPlayer.pararDeSeguir(from)', 'para de seguir');
});

await test('o cache NÃO entra no backup do !atualizar', () => {
  // O backup é recursivo; um cache de 300 MB por grupo estouraria o disco
  // (foi o bug do ENOSPC com o apk-cache).
  const B = fs.readFileSync(new URL('../dados/src/.scripts/database-backup.js', import.meta.url), 'utf8');
  includes(B, 'call-cache', 'call-cache está em DIRS_PULADOS');
});

const totalOk = RESULTS.reduce((a, r) => a + r.passed, 0);
const totalFail = RESULTS.reduce((a, r) => a + r.failed, 0);
console.log('\n' + '='.repeat(40));
console.log(`RESULTADO: ${RESULTS.length} testes | ${totalOk} asserções ok | ${totalFail} falhas`);
console.log('='.repeat(40));
if (totalFail > 0) process.exit(1);
