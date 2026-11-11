/**
 * Stories do Instagram (`!instagram <link de /stories/>`).
 *
 * O story NÃO é conteúdo público: exige login. Só com o `sessionid` (o mesmo
 * `!keyig`) o bot puxa — fluxo `username` -> `usernameinfo` (pk) ->
 * `feed/user/<pk>/story/`. O teste roda o módulo REAL contra um servidor local (seam
 * `IG_API_BASE`), cobrindo foto E vídeo, o filtro por id, e as recusas.
 *
 * Uso: node tests/instagram-stories.test.js
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import http from 'http';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(HERE, '..');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'lizzy-igstory-'));
process.env.IG_COOKIES_DIR = path.join(TMP, 'instagram');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('FAIL:', m); } };

const igc = await import(new URL('../dados/src/utils/instagramCookies.js', import.meta.url).href);
const igdl = await import(new URL('../dados/src/funcs/downloads/igdl.js', import.meta.url).href);

// ── 1) extrairStory (puro) ───────────────────────────────────────────────────
const casos = [
  ['https://www.instagram.com/stories/l.szzy/', 'l.szzy', null],
  ['https://www.instagram.com/stories/l.szzy/1234567890/', 'l.szzy', '1234567890'],
  ['https://instagram.com/stories/user.name/987/', 'user.name', '987'],
  ['https://www.instagram.com/reel/abc/', null, null],
];
for (const [url, user, id] of casos) {
  const r = igdl.extrairStory(url);
  ok((r?.username ?? null) === user, `extrairStory("${url}") username=${user} (veio ${r?.username})`);
  ok((r?.storyId ?? null) === id, `extrairStory("${url}") id=${id} (veio ${r?.storyId})`);
}

// ── 2) Sem sessão -> orienta o !keyig (não tenta a rede) ─────────────────────
igc.limparCookies();
const semSessao = await igdl.dlStories('https://www.instagram.com/stories/l.szzy/');
ok(semSessao.ok === false, 'sem sessão -> falha');
ok(semSessao.code === 'IG_PRECISA_LOGIN', `sem sessão -> IG_PRECISA_LOGIN (veio ${semSessao.code})`);

// URL inválida (sem cookie, mas o parsing vem primeiro)
const invalida = await igdl.dlStories('https://www.instagram.com/reel/abc/');
ok(invalida.ok === false && /inválida/i.test(invalida.msg), 'URL sem /stories/ -> recusa');

// ── 3) O fluxo REAL (servidor local) — foto E vídeo ──────────────────────────
const PK = '1234567890';
const REELS = {
  reel: {
    items: [
      { id: '111_9', image_versions2: { candidates: [{ url: 'https://cdn.ex/foto1-small.jpg', width: 150, height: 150 }, { url: 'https://cdn.ex/foto1.jpg', width: 1080, height: 1920 }] } },
      { id: '222_9', video_versions: [{ url: 'https://cdn.ex/video1-small.mp4', width: 320, height: 568 }, { url: 'https://cdn.ex/video1.mp4', width: 720, height: 1280 }] },
      { id: '333_9', image_versions2: { candidates: [{ url: 'https://cdn.ex/foto2.jpg', width: 1080, height: 1920 }] } },
    ]
  }
};
let cookieVisto = null;
const srv = http.createServer((req, res) => {
  cookieVisto = req.headers.cookie || null;
  res.writeHead(200, { 'Content-Type': 'application/json' });
  if (req.url.includes('usernameinfo')) {
    res.end(JSON.stringify({ user: { pk: PK, username: 'l.szzy' } }));
  } else if (req.url.includes('/story/')) {
    res.end(JSON.stringify(REELS));
  } else {
    res.end('{}');
  }
});
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
process.env.IG_API_BASE = `http://127.0.0.1:${srv.address().port}`;

igc.salvarSessionId('1234567890%3A' + 'a'.repeat(30));
const todos = await igdl.dlStories('https://www.instagram.com/stories/l.szzy/');
ok(todos.ok === true, `com sessão -> ok (msg: ${todos.msg || ''})`);
ok(todos.count === 3, `3 stories (veio ${todos.count})`);
ok(todos.data.filter((m) => m.type === 'image').length === 2, '2 fotos');
ok(todos.data.filter((m) => m.type === 'video').length === 1, '1 vídeo');
ok(todos.data[0].url === 'https://cdn.ex/foto1.jpg', 'pega a MAIOR resolucao (nao a pequena)');
ok(todos.data[1].mime === 'video/mp4', 'vídeo com mime correto');
ok(/sessionid=/.test(cookieVisto || ''), 'mandou o sessionid no header');

// Filtro por ID específico do story.
const umSo = await igdl.dlStories('https://www.instagram.com/stories/l.szzy/222/');
ok(umSo.ok === true && umSo.count === 1, `filtro por id -> 1 story (veio ${umSo.count})`);
ok(umSo.data[0].type === 'video', 'o item filtrado é o vídeo (id 222)');

// Sem stories ativos.
const vazio = await igdl.dlStories('https://www.instagram.com/stories/ninguem/');
// (o servidor devolve os mesmos itens; simulamos o vazio trocando o id)
const srvVazio = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(req.url.includes('usernameinfo')
    ? JSON.stringify({ user: { pk: '999', username: 'x' } })
    : JSON.stringify({ reel: { items: [] } }));
});
await new Promise((r) => srvVazio.listen(0, '127.0.0.1', r));
process.env.IG_API_BASE = `http://127.0.0.1:${srvVazio.address().port}`;
const semStory = await igdl.dlStories('https://www.instagram.com/stories/x/');
ok(semStory.ok === false && /Nenhum story/i.test(semStory.msg), 'sem stories ativos -> recusa clara');
srvVazio.close();

// Sessão recusada (403).
const srv403 = http.createServer((req, res) => { res.writeHead(403, { 'Content-Type': 'application/json' }); res.end('{"status":"fail"}'); });
await new Promise((r) => srv403.listen(0, '127.0.0.1', r));
process.env.IG_API_BASE = `http://127.0.0.1:${srv403.address().port}`;
const recusada = await igdl.dlStories('https://www.instagram.com/stories/outro_usuario_403/');
ok(recusada.ok === false, '403 -> falha');
ok(recusada.msg.includes('!keyig testar'), `403 -> aponta o diagnostico (veio "${recusada.msg.slice(0,80)}")`);
srv403.close();

srv.close();
delete process.env.IG_API_BASE;

console.log('════════════════════════════════════════');
console.log(`RESULTADO: ${pass} asserções ok | ${fail} falhas`);
console.log('════════════════════════════════════════');
fs.rmSync(TMP, { recursive: true, force: true });
if (fail > 0) process.exit(1);
console.log('✅ TODOS OS TESTES PASSARAM');
process.exit(0);
