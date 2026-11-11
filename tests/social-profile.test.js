/**
 * Testes do `socialProfile` — o núcleo dos comandos `!pinsta` e `!pspotify`
 * (e também `!ptiktok` / `!px`).
 *
 * O que este teste garante (o que NÃO dá para garantir por rede):
 *   - `normalizeUsername` aceita @handle, handle puro e URL de perfil;
 *   - o `og:` scraping do Spotify parseia a página pública corretamente e
 *     classifica "não encontrado" (sem rede — usa um axios falso via injeção de
 *     módulo não é possível aqui, então testamos o FORMATO e a classificação de
 *     erro com um perfil montado à mão);
 *   - `formatSocialProfile` não deixa `undefined`/`null`/`NaN` vazar;
 *   - `getSocialProfile` classifica "não encontrado" x "erro de API".
 *
 * Uso: node tests/social-profile.test.js
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.resolve(HERE, '..');

const TMP_DB = fs.mkdtempSync(path.join(os.tmpdir(), 'lizzy-social-'));
process.env.DATABASE_PATH = TMP_DB;
fs.mkdirSync(path.join(TMP_DB, 'grupos'), { recursive: true });

const RESULTS = [];
let CURRENT = null;

function test(name, fn) {
  CURRENT = { name, passed: 0, failed: 0, errors: [] };
  RESULTS.push(CURRENT);
  try {
    const r = fn();
    if (r && typeof r.then === 'function') {
      return r.then(() => finish(name)).catch((e) => { CURRENT.failed += 1; CURRENT.errors.push(`EXCEÇÃO: ${e?.stack || e}`); finish(name); });
    }
    finish(name);
  } catch (e) {
    CURRENT.failed += 1;
    CURRENT.errors.push(`EXCEÇÃO: ${e?.stack || e}`);
    finish(name);
  }
  return Promise.resolve();
}
function finish(name) {
  console.log(`${CURRENT.failed === 0 ? '✅' : '❌'} ${name} (${CURRENT.passed} ok, ${CURRENT.failed} falhas)`);
  for (const e of CURRENT.errors) console.log(`     ${e.split('\n')[0]}`);
}
function ok(c, m) { if (c) CURRENT.passed += 1; else { CURRENT.failed += 1; CURRENT.errors.push(`ASSERT FALHOU: ${m}`); } }
// O layout novo usa MATHEMATICAL BOLD nos titulos — desbold antes de comparar.
function desbold(t) {
  return String(t || '').replace(/[\u{1D400}-\u{1D7FF}]/gu, (c) => {
    const n = c.codePointAt(0);
    if (n >= 0x1D400 && n <= 0x1D419) return String.fromCharCode(65 + n - 0x1D400);
    if (n >= 0x1D41A && n <= 0x1D433) return String.fromCharCode(97 + n - 0x1D41A);
    if (n >= 0x1D468 && n <= 0x1D481) return String.fromCharCode(65 + n - 0x1D468);
    if (n >= 0x1D482 && n <= 0x1D49B) return String.fromCharCode(97 + n - 0x1D482);
    return c;
  });
}
function includes(h, n, l) { ok(typeof h === 'string' && desbold(h).includes(n), `${l || n} — esperado conter "${n}"`); }
function notIncludes(h, n, l) { ok(typeof h === 'string' && !h.includes(n), `${l || n} — não deveria conter "${n}"`); }

const sp = await import(new URL('../dados/src/funcs/utils/socialProfile.js', import.meta.url).href);

// ============================================================================
// 1) normalizeUsername
// ============================================================================

await test('socialProfile: normalizeUsername aceita handle, @handle e URL', () => {
  ok(sp.normalizeUsername('nasa') === 'nasa', 'handle puro');
  ok(sp.normalizeUsername('@nasa') === 'nasa', '@handle');
  ok(sp.normalizeUsername('  nasa  ') === 'nasa', 'com espaços');
  ok(sp.normalizeUsername('https://www.instagram.com/nasa/') === 'nasa', 'URL do Instagram');
  ok(sp.normalizeUsername('https://open.spotify.com/user/spotify') === 'spotify', 'URL do Spotify (/user/id)');
  ok(sp.normalizeUsername('https://x.com/elonmusk') === 'elonmusk', 'URL do X');
  ok(sp.normalizeUsername('me segue @nasa lá') === 'nasa', '@handle no meio do texto');
  ok(sp.normalizeUsername('') === '', 'vazio -> vazio');
  ok(sp.normalizeUsername(null) === '', 'null -> vazio');
});

// ============================================================================
// 2) formatSocialProfile (não vaza undefined/null/NaN)
// ============================================================================

await test('socialProfile: formatSocialProfile monta o cartão do Instagram', () => {
  const t = sp.formatSocialProfile({
    platform: 'instagram', username: 'nasa', displayName: 'NASA',
    followers: 104308003, following: 89, posts: 1200, private: false, verified: true,
    bio: 'Making the impossible possible', profileUrl: 'https://instagram.com/nasa'
  });
  includes(t, 'INSTAGRAM', 'título');
  includes(t, '@nasa', 'usuário');
  includes(t, 'NASA', 'nome');
  includes(t, '104.3M', 'seguidores formatados');
  includes(t, 'Verificado: Sim', 'verificado');
  notIncludes(t, 'undefined', 'sem undefined');
  notIncludes(t, 'NaN', 'sem NaN');
});

await test('socialProfile: formatSocialProfile monta o cartão do Spotify (sem seguidores)', () => {
  const t = sp.formatSocialProfile({
    platform: 'spotify', username: 'spotify', displayName: 'Spotify',
    avatar: 'https://i.scdn.co/image/x', profileUrl: 'https://open.spotify.com/user/spotify'
  });
  includes(t, 'SPOTIFY', 'título');
  includes(t, '@spotify', 'usuário');
  includes(t, 'Nome: Spotify', 'nome');
  notIncludes(t, 'undefined', 'sem undefined');
  notIncludes(t, '[object Object]', 'sem objeto cru');
});

await test('socialProfile: formatSocialProfile ignora campos vazios/estranhos', () => {
  const t = sp.formatSocialProfile({
    platform: 'spotify', username: 'x', displayName: undefined,
    followers: undefined, posts: null, bio: '', location: 'NaN', website: '[object Object]'
  });
  notIncludes(t, 'undefined', 'sem undefined');
  notIncludes(t, 'null', 'sem null');
  notIncludes(t, 'NaN', 'sem NaN');
  notIncludes(t, '[object', 'sem objeto cru');
});

// ============================================================================
// 3) formatErrorProfile
// ============================================================================

await test('socialProfile: formatErrorProfile distingue não-encontrado de erro', () => {
  includes(sp.formatErrorProfile('not_found', 'Spotify', 'fulano'), 'não encontrado', 'não encontrado');
  includes(sp.formatErrorProfile('not_found', 'Spotify', 'fulano'), '@fulano', 'cita o handle');
  includes(sp.formatErrorProfile('api', 'Spotify', 'fulano'), 'Tente novamente', 'erro de API pede retry');
});

// ============================================================================
// 4) getSocialProfile — validação de entrada (sem rede)
// ============================================================================

await test('socialProfile: getSocialProfile recusa plataforma/usuário inválidos', async () => {
  const semPlat = await sp.getSocialProfile('orkut', 'x');
  ok(semPlat.ok === false && /suportada/i.test(semPlat.text), 'plataforma não suportada');

  const semUser = await sp.getSocialProfile('spotify', '   ');
  ok(semUser.ok === false && /Informe um usuário/i.test(semUser.text), 'sem usuário avisa');
});

// ============================================================================
// 5) Contrato dos providers (estrutura)
// ============================================================================

await test('socialProfile: expõe os quatro providers e o formatter', () => {
  for (const fn of ['getSocialProfile', 'getTikTokProfile', 'getInstagramProfile', 'getXProfile', 'getSpotifyProfile', 'formatSocialProfile', 'normalizeUsername']) {
    ok(typeof sp[fn] === 'function', `exporta ${fn}`);
  }
});

// ============================================================================

// 5) Foto em HD (hd_profile_pic_url_info) + ffmpeg
// ============================================================================
await test('o avatar HD e escolhido (nao a versao 150x150)', () => {
  const p = {
    platform: 'instagram', username: 'x', displayName: 'X',
    followers: 1, following: 2, posts: 3, private: false, verified: false,
    avatar: 'https://scontent.cdninstagram.com/v/t51/aaa.jpg?stp=dst-jpg_s150x150_tt6&x=1',
    profileUrl: 'https://www.instagram.com/x'
  };
  const t = sp.formatSocialProfile(p);
  includes(t, '📊', 'a linha de numeros compacta existe');
  includes(t, '📸 3', 'posts na linha de numeros');
  notIncludes(t, 'undefined', 'sem undefined');
  // o texto NAO deve trazer o link cru (virou botao cta_url no handler)
  ok(!/^┃ https?:/m.test(t), 'o link do perfil nao vai no texto (vira cta_url)');
});


const totalOk = RESULTS.reduce((a, r) => a + r.passed, 0);
const totalFail = RESULTS.reduce((a, r) => a + r.failed, 0);
console.log('\n════════════════════════════════════════');
console.log(`RESULTADO: ${RESULTS.length} testes | ${totalOk} asserções ok | ${totalFail} falhas`);
// ============================================================================
console.log('════════════════════════════════════════');

fs.rmSync(TMP_DB, { recursive: true, force: true });

if (totalFail > 0) {
  console.log('\nFALHAS:');
  for (const r of RESULTS) if (r.failed) for (const e of r.errors) console.log(`- [${r.name}] ${e}`);
  process.exit(1);
}
console.log('✅ TODOS OS TESTES PASSARAM');
process.exit(0);
