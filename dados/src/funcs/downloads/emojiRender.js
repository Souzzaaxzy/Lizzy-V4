/**
 * Emoji rendering for the canvas/text commands (`!brat`, `!bratvid`, ...).
 *
 * ## Why this exists
 *
 * The text layer is drawn with jimp against a **bitmap font** (BMFont:
 * `dejavu-bold-96.fnt`, 191 glyphs, ASCII/latin1 only). jimp's print plugin
 * substitutes **any character missing from the font with a literal `"?"`**:
 *
 *     } else {
 *         char = "?";          // plugin-print/dist/esm/index.js
 *     }
 *
 * So every emoji in the text came out as `????`. There is no font swap that
 * fixes this: a BMFont is a fixed atlas of pre-rendered glyphs, and no practical
 * atlas carries the whole emoji range (which is also multi-codepoint, colour, and
 * frequently updated).
 *
 * The fix is to stop treating emoji as text. Emoji are rendered as **images**
 * (Twemoji SVG-derived PNGs, the same artwork WhatsApp/Telegram use), blitted
 * next to the text runs. Text keeps its bitmap font; emoji keep their colour.
 *
 * ## What counts as emoji
 *
 * Grapheme clusters, not code points: `❤️` is U+2764 U+FE0F (two code points,
 * one emoji), `👨👩👧` is joined by U+200D, `🇧🇷` is two regional indicators,
 * `1️⃣` is `1` + U+FE0F + U+20E3. Slicing by code point would break all of them.
 * `TWEMOJI_FILE` encodes the codepoints the way Twemoji names its files (lowercase
 * hex joined by `-`, variation selectors dropped).
 */
import { Jimp } from 'jimp';

/**
 * Matches emoji grapheme clusters.
 *
 * Order matters: the alternation tries the multi-codepoint kinds first so a ZWJ
 * sequence or a keycap is consumed whole rather than as its first code point.
 */
const EMOJI_RE = new RegExp(
  [
    // keycap: digit/#/* + optional VS16 + U+20E3
    '[#*0-9]\\uFE0F?\\u20E3',
    // flag: two regional indicators
    '\\p{Regional_Indicator}{2}',
    // ZWJ sequence: pic + (VS16)? + (ZWJ + pic + (VS16)?)*
    '\\p{Extended_Pictographic}\\uFE0F?(?:\\u200D\\p{Extended_Pictographic}\\uFE0F?)*',
    // standalone variation selector after a pictographic-less base (rare)
    '\\p{Emoji_Modifier_Base}\\p{Emoji_Modifier}'
  ].join('|'),
  'gu'
);

/** Does the text carry at least one emoji? */
export function hasEmoji(text) {
  EMOJI_RE.lastIndex = 0;
  return EMOJI_RE.test(String(text ?? ''));
}

/**
 * Splits text into ordered runs: `{ type: 'text' | 'emoji', value }`.
 *
 * Plain text runs are kept whole so the bitmap font still applies kerning inside
 * a word; emoji runs carry the exact cluster used to fetch the image.
 */
export function splitEmoji(text) {
  const source = String(text ?? '');
  const runs = [];
  let last = 0;
  EMOJI_RE.lastIndex = 0;
  let m;
  while ((m = EMOJI_RE.exec(source)) !== null) {
    if (m.index > last) runs.push({ type: 'text', value: source.slice(last, m.index) });
    runs.push({ type: 'emoji', value: m[0], key: twemojiKey(m[0]) });
    last = m.index + m[0].length;
    // guard against a zero-length match looping forever
    if (m[0].length === 0) EMOJI_RE.lastIndex += 1;
  }
  if (last < source.length) runs.push({ type: 'text', value: source.slice(last) });
  return runs;
}

/**
 * Twemoji file name for a cluster: lowercase hex code points joined by `-`,
 * with variation selectors (U+FE0F / U+FE0E) removed — that is how the asset
 * repo names them (`❤️` -> `2764.png`, `👨👩👧` -> `1f468-200d-1f469-200d-1f467.png`).
 */
export function twemojiKey(cluster) {
  return [...String(cluster)]
    .map((ch) => ch.codePointAt(0))
    .filter((cp) => cp !== 0xfe0f && cp !== 0xfe0e)
    .map((cp) => cp.toString(16))
    .join('-');
}

/**
 * Mirrors offered in order. All are Twemoji artwork under permissive licences
 * (CC-BY 4.0); the first that resolves wins and the result is cached, so the
 * order only matters for availability.
 */
const EMOJI_SOURCES = [
  (f) => `https://cdn.jsdelivr.net/gh/jdecked/twemoji@15.1.0/assets/72x72/${f}.png`,
  (f) => `https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/${f}.png`,
  (f) => `https://raw.githubusercontent.com/jdecked/twemoji/main/assets/72x72/${f}.png`
];

const EMOJI_FETCH_TIMEOUT_MS = 12 * 1000;

const emojiCache = new Map();
const emojiMisses = new Set();
const EMOJI_CACHE_MAX = 2000;

let warnedOnce = false;

/** Fetch a Twemoji PNG, trying each mirror. Returns a Buffer or null. */
async function fetchEmojiPng(key) {
  for (const build of EMOJI_SOURCES) {
    const url = build(key);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), EMOJI_FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        signal: ctrl.signal,
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
      });
      if (!res.ok) continue;
      const ab = await res.arrayBuffer();
      if (ab.byteLength) return Buffer.from(ab);
    } catch {
      /* try the next mirror */
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}

/**
 * The Jimp image for an emoji cluster, or null when it cannot be resolved.
 *
 * Cached by cluster (and misses cached too, so a broken emoji does not re-hit the
 * network on every frame — a 9-word bratvid draws every frame).
 */
export async function getEmojiImage(cluster) {
  const key = twemojiKey(cluster);
  if (!key) return null;
  if (emojiCache.has(key)) return emojiCache.get(key);
  if (emojiMisses.has(key)) return null;

  const png = await fetchEmojiPng(key);
  if (!png) {
    emojiMisses.add(key);
    if (!warnedOnce) {
      warnedOnce = true;
      process.stderr.write(
        `[emoji] nao consegui baixar o emoji "${cluster}" (${key}) — ele saira' sem desenho. ` +
        'Verifique a saida de rede do bot para o CDN de emoji.\n'
      );
    }
    return null;
  }

  const img = await Jimp.read(png);
  if (emojiCache.size >= EMOJI_CACHE_MAX) {
    emojiCache.delete(emojiCache.keys().next().value);
  }
  emojiCache.set(key, img);
  return img;
}

/** Pre-resolve every emoji in a text (so rendering does not await mid-layout). */
export async function preloadEmoji(text) {
  const runs = splitEmoji(text);
  const keys = [...new Set(runs.filter((r) => r.type === 'emoji').map((r) => r.value))];
  const out = new Map();
  for (const cluster of keys) {
    out.set(cluster, await getEmojiImage(cluster));
  }
  return out;
}
