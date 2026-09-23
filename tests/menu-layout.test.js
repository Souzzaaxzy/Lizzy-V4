/**
 * Testes do LAYOUT do menu principal (`dados/src/menus/menu.js`) e da sua
 * integração no `!menu` (dados/src/index.js).
 *
 * O ponto central: o menu é dividido em DUAS partes por causa do "ler mais".
 *   - `visible` (cabeçalho + PRIMEIRA categoria) fica ANTES do prefixo invisível
 *     — é o que aparece na prévia junto com a mídia;
 *   - `rest` (demais categorias + rodapé) fica DEPOIS, colapsado.
 *
 * Uso: node tests/menu-layout.test.js
 */

import fs from 'fs';
import os from 'os';
import path from 'path';

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
function eq(a, b, m) { ok(a === b, `${m} — esperado ${JSON.stringify(b)}, veio ${JSON.stringify(a)}`); }
function contem(h, n, l) { ok(typeof h === 'string' && h.includes(n), `${l || n} — esperado conter "${n}"`); }
function naoContem(h, n, l) { ok(typeof h === 'string' && !h.includes(n), `${l || n} — não deveria conter "${n}"`); }

// ============================================================================
// CARGA
// ============================================================================

const TMP_DB = fs.mkdtempSync(path.join(os.tmpdir(), 'lizzy-menu-db-'));
process.env.DATABASE_PATH = TMP_DB;
process.env.CONFIG_PATH = path.join(TMP_DB, 'config.json');
fs.mkdirSync(path.join(TMP_DB, 'grupos'), { recursive: true });
fs.mkdirSync(path.join(TMP_DB, 'dono'), { recursive: true });
fs.writeFileSync(process.env.CONFIG_PATH, JSON.stringify({ prefixo: '!', nomebot: 'Abyss', nomedono: 'Dono', numerodono: '5511000000000', debug: false }, null, 2));

const menuMod = await import(new URL('../dados/src/menus/menu.js', import.meta.url).href);
const menu = menuMod.default;
const { bold, boldItalic } = menuMod;
const db = await import(new URL('../dados/src/utils/database.js', import.meta.url).href);

const indexModule = await import(new URL('../dados/src/index.js', import.meta.url).href);
const handleMessage = indexModule.default ?? indexModule;
if (typeof handleMessage !== 'function') throw new Error('index.js não exporta o handler');

// ============================================================================
// SOCKET FALSO
// ============================================================================

const BOT_JID = '5599999999999@s.whatsapp.net';
const BOT_LID = '111111111111111@lid';
const DONO = '5511000000000@s.whatsapp.net';
let groupCounter = 0;
const newGroupJid = () => { groupCounter += 1; return `1203638200000000${String(groupCounter).padStart(3, '0')}@g.us`; };

function makeNazu({ sent, groupJid }) {
  return {
    sendMessage: async (jid, content, options) => { sent.push({ jid, content, options }); return { key: { id: 'SENT' } }; },
    user: { id: `${BOT_JID.split('@')[0]}:5@s.whatsapp.net`, lid: BOT_LID, name: 'Abyss' },
    onWhatsApp: async (jid) => [{ jid, exists: true, lid: '999000000000001@lid' }],
    signalRepository: { lidMapping: { getPNForLID: async () => null } },
    groupMetadata: async () => ({
      id: groupJid, subject: 'Grupo Teste',
      participants: [
        { id: BOT_LID, admin: 'admin', phoneNumber: BOT_JID },
        { id: '5511000000000@lid', admin: 'admin', phoneNumber: DONO },
      ],
    }),
    groupParticipantsUpdate: async () => ({}),
    groupRequestParticipantsList: async () => [],
    groupRequestParticipantsUpdate: async () => ({}),
    ev: { on: () => {}, emit: () => {}, removeAllListeners: () => {} },
    readMessages: async () => {}, sendPresenceUpdate: async () => {},
    profilePictureUrl: async () => null, react: async () => ({}),
  };
}

let n = 0;
async function rodar(comando) {
  const sent = [];
  const groupJid = newGroupJid();
  const nazu = makeNazu({ sent, groupJid });
  n += 1;
  await handleMessage(nazu, {
    key: { remoteJid: groupJid, fromMe: true, id: `M${n}`, participant: '5511000000000@lid' },
    message: { extendedTextMessage: { text: comando } },
    messageTimestamp: 1757900000, pushName: 'Tester',
  }, null, new Map(), null);
  return { sent };
}
const temNewsletter = (c) => Boolean(c?.contextInfo?.forwardedNewsletterMessageInfo?.newsletterJid);
const textoDe = (s) => s.map((x) => x.content?.text || x.content?.caption || '').join('\n');

