/**
 * Testes do módulo do Spotify (`funcs/downloads/spotify.js`).
 *
 * Cobre o modulo usado pelo `!spotifydl` (link do Spotify) e pelo autodownload:
 * a busca antiga (Brave 429 / vreden 404) passou a usar o Deezer, o download do
 * spotisaver (403 Cloudflare) passou a vir do yt-dlp, e o `download()` aceita
 * link do Spotify e do Deezer.
 *
 * Testes offline (sem rede): os puros. O teste de rede (busca ao vivo) é
 * marcado e pode ser pulado com OFFLINE=1.
 *
 * Uso: node tests/spotify.test.js
 */

import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const mod = await import(new URL('../dados/src/funcs/downloads/spotify.js', import.meta.url).href);
const API = mod.default;
const { extractTrackId, isValidSpotifyUrl, normalizeText, rankResults, secondsToMs } = mod;

const RESULTS = [];
let CURRENT = null;

function test(name, fn) {
  CURRENT = { name, passed: 0, failed: 0, errors: [] };
  RESULTS.push(CURRENT);
  return Promise.resolve()
    .then(fn)
    .catch((error) => {
      CURRENT.failed += 1;
      CURRENT.errors.push(`EXCEÇÃO: ${error?.stack || error}`);
    })
    .then(() => {
      console.log(`${CURRENT.failed === 0 ? '✅' : '❌'} ${name} (${CURRENT.passed} ok, ${CURRENT.failed} falhas)`);
      for (const err of CURRENT.errors) console.log(`     ${err.split('\n')[0]}`);
    });
}

function ok(condition, message) {
  if (condition) CURRENT.passed += 1;
  else {
    CURRENT.failed += 1;
    CURRENT.errors.push(`ASSERT FALHOU: ${message}`);
  }
}

// ============================================================================
// 1) PUROS
// ============================================================================

await test('extractTrackId: aceita só track do Spotify', () => {
  ok(extractTrackId('https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC') === '4uLU6hMCjMI75M1A2tKUQC', 'link padrão');
  ok(extractTrackId('https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC?si=abc') === '4uLU6hMCjMI75M1A2tKUQC', 'com query');
  ok(extractTrackId('https://open.spotify.com/intl-pt/track/4uLU6hMCjMI75M1A2tKUQC') === '4uLU6hMCjMI75M1A2tKUQC', 'com intl-pt');
  ok(extractTrackId('https://open.spotify.com/album/4uLU6hMCjMI75M1A2tKUQC') === null, 'album não é track');
  ok(extractTrackId('') === null, 'vazio');
  ok(extractTrackId(null) === null, 'null');
});

await test('isValidSpotifyUrl', () => {
  ok(isValidSpotifyUrl('https://open.spotify.com/track/x') === true, 'track válido');
  ok(isValidSpotifyUrl('https://open.spotify.com/album/x') === false, 'album inválido');
  ok(isValidSpotifyUrl('https://www.deezer.com/track/123') === false, 'deezer não é spotify');
  ok(isValidSpotifyUrl(null) === false, 'null');
});

await test('secondsToMs / normalizeText', () => {
  ok(secondsToMs(128) === 128000, 'segundos -> ms');
  ok(secondsToMs(0) === null, 'zero -> null');
  ok(secondsToMs('abc') === null, 'inválido -> null');
  ok(normalizeText('Rô Rosa') === 'ro rosa', 'tira acento e baixa caixa');
});

await test('rankResults: relevância coloca o hit certo em 1º', () => {
  const results = [
    { name: 'Clamo Jesus (Ao Vivo)', artist: 'Paulo Cesar Baruk', image: 'x' },
    { name: 'Te vi de canto', artist: 'Rô Rosa', image: 'x' },
    { name: 'É por você que canto', artist: 'Leandro & Leonardo', image: 'x' },
  ];
  const r = rankResults(results, 'te vi de canto');
  ok(r[0].name === 'Te vi de canto', `1º deveria ser o hit (veio "${r[0].name}")`);
});

