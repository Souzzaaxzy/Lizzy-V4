/**
 * `!brat` / `!bratvid` — emoji, limite de texto e ritmo uniforme.
 *
 * ## O que estava errado (medido, nao inferido)
 *
 * 1. **Emoji virava "?"**. A camada de texto usa uma fonte BITMAP (BMFont:
 *    `dejavu-bold-96.fnt`, 191 glifos, so' ASCII/latin1). O `print()` do jimp
 *    troca qualquer char ausente da fonte por um `"?"` literal — confirmado no
 *    codigo: `plugin-print/dist/esm/index.js`, `else { char = "?" }`.
 * 2. **Limite de texto baixo**. O `print()` para de desenhar quando passa da
 *    altura maxima, entao a fonte de 113 px em 460 px dava ~4 linhas curtas.
 * 3. **Palavra final lenta**. Cada palavra ficava 500 ms e a ultima **1500 ms**,
 *    porque o encoder de webp funde frames identicos e soma as duracoes — o
 *    `hold` de 2 frames entrava na conta da ultima palavra.
 *
 * Uso: node tests/brat-emoji.test.js
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const canvas = await import(new URL('../dados/src/funcs/downloads/canvas.js', import.meta.url).href);
const emoji = await import(new URL('../dados/src/funcs/downloads/emojiRender.js', import.meta.url).href);

let passed = 0;
let failed = 0;
const ok = (cond, msg) => {
  if (cond) { passed += 1; console.log(`✅ ${msg}`); }
  else { failed += 1; console.log(`❌ ${msg}`); }
};

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'brat-test-'));

const haveFfmpeg = (() => {
  try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); return true; }
  catch { return false; }
})();

/** Decodifica o webp e devolve estatisticas dos pixels. */
const analyze = (webp, file) => {
  fs.writeFileSync(file, webp);
  const png = execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', file, '-frames:v', '1', '-f', 'image2', 'pipe:1'], { maxBuffer: 1 << 28 });
  const raw = execFileSync('ffmpeg', ['-v', 'error', '-i', 'pipe:0', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'], { input: png, maxBuffer: 1 << 28 });
  const W = 512;
  let ink = 0, colored = 0, minX = 1e9, maxX = -1, minY = 1e9, maxY = -1;
  for (let i = 0; i < raw.length; i += 3) {
    const r = raw[i], g = raw[i + 1], b = raw[i + 2];
    const white = r > 245 && g > 245 && b > 245;
    if (!white) {
      ink += 1;
      if (Math.max(r, g, b) - Math.min(r, g, b) > 40) colored += 1;
      const px = (i / 3) % W, py = Math.floor((i / 3) / W);
      if (px < minX) minX = px; if (px > maxX) maxX = px;
      if (py < minY) minY = py; if (py > maxY) maxY = py;
    }
  }
  return { ink, colored, w: maxX - minX + 1, h: maxY - minY + 1 };
};

/** Duracoes dos frames do webp animado (chunks ANMF). */
const frameDurations = (buf) => {
  const out = [];
  let off = 12;
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    if (id === 'ANMF') {
      const b = off + 8;
      out.push(buf[b + 12] | (buf[b + 13] << 8) | (buf[b + 14] << 16));
    }
    off += 8 + size + (size % 2);
  }
  return out;
};

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── Emoji: deteccao e chave do asset ──');
ok(emoji.hasEmoji('oi 🚀') === true, 'detecta emoji no texto');
ok(emoji.hasEmoji('texto puro') === false, 'nao confunde texto puro com emoji');
ok(emoji.twemojiKey('🚀') === '1f680', 'chave de 1 code point (🚀 -> 1f680)');
ok(emoji.twemojiKey('❤️') === '2764', 'remove o VS16 (❤️ -> 2764)');
ok(emoji.twemojiKey('👨‍👩‍👧') === '1f468-200d-1f469-200d-1f467', 'preserva a sequencia ZWJ');
ok(emoji.twemojiKey('🇧🇷') === '1f1e7-1f1f7', 'bandeira usa os dois regional indicators');
ok(emoji.twemojiKey('1️⃣') === '31-20e3', 'keycap (1️⃣ -> 31-20e3)');

const runs = emoji.splitEmoji('bom dia ☀️ grupo 🔥');
ok(runs.filter(r => r.type === 'emoji').length === 2, 'separa 2 emojis de um texto com 2');
ok(runs.map(r => r.value).join('') === 'bom dia ☀️ grupo 🔥', 'a concatenacao dos runs devolve o texto original');

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── Emoji: baixa e desenha ──');
let emojiOk = true;
for (const e of ['🚀', '❤️', '👨‍👩‍👧', '🇧🇷', '1️⃣']) {
  const img = await emoji.getEmojiImage(e);
  if (!img || !img.width) emojiOk = false;
}
ok(emojiOk, 'baixa os 5 tipos de emoji (simples, VS16, ZWJ, bandeira, keycap)');

if (haveFfmpeg) {
  const file = path.join(TMP, 'a.webp');
  const semEmoji = analyze((await canvas.gerarbrat('sem emoji aqui', '', '', '')).buffer, file);
  const comEmoji = analyze((await canvas.gerarbrat('oi 🚀', '', '', '')).buffer, file);
  ok(semEmoji.colored === 0, `texto sem emoji e' monocromatico (${semEmoji.colored} pixels coloridos)`);
  ok(comEmoji.colored > 100, `texto COM emoji tem cor de verdade (${comEmoji.colored} pixels coloridos)`);

  // o coracao e' o caso do VS16 (2 code points, 1 emoji)
  const coracao = analyze((await canvas.gerarbrat('coração ❤️', '', '', '')).buffer, file);
  ok(coracao.colored > 100, `❤️ (VS16) sai colorido (${coracao.colored} pixels)`);

  // ───────────────────────────────────────────────────────────────────────────
  console.log('\n── Limite de texto ──');
  const curto = analyze((await canvas.gerarbrat('curto', '', '', '')).buffer, file);
  const longo = analyze((await canvas.gerarbrat('essa e uma frase bem mais longa do que o limite antigo permitia exibir por completo no sticker', '', '', '')).buffer, file);
  ok(longo.ink > curto.ink, `frase longa desenha MAIS tinta que a curta (${longo.ink} > ${curto.ink})`);
  ok(longo.w > 300, `frase longa usa a largura do sticker (${longo.w}px, antes virava uma tira estreita)`);
  // A tinta pode passar alguns px do box de layout: os glifos da fonte bitmap tem
  // xoffset negativo. O que precisa caber e' o STICKER (512, com 26 de margem).
  ok(longo.w <= 512 - 26 + 8 && longo.h <= 512 - 26 + 8, `frase longa cabe no sticker (${longo.w}x${longo.h}, margem 26)`);

  const gigante = analyze((await canvas.gerarbrat('a'.repeat(400), '', '', '')).buffer, file);
  ok(gigante.ink > 1000, `400 caracteres sem espacos ainda rendem texto legivel (tinta=${gigante.ink})`);
  ok(gigante.w <= 470 && gigante.h <= 470, `400 caracteres cabem no box (${gigante.w}x${gigante.h})`);
  ok(gigante.h > 100, `400 caracteres NAO colapsam num risco (altura=${gigante.h}px, antes eram 5px)`);

  // ───────────────────────────────────────────────────────────────────────────
  console.log('\n── bratvid: ritmo uniforme ──');
  for (const [bpm, esperado] of [['', 520], ['60', 1000]]) {
    const r = await canvas.gerarbratvid('bom dia grupo', '', '', bpm, '');
    const durs = frameDurations(r.buffer);
    const uniq = [...new Set(durs)];
    ok(uniq.length === 1, `bpm=${bpm || '120'}: todas as palavras tem a MESMA duracao (${JSON.stringify(uniq)})`);
    ok(uniq[0] === esperado, `bpm=${bpm || '120'}: duracao por palavra = ${esperado}ms (${uniq[0]}ms)`);
    ok(durs.length === 3, `bpm=${bpm || '120'}: 3 palavras = 3 frames (${durs.length})`);
  }

  const comEmojiVid = await canvas.gerarbratvid('bom dia 🔥', '', '', '', '');
  ok(comEmojiVid.ok === true, 'bratvid aceita emoji e gera o sticker');
  const dursEmoji = frameDurations(comEmojiVid.buffer);
  ok(new Set(dursEmoji).size === 1, `bratvid com emoji mantem o ritmo uniforme (${JSON.stringify([...new Set(dursEmoji)])})`);
} else {
  console.log('⚠️  ffmpeg ausente: os testes de pixel/timing foram pulados');
}

fs.rmSync(TMP, { recursive: true, force: true });

console.log(`\nRESULTADO: ${passed} ok, ${failed} falhas`);
process.exit(failed === 0 ? 0 : 1);
