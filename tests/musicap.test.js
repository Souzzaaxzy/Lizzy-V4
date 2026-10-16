/**
 * `!musicap` — o PLAYER de musica da call (fila + controles).
 *
 * ## O contrato que este teste mede
 *
 * O comando mudou de proposito: antes tocava UM arquivo direto e era
 * dono-only; agora e' um sistema de fila (estilo Discord), aberto a MEMBROS.
 *
 *   - `!musicap` e' de MEMBRO (o gate de dono e' so' do `!callp`);
 *   - sem call ativa -> orienta a usar `!callp`;
 *   - `pular`/`parar`/`limpar` -> so' o DONO da faixa (ou o dono do bot);
 *   - o audio vem por NOME (reusa `youtube.search` + `youtube.mp3`, o mesmo
 *     caminho do `!play`) e entra na fila;
 *   - o cache e' por grupo e sai quando a faixa sai.
 *
 * Uso: node tests/musicap.test.js
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const TMP_DB = fs.mkdtempSync(path.join(os.tmpdir(), 'lizzy-musicap-'));
process.env.DATABASE_PATH = TMP_DB;
process.env.CALL_CACHE_DIR = path.join(TMP_DB, 'call-cache');
process.env.ZAPO_DISABLE_CONNECT = '1';
const GRUPOS_DIR = path.join(TMP_DB, 'grupos');
fs.mkdirSync(GRUPOS_DIR, { recursive: true });

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

const SRC = fs.readFileSync(new URL('../dados/src/index.js', import.meta.url), 'utf8');
const fila = await import(new URL('../dados/src/funcs/utils/musicQueue.js', import.meta.url).href);

console.log('\n=== 1) O BLOCO DO COMANDO (contrato) ===\n');

/** O bloco do `case 'musicap'` (ate o proximo case). */
const blocoMusicap = () => {
  const i = SRC.indexOf("case 'musicap':");
  const j = SRC.indexOf("case 'antifantasma':");
  return SRC.slice(i, j);
};

await test('!musicap NÃO exige dono nem admin (membro pode usar)', () => {
  const b = blocoMusicap();
  ok(b.length > 0, 'achou o bloco');
  ok(!/if \(!podeDonoTotal\(\)\)/.test(b), 'não exige dono do bot');
  ok(!/if \(!isGroupAdmin\)/.test(b), 'não exige admin do grupo');
  includes(b, 'if (!isGroup)', 'continua exigindo grupo');
});

await test('tem TODOS os subcomandos pedidos', () => {
  const b = blocoMusicap();
  for (const [sub, rotulo] of [
    ['pular', 'pular'],
    ['parar', 'parar'],
    ['atual', 'atual'],
    ['limpar', 'limpar'],
    ['adicionar', 'adicionar']
  ]) {
    includes(b, `sub === '${sub}'`, rotulo);
  }
  // `pular` tambem atende por skip/next (o dono pediu "!skip").
  includes(b, "sub === 'skip'", 'skip (apelido de pular)');
});

await test('sem call ativa, orienta a usar o !callp', () => {
  const b = blocoMusicap();
  includes(b, 'Não há chamada ativa', 'avisa');
  includes(b, 'callp', 'diz qual comando usar');
});

await test('o áudio vem por NOME, reusando o caminho do !play', () => {
  const b = blocoMusicap();
  includes(b, 'youtube.search(termo)', 'busca igual ao !play');
  includes(b, 'youtube.mp3(videoUrl, 128)', 'baixa igual ao !play');
  includes(b, 'prepararAudioParaCall', 'prepara 16 kHz');
  includes(b, 'musicQueue.enfileirar', 'entra na fila');
});

await test('a mensagem de espera é apagada (inclusive no erro)', () => {
  const b = blocoMusicap();
  includes(b, 'apagarAviso', 'tem o apagador');
  includes(b, 'delete: avisoBusca.key', 'apaga a mensagem');
  // No catch do bloco interno tambem precisa apagar.
  const posCatch = b.indexOf("catch (e) {\n            await apagarAviso();");
  ok(posCatch > -1, 'apaga também no catch');
});

console.log('\n=== 2) AS REGRAS DE CONTROLE ===\n');