await test('rankResults: penaliza "Ao Vivo"/cover e premia título exato', () => {
  const results = [
    { name: 'Evidências (Ao Vivo)', artist: 'X', image: 'x' },
    { name: 'Evidências', artist: 'Chitãozinho & Xororó', image: 'x' },
  ];
  const r = rankResults(results, 'evidencias');
  ok(r[0].name === 'Evidências', `estúdio deveria vir antes (veio "${r[0].name}")`);
});

// ============================================================================
// 2) CONTRATO DO MÓDULO
// ============================================================================

await test('o módulo expõe as funções que o index.js usa', () => {
  ok(typeof API.search === 'function', 'search');
  ok(typeof API.download === 'function', 'download');
  ok(typeof API.downloadTrack === 'function', 'downloadTrack');
  ok(typeof API.searchDownload === 'function', 'searchDownload');
  ok(typeof API.resolveTrackMetadata === 'function', 'resolveTrackMetadata');
});

await test('search: query vazia devolve erro claro (sem rede)', async () => {
  const r1 = await API.search('');
  ok(r1.ok === false, 'vazio -> ok:false');
  ok(typeof r1.msg === 'string' && r1.msg.length > 0, 'com mensagem');
  const r2 = await API.search(null);
  ok(r2.ok === false, 'null -> ok:false');
});

await test('download: link inválido devolve erro claro (sem rede)', async () => {
  const r = await API.download('https://example.com/nao-e-musica');
  ok(r.ok === false, 'inválido -> ok:false');
  ok(/inválido/i.test(r.msg), `mensagem explica (veio "${r.msg}")`);
  const r2 = await API.download('https://open.spotify.com/album/abc');
  ok(r2.ok === false, 'album -> ok:false');
});

await test('downloadTrack: item inválido não quebra', async () => {
  const r = await API.downloadTrack(null);
  ok(r.ok === false, 'null -> ok:false');
  const r2 = await API.downloadTrack({});
  ok(r2.ok === false, 'sem nome -> ok:false');
});

// ============================================================================
// 3) REDE (pode ser pulado com OFFLINE=1)
// ============================================================================

if (process.env.OFFLINE === '1') {
  console.log('⏭️  Testes de rede pulados (OFFLINE=1)');
} else {
  await test('search: busca real no Deezer encontra a música', async () => {
    const r = await API.search('te vi de canto');
    ok(r.ok === true, `busca ok (msg: ${r.msg || '-'})`);
    ok(Array.isArray(r.results) && r.results.length > 0, 'tem resultados');
    ok(r.results[0].name.toLowerCase().includes('te vi de canto'), `1º é o hit (veio "${r.results[0].name}")`);
    ok(typeof r.results[0].song_link === 'string' && r.results[0].song_link.length > 0, 'tem link');
    ok(r.results[0].image, 'tem capa');
  });

  await test('resolveTrackMetadata: lê título/artista do link do Spotify', async () => {
    const meta = await API.resolveTrackMetadata('https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC');
    ok(meta && meta.name, 'tem título');
    ok(meta.artist, 'tem artista');
    ok(meta.image, 'tem capa');
  });

  await test('searchDownload: erra de forma controlada sem yt-dlp', async () => {
    // Sem yt-dlp no servidor de teste, o áudio falha — mas a busca deve funcionar
    // e o erro deve ser claro (não uma exceção).
    const r = await API.searchDownload('te vi de canto');
    if (r.ok) {
      ok(Buffer.isBuffer(r.buffer) && r.buffer.length > 0, 'se baixou, veio buffer');
    } else {
      ok(typeof r.msg === 'string' && r.msg.length > 0, `erro claro (veio "${r.msg}")`);
    }
  });
}

// ============================================================================

const totalOk = RESULTS.reduce((a, r) => a + r.passed, 0);
const totalFail = RESULTS.reduce((a, r) => a + r.failed, 0);
console.log('\n════════════════════════════════════════');
console.log(`RESULTADO: ${RESULTS.length} testes | ${totalOk} asserções ok | ${totalFail} falhas`);
console.log('════════════════════════════════════════');

if (totalFail > 0) {
  console.log('\nFALHAS:');
  for (const r of RESULTS) if (r.failed) for (const e of r.errors) console.log(`- [${r.name}] ${e}`);
  process.exit(1);
}
console.log('✅ TODOS OS TESTES PASSARAM');
process.exit(0);
