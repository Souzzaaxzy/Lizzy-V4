/**
 * !keyig — cookie/sessão do Instagram (só o dono) + caminho autenticado do
 * `getInstagramProfile`.
 *
 * O Instagram desligou o endpoint anônimo (`web_profile_info` -> 404 medido), então
 * o `!pinsta` precisa do `sessionid` de uma conta. O cookie libera o CABEÇALHO de
 * qualquer perfil — inclusive PRIVADO (foto, nome, seguidores, seguindo).
 *
 * O teste roda o HANDLER REAL (com socket falso) e o módulo puro. Nada de rede:
 * o `axios` do socialProfile é dublado por um seam de teste.
 *
 * Uso: node tests/keyig-instagram.test.js
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.resolve(HERE, '..');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'lizzy-keyig-'));
process.env.DATABASE_PATH = TMP;
process.env.CONFIG_PATH = path.join(TMP, 'config.json');
process.env.IG_COOKIES_DIR = path.join(TMP, 'instagram');
fs.mkdirSync(path.join(TMP, 'grupos'), { recursive: true });
fs.mkdirSync(path.join(TMP, 'dono'), { recursive: true });
fs.writeFileSync(process.env.CONFIG_PATH, JSON.stringify({
  nomebot: 'Lizzy', prefixo: '!', numerodono: '5599999999999', nomedono: 'Dono'
}));

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('FAIL:', m); } };
const contem = (h, n, m) => ok(typeof h === 'string' && h.includes(n), `${m || n} — esperado "${n}"`);

// ── 1) Módulo de cookies (puro) ──────────────────────────────────────────────
const igc = await import(new URL('../dados/src/utils/instagramCookies.js', import.meta.url).href);

// Netscape de verdade (formato que o navegador exporta).
const NETSCAPE = [
  '# Netscape HTTP Cookie File',
  '.instagram.com\tTRUE\t/\tTRUE\t1800000000\tcsrftoken\tABC123',
  '.instagram.com\tTRUE\t/\tTRUE\t1800000000\tsessionid\t99999%3AAAbbCcDdEeFfGgHhIiJjKkLlMmNnOoPpQq',
  '.instagram.com\tTRUE\t/\tTRUE\t1800000000\tmid\tZZZ',
].join('\n');

ok(igc.extrairSessionId(NETSCAPE) === '99999%3AAAbbCcDdEeFfGgHhIiJjKkLlMmNnOoPpQq', 'extrai o sessionid do Netscape');
ok(igc.extrairSessionId('') === null, 'conteudo vazio -> null');
ok(igc.extrairSessionId('abc') === null, 'valor curto demais -> null');
ok(igc.extrairSessionId('99999%3A' + 'x'.repeat(40)) === '99999%3A' + 'x'.repeat(40), 'sessionid cru (sem tab) e aceito');
ok(igc.extrairSessionId(NETSCAPE.replace('sessionid', 'outrocookie')) === null, 'sem a linha do sessionid no Netscape -> null');

ok(!igc.temCookies(), 'sem arquivo -> sem cookies');
const salv = igc.salvarSessionId('12345%3A' + 'a'.repeat(30));
ok(salv.ok === true, 'salva o sessionid');
ok(igc.temCookies() === true, 'depois de salvar, tem cookies');
ok(igc.lerSessionId() === '12345%3A' + 'a'.repeat(30), 'le o sessionid salvo');
ok(igc.mascarar('12345%3A' + 'a'.repeat(30)).includes('...'), 'mascara o valor');
ok(!igc.mascarar('12345%3A' + 'a'.repeat(30)).includes('a'.repeat(30)), 'nao expoe o valor inteiro');

ok(!igc.salvarSessionId('').ok, 'recusa vazio');
ok(!igc.salvarSessionId('com espaco aqui dentro').ok, 'recusa espaco');
ok(!igc.salvarSessionId('curto').ok, 'recusa curto');

const removidos = igc.limparCookies();
ok(removidos.length >= 1, 'limpar remove arquivo(s)');
ok(!igc.temCookies(), 'depois de limpar, sem cookies');

// Arquivo Netscape colocado a mao (o "igual ao YouTube").
fs.mkdirSync(process.env.IG_COOKIES_DIR, { recursive: true });
fs.writeFileSync(igc.ARQUIVO_NETSCAPE, NETSCAPE);
ok(igc.lerSessionId() === '99999%3AAAbbCcDdEeFfGgHhIiJjKkLlMmNnOoPpQq', 'le o sessionid do cookies.txt (Netscape) colocado a mao');

// ── 2) O caminho autenticado do getInstagramProfile (servidor local) ─────────
// O `socialProfile` aponta para o IG real; o seam `IG_API_BASE` permite apontar
// para um servidor local que devolve o JSON do perfil — entao medimos o caminho
// autenticado de verdade, sem tocar na rede externa.
import http from 'http';

const PERFIL_PRIVADO = {
  data: { user: {
    username: 'fulano_privado', full_name: 'Fulano Privado',
    profile_pic_url_hd: 'https://exemplo/x.jpg', biography: 'bio aqui',
    edge_followed_by: { count: 1234 }, edge_follow: { count: 567 },
    edge_owner_to_timeline_media: { count: 12 },
    is_private: true, is_verified: false
  } }
};

let recebeuCookie = null;
let ultimaRota = '';
const srv = http.createServer((req, res) => {
  recebeuCookie = req.headers.cookie || null;
  ultimaRota = req.url;
  res.writeHead(200, { 'Content-Type': 'application/json' });
  // O `usernameinfo` devolve o usuario direto; o `web_profile_info`, sob `data.user`.
  res.end(JSON.stringify(ultimaRota.includes('usernameinfo') ? PERFIL_PRIVADO.data.user : PERFIL_PRIVADO));
});
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
process.env.IG_API_BASE = `http://127.0.0.1:${srv.address().port}`;

// Reimporta o socialProfile JÁ com o seam setado.
const sp = await import(new URL('../dados/src/funcs/utils/socialProfile.js', import.meta.url).href);

// Sem cookie: nao deveria nem tocar no servidor autenticado (cai no anonimo,
// que falha). Com cookie: usa o caminho autenticado.
// Zera os cookies (a parte 1 deixou o cookies.txt Netscape no disco).
igc.limparCookies();
ok(igc.temCookies() === false, 'comeca sem cookies');
const semCookie = await sp.getInstagramProfile('fulano_privado');
ok(semCookie.ok === false, 'sem cookie -> falha (anonimo morto)');
ok(semCookie.code === 'IG_PRECISA_LOGIN', `sem cookie -> IG_PRECISA_LOGIN (veio "${semCookie.code}")`);

// O servidor devolve o formato do `usernameinfo` (objeto do usuario direto)
// quando a URL nao tem `web_profile_info`. Testamos os DOIS formatos de resposta.
let formatoAtual = 'web_profile_info';

// Com cookie: caminho autenticado -> devolve o CABEÇALHO do perfil privado.
igc.salvarSessionId('1234567890%3A' + 'a'.repeat(30));
const comCookie = await sp.getInstagramProfile('fulano_privado');
ok(comCookie.ok === true, `com cookie -> ok (msg: ${comCookie.msg || ''})`);
ok(comCookie.profile?.username === 'fulano_privado', 'username do perfil');
ok(comCookie.profile?.followers === 1234, `seguidores (veio ${comCookie.profile?.followers})`);
ok(comCookie.profile?.following === 567, `seguindo (veio ${comCookie.profile?.following})`);
ok(comCookie.profile?.private === true, 'perfil PRIVADO marcado');
ok(comCookie.profile?.autenticado === true, 'marca que veio autenticado');
ok(comCookie.profile?.displayName === 'Fulano Privado', 'nome de exibicao');
ok(/sessionid=/.test(recebeuCookie || ''), 'mandou o cookie sessionid no header');
ok(ultimaRota.includes('usernameinfo'), 'usou a rota do app (usernameinfo) por padrao');
srv.close();

// ── 2b) A CADEIA de rotas: se a 1a cair (404), a proxima assume ──────────────
// Servidor que responde 404 na 1a chamada e 200 na 2a (simula a rota morta).
let chamadas = 0;
const srv2 = http.createServer((req, res) => {
  chamadas += 1;
  if (chamadas === 1) { res.writeHead(404, { 'Content-Type': 'text/html' }); res.end('<html>404</html>'); return; }
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(PERFIL_PRIVADO.data.user));
});
await new Promise((r) => srv2.listen(0, '127.0.0.1', r));
process.env.IG_API_BASE = `http://127.0.0.1:${srv2.address().port}`;
// Reimporta para pegar o novo base (o modulo le a env a cada chamada, mas o
// getInstagramProfile e' o mesmo; basta chamar).
const r2 = await sp.getInstagramProfile('qualquer');
ok(r2.ok === true, 'a 2a rota assumiu quando a 1a deu 404');
ok(chamadas === 2, `tentou a 2a rota (chamadas=${chamadas})`);
srv2.close();

// ── 2c) TODAS as rotas falham -> "Perfil nao encontrado" (nao mais erro generico) ─
const srv3 = http.createServer((req, res) => { res.writeHead(404, { 'Content-Type': 'text/html' }); res.end('404'); });
await new Promise((r) => srv3.listen(0, '127.0.0.1', r));
process.env.IG_API_BASE = `http://127.0.0.1:${srv3.address().port}`;
const r3 = await sp.getInstagramProfile('nao_existe_mesmo');
ok(r3.ok === false, 'todas as rotas 404 -> falha');
ok(r3.msg.includes('não encontrado'), `404 em tudo -> "perfil nao encontrado" (veio "${r3.msg}")`);
srv3.close();
delete process.env.IG_API_BASE;

// ── 2d) HTTP 200 com corpo `status:"fail"` NAO e' sucesso ────────────────────
// O Instagram responde 200+fail quando a requisicao nao e' confiavel (headers
// de app faltando / sessao invalida). Era o furo: eu lia so o HTTP.
const srvFail = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ message: "We're sorry", status_code: '200', status: 'fail' }));
});
await new Promise((r) => srvFail.listen(0, '127.0.0.1', r));
process.env.IG_API_BASE = `http://127.0.0.1:${srvFail.address().port}`;
igc.salvarSessionId('1234567890%3A' + 'a'.repeat(30));
const rFail = await sp.getInstagramProfile('l.szzy');
ok(rFail.ok === false, '200+fail -> NAO e ok');
ok(rFail.code === 'IG_REQUISICAO_RECUSADA', `200+fail -> IG_REQUISICAO_RECUSADA (veio ${rFail.code})`);
srvFail.close();
delete process.env.IG_API_BASE;

// ── 2e) Os headers do app vao completos (o que faz o IG aceitar) ─────────────
const { userIdDoSessionId } = sp;
ok(userIdDoSessionId('66612345678%3AAbCdEf%3A28') === '66612345678', 'extrai o user id do sessionid');
ok(userIdDoSessionId('abc') === null, 'sessionid sem id -> null');

// Captura os headers que o modulo manda numa requisicao real.
let headersVistos = null;
const srvH = http.createServer((req, res) => {
  headersVistos = req.headers;
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ user: { pk: '1', username: 'x', full_name: 'X', edge_followed_by: { count: 1 } } }));
});
await new Promise((r) => srvH.listen(0, '127.0.0.1', r));
process.env.IG_API_BASE = `http://127.0.0.1:${srvH.address().port}`;
await sp.getInstagramProfile('x');
ok(headersVistos && headersVistos['x-ig-app-id'], 'manda X-IG-App-ID');
ok(headersVistos && headersVistos['x-ig-device-id'], 'manda X-IG-Device-ID (faltava)');
ok(headersVistos && headersVistos['x-ig-www-claim'] === '0', 'manda X-IG-WWW-Claim');
ok(headersVistos && headersVistos['ig-intended-user-id'] === '1234567890', 'manda IG-INTENDED-USER-ID com o id do sessionid');
ok(headersVistos && /sessionid=/.test(headersVistos['cookie'] || ''), 'manda o cookie');
srvH.close();
delete process.env.IG_API_BASE;

// ── 2f) O diagnostico inclui o teste de SESSAO (current_user) ────────────────
// E' o que separa "sessao invalida" de "IP bloqueado": se o current_user
// devolver a conta, a sessao presta.
const srvCu = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  if (req.url.includes('current_user')) {
    res.end(JSON.stringify({ user: { pk: '999', username: 'minhaconta' }, status: 'ok' }));
  } else {
    res.end(JSON.stringify({ status: 'fail', message: 'no' }));
  }
});
await new Promise((r) => srvCu.listen(0, '127.0.0.1', r));
process.env.IG_API_BASE = `http://127.0.0.1:${srvCu.address().port}`;
const diagOk = await sp.diagnosticarInstagram('l.szzy');
ok(diagOk.linhas.some((l) => /SESS.O V.LIDA/.test(l)), `diag mostra sessao valida (${diagOk.linhas[0]})`);
ok(diagOk.linhas.some((l) => /status:fail/.test(l)), 'diag marca o status:fail nas rotas');
srvCu.close();

const srvCuBad = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ status: 'fail', message: 'login required' }));
});
await new Promise((r) => srvCuBad.listen(0, '127.0.0.1', r));
process.env.IG_API_BASE = `http://127.0.0.1:${srvCuBad.address().port}`;
const diagBad = await sp.diagnosticarInstagram('l.szzy');
ok(diagBad.linhas.some((l) => /SESS.O INV.LIDA/.test(l)), `diag mostra sessao invalida (${diagBad.linhas[0]})`);
srvCuBad.close();
delete process.env.IG_API_BASE;

// ── 3) O comando !keyig (handler real) ───────────────────────────────────────
const mod = await import(new URL('../dados/src/index.js', import.meta.url).href);
const handle = mod.default ?? mod;

const BOT_LID = '111111111111111@lid';
let gc = 0;
function makeNazu(sent) {
  return {
    sendMessage: async (jid, content, options) => { sent.push({ jid, content, options }); return { key: { id: 'S' + sent.length } }; },
    user: { id: '5599999999999:5@s.whatsapp.net', lid: BOT_LID, name: 'Lizzy' },
    getName: async () => 'Nick',
    onWhatsApp: async (j) => [{ jid: j, exists: true }],
    signalRepository: { lidMapping: { getPNForLID: async () => null } },
    groupMetadata: async (g) => ({ id: g, subject: 'G', participants: [{ id: BOT_LID, admin: 'admin', phoneNumber: '5599999999999@s.whatsapp.net' }] }),
    groupParticipantsUpdate: async () => ({}), groupSettingUpdate: async () => ({}),
    groupRequestParticipantsList: async () => [], groupRequestParticipantsUpdate: async () => ({}),
    ev: { on: () => {}, emit: () => {}, removeAllListeners: () => {} },
    readMessages: async () => {}, sendPresenceUpdate: async () => {},
    profilePictureUrl: async () => 'x', react: async () => ({}),
  };
}

let senderN = 0;
function novoLid() { senderN += 1; return `33300000${String(senderN).padStart(5, '0')}@lid`; }

async function rodar({ sender, text, fromMe = true }) {
  const sent = [];
  const nazu = makeNazu(sent);
  const g = `1203639000000000${String(++gc).padStart(3, '0')}@g.us`;
  await handle(nazu, {
    key: { remoteJid: g, fromMe, id: `M-${Math.random().toString(36).slice(2, 9)}`, participant: sender },
    message: { extendedTextMessage: { text, contextInfo: { remoteJid: g } } },
    messageTimestamp: 1757900000, pushName: 'Tester',
  }, null, new Map(), null);
  const texto = sent.map((s) => s.content?.text ?? s.content?.caption ?? '').filter(Boolean).join('\n');
  return { sent, texto };
}

// Sem argumento -> painel (com o tutorial).
const painel = await rodar({ sender: novoLid(), text: '!keyig' });
contem(painel.texto, 'Cookie do Instagram', 'painel: titulo');
contem(painel.texto, 'sessionid', 'painel: fala do sessionid');
contem(painel.texto, 'data/instagram/cookies.txt', 'painel: aponta o arquivo (igual YouTube)');

// Salvar um sessionid valido.
const SID = '1234567890%3A' + 'a'.repeat(30);
const salvou = await rodar({ sender: novoLid(), text: `!keyig ${SID}` });
contem(salvou.texto, 'configurada', 'avisa que configurou');
ok(igc.lerSessionId() === SID, 'o sessionid foi gravado de verdade');

// Mascarado no painel (nao expoe o valor inteiro).
const painel2 = await rodar({ sender: novoLid(), text: '!keyig' });
contem(painel2.texto, 'configurado', 'painel diz configurado');
ok(!painel2.texto.includes(SID), 'o painel NAO expoe o sessionid inteiro');

// Limpar.
const limpou = await rodar({ sender: novoLid(), text: '!keyig limpar' });
contem(limpou.texto, 'removido', 'avisa que removeu');
ok(!igc.temCookies(), 'o arquivo foi removido de verdade');

// Valor invalido.
const invalido = await rodar({ sender: novoLid(), text: '!keyig curto' });
contem(invalido.texto, 'Não consegui salvar', 'recusa sessionid invalido');

// `!keyig teste` (grafia comum) roda o DIAGNOSTICO, nao tenta salvar.
const diag = await rodar({ sender: novoLid(), text: '!keyig teste l.szzy' });
ok(/Diagn.stico do Instagram/.test(diag.texto), '`teste` roda o diagnostico (nao tenta salvar)');
ok(!/N.o consegui salvar/.test(diag.texto), '`teste` NAO tenta salvar como cookie');

// Membro comum nao usa.
const comum = await rodar({ sender: novoLid(), text: '!keyig ' + SID, fromMe: false });
contem(comum.texto, 'exclusivo para o dono', 'membro comum recusado');

// ── 4) Menu / blockPv ────────────────────────────────────────────────────────
const menu = fs.readFileSync(path.join(RAIZ, 'dados', 'src', 'menus', 'menudono.js'), 'utf-8');
ok(menu.includes('keyig'), 'menudono lista o !keyig');
ok(/COOKIES \/ REDES SOCIAIS/.test(menu), 'categoria COOKIES / REDES SOCIAIS existe');
const bp = fs.readFileSync(path.join(RAIZ, 'dados', 'src', 'utils', 'blockPv.js'), 'utf-8');
ok(/'keyig'/.test(bp), 'blockPv registra o keyig');

console.log('════════════════════════════════════════');
console.log(`RESULTADO: ${pass} asserções ok | ${fail} falhas`);
console.log('════════════════════════════════════════');
fs.rmSync(TMP, { recursive: true, force: true });
if (fail > 0) process.exit(1);
console.log('✅ TODOS OS TESTES PASSARAM');
process.exit(0);
