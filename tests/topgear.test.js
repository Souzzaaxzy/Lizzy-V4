/**
 * !topgear — experiência Rich/Web (webview) experimental.
 *
 * O jogo é servido pelo GitHub Pages (docs/emugames/). O comando só monta o
 * payload interactiveMessage com o botão cta_url (webview_interaction: true)
 * e envia por relayMessage.
 *
 * Uso: node tests/topgear.test.js
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.resolve(HERE, '..');

const TMP_DB = fs.mkdtempSync(path.join(os.tmpdir(), 'lizzy-tg-db-'));
process.env.DATABASE_PATH = TMP_DB;
fs.mkdirSync(path.join(TMP_DB, 'grupos'), { recursive: true });

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

function ok(cond, msg) {
  if (cond) CURRENT.passed += 1;
  else {
    CURRENT.failed += 1;
    CURRENT.errors.push(`ASSERT FALHOU: ${msg}`);
  }
}

const handleMessage = (await import(new URL('../dados/src/index.js', import.meta.url).href)).default;
const topgear = (await import(new URL('../dados/src/topgear/index.js', import.meta.url).href)).default;

const G = '120363826666666601@g.us';
fs.writeFileSync(path.join(TMP_DB, 'grupos', `${G}.json`), JSON.stringify({ modobrincadeira: true }, null, 2));

let relayed = null;
const sent = [];

function makeNazu() {
  return {
    sendMessage: async (jid, content) => { sent.push(content); return { key: { id: 'S' } }; },
    relayMessage: async (jid, message, opts) => { relayed = { jid, message, opts }; return 'ok'; },
    user: { id: '5599999999999:5@s.whatsapp.net', lid: '111111111111111@lid' },
    onWhatsApp: async (j) => [{ jid: j, exists: true }],
    signalRepository: { lidMapping: { getPNForLID: async () => null } },
    groupMetadata: async () => ({ id: G, participants: [{ id: '555000000000@lid', admin: 'admin', phoneNumber: '555000000000@s.whatsapp.net' }] }),
    groupParticipantsUpdate: async () => ({}),
    ev: { on: () => {}, emit: () => {}, removeAllListeners: () => {} },
    readMessages: async () => {}, sendPresenceUpdate: async () => {},
    profilePictureUrl: async () => null, react: async () => ({}),
    waUploadToServer: async () => ({})
  };
}

async function rodar(texto, { fromMe = true } = {}) {
  sent.length = 0;
  relayed = null;
  await handleMessage(makeNazu(), {
    key: { remoteJid: G, fromMe, id: `TG-${Math.random()}`, participant: '555000000000@lid' },
    message: { extendedTextMessage: { text: texto, contextInfo: { remoteJid: G } } },
    messageTimestamp: 1757900000, pushName: 'A'
  }, null, new Map(), null);
  return sent.map((s) => s.text || s.caption || '').filter(Boolean).join('\n');
}

await test('config: a URL do jogo está definida', () => {
  const url = topgear.pagina();
  ok(typeof url === 'string' && url.length > 0, 'pagina() devolve uma URL');
  ok(url.startsWith('https://'), 'usa HTTPS (o webview exige)');
  ok(!url.endsWith('/index.html'), `usa a raiz (sem /index.html; veio ${url})`);
  ok(topgear.pagina('topgear2').includes('?jogo=topgear2'), 'aceita ?jogo=<id>');
});

await test('a pasta docs/emugames tem o player multi-jogo', () => {
  for (const f of ['index.html', 'style.css', 'jogos.json', 'jogos/README.md', 'capas/README.md']) {
    ok(fs.existsSync(path.join(PROJECT, 'docs/emugames', f)), `docs/emugames/${f} existe`);
  }
  const cat = JSON.parse(fs.readFileSync(path.join(PROJECT, 'docs/emugames/jogos.json'), 'utf-8'));
  ok(Array.isArray(cat.jogos) && cat.jogos.length >= 3, `catalogo tem 3+ jogos (veio ${cat.jogos?.length})`);
  for (const j of cat.jogos) {
    ok(!!j.id && !!j.nome && !!j.console && !!j.rom, `jogo ${j.id} tem id/nome/console/rom`);
    ok(typeof j.descricao === 'string' && j.descricao.length > 10, `jogo ${j.id} tem descricao`);
    if (j.console === 'arcade') ok(!!j.bios, `jogo arcade ${j.id} tem bios`);
  }
  const ids = cat.jogos.map((j) => j.id);
  for (const alvo of ['topgear2', 'metalslug', 'kof97']) ok(ids.includes(alvo), `catalogo tem ${alvo}`);
  ok(fs.existsSync(path.join(PROJECT, 'docs/.nojekyll')), '.nojekyll presente');
});

await test('index.html: player multi-jogo com os caminhos certos', () => {
  const html = fs.readFileSync(path.join(PROJECT, 'docs/emugames/index.html'), 'utf-8');
  ok(html.includes('cdn.emulatorjs.org'), 'carrega do CDN do EmulatorJS');
  ok(html.includes('src/'), 'aponta os scripts para src/');
  ok(html.includes('EJS_gameUrl'), 'define a ROM');
  ok(html.includes('jogos.json'), 'le o catalogo de jogos');
  ok(html.includes("get('jogo')"), 'aceita ?jogo=<id>');
  ok(!html.includes('id="lista"'), 'nao tem lista de jogos (comando e de um jogo so)');
  ok(!html.includes('id="trocar"'), 'nao tem botao de trocar jogo');
  ok(html.includes('EJS_core = j.console'), 'o core vem do console do jogo');
  ok(html.includes('EJS_Buttons'), 'controla os botoes do player');
  ok(html.includes('EJS_biosUrl'), 'suporta BIOS (arcade/Neo Geo)');
  ok(html.includes('exitEmulation: true'), 'tem botao de sair');
  ok(html.includes('EJS_onExit'), 'detecta a saida');
  ok(html.includes('id="parar"'), 'tem botao PARAR');
  ok(html.includes('3 * 60 * 1000'), 'desliga por inatividade (3 min)');
  ok(html.includes('visibilitychange'), 'para ao sair da aba');
  const css = fs.readFileSync(path.join(PROJECT, 'docs/emugames/style.css'), 'utf-8');
  ok(css.includes('ejs_virtualGamepad_parent'), 'reposiciona os controles de toque (css)');
  ok(/height:\s*calc\(.*200px\)/.test(css), 'a caixa reserva a faixa dos controles');
  ok(/ejs_canvas_parent[^}]*height:\s*calc\(100% - 200px\)/s.test(css), 'a tela ocupa so o andar de cima');
  ok(html.includes("callEvent('exit')"), 'para o emulador pela API real (callEvent exit)');
  ok(html.includes('freeze'), 'trata o congelamento do webview');
  ok(html.includes('pageshow'), 'reage ao voltar para a pagina');
});

await test('EmulatorJS: os assets do CDN respondem 200', async () => {
  const base = 'https://cdn.emulatorjs.org/stable/data/';
  for (const f of ['loader.js', 'emulator.min.css', 'src/emulator.js', 'src/GameManager.js', 'cores/snes9x-wasm.data']) {
    const r = await fetch(base + f, { method: 'HEAD' });
    ok(r.status === 200, `${f} -> ${r.status}`);
  }
});

await test('!topgear: envia interactiveMessage com botão webview', async () => {
  const texto = await rodar('!topgear');
  ok(!!relayed, 'usou relayMessage');
  const btn = relayed?.message?.interactiveMessage?.nativeFlowMessage?.buttons?.[0];
  ok(btn?.name === 'cta_url', `botão é cta_url (veio ${btn?.name})`);
  const params = JSON.parse(btn?.buttonParamsJson || '{}');
  ok(params.webview_interaction === true, 'abre em webview');
  ok(String(params.url).startsWith('https://'), `url e https (veio ${params.url})`);
  ok(!texto.includes('Experiência enviada'), 'nao manda mensagem extra com link');
  ok(!texto.includes('http'), 'nao vaza a URL em texto');
});

await test('os 3 comandos funcionam e sao liberados para membros', async () => {
  for (const cmd of ['!topgear', '!metalslug', '!kof']) {
    const texto = await rodar(cmd, { fromMe: false });
    ok(!!relayed, `${cmd} dispara mesmo sem ser dono`);
    const btn = relayed?.message?.interactiveMessage?.nativeFlowMessage?.buttons?.[0];
    ok(btn?.name === 'cta_url', `${cmd} gera cta_url`);
    ok(JSON.parse(btn?.buttonParamsJson || '{}').webview_interaction === true, `${cmd} abre em webview`);
    ok(String(JSON.parse(btn?.buttonParamsJson || '{}').url).includes('?jogo='), `${cmd} aponta o jogo na URL`);
  }
});

await test('!topgear NÃO está em nenhum menu nem no blockPv', async () => {
  const menus = fs.readdirSync(path.join(PROJECT, 'dados/src/menus'));
  for (const m of menus) {
    if (!m.endsWith('.js')) continue;
    const txt = fs.readFileSync(path.join(PROJECT, 'dados/src/menus', m), 'utf-8');
    ok(!txt.includes('topgear'), `${m} não cita topgear`);
  }
  const blockPv = fs.readFileSync(path.join(PROJECT, 'dados/src/utils/blockPv.js'), 'utf-8');
  ok(!blockPv.includes('topgear'), 'blockPv não cita topgear');
});

await test('o bot não abre porta/servidor local', () => {
  ok(!fs.existsSync(path.join(PROJECT, 'dados/src/topgear/server.js')), 'server.js removido');
  const idx = fs.readFileSync(path.join(PROJECT, 'dados/src/index.js'), 'utf-8');
  ok(!idx.includes('topgearServer'), 'index não referencia mais o servidor local');
});

await test('nenhuma ROM comercial no repositório', () => {
  for (const dir of ['dados/src/topgear']) {
    for (const f of fs.readdirSync(path.join(PROJECT, dir))) {
      ok(!/\.(sfc|smc|fig|swc|rom|bin|zip)$/i.test(f), `${dir}/${f} não é ROM`);
    }
  }
});

// Leitor de ZIP minimo (sem dependencia): deflate via zlib + CRC32 do node.
function lerZip(caminho) {
  const b = fs.readFileSync(caminho);
  let eocd = -1;
  for (let i = b.length - 22; i >= 0 && i >= b.length - 66000; i--) {
    if (b.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) return [];
  const total = b.readUInt16LE(eocd + 10);
  let off = b.readUInt32LE(eocd + 16);
  const entradas = [];
  for (let i = 0; i < total; i++) {
    if (b.readUInt32LE(off) !== 0x02014b50) break;
    const metodo = b.readUInt16LE(off + 10);
    const compSize = b.readUInt32LE(off + 20);
    const nomeLen = b.readUInt16LE(off + 28);
    const extraLen = b.readUInt16LE(off + 30);
    const commentLen = b.readUInt16LE(off + 32);
    const localOff = b.readUInt32LE(off + 42);
    const nome = b.toString('utf8', off + 46, off + 46 + nomeLen);
    const lNomeLen = b.readUInt16LE(localOff + 26);
    const lExtraLen = b.readUInt16LE(localOff + 28);
    const inicio = localOff + 30 + lNomeLen + lExtraLen;
    const comp = b.subarray(inicio, inicio + compSize);
    entradas.push({ nome, dados: metodo === 0 ? Buffer.from(comp) : zlib.inflateRawSync(comp) });
    off += 46 + nomeLen + extraLen + commentLen;
  }
  return entradas;
}

await test('romsets de arcade batem com os CRCs oficiais (MAME/FBNeo)', () => {
  const crc = (buf) => (zlib.crc32(buf) >>> 0).toString(16).padStart(8, '0');

  // CRC32 oficiais do FBNeo (d_neogeo.cpp) — nome interno -> crc
  const OFICIAIS = {
    mslug: {
      '201-p1.p1': '08d8daa5', '201-s1.s1': '2f55958d', '201-c1.c1': '72813676',
      '201-c2.c2': '96f62574', '201-c3.c3': '5121456a', '201-c4.c4': 'f4ad59a3',
      '201-m1.m1': 'c28b3253', '201-v1.v1': '23d22ed1', '201-v2.v2': '472cf9db'
    },
    kof97: {
      '232-p1.p1': '7db81ad9', '232-p2.sp2': '158b23f6', '232-s1.s1': '8514ecf5',
      '232-c1.c1': '5f8bf0a1', '232-c2.c2': 'e4d45c81', '232-c3.c3': '581d6618',
      '232-c4.c4': '49bb1e68', '232-c5.c5': '34fc4e51', '232-c6.c6': '4ff4d47b',
      '232-m1.m1': '45348747', '232-v1.v1': '22a2b5b5', '232-v2.v2': '2304e744',
      '232-v3.v3': '759eb954'
    }
  };

  const entradas = (nomeZip) => {
    const m = new Map();
    for (const { nome, dados } of lerZip(path.join(PROJECT, 'docs/emugames/jogos/arcade', nomeZip))) {
      if (nome.endsWith('.html')) continue;
      m.set(nome, dados);
    }
    return m;
  };

  // Metal Slug: o romset do CoolROM (`mslug_c1.rom` + metades trocadas) foi
  // CONVERTIDO para o formato MAME/FBNeo (`201-c1.c1` + CRC oficial).
  // Exige o nome interno oficial E o CRC oficial — assim o zip antigo reprova.
  const mslug = entradas('mslug.zip');
  for (const [nome, esperado] of Object.entries(OFICIAIS.mslug)) {
    ok(mslug.has(nome), `mslug contem o arquivo ${nome}`);
    if (mslug.has(nome)) ok(crc(mslug.get(nome)) === esperado, `${nome} com CRC oficial (${esperado})`);
  }
  ok(mslug.size === 9, `mslug tem 9 arquivos (veio ${mslug.size})`);

  // KOF 97: as duas partes foram juntadas num romset so (13/13). Antes eram
  // `kof97.zip` (3 arquivos de som) + `kof2.zip` (10) — agora e um zip unico,
  // com os nomes internos oficiais e o CRC oficial.
  const kof = entradas('kof97.zip');
  for (const [nome, esperado] of Object.entries(OFICIAIS.kof97)) {
    ok(kof.has(nome), `kof97 contem o arquivo ${nome}`);
    if (kof.has(nome)) ok(crc(kof.get(nome)) === esperado, `${nome} com CRC oficial (${esperado})`);
  }
  ok(kof.size === 13, `kof97 tem 13 arquivos (veio ${kof.size})`);

  // Nao pode sobrar o zip da segunda parte ao lado (ja foi unificado).
  const pasta = path.join(PROJECT, 'docs/emugames/jogos/arcade');
  ok(!fs.existsSync(path.join(pasta, 'kof2.zip')), 'kof2.zip nao existe mais (foi unificado)');
});

await test('as capas dos jogos existem (senao o card cai para texto)', () => {
  const cat = JSON.parse(fs.readFileSync(path.join(PROJECT, 'docs/emugames/jogos.json'), 'utf-8'));
  for (const j of cat.jogos) {
    const capa = path.join(PROJECT, 'docs/emugames/capas', `${j.id}.gif`);
    ok(fs.existsSync(capa), `capa ${j.id}.gif existe`);
    if (fs.existsSync(capa)) {
      const b = fs.readFileSync(capa);
      ok(b.slice(0, 3).toString('latin1') === 'GIF', `${j.id}.gif e um GIF`);
    }
  }
  const card = fs.readFileSync(path.join(PROJECT, 'dados/src/topgear/index.js'), 'utf-8');
  ok(card.includes('capas/'), 'o card procura a capa em capas/');
  ok(card.includes('gif: { url: capaUrl }'), 'o card usa a capa como GIF (a fork converte p/ MP4)');
});

await test('o conversor de romset Neo Geo esta no repositorio', () => {
  const t = path.join(PROJECT, 'tools/romset-neogeo.py');
  ok(fs.existsSync(t), 'tools/romset-neogeo.py existe');
  const src = fs.readFileSync(t, 'utf-8');
  ok(src.includes('trocar_metades'), 'implementa o swap de metades');
  ok(src.includes('72813676'), 'traz a tabela de CRCs oficiais (mslug)');
});

await test('o kof97.zip esta fora do upload do Cloudflare (.assetsignore)', () => {
  const ig = path.join(PROJECT, 'docs/emugames/.assetsignore');
  ok(fs.existsSync(ig), '.assetsignore existe');
  const txt = fs.readFileSync(ig, 'utf-8');
  const linhas = txt.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  ok(linhas.includes('jogos/arcade/kof97.zip'), 'exclui o kof97.zip do upload');
  ok(linhas.length === 1, `exclui so o arquivo grande (veio ${linhas.length} regra(s))`);
});

await test('o espelho serve o romset grande com CORS', async () => {
  const r = await fetch('https://souzzaaxzy.github.io/Lizzy-V4/emugames/jogos/arcade/kof97.zip', { method: 'HEAD' });
  ok(r.status === 200, `kof97.zip no espelho -> ${r.status}`);
  ok(r.headers.get('access-control-allow-origin') === '*', 'o espelho manda CORS *');
});

await test('o player NAO define EJS_paths (quebra o boot do EmulatorJS)', () => {
  const html = fs.readFileSync(path.join(PROJECT, 'docs/emugames/index.html'), 'utf-8');
  // O loader.js do EmulatorJS resolve os caminhos sozinho (data/ e data/src/).
  // Definir EJS_paths sobrescreve esses caminhos e o jogo NUNCA inicia
  // (EJS_emulator.started fica false) -- medido nos dois consoles.
  const codigo = html.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  ok(!/window\.EJS_paths\s*=/.test(codigo), 'o codigo nao seta window.EJS_paths');
  ok(!/\bconst SRC\b/.test(codigo), 'nao monta o prefixo src/ (nao e mais preciso)');
  ok(html.includes('EJS_paths'), 'o motivo esta documentado num comentario');
  // a ROM grande continua resolvida (em partes -> Blob)
  ok(/function remontarRom/.test(html), 'mantem a remontagem das partes');
  ok(/window\.EJS_gameUrl = gameUrl/.test(html), 'o EJS_gameUrl usa a ROM (ou o Blob)');
});

await test('a BIOS e entregue como ZIP (dontExtractBIOS) e fica na raiz', () => {
  const html = fs.readFileSync(path.join(PROJECT, 'docs/emugames/index.html'), 'utf-8');
  // O EmulatorJS, por padrao, EXTRAI a BIOS em arquivos soltos. O FBNeo procura
  // "neogeo.zip" -- sem o zip ele acusa "one of your romsets is missing files".
  ok(/window\.EJS_dontExtractBIOS = true/.test(html), 'liga EJS_dontExtractBIOS');
  ok(/if \(j\.bios\)/.test(html), 'so quando o jogo tem BIOS');

  const cat = JSON.parse(fs.readFileSync(path.join(PROJECT, 'docs/emugames/jogos.json'), 'utf-8'));
  for (const j of cat.jogos) {
    if (!j.bios) continue;
    // a BIOS tem de estar na RAIZ do site: o EJS grava o arquivo no CWD do FS
    // e o FBNeo procura o zip pelo nome na raiz.
    ok(!j.bios.includes('/'), `${j.id}: bios na raiz do site (veio ${j.bios})`);
    ok(fs.existsSync(path.join(PROJECT, 'docs/emugames', j.bios)), `${j.id}: ${j.bios} existe`);
  }
  // e o zip da BIOS tem os arquivos essenciais do FBNeo
  const essenciais = { 'sm1.sm1': '94416d67', 'sfix.sfix': 'c2ea0cfd', '000-lo.lo': '5a86cff2' };
  const entradas = (nome) => {
    const m = new Map();
    for (const { nome: n, dados } of lerZip(path.join(PROJECT, 'docs/emugames', nome))) m.set(n, dados);
    return m;
  };
  const bios = entradas('neogeo.zip');
  for (const [nome, esperado] of Object.entries(essenciais)) {
    ok(bios.has(nome) && (zlib.crc32(bios.get(nome)) >>> 0).toString(16).padStart(8, '0') === esperado,
      `BIOS tem ${nome} com CRC oficial`);
  }
});

await test('ROM grande e servida em PARTES e remontada no player', () => {
  const cat = JSON.parse(fs.readFileSync(path.join(PROJECT, 'docs/emugames/jogos.json'), 'utf-8'));
  const html = fs.readFileSync(path.join(PROJECT, 'docs/emugames/index.html'), 'utf-8');
  const LIMITE = 25 * 1024 * 1024;
  const pasta = path.join(PROJECT, 'docs/emugames/jogos/arcade');

  // Toda ROM acima do limite do Cloudflare tem de vir em partes, e cada parte
  // tem de caber no limite (senao o deploy inteiro falha).
  for (const j of cat.jogos) {
    const p = path.join(PROJECT, 'docs/emugames', j.rom);
    if (!fs.existsSync(p)) continue;
    const tam = fs.statSync(p).size;
    if (tam <= LIMITE) continue;
    ok(Array.isArray(j.partes) && j.partes.length >= 2, `${j.id} tem partes (${j.partes?.length})`);
    let soma = 0;
    for (const parte of j.partes || []) {
      const pp = path.join(pasta, parte);
      ok(fs.existsSync(pp), `${j.id}: parte ${parte} existe`);
      if (!fs.existsSync(pp)) continue;
      const tp = fs.statSync(pp).size;
      ok(tp <= LIMITE, `${parte} cabe em 25 MiB (${(tp / 1048576).toFixed(1)} MiB)`);
      soma += tp;
    }
    ok(soma === tam, `${j.id}: as partes somam o zip inteiro (${soma} == ${tam})`);
    ok(j.mirror === undefined, `${j.id} nao depende mais do espelho`);
  }

  // o player remonta num Blob e da o nome do ARQUIVO ao romset (arcade)
  ok(/function remontarRom/.test(html), 'o player remonta as partes');
  ok(/new Blob\(/.test(html), 'remonta num Blob');
  ok(/j\.partes/.test(html), 'usa o campo partes do catalogo');
  ok(/j\.console === 'arcade'\) window\.EJS_gameName = j\.rom\.split\('\/'\)\.pop\(\)/.test(html),
    'em arcade o nome do arquivo e o do romset (o core procura pelo nome)');

  // o .assetsignore exclui SO o zip grande (as partes precisam subir)
  const ig = fs.readFileSync(path.join(PROJECT, 'docs/emugames/.assetsignore'), 'utf-8');
  const linhas = ig.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  ok(linhas.includes('jogos/arcade/kof97.zip'), 'exclui o zip grande do Cloudflare');
  ok(!linhas.some((l) => l.endsWith('.p1') || l.endsWith('.p2')), 'NAO exclui as partes');
});

const totalOk = RESULTS.reduce((a, r) => a + r.passed, 0);
const totalFail = RESULTS.reduce((a, r) => a + r.failed, 0);
console.log('\n════════════════════════════════════════');
console.log(`RESULTADO: ${RESULTS.length} testes | ${totalOk} asserções ok | ${totalFail} falhas`);
console.log('════════════════════════════════════════');

fs.rmSync(TMP_DB, { recursive: true, force: true });
if (totalFail > 0) {
  for (const r of RESULTS) if (r.failed) for (const e of r.errors) console.log(`- [${r.name}] ${e}`);
  process.exit(1);
}
console.log('✅ TODOS OS TESTES PASSARAM');
process.exit(0);