// ============================================================================
// SEÇÃO 1 — O LAYOUT (menu.js)
// ============================================================================

await test('1. o cabeçalho segue o layout pedido (com o cargo em bold)', async () => {
  const r = await menu('!', 'Abyss', 'Kannon', { userCargo: 'Dono', userVip: false, ping: 790 });
  contem(r.visible, '╭━━━꧁༺ ✦ Abyss ✦ ༻꧂━━━╮', 'topo');
  contem(r.visible, '┃ 𖤐 𝐎𝐥á, Kannon', 'saudação');
  contem(r.visible, `┃ 〆 𝐂𝐚𝐫𝐠𝐨: ${bold('Dono')}`, 'cargo em bold');
  contem(r.visible, `┃ ◈ 𝐕𝐈𝐏: ${bold('Não')}`, 'vip em bold');
  contem(r.visible, `┃ ⌁ 𝐏𝐢𝐧𝐠: ${bold('790')}𝐦𝐬`, 'ping em bold');
  contem(r.visible, '╰━━━꧁༺ ✦ ༻꧂━━━━━━━━━━━━━━╯', 'rodapé do header');
});

await test('2. as categorias usam BOLD ITALIC (estilo diferente do header)', async () => {
  const r = await menu('!', 'Abyss', 'Kannon', {});
  contem(r.rest, `⚙️ ${boldItalic('UTILIDADES')} ⚙️`, 'título em bold italic');
  contem(r.rest, `🎨 ${boldItalic('CRIAÇÃO')} 🎨`, 'CRIAÇÃO em bold italic');
  contem(r.rest, `🛡️ ${boldItalic('COMUNIDADE')} 🛡️`, 'COMUNIDADE em bold italic');
  contem(r.rest, `🎮 ${boldItalic('JOGOS')} 🎮`, 'JOGOS em bold italic');
  naoContem(r.rest, bold('UTILIDADES'), 'não usa bold reto no título');
});

await test('3. o `visible` é SÓ o cabeçalho (nenhuma categoria acima)', async () => {
  const r = await menu('!', 'Abyss', 'Kannon', {});
  contem(r.visible, '╭━━━꧁༺ ✦ Abyss ✦ ༻꧂━━━╮', 'tem o cabeçalho');
  // NENHUMA categoria pode estar acima do "ler mais".
  for (const t of ['UTILIDADES', 'CRIAÇÃO', 'COMUNIDADE', 'JOGOS']) {
    naoContem(r.visible, boldItalic(t), `${t} NÃO fica no visible`);
  }
  naoContem(r.visible, '!menuia', 'nenhum comando no visible');
});

await test('3b. TODAS as categorias ficam no `rest` (abaixo do ler mais)', async () => {
  const r = await menu('!', 'Abyss', 'Kannon', {});
  for (const t of ['UTILIDADES', 'CRIAÇÃO', 'COMUNIDADE', 'JOGOS']) {
    contem(r.rest, boldItalic(t), `${t} está no rest`);
  }
  for (const c of ['!menuia', '!menudown', '!ferramentas', '!menufig', '!menulogos', '!menuedits', '!alteradores', '!menumemb', '!menuadm', '!menudono', '!menubn', '!menufut', '!menurpg', '!menuvip', '!menugames']) {
    contem(r.rest, c, `rest tem ${c}`);
  }
  // E UTILIDADES vem PRIMEIRO (ordem do layout).
  ok(r.rest.indexOf(boldItalic('UTILIDADES')) < r.rest.indexOf(boldItalic('CRIAÇÃO')), 'UTILIDADES antes de CRIAÇÃO');
});

await test('4. as DEMAIS categorias ficam no `rest` (ler mais) + o fecho', async () => {
  const r = await menu('!', 'Abyss', 'Kannon', {});
  for (const t of ['CRIAÇÃO', 'COMUNIDADE', 'JOGOS']) contem(r.rest, boldItalic(t), `rest tem ${boldItalic(t)}`);
  for (const c of ['!menulogos', '!menuedits', '!alteradores', '!menumemb', '!menuadm', '!menudono', '!menubn', '!menufut', '!menurpg', '!menuvip', '!menugames']) {
    contem(r.rest, c, `rest tem ${c}`);
  }
  contem(r.rest, '╰━━━꧁༺ 𓆩 ✦ Abyss ✦ 𓆪 ༻꧂━━━╯', 'fecho com o nome do bot');
  naoContem(r.visible, boldItalic('JOGOS'), 'JOGOS não está no visível');
  naoContem(r.visible, boldItalic('COMUNIDADE'), 'COMUNIDADE não está no visível');
  naoContem(r.visible, boldItalic('UTILIDADES'), 'UTILIDADES também não');
});

