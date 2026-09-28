/**
 * `!menuedits` e `!menulogos` (2 textos) — tudo LOCAL, sem API.
 *
 * ## O que estava errado
 *
 * - **menuedits**: o handler mandava a imagem para o GitHub (`upload`) e o
 *   `geraredit` baixava de volta pela URL antes de editar. Efeito local (jimp)
 *   dependendo de rede + token de terceiros: qualquer falha desse passeio virava
 *   "erro interno" em TODOS os comandos do menu. Alem disso o `wojakreaction`
 *   estava listado no menu e sempre respondia "temporariamente indisponivel".
 * - **menulogos (2 textos)**: `!pornhub`, `!avengers` e companhia usavam a classe
 *   `Logos2`, que chamava a API externa `apisnodz.com.br/api/logotipos` — o
 *   comando travava e devolvia um link de API em vez da imagem.
 *
 * Uso: node tests/edits-logos-locais.test.js
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const edits = await import(new URL('../dados/src/funcs/edits/index.js', import.meta.url).href);
const logos = await import(new URL('../dados/src/funcs/logos/index.js', import.meta.url).href);
const { Jimp } = await import('jimp');

let passed = 0;
let failed = 0;
const ok = (cond, msg) => {
  if (cond) { passed += 1; console.log(`✅ ${msg}`); }
  else { failed += 1; console.log(`❌ ${msg}`); }
};

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'edits-logos-'));

const haveFfmpeg = (() => {
  try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); return true; }
  catch { return false; }
})();

/** Monta uma imagem de teste com contraste (gradiente + blocos). */
const testImage = async () => {
  const img = new Jimp({ width: 400, height: 300, color: 0x223344ff });
  for (let y = 40; y < 120; y++) {
    for (let x = 40; x < 360; x++) {
      const i = (y * 400 + x) * 4;
      img.bitmap.data[i] = 240; img.bitmap.data[i + 1] = 220; img.bitmap.data[i + 2] = 60; img.bitmap.data[i + 3] = 255;
    }
  }
  return img.getBuffer('image/png');
};

const decode = (buf, name) => {
  const f = path.join(TMP, name + '.png');
  fs.writeFileSync(f, buf);
  const raw = execFileSync('ffmpeg', ['-v', 'error', '-i', f, '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'], { maxBuffer: 1 << 28 });
  return { raw, W: 400, H: 300 };
};

const stats = (raw, W, H) => {
  let colored = 0, bright = 0, dark = 0;
  for (let i = 0; i < raw.length; i += 3) {
    const r = raw[i], g = raw[i + 1], b = raw[i + 2];
    if (Math.max(r, g, b) - Math.min(r, g, b) > 25) colored += 1;
    const s = r + g + b;
    if (s > 480) bright += 1;
    if (s < 90) dark += 1;
  }
  return { colored, bright, dark };
};

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── menuedits: os 5 comandos do menu ──');
const MENU_EDITS = ['jornal', 'cinema', 'blackwhite', 'desfoque', 'wojakreaction'];
const imgBuf = await testImage();

for (const t of MENU_EDITS) {
  const r = await edits.geraredit({ query: imgBuf, type: t });
  ok(r?.ok === true && Buffer.isBuffer(r.buffer) && r.buffer.length > 0,
    `!${t} gera imagem localmente (${r?.buffer?.length ?? 0} bytes)${r?.ok ? '' : ' — ' + r?.msg}`);
}

// o wojakreaction nao pode mais ser "indisponivel"
const wojak = await edits.geraredit({ query: imgBuf, type: 'wojakreaction' });
ok(wojak.ok === true, 'wojakreaction NAO responde mais "temporariamente indisponivel"');

const invalido = await edits.geraredit({ query: imgBuf, type: 'naoexiste' });
ok(invalido.ok === false && /inválido/i.test(invalido.msg), 'tipo inexistente devolve erro explicito');

// aceita Buffer (o caminho do bot) — sem upload/URL
ok((await edits.geraredit({ query: imgBuf, type: 'blackwhite' })).ok === true,
  'aceita Buffer direto (nenhum upload/URL no caminho)');