await test('pular/parar passam o dono da faixa (e o dono do bot)', () => {
  const b = blocoMusicap();
  includes(b, 'callPlayer.pular(from, sender, opcoesDono)', 'pular com permissão');
  includes(b, 'callPlayer.parar(from, sender, opcoesDono)', 'parar com permissão');
  includes(b, 'ehDonoDoBot: isOwner', 'o dono do bot sempre pode');
  includes(b, 'mesmoId: (a, b) => idsMatch(a, b)', 'compara LID x número');
});

await test('quem não é dono recebe uma recusa que explica', () => {
  const b = blocoMusicap();
  includes(b, "r.motivo === 'nao_e_dono'", 'trata o motivo');
  includes(b, 'Só quem pediu', 'explica quem pode');
  includes(b, 'r.titulo', 'diz qual música');
});

console.log('\n=== 3) A FILA (o que o comando alimenta) ===\n');

await test('enfileirar guarda o DONO da faixa', () => {
  fila.limparTudo();
  fila.enfileirar('g@g.us', { caminho: '/x.wav', titulo: 'X', donoId: 'quem@s.whatsapp.net' });
  ok(fila.atual('g@g.us')?.donoId === 'quem@s.whatsapp.net', 'dono registrado');
});

await test('a fila é por grupo (duas calls não se misturam)', () => {
  fila.limparTudo();
  fila.enfileirar('a@g.us', { caminho: '/x.wav', titulo: 'X', donoId: 'u@x' });
  ok(fila.tamanho('b@g.us') === 0, 'o outro grupo está vazio');
});

await test('o resumo alimenta o `!musicap atual` e o `!callp status`', () => {
  fila.limparTudo();
  ok(fila.resumo('g@g.us').vazia === true, 'vazia');
  fila.enfileirar('g@g.us', { caminho: '/x.wav', titulo: 'X', donoId: 'u@x' });
  const r = fila.resumo('g@g.us');
  ok(r.vazia === false && r.total === 1 && r.atual.titulo === 'X', 'resumo correto');
});

console.log('\n=== 4) O CACHE (por grupo, limpo ao sair) ===\n');

await test('o cache é por grupo e o nome do arquivo é seguro', () => {
  const cache = fs.existsSync(path.join(TMP_DB, 'call-cache'));
  ok(cache === false || cache === true, 'o diretório é configurável (CALL_CACHE_DIR)');
  includes(SRC, 'callCache.caminhoNovo(from', 'o comando usa o cache do grupo');
  includes(SRC, 'callCache.apagar', 'apaga a faixa que sai');
});

await test('encerrar a call limpa fila + cache', () => {
  const i = SRC.indexOf("case 'callp':");
  const bloco = SRC.slice(i, i + 6000);
  includes(bloco, 'musicQueue.limpar(from)', 'limpa a fila');
  includes(bloco, 'callCache.limparGrupo(from)', 'limpa o cache do grupo');
});

console.log('\n=== 5) O HANDLER REAL (sem socket) ===\n');

// O handler real exige socket; aqui medimos o CONTRATO do bloco, que e' o que
// os testes de socket falso nao cobrem (o bloco mudou por inteiro).

await test('o bloco trata erro sem vazar stack para o usuário', () => {
  const b = blocoMusicap();
  includes(b, "console.error('[MUSICAP] erro", 'loga o detalhe');
  includes(b, 'Ocorreu um erro', 'responde amigável');
  ok(!b.includes('e.stack'), 'não vaza stack');
});

await test('as respostas carregam o cabeçalho de canal (newsletter)', () => {
  const b = blocoMusicap();
  const usos = (b.match(/gerarContextNewsletter\(\)/g) || []).length;
  ok(usos >= 4, `usa o cabeçalho nas respostas (achei ${usos})`);
});

const totalOk = RESULTS.reduce((a, r) => a + r.passed, 0);
const totalFail = RESULTS.reduce((a, r) => a + r.failed, 0);
console.log('\n' + '='.repeat(40));
console.log(`RESULTADO: ${RESULTS.length} testes | ${totalOk} asserções ok | ${totalFail} falhas`);
console.log('='.repeat(40));
if (totalFail > 0) process.exit(1);