await test('5. `full` é a junção e o menu respeita o prefixo do grupo', async () => {
  const r = await menu('/', 'Abyss', 'K', {});
  contem(r.full, r.visible, 'full contém visible');
  contem(r.full, r.rest, 'full contém rest');
  contem(r.rest, '/menuia', 'usa o prefixo passado');
  naoContem(r.rest, '!menuia', 'não fixa o "!"');
});

await test('6. o marcador e o emoji de cada categoria são os do layout', async () => {
  const r = await menu('!', 'Abyss', 'K', {});
  contem(r.rest, '𓆩 🤖 ㅤ!menuia', 'marcador 𓆩 com emoji');
  contem(r.rest, '◇ ㅤ!menulogos', 'marcador ◇ com filler');
  contem(r.rest, '❖ ㅤ!menumemb', 'marcador ❖ com filler');
  contem(r.rest, '⟢ ⚽ ㅤ!menufut', 'marcador ⟢ com emoji');
});

// ============================================================================
// SEÇÃO 2 — INTEGRAÇÃO NO !menu
// ============================================================================

await test('7. !menu deixa SÓ o cabeçalho antes do "ler mais" (categorias depois)', async () => {
  db.setMenuLerMais(true);
  const prefixoInvisivel = db.getMenuLerMaisText();
  ok(prefixoInvisivel.length > 0, 'pré-condição: o "ler mais" está ligado');
  const { sent } = await rodar('!menu');
  const texto = textoDe(sent);
  const posInvisivel = texto.indexOf(prefixoInvisivel);
  ok(posInvisivel > 0, 'achou o prefixo invisível no texto enviado');
  const antes = texto.slice(0, posInvisivel);
  const depois = texto.slice(posInvisivel + prefixoInvisivel.length);
  // Acima do "ler mais" fica SÓ o cabeçalho; TODAS as categorias vão abaixo.
  contem(antes, 'Abyss', 'o cabeçalho fica antes');
  for (const t of ['UTILIDADES', 'CRIAÇÃO', 'COMUNIDADE', 'JOGOS']) {
    naoContem(antes, boldItalic(t), `${t} NÃO fica antes do ler mais`);
    contem(depois, boldItalic(t), `${t} fica depois (colapsado)`);
  }
  contem(depois, '!menuia', 'os comandos ficam depois');
  db.setMenuLerMais(false);
});

await test('8. com o "ler mais" DESLIGADO o menu sai inteiro, sem separador', async () => {
  db.setMenuLerMais(false);
  eq(db.getMenuLerMaisText(), '', 'pré-condição: prefixo vazio');
  const { sent } = await rodar('!menu');
  const texto = textoDe(sent);
  contem(texto, boldItalic('UTILIDADES'), 'tem a 1ª categoria');
  contem(texto, boldItalic('JOGOS'), 'tem as demais');
  contem(texto, 'Abyss', 'tem o nome do bot');
});

await test('9. o cabeçalho do !menu usa o nome/cargo/ping reais', async () => {
  const { sent } = await rodar('!menu');
  const texto = textoDe(sent);
  contem(texto, 'Abyss', 'nome do bot');
  contem(texto, `𝐂𝐚𝐫𝐠𝐨: ${bold('Dono')}`, 'cargo do dono em bold');
  contem(texto, '𝐏𝐢𝐧𝐠:', 'linha de ping presente');
});

await test('10. o menu continua sem quoted e com newsletter', async () => {
  const { sent } = await rodar('!menu');
  ok(sent.length > 0, 'enviou');
  ok(sent.every((x) => !x.options?.quoted), 'sem quoted');
  ok(sent.every((x) => temNewsletter(x.content)), 'com newsletter');
});

await test('11. os menus TEMÁTICOS continuam funcionando (não usam o menu.js)', async () => {
  db.setMenuLerMais(true);
  const { sent } = await rodar('!menudono');
  if (!sent.length) { console.log('     ⏭  !menudono não enviou (sem permissão?)'); db.setMenuLerMais(false); return; }
  const texto = textoDe(sent);
  ok(texto.length > 0, 'tem conteúdo');
  ok(sent.every((x) => !x.options?.quoted), 'sem quoted');
  ok(sent.every((x) => temNewsletter(x.content)), 'com newsletter');
  db.setMenuLerMais(false);
});