if (haveFfmpeg) {
  const cor = stats(...Object.values(decode((await edits.geraredit({ query: imgBuf, type: 'blackwhite' })).buffer, 'bw')), 400, 300);
  ok(cor.colored === 0, `blackwhite realmente remove a cor (${cor.colored} pixels coloridos)`);
  const orig = stats(...Object.values(decode(imgBuf, 'orig')), 400, 300);
  ok(orig.colored > 1000, `a imagem de teste tem cor de partida (${orig.colored})`);
  const cin = stats(...Object.values(decode((await edits.geraredit({ query: imgBuf, type: 'cinema' })).buffer, 'cin')), 400, 300);
  ok(cin.dark > orig.dark + 1000, `cinema adiciona as barras escuras (${cin.dark} vs ${orig.dark})`);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── menulogos: os 10 comandos de 2 textos ──');
const MENU_LOGOS2 = ['pornhub', 'avengers', 'graffiti', 'captainamerica', 'stone3d', 'neon2', 'thor', 'deadpool', 'blackpink', 'amongus'];
const MENU_LOGOS1 = ['royal', 'firework', 'galaxy', 'glitch', 'comics'];

ok(logos.TWO_TEXT_TYPES.length === MENU_LOGOS2.length, `STYLES2 cobre os ${MENU_LOGOS2.length} estilos de 2 textos (${logos.TWO_TEXT_TYPES.length})`);
for (const t of MENU_LOGOS2) {
  ok(logos.STYLES2[(t === 'amongus' ? 'amongus2' : t)] != null, `estilo local existe para !${t}`);
}
for (const t of MENU_LOGOS1) {
  ok(logos.STYLES[t] != null, `estilo local de 1 texto existe para !${t}`);
}

for (const t of MENU_LOGOS2) {
  const r = await logos.gerarLogo({ query: ['Abyss', 'Bot'], type: t });
  ok(r?.ok === true && r.buffer?.length > 0, `!${t} gera com DOIS textos localmente (${r?.buffer?.length ?? 0} bytes)${r?.ok ? '' : ' — ' + r?.msg}`);
}

// 1 texto continua funcionando (nao regrediu)
for (const t of MENU_LOGOS1) {
  const r = await logos.gerarLogo({ query: 'Vex Bot', type: t });
  ok(r?.ok === true && r.buffer?.length > 0, `!${t} (1 texto) continua funcionando`);
}

// o comando `amongus` aparece nos dois menus: o estilo tem que resolver nos dois modos
const amongus1 = await logos.gerarLogo({ query: 'Vex', type: 'amongus' });
const amongus2 = await logos.gerarLogo({ query: ['Abyss', 'Bot'], type: 'amongus' });
ok(amongus1.ok === true && amongus2.ok === true, '!amongus funciona nos DOIS modos (1 e 2 textos)');

// dois textos incompletos e' erro explicito (nao gera imagem errada)
const incompleto = await logos.gerarLogo({ query: ['Abyss', ''], type: 'pornhub' });
ok(incompleto.ok === false && /dois textos/i.test(incompleto.msg), 'dois textos incompletos devolve erro explicito');

if (haveFfmpeg) {
  // a prova de que as DUAS linhas saem: tinta em duas faixas verticais distintas
  const bandsOf = (buf, name) => {
    const f = path.join(TMP, name + '.png');
    fs.writeFileSync(f, buf);
    const raw = execFileSync('ffmpeg', ['-v', 'error', '-i', f, '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'], { maxBuffer: 1 << 28 });
    const W = 1200, H = 640;
    const lit = [];
    for (let y = 0; y < H; y++) {
      let rowSum = 0;
      for (let x = 0; x < W; x++) { const i = (y * W + x) * 3; rowSum += raw[i] + raw[i + 1] + raw[i + 2]; }
      const avg = rowSum / W;
      let n = 0;
      for (let x = 0; x < W; x++) { const i = (y * W + x) * 3; if (raw[i] + raw[i + 1] + raw[i + 2] - avg > 120) n++; }
      lit.push(n > 15 ? 1 : 0);
    }
    const out = [];
    let st = -1;
    for (let y = 0; y <= H; y++) {
      if (lit[y] && st < 0) st = y;
      else if (!lit[y] && st >= 0) { out.push([st, y - 1]); st = -1; }
    }
    return out;
  };

  for (const t of ['thor', 'neon2', 'blackpink', 'avengers']) {
    const r = await logos.gerarLogo({ query: ['Abyss', 'Bot'], type: t });
    const b = bandsOf(r.buffer, 'bands-' + t);
    // as duas linhas caem em faixas verticais distintas (blocos separados
    // contam como uma faixa, entao exige-se pelo menos 2)
    ok(b.length >= 2, `!${t}: DUAS linhas de texto no sticker (${b.length} faixas verticais)`);
  }

  // uma linha so' (o array nao foi coagido para string). Usa um estilo de
  // 1 texto — `thor` e' exclusivo de 2 textos, entao nao serve aqui.
  const umTexto = await logos.gerarLogo({ query: 'LinhaUnica', type: 'royal' });
  const b1 = bandsOf(umTexto.buffer, 'bands-1');
  ok(b1.length >= 1 && b1.length < 3, `1 texto continua com uma faixa central (${b1.length})`);

  // e um estilo EXCLUSIVO de 2 textos recusa o modo de 1 texto (nao inventa)
  const so2 = await logos.gerarLogo({ query: 'LinhaUnica', type: 'thor' });
  ok(so2.ok === false && /desconhecido/i.test(so2.msg), 'estilo exclusivo de 2 textos recusa o modo de 1 texto');
}

fs.rmSync(TMP, { recursive: true, force: true });

console.log(`\nRESULTADO: ${passed} ok, ${failed} falhas`);
process.exit(failed === 0 ? 0 : 1);
