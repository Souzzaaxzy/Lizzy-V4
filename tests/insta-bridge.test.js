/**
 * Ponte do Instagram (DM) — `dados/src/utils/instaBridge.js`.
 *
 * O que este teste garante (o que NÃO depende de rede):
 *   - a ponte é OPT-IN (`INSTA_DM=1`); sem a env, `ligarPonteInstagram` não sobe;
 *   - `infoDoDm` monta o `info` no formato que o handler do bot espera;
 *   - o `!ping` REAL do bot responde quando o `info` vem "do Instagram";
 *   - a ponte não sobe sem cookie, e não inventa sucesso.
 *
 * O teste do `!ping` usa o HANDLER REAL (`index.js`) com um `nazu` falso que
 * captura a resposta — nenhuma mensagem vai para o Instagram.
 *
 * Uso: node tests/insta-bridge.test.js
 */

import fs from 'fs';
import os from 'os';
import path from 'path';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'lizzy-insta-'));
process.env.DATABASE_PATH = TMP;
process.env.CONFIG_PATH = path.join(TMP, 'config.json');
fs.mkdirSync(path.join(TMP, 'grupos'), { recursive: true });
fs.writeFileSync(process.env.CONFIG_PATH, JSON.stringify({
  nomebot: 'Lizzy', prefixo: '!', numerodono: '5511999999999', nomedono: 'Dono'
}));

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('FAIL:', m); } };
// O layout do bot usa MATHEMATICAL BOLD — desbold antes de comparar.
function desbold(t) {
  return String(t || '').replace(/[\u{1D400}-\u{1D7FF}]/gu, (c) => {
    const n = c.codePointAt(0);
    if (n >= 0x1D400 && n <= 0x1D419) return String.fromCharCode(65 + n - 0x1D400);
    if (n >= 0x1D41A && n <= 0x1D433) return String.fromCharCode(97 + n - 0x1D41A);
    return c;
  });
}
const contem = (h, n, m) => ok(typeof h === 'string' && desbold(h).includes(n), `${m || n} — esperado "${n}"`);

const bridge = await import(new URL('../dados/src/utils/instaBridge.js', import.meta.url).href);
const { infoDoDm, instaDmLigado, ligarPonteInstagram } = bridge;

// ── 1) OPT-IN ────────────────────────────────────────────────────────────────
delete process.env.INSTA_DM;
ok(instaDmLigado() === false, 'sem INSTA_DM -> desligado');
process.env.INSTA_DM = '1';
ok(instaDmLigado() === true, 'com INSTA_DM=1 -> ligado');
delete process.env.INSTA_DM;
ok((await ligarPonteInstagram({ executar: () => {} })) === null, 'desligado -> nao sobe (null)');
process.env.INSTA_DM = '1';

// ── 2) infoDoDm (o formato que o handler espera) ─────────────────────────────
const i = infoDoDm({ thread_id: 'T1', user_id: 'U1', text: '!ping', id: 'M1', item_type: 'text', timestamp: Date.now() });
ok(i !== null, 'texto -> info montado');
ok(i.key.remoteJid === 'T1', 'remoteJid = id da THREAD');
ok(i.key.participant === 'U1', 'participant = quem mandou');
ok(i.key.fromMe === false, 'fromMe = false');
ok(i.message.conversation === '!ping', 'o texto vai em conversation');
ok(i._origem === 'instagram', 'marca a origem');
ok(typeof i.messageTimestamp === 'number' && i.messageTimestamp > 1e9 && i.messageTimestamp < 1e11,
  'timestamp em SEGUNDOS (o handler multiplica por 1000)');

ok(infoDoDm(null) === null, 'null -> null');
ok(infoDoDm({ thread_id: 'T', user_id: 'U', text: '' }) === null, 'texto vazio -> null');
ok(infoDoDm({ thread_id: 'T', user_id: 'U', text: 'oi', item_type: 'reaction' }) === null, 'reacao -> ignorada');
ok(infoDoDm({ user_id: 'U', text: 'oi' }) === null, 'sem thread -> null');

// ── 3) sem cookie, nao sobe ─────────────────────────────────────────────────
process.env.IG_COOKIES_FILE = path.join(TMP, 'inexistente.txt');
delete process.env.IG_COOKIES_DIR;
const semCookie = await ligarPonteInstagram({ executar: () => {} });
ok(semCookie === null, 'sem cookie -> nao sobe');

// ── 4) o !ping REAL responde com o info "do Instagram" ───────────────────────
const indexModule = (await import(new URL('../dados/src/index.js', import.meta.url).href)).default;
const info = infoDoDm({ thread_id: 'T-FAKE', user_id: 'U-FAKE', text: '!ping', id: 'M1', item_type: 'text', timestamp: Date.now() });
const capturado = [];
const nazu = {
  sendMessage: async (chatId, content) => { capturado.push(content); return { key: { id: 'x' } }; },
  user: { id: '66619508210', lid: '66619508210' },
  store: { contacts: {} },
};
await indexModule(nazu, info, null, new Map(), null);
ok(capturado.length >= 1, `o handler respondeu (${capturado.length} mensagem)`);
const texto = capturado.map((c) => c?.text || '').join('\n');
contem(texto, 'PING', 'a resposta e o PING do bot');
contem(texto, 'Latência', 'traz a latencia (comando real, nao stub)');

// ── 5) guard estrutural: a ponte usa o MESMO handler ─────────────────────────
const src = fs.readFileSync(new URL('../dados/src/utils/instaBridge.js', import.meta.url), 'utf8');
ok(/executar\(nazu, info, null, new Map\(\), null\)/.test(src), 'a ponte chama o handler no MESMO formato');
ok(/dm\.received/.test(src), 'escuta o evento dm.received da lib');
ok(/sessionIdFromCookiesFile|caminhoCookies/.test(src), 'a sessao vem do MESMO arquivo do !keyig');
ok(!/app\.get|express|listen\(/.test(src), 'a ponte nao abre porta (nao e servidor)');

console.log('════════════════════════════════════════');
console.log(`RESULTADO: ${pass} asserções ok | ${fail} falhas`);
console.log('════════════════════════════════════════');
fs.rmSync(TMP, { recursive: true, force: true });
if (fail > 0) process.exit(1);
console.log('✅ TODOS OS TESTES PASSARAM');
process.exit(0);