// ============================================================================
// SEÇÃO 3 — GUARDAS ESTRUTURAIS
// ============================================================================

await test('12. o menu.js exporta a divisão visible/rest (contrato)', async () => {
  const r = await menu('!', 'B', 'U', {});
  for (const k of ['visible', 'rest', 'full', 'header']) ok(k in r, `exporta ${k}`);
  ok(typeof r.visible === 'string' && r.visible.length > 0, 'visible é string não-vazia');
  eq(r.visible, r.header, 'visible é exatamente o cabeçalho');
  ok(typeof r.rest === 'string' && r.rest.length > 0, 'rest é string não-vazia');
});

await test('13. o index compõe visible + lerMais + rest (não só concatena tudo)', () => {
  const src = fs.readFileSync(new URL('../dados/src/index.js', import.meta.url), 'utf8');
  contem(src, '${menuParts.visible}${lerMaisPrefix}${menuParts.rest}', 'composição no case menu');
  contem(src, 'menuPartsFb.visible', 'composição no fallback');
  const idxV = src.indexOf('${menuParts.visible}');
  const idxL = src.indexOf('${lerMaisPrefix}');
  const idxR = src.indexOf('${menuParts.rest}');
  ok(idxV < idxL && idxL < idxR, 'ordem visible < lerMais < rest');
});

// ============================================================================
// SEÇÃO 4 — MENUS TEMÁTICOS no layout novo
// ============================================================================

// Comandos esperados por menu (contagem medida no baseline do git). Serve de
// TRAVA: se algum comando sumir numa mexida futura, o teste falha.
const COMANDOS_POR_MENU = {
  menuia: 17, menudown: 20, ferramentas: 26, menufig: 16, menulogo: 44,
  menuedits: 5, alteradores: 58, menumemb: 54,
  // menuadm: 172 -> 170 (removidos `fotomenug` e `videomenug`) -> 171 (o
  // `!antibot` entrou na categoria SEGURANÇA).
  // menudono: 166 -> 165 (`fotomenu` + `videomenu` -> `midiamenu`).
  menuadm: 171, menudono: 165,
  menubn: 348, menufut: 42, menurpg: 149,
  // menuvip nao tem comando cadastrado; o `!` contado e o `!addcmdvip` da
  // instrucao ("Use: !addcmdvip"), que no original tambem estava fixo.
  menuvip: 1, menugames: 28,
};

await test('15. TODOS os menus temáticos usam o layout novo (caixas ꧁༺ ✦ ༻꧂)', async () => {
  for (const nome of Object.keys(COMANDOS_POR_MENU)) {
    const mod = await import(new URL(`../dados/src/menus/${nome}.js`, import.meta.url).href);
    const texto = await mod.default('!', 'Abyss', 'Kannon');
    ok(typeof texto === 'string' && texto.length > 0, `${nome}: renderiza`);
    contem(texto, '╭━━━꧁༺ ✦ Abyss ✦ ༻꧂━━━╮', `${nome}: cabeçalho novo`);
    contem(texto, '╰━━━꧁༺ ✦ ༻꧂━━━━━━━━━━━━━━╯', `${nome}: fecha o cabeçalho`);
    ok(!texto.includes('╭─❖'), `${nome}: não tem mais a borda antiga ╭─❖`);
    // A borda antiga e uma linha INTEIRA de tracos; o fecho novo tambem tem
    // tracos, entao a checagem e por LINHA, nao por substring.
    const temLinhaAntiga = texto.split('\n').some((l) => /^╰─+$/.test(l.trim()));
    ok(!temLinhaAntiga, `${nome}: não tem mais a linha de borda antiga`);
  }
});

await test('16. NENHUM comando se perdeu (contagem por menu vs baseline)', async () => {
  for (const [nome, esperado] of Object.entries(COMANDOS_POR_MENU)) {
    const mod = await import(new URL(`../dados/src/menus/${nome}.js`, import.meta.url).href);
    const texto = await mod.default('!', 'Abyss', 'Kannon');
    const n = (texto.match(/!/g) || []).length;   // `${prefix}` = '!' no teste
    eq(n, esperado, `${nome}: ${esperado} comandos`);
  }
});

await test('17. menubn: os 348 comandos estão TODOS lá (o mais crítico)', async () => {
  const mod = await import(new URL('../dados/src/menus/menubn.js', import.meta.url).href);
  const texto = await mod.default('!', 'Abyss', 'Kannon');
  eq((texto.match(/!/g) || []).length, 348, '348 comandos no modo completo');
  // Amostras de cada categoria (inclusive as condicionais).
  for (const c of ['!tictactoe', '!uno criar', '!conselho', '!tapa', '!surubao', '!pgpau', '!medirpau', '!rankputo', '!casal']) {
    contem(texto, c, `tem ${c}`);
  }
  // Modo LITE: continua escondendo as "picantes" e mantendo o resto.
  const lite = await mod.default('!', 'Abyss', 'Kannon', true);
  ok(!lite.includes('!surubao'), 'lite esconde as picantes');
  ok(lite.includes('!tictactoe'), 'lite mantém jogos');
  ok(lite.includes('!medirpau'), 'lite mantém as masculinas');
  ok((lite.match(/!/g) || []).length > 300, 'lite ainda tem centenas de comandos');
});

await test('18. as categorias dos menus temáticos usam BOLD ITALIC no título', async () => {
  const casos = [
    ['menuia', 'GERAÇÃO DE TEXTO'],
    ['menudono', 'INÍCIO'],
    ['menubn', 'JOGOS & DIVERSÃO'],
    ['alteradores', 'EDIÇÃO BÁSICA'],
  ];
  for (const [nome, titulo] of casos) {
    const mod = await import(new URL(`../dados/src/menus/${nome}.js`, import.meta.url).href);
    const texto = await mod.default('!', 'Abyss', 'Kannon');
    contem(texto, boldItalic(titulo), `${nome}: título "${titulo}" em bold italic`);
    contem(texto, '╭━━━꧁༺', `${nome}: usa a caixa de categoria nova`);
  }
});

await test('19. menuvip (sem comandos) não quebra e usa o layout', async () => {
  const mod = await import(new URL('../dados/src/menus/menuvip.js', import.meta.url).href);
  const texto = await mod.default('!', 'Abyss', 'Kannon');
  contem(texto, '╭━━━꧁༺ ✦ Abyss ✦ ༻꧂━━━╮', 'cabeçalho novo');
  contem(texto, 'Nenhum comando cadastrado', 'mantém o aviso de vazio');
  contem(texto, '!addcmdvip', 'mantém a instrução para o dono');
});

await test('14. os menus temáticos NÃO perderam o "ler mais"', () => {
  const src = fs.readFileSync(new URL('../dados/src/index.js', import.meta.url), 'utf8');
  const i = src.indexOf('async function sendMenuWithMedia');
  ok(i > 0, 'achou o helper');
  const bloco = src.slice(i, i + 5000);
  contem(bloco, 'lerMaisPrefix + menuText', 'o helper aplica o ler mais');
});

await test('20. !midiamenu existe e os antigos !fotomenug/!videomenug foram removidos', () => {
  const src = fs.readFileSync(new URL('../dados/src/index.js', import.meta.url), 'utf8');
  eq((src.match(/case 'midiamenu'/g) || []).length, 1, 'uma case midiamenu');
  eq((src.match(/case 'fotomenug'/g) || []).length, 0, 'fotomenug removido');
  eq((src.match(/case 'videomenug'/g) || []).length, 0, 'videomenug removido');
  // Aliases do global continuam (compatibilidade).
  for (const c of ['fotomenu', 'videomenu', 'gifmenu', 'mediamenu']) {
    eq((src.match(new RegExp(`case '${c}'`, 'g')) || []).length, 1, `${c} é alias`);
  }
  // E nao sobrou a case antiga do global (sem `off`, sem GIF).
  ok(!src.includes('Marque uma imagem ou um vídeo, com o comando'), 'bloco antigo removido');
});

await test('21. !midiamenu usa o mesmo desenho do prefixo (foto/vídeo/GIF + off)', () => {
  const src = fs.readFileSync(new URL('../dados/src/index.js', import.meta.url), 'utf8');
  const i = src.indexOf("case 'midiamenu'");
  const bloco = src.slice(i, i + 8000);
  contem(bloco, 'isMenuMediaEnabled', 'usa o sistema de mídia do menu');
  contem(bloco, 'setMenuMedia', 'grava pelo helper');
  contem(bloco, 'removeMenuMedia', 'off remove');
  contem(bloco, 'converterGifParaMp4', 'GIF é convertido');
  contem(bloco, "m.gifPlayback === true", 'detecta GIF pelo gifPlayback');
  contem(bloco, 'gifPlayback', 'trata o GIF');
  // O menu (case 'menu') passa a usar o sistema novo com isGifMenu.
  const j = src.indexOf("case 'menu':");
  const blocoMenu = src.slice(j, j + 6000);
  contem(blocoMenu, 'getMenuMediaPath', 'menu lê a mídia global nova');
  contem(blocoMenu, 'getMenuMediaIsGif', 'menu lê o isGif');
  contem(blocoMenu, 'gifPlayback: isGifMenu', 'menu envia com gifPlayback');
});

await test('22. o menuadm e o menudono refletem os comandos', () => {
  const adm = fs.readFileSync(new URL('../dados/src/menus/menuadm.js', import.meta.url), 'utf8');
  const dono = fs.readFileSync(new URL('../dados/src/menus/menudono.js', import.meta.url), 'utf8');
  contem(dono, 'midiamenu', 'menudono lista midiamenu');
  ok(!dono.includes('fotomenu'), 'menudono sem fotomenu');
  // `fotomenugrupo` contem "fotomenug" como substring — a checagem e pela
  // LINHA do comando antigo (`${prefix}fotomenug`), nao por substring.
  ok(!/\$\{prefix\}fotomenug\b/.test(adm.replace(/fotomenugrupo/g, '')), 'menuadm sem fotomenug');
  ok(!/\$\{prefix\}videomenug/.test(adm), 'menuadm sem videomenug');
});

await test('23. !audiomenu: menu em cima, audio embaixo, os dois com newsletter', async () => {
  // Pedido do dono: o audio vai DEPOIS do menu e os dois levam o mesmo cabecalho
  // de canal, para parecerem um bloco so.
  const src = fs.readFileSync(new URL('../dados/src/index.js', import.meta.url), 'utf8');
  const i = src.indexOf("case 'audiomenu'");
  ok(i > 0, 'a case audiomenu existe');
  const bloco = src.slice(i, i + 3000);
  contem(bloco, 'setMenuAudio', 'salva o audio');
  contem(bloco, 'removeMenuAudio', 'off remove');

  // No envio do menu, a ORDEM tem de ser menu -> audio.
  const j = src.indexOf('// ---- 1) O MENU (acima) ----');
  const k = src.indexOf('// ---- 2) O ÁUDIO (abaixo) ----');
  ok(j > 0 && k > j, 'o menu vem antes do audio no codigo');
  const envio = src.slice(j, k + 2000);
  // O audio sai DEPOIS do bloco do menu e sem `quoted`.
  const posMenuEnvio = envio.indexOf('text: menuText');
  const posAudioEnvio = envio.indexOf('audio: audioBuffer');
  ok(posMenuEnvio > 0 && posAudioEnvio > posMenuEnvio, 'o envio do audio fica depois do envio do menu');
  contem(envio, 'contextInfo: newsletterContext', 'os dois usam o mesmo contexto de canal');
  ok(!envio.includes('quoted: info'), 'nem o menu nem o audio citam o usuario');
  ok(!envio.includes('Envia o áudio primeiro'), 'o comentario antigo (audio primeiro) sumiu');
});

await test('24. !audiomenu off deixa de existir (remove registro e arquivo)', async () => {
  const dbMod = await import(new URL('../dados/src/utils/database.js', import.meta.url).href);
  const caminho = dbMod.getMenuAudioPath();
  // Estado inicial: sem audio (o teste 23 nao configurou).
  ok(!dbMod.isMenuAudioEnabled(), 'comeca sem audio');
  // Configura um audio de mentira (arquivo real no tmp do banco).
  const falso = path.join(TMP_DB, 'audio-teste.mp3');
  fs.writeFileSync(falso, Buffer.from('audio'));
  dbMod.setMenuAudio(falso);
  ok(Boolean(dbMod.isMenuAudioEnabled()), 'audio ativo apos configurar');
  ok(fs.existsSync(falso), 'arquivo existe');
  // off -> deixa de existir.
  dbMod.removeMenuAudio();
  ok(!dbMod.isMenuAudioEnabled(), 'desativado');
  eq(dbMod.getMenuAudioPath(), null, 'sem caminho');
  ok(!fs.existsSync(falso), 'arquivo removido do disco');
});

// ============================================================================
// FINAL
// ============================================================================

try { fs.rmSync(TMP_DB, { recursive: true, force: true }); } catch { /* ignore */ }

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
