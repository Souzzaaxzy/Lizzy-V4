/**
 * !topgear — experiência Rich/Web (webview) experimental.
 *
 * O jogo é servido pelo Cloudflare Workers (dados/emugames/). O comando só monta
 * o payload interactiveMessage com o botão cta_url (webview_interaction: true)
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

function pular(motivo) {
  CURRENT.pulou = motivo;
  console.log(`\u23ed\uFE0F  ${CURRENT.name} (pulado: ${motivo})`);
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

/**
 * Onde esta o SITE.
 *
 * O player/ROMs moram num repositorio proprio (`Souzzaaxzy/emugames`) -- o repo
 * do bot guarda so o `jogos.json`. Para os testes que falam da APARENCIA o site
 * precisa estar a mao, entao procuramos nesta ordem:
 *   1. `EMUGAMES_SITE_DIR` (apontar a mao);
 *   2. a pasta `emugames/` do lado do projeto (clone irmao);
 *   3. `dados/emugames/` (caso o site ainda esteja dentro do bot).
 * Sem nenhuma delas, os testes de site sao PULADOS -- o resto roda normal.
 */
function acharSite() {
  const candidatos = [
    process.env.EMUGAMES_SITE_DIR,
    path.resolve(PROJECT, '..', 'emugames'),
    path.resolve(PROJECT, 'emugames'),
    path.join(PROJECT, 'dados', 'emugames'),
  ].filter(Boolean);
  for (const c of candidatos) {
    if (fs.existsSync(path.join(c, 'index.html'))) return c;
  }
  return null;
}
const SITE = acharSite();

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

await test('o BOT guarda so o CATALOGO (o site mora em repo proprio)', () => {
  // O site (player + ROMs + capas) foi para o repo `Souzzaaxzy/emugames`.
  // O bot guarda apenas o `jogos.json` -- que e' a fonte unica que o `!arcade`
  // le -- e a URL publica. Motivo: os 113 MB no repo do bot pesavam em todo
  // `!atualizar` (git pull/merge) sem nenhum ganho.
  const pasta = path.join(PROJECT, 'dados/emugames');
  ok(fs.existsSync(path.join(pasta, 'jogos.json')), 'o bot mantem o jogos.json (fonte do catalogo)');
  for (const fora of ['index.html', 'style.css', 'jogos', 'capas', 'neogeo.zip', '_headers']) {
    ok(!fs.existsSync(path.join(pasta, fora)), `${fora} NAO fica no repo do bot (foi para o site)`);
  }
  // E o repo do bot nao carrega mais nada de publicacao do site.
  ok(!fs.existsSync(path.join(PROJECT, 'wrangler.jsonc')), 'wrangler.jsonc saiu do repo do bot');

  const cat = JSON.parse(fs.readFileSync(path.join(pasta, 'jogos.json'), 'utf-8'));
  ok(Array.isArray(cat.jogos) && cat.jogos.length >= 3, `catalogo tem 3+ jogos (veio ${cat.jogos?.length})`);
  for (const j of cat.jogos) {
    ok(!!j.id && !!j.nome && !!j.console && !!j.rom, `jogo ${j.id} tem id/nome/console/rom`);
    ok(typeof j.descricao === 'string' && j.descricao.length > 10, `jogo ${j.id} tem descricao`);
    if (j.console === 'arcade') ok(!!j.bios, `jogo arcade ${j.id} tem bios`);
  }
  const ids = cat.jogos.map((j) => j.id);
  for (const alvo of ['topgear2', 'metalslug', 'kof97']) ok(ids.includes(alvo), `catalogo tem ${alvo}`);
});

await test('index.html: player multi-jogo com os caminhos certos', () => {
  if (!SITE) return pular('site');
  const html = fs.readFileSync(path.join(SITE, 'index.html'), 'utf-8');
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
  // O player e so single-player (o multiplayer/netplay foi removido).
  ok(/exitEmulation:\s*true/.test(html), 'tem botao de sair');
  ok(!/EM_SALA|netplay/i.test(html), 'nao tem mais nada de sala/netplay');
  ok(html.includes('EJS_onExit'), 'detecta a saida');
  // ROTAS: ao voltar (ou no catalogo), a URL e normalizada para a rota do
  // catalogo (sem `?jogo=`), senao a barra continuava com a rota do jogo.
  ok(/voltarAoCatalogo[\s\S]{0,400}new URLSearchParams\(location.search\)\.has\('jogo'\)/.test(html),
    'voltar limpa o ?jogo da URL');
  ok(/params\.has\('jogo'\)[\s\S]{0,200}#\//.test(html),
    'no catalogo a URL e normalizada (sem ?jogo)');
  ok(html.includes('id="parar"'), 'tem botao PARAR');
  ok(html.includes('3 * 60 * 1000'), 'desliga por inatividade (3 min)');
  ok(html.includes('visibilitychange'), 'para ao sair da aba');
  const css = fs.readFileSync(path.join(SITE, 'style.css'), 'utf-8');
  ok(css.includes('ejs_virtualGamepad_parent'), 'reposiciona os controles de toque (css)');
  // A faixa e' DERIVADA dos controles (dpad + analogico + vao), nunca um px fixo.
  ok(/--ctl:\s*calc\(.*--dpad.*--stick.*--gap/s.test(css), 'a faixa e a soma dos dois controles + o vao');
  ok(/height:\s*calc\(.*var\(--ctl\)\)/.test(css), 'a caixa reserva a faixa dos controles');
  ok(/ejs_canvas_parent[^}]*height:\s*calc\(100% - var\(--ctl\)\)/s.test(css), 'a tela ocupa so o andar de cima');
  // Responsivo: tamanho sai do menor eixo do viewport (vmin/vh) com teto, sem px fixo.
  ok(/--lado:\s*min\(clamp\([^)]*vh[^)]*\),\s*46vmin,\s*34vh\)/.test(css), 'o tamanho base vem do viewport (vh) com teto em vmin/vh');
  ok(/--dpad:\s*calc\(var\(--lado\)/.test(css), 'o D-pad e derivado do tamanho base');
  ok(/--stick:\s*calc\(var\(--lado\)\s*\*\s*1\.15\)/.test(css), 'o analogico e ~15% maior que a base');
  ok(/--knob:\s*min\(clamp\([^)]*vh[^)]*\),\s*\d+vmin\)/.test(css), 'o joystick interno e responsivo (clamp + teto)');
  ok(/--gap:\s*clamp\([^)]*vmin[^)]*\)/.test(css), 'o vao entre os dois e responsivo (vmin)');
  ok(!/--joy-scale/.test(css), 'nao ha mais escala fixa do cluster (era px fixo)');
  ok(!/--stick-scale/.test(css), 'nao ha mais escala fixa do analogico (era px fixo)');
  ok(/--btn-scale:\s*1\.55/.test(css), 'botoes maiores (--btn-scale 1.55)');
  ok(/transform:\s*scale\(var\(--btn-scale\)\)/.test(css), 'escala o cluster direito (botoes)');
  // Paisagem: tela cheia + controles +40px.
  ok(/@media\s*\(orientation:\s*landscape\)/.test(css), 'tem o modo paisagem');
  // Em paisagem o jogo ocupa a tela sozinho e os controles crescem. Os valores
  // foram recalibrados para o cluster do meio caber (ver o Fast/Slow abaixo).
  ok(/orientation:\s*landscape[\s\S]*--btn-scale:\s*1\.62/.test(css), 'paisagem: botoes maiores (1.62)');
  ok(/orientation:\s*landscape[\s\S]*--stack[\s\S]*bottom:\s*10px/.test(css), 'paisagem: a coluna encosta na base (mantendo o vao)');
  ok(/orientation:\s*landscape[\s\S]*position:\s*fixed/.test(css), 'paisagem: o player ocupa a tela cheia');
  ok(/orientation:\s*landscape[\s\S]*#barra,\s*#controles\s*\{\s*display:\s*none/.test(css), 'paisagem: esconde a barra/cont roles');
  ok(/\.b_r\s*\{\s*top:\s*-70px/.test(css), 'aproxima o ombro R (nao sai da tela)');
  // O bug relatado: o Fast/Slow (top:50px INLINE) caia FORA da caixa do jogo e
  // era recortado pelo overflow:hidden. A regra sobe os dois.
  ok(/b_speed_fast[\s\S]{0,120}b_speed_slow\s*\{\s*top:\s*-46px/.test(css), 'Fast/Slow sobem para dentro da caixa (nao sao recortados)');
  // Diamante dos botoes: padrao unico, IGUAL AO ARCADE (pedido do dono):
  //   topo = Y | esquerda = X | direita = B | baixo = A
  // O EmulatorJS muda o layout por controlScheme (snes X-topo, arcade Y-topo);
  // o CSS padroniza TUDO no do arcade, com !important (posicao vem inline).
  ok(/\.b_y\s*\{\s*left:\s*40px\s*!important;\s*top:\s*0\s*!important/.test(css), 'diamante: Y no topo');
  ok(/\.b_x\s*\{\s*left:\s*0\s*!important;\s*top:\s*40px\s*!important/.test(css), 'diamante: X a esquerda');
  ok(/\.b_b\s*\{\s*left:\s*80px\s*!important;\s*top:\s*40px\s*!important/.test(css), 'diamante: B a direita');
  ok(/\.b_a\s*\{\s*left:\s*40px\s*!important;\s*top:\s*80px\s*!important/.test(css), 'diamante: A embaixo');
  ok(!css.includes(':not(.cs_snes)'), 'diamante: vale para TODOS os esquemas (sem excecao)');
  ok(html.includes("callEvent('exit')"), 'para o emulador pela API real (callEvent exit)');
  // NAO ha teardown em unload/freeze: desmontar durante a navegacao faz o
  // runtime do EmulatorJS estourar (medido). O audio e' tratado no
  // `visibilitychange` e a retomada no `pageshow`.
  ok(!/addEventListener\(\s*'freeze'/.test(html), 'nao desmonta o emulador no freeze (evita ErrnoError)');
  ok(!/addEventListener\(\s*'pagehide'/.test(html), 'nao desmonta o emulador no pagehide');
  ok(/visibilitychange/.test(html), 'trata a saida da aba pelo visibilitychange');
  ok(/emu\.started = false/.test(html), 'marca o emulador como encerrado (evita remontar o FS)');
  ok(html.includes('pageshow'), 'reage ao voltar para a pagina');
});

await test('gamepad: ANALOGICO + D-PAD em todos os jogos', () => {
  if (!SITE) return pular('site');
  const html = fs.readFileSync(path.join(SITE, 'index.html'), 'utf-8');
  const css = fs.readFileSync(path.join(SITE, 'style.css'), 'utf-8');

  // O EmulatorJS aceita um gamepad proprio por `EJS_VirtualGamepadSettings`.
  ok(/EJS_VirtualGamepadSettings\s*=/.test(html), 'monta o gamepad (EJS_VirtualGamepadSettings)');
  ok(/function gamepadDoJogo/.test(html), 'tem a funcao que monta o gamepad');
  ok(/type:\s*'zone'/.test(html), 'usa uma ZONA (analogico)');
  ok(/type:\s*'dpad'/.test(html), 'usa um D-PAD (as setas)');
  ok(/inputValues:\s*\[16,\s*17,\s*18,\s*19\]/.test(html) === false,
    'o analogico NAO usa os indices de analogico (o SNES nao tem: ficaria morto)');
  // Os dois escrevem nos mesmos indices do direcional, entao qualquer um move.
  ok((html.match(/inputValues:\s*\[4,\s*5,\s*6,\s*7\]/g) || []).length >= 2,
    'analogico e dpad escrevem nos MESMOS indices (4..7)');
  // No ARRAY o analogico vem primeiro (a ordem de declaracao das constantes nao
  // importa; o que vale e' a ordem que vai no EJS_VirtualGamepadSettings).
  ok(/return\s*\[ANALOGICO,\s*DPAD/.test(html), 'o analogico vem antes do dpad no gamepad');
  ok(/if \(console === 'snes'\)/.test(html) && /if \(console === 'arcade'\)/.test(html),
    'snes e arcade recebem o gamepad novo');
  // CAIXAS SEPARADAS dentro da coluna esquerda: D-pad ancorado no TOPO, o
  // analogico ancorado na BASE. Como cada um tem a propria largura/altura
  // (var(--dpad) / var(--stick)), as areas de toque nunca se tocam.
  ok(/\.ejs_virtualGamepad_left\s+\.b_dpad\s*\{[^}]*top:\s*0\s*!important/s.test(css)
     && /\.ejs_virtualGamepad_left\s+\.b_dpad\s*\{[^}]*width:\s*var\(--dpad\)/s.test(css),
    'o D-pad fica no TOPO da coluna, com a propria caixa');
  // O analogico e' um PONTO (0x0) na base da coluna, deslocado 25px a direita.
  ok(/\.ejs_virtualGamepad_left\s+\.b_stick\s*\{[^}]*bottom:\s*calc\(var\(--stick\)/s.test(css)
     && /\.ejs_virtualGamepad_left\s+\.b_stick\s*\{[^}]*width:\s*0\s*!important/s.test(css),
    'o analogico e um PONTO na base da coluna (abaixo do D-pad)');
  ok(/--stick-right:\s*25px/.test(css) && /--dpad-up:\s*20px/.test(css),
    'ajustes do dono: D-pad 20px p/ cima e analogico 25px p/ a direita');
  // A caixa da COLUNA tem a altura do conjunto (--stack) -> preserva o --gap.
  ok(/\.ejs_virtualGamepad_left\s*\{[^}]*width:\s*var\(--stick\)/s.test(css)
     && /--stack:\s*calc\(var\(--dpad\)[^)]*var\(--stick\)[^)]*var\(--gap\)/.test(css),
    'a coluna tem a largura do controle e a altura do conjunto (dpad+stick+vao)');
  // O circulo visivel (.back) e' dimensionado/centralizado pelo CSS (nao mais
  // pelo inline do nipple), e o joystick interno pelo --knob.
  ok(/\.b_stick\s+\.back\s*\{[^}]*width:\s*var\(--stick\)/s.test(css)
     && /\.b_stick\s+\.back\s*\{[^}]*margin-left:\s*calc\(var\(--stick\)/s.test(css),
    'o circulo do analogico e dimensionado e centralizado pelo CSS');
  ok(/\.b_stick\s+\.front\s*\{[^}]*width:\s*var\(--knob\)/s.test(css),
    'o joystick interno usa --knob');
  // O nipple traz `top:100%` inline; o CSS o leva ao CENTRO da caixa .b_stick.
  // O nipplejs calcula o centro como `rect da zona + top:100%`; o ponto 0x0
  // mantem esse centro alinhado ao desenho (era o bug das direcoes).
  ok(/\.b_stick\s*>\s*div\s*\{[^}]*top:\s*100%\s*!important/s.test(css), 'o nipple ancora no ponto da zona (top:100%)');
  ok(/--stick-scale/.test(css) === false, 'sem escala fixa do analogico (era px fixo)');
  // COR do analogico: anel cinza opaco + joystick preto com bolinhas pequenas.
  ok(/\.b_stick\s+\.back\s*\{[^}]*background-color:\s*#8b8b8b/s.test(css),
    'o anel do analogico e cinza opaco');
  ok(/\.b_stick\s+\.back\s*\{[^}]*background-image:\s*none/s.test(css),
    'o anel nao tem mais o degrade (era o gradiente do nipple)');
  ok(/\.b_stick\s+\.front\s*\{[^}]*background-color:\s*#000/s.test(css),
    'o joystick do analógico e preto');
  ok(/\.b_stick\s+\.front\s*\{[^}]*radial-gradient/s.test(css)
     && /\.b_stick\s+\.front\s*\{[^}]*background-size:\s*7px 7px/s.test(css),
    'o joystick tem bolinhas cinzas pequenas (radial-gradient 7px)');
  // DOIS rotulos dos cantos (ESQ/DIR = ombros L/R; pt-BR traduz L->ESQ, R->DIR).
  ok(/\.b_l,\s*\n#game\s+\.b_r\s*\{[^}]*display:\s*none/s.test(css),
    'os dois rotulos dos cantos (ESQ/DIR) foram removidos');
  ok(/\.b_l\s*\{\s*top:\s*-22px/.test(css), 'o ombro L nao sai da caixa com o cluster maior');
});

await test('controle Bluetooth: botao no canto + deteccao real pela Gamepad API', () => {
  if (!SITE) return pular('site');
  const html = fs.readFileSync(path.join(SITE, 'index.html'), 'utf-8');
  const css = fs.readFileSync(path.join(SITE, 'style.css'), 'utf-8');

  ok(/id="controle"/.test(html), 'tem o botao de controle');
  ok(/id="controle-painel"/.test(html), 'tem o painel do controle');
  // O botao precisa viver FORA de `#jogador`: em tela cheia o `#jogador` e
  // rotacionado, e um `position: fixed` dentro dele gira junto (medido: o botao
  // aparecia deitado, na vertical).
  const posBotao = html.indexOf('id="controle"');
  const posJogador = html.indexOf('<section id="jogador"');
  ok(posBotao < posJogador, 'o botao fica FORA de #jogador (nao gira junto)');
  ok(/body\.jogando\s+#controle\s*\{[^}]*position:\s*fixed/s.test(css), 'o botao e fixo no jogo');
  ok(/body\.jogando\s+#controle\s*\{[^}]*left:/s.test(css), 'fica no lado ESQUERDO');
  ok(/body\.jogando\s+#controle\s*\{[^}]*top:/s.test(css), 'fica no TOPO');
  ok(/#controle\s*\{\s*display:\s*none/.test(css), 'escondido no catalogo (so aparece jogando)');

  // Deteccao REAL: le a Gamepad API e reage ao evento do navegador.
  ok(/navigator\.getGamepads/.test(html), 'le a Gamepad API (estado real, nao inventado)');
  ok(/gamepadconnected/.test(html) && /gamepaddisconnected/.test(html), 'reage a conexao/desconexao');
  ok(/crossOriginIsolated/.test(css) === false && /crossOriginIsolated/.test(html), 'detecta o isolamento (threads)');
  // O pareamento e' do SISTEMA; a Web Bluetooth e' atalho com reserva manual.
  ok(/navigator\.bluetooth/.test(html), 'oferece abrir o Bluetooth quando o navegador permite');
  ok(/configurações do aparelho|configuracoes de Bluetooth/.test(html), 'e ensina o caminho manual');
  ok(/Testar/.test(html), 'tem o teste honesto (so acende se a API enxergar)');
  ok(/#controle\.ativo/.test(css), 'fica verde quando ha controle (dado real)');

  // FLUXO "abrir Bluetooth -> lista -> escolher"
  ok(/id="controle-lista"/.test(html), 'tem a lista de aparelhos');
  ok(/id="controle-busca"/.test(html) && /spinner/.test(css), 'mostra o "procurando…" com o spinner');
  ok(/requestDevice\(\{[\s\S]{0,80}acceptAllDevices:\s*true/.test(html), 'a busca aceita todos os aparelhos');
  ok(/device\?\.name|device\.name/.test(html), 'mostra o nome do aparelho escolhido');
  ok(/e\?\.name\s*!==\s*'NotFoundError'|NotFoundError/.test(html), 'trata o cancelamento da busca sem quebrar');
  // O pareamento de controle NAO e' feito pela Web Bluetooth -- o texto diz isso
  // (nao promete o que a API nao faz) e manda pro Bluetooth do sistema.
  ok(/configurações do aparelho|configuracoes do aparelho/.test(html),
    'manda parear pelo Bluetooth DO APARELHO (a Web Bluetooth nao pareia controle)');
});

await test('controle: SALVO entre sessoes (localStorage) + reconexao automatica', () => {
  if (!SITE) return pular('site');
  const html = fs.readFileSync(path.join(SITE, 'index.html'), 'utf-8');

  ok(/localStorage/.test(html), 'usa o armazenamento local');
  ok(/emugames\.controles/.test(html), 'guarda a lista de controles ja vistos');
  ok(/emugames\.controlePreferido/.test(html), 'guarda qual e o controle do usuario');
  ok(/function salvarControle/.test(html), 'tem a funcao que salva o controle');
  ok(/salvos\.find\(\(s\)\s*=>\s*s\.id\s*===\s*gp\.id\)/.test(html), 'nao duplica o mesmo controle');
  ok(/procurarControlesSalvos/.test(html), 'procura os controles salvos ao abrir o site');
  ok(/Seu controle:/.test(html), 'mostra qual e o controle salvo quando ele nao esta conectado');
  // A reconexao e' do SO (o controle fica pareado); o site so reconhece.
  ok(/reconecta no aparelho/.test(html), 'explica que a reconexao e do aparelho');
});

await test('controle: nome AMIGAVEL (nunca o IP/MAC do aparelho)', () => {
  if (!SITE) return pular('site');
  const html = fs.readFileSync(path.join(SITE, 'index.html'), 'utf-8');

  ok(/function nomeDoControle/.test(html), 'tem a funcao que limpa o nome');
  // O `id` da Gamepad API as vezes vem como endereco: vendor/product em hex
  // (`045e-02fd-Wireless Controller`) ou MAC/IP -- que nao identificam nada.
  // Confere pelos TRECHOS reais do codigo (regex dentro de regex e' fragil).
  const trechoNome = html.slice(html.indexOf('function nomeDoControle'), html.indexOf('const gamepadsConectados'));
  ok(/Vendor\|Product/.test(trechoNome), 'remove o rotulo Vendor/Product');
  ok(/\(\[:-/.test(trechoNome) && /\{5\}/.test(trechoNome), 'remove MAC (6 pares hex)');
  ok(/\\d\{1,3\}/.test(trechoNome) && /\{3\}/.test(trechoNome), 'remove IP');
  ok(/STANDARD GAMEPAD\|XInput/.test(trechoNome), 'remove o ruido do mapeamento');
  ok(/return s \|\| 'Controle'/.test(html), 'cai em "Controle" quando nao sobra nome');
  // O nome e' guardado junto do controle, para as proximas visitas.
  ok(/nome:\s*gp\.nome/.test(html), 'salva o nome do controle');
  // E o estado mostra o NOME, nunca o id cru.
  ok(/lista\.map\(\(g\) => esc\(g\.nome\)\)/.test(html), 'mostra o nome na lista de conectados');
});

await test('TV: foco visivel para controle remoto + alvos maiores', () => {
  if (!SITE) return pular('site');
  const css = fs.readFileSync(path.join(SITE, 'style.css'), 'utf-8');
  const html = fs.readFileSync(path.join(SITE, 'index.html'), 'utf-8');

  // Na TV nao ha toque: quem navega e o direcional do controle remoto, que move
  // o FOCO. Medido: o site nao tinha NENHUM estilo de :focus.
  ok(/:focus-visible/.test(css), 'tem estilo de foco (controle remoto)');
  ok(/\.card:focus-visible[\s\S]{0,400}outline:\s*3px/.test(css), 'o foco e bem visivel');
  ok(/\.card:focus-visible\s*\{[^}]*transform:\s*scale/.test(css), 'o cartao em foco cresce');
  ok(/@media\s*\(min-width:\s*1400px\)/.test(css), 'trata tela grande (TV)');
  ok(/min-width:\s*1400px[\s\S]{0,200}minmax\(220px/.test(css), 'cartoes maiores na TV');
  // Os alvos ja sao <button> (focaveis de fabrica) -- sem isso o controle
  // remoto nao teria o que percorrer.
  ok(/<button[^>]*class="card"/.test(html) || /createElement\('button'\)/.test(html),
    'os cartoes sao <button> (focaveis pelo controle remoto)');
});

await test('TV/controle: jogar com controle NAO conta como inatividade', () => {
  if (!SITE) return pular('site');
  const html = fs.readFileSync(path.join(SITE, 'index.html'), 'utf-8');

  // Medido: a atividade so vinha de toque/teclado. Numa TV com controle o jogo
  // seria fechado por "inatividade" no meio da partida.
  ok(/function controleEmUso/.test(html), 'tem a checagem de controle em uso');
  ok(/controleEmUso\(\)\)\s*marcarAtividade\(\)/.test(html), 'controle em uso conta como atividade');
  ok(/b\.pressed\s*\|\|\s*b\.value\s*>\s*0\.2/.test(html), 'le os botoes do controle');
  ok(/Math\.abs\(a\)\s*>\s*0\.25/.test(html), 'le os analogicos do controle');
  // Numa TV o controle virtual de DEDO nao deve aparecer (nao ha toque) --
  // quem decide isso e' o proprio EmulatorJS (`hasTouchScreen`/`isMobile`).
  ok(!/EJS_VirtualGamepadSettings[\s\S]{0,40}isMobile/.test(html),
    'nao forca o gamepad de dedo (o EmulatorJS decide por hasTouchScreen)');
});

await test('desempenho: threads com deteccao + headers de isolamento', () => {
  if (!SITE) return pular('site');
  const html = fs.readFileSync(path.join(SITE, 'index.html'), 'utf-8');
  const raiz = SITE;

  // Threads: liga SO quando o isolamento existe. Medido: ligar sem
  // SharedArrayBuffer NAO cai para o nucleo normal -- termina com
  // `failedToStart`, entao o valor tem de ser detectado, nunca fixo em `true`.
  ok(/EJS_threads\s*=/.test(html), 'configura as threads');
  ok(/crossOriginIsolated/.test(html) && /SharedArrayBuffer/.test(html),
    'so liga threads quando ha isolamento (SharedArrayBuffer)');
  ok(!/EJS_threads\s*=\s*true\s*;/.test(html), 'NAO liga threads no escuro (quebraria o boot)');

  // O arquivo de headers e' o que da o isolamento no Cloudflare.
  const h = fs.readFileSync(path.join(raiz, '_headers'), 'utf-8');
  ok(/Cross-Origin-Opener-Policy:\s*same-origin/.test(h), '_headers: COOP');
  ok(/Cross-Origin-Embedder-Policy:\s*credentialless/.test(h), '_headers: COEP');

  // FPS a mostra: serve para conferir que nao esta caindo de quadro.
  ok(/EJS_defaultOptions\s*=\s*\{\s*fps/.test(html), 'mostra os FPS (para conferir travada)');
});

await test('tela cheia: aperta o botao, a tela VIRA e o botao continua acessivel', () => {
  if (!SITE) return pular('site');
  const html = fs.readFileSync(path.join(SITE, 'index.html'), 'utf-8');
  const css = fs.readFileSync(path.join(SITE, 'style.css'), 'utf-8');

  ok(/function tentarGirar/.test(html), 'tem a funcao que gira a tela');
  ok(/screen\.orientation[\s\S]{0,120}lock\('landscape'\)/.test(html), 'tenta travar em paisagem (Android)');
  ok(/classList\.toggle\('girado'/.test(html), 'deita o layout por CSS quando a API nao gira');
  // Sair da tela cheia desfaz o giro: `ajustarGiro` e' chamada no fim do
  // `alternarTelaCheia` e tira a classe quando o modo esta desligado.
  ok(/ajustarGiro\(\);\s*\n\s*cheiaBtn\.textContent/.test(html), 'sair da tela cheia desfaz o giro');

  // REGRESSAO do bug relatado ("o jogo fica so na metade e de cabeca para
  // baixo"): a decisao de girar tem de ser REAVALIADA, e nunca girar quando a
  // tela ja esta deitada. Antes ela era tomada UMA vez, 400ms depois do
  // clique -- e o `screen.orientation.lock` do Android chega ATRASADO, entao a
  // classe ficava presa: layout girado em cima de uma tela deitada.
  ok(/function ajustarGiro/.test(html), 'tem a funcao que decide o giro (reavaliavel)');
  ok(/ajustarGiro\(\)[\s\S]{0,80}estaEmTelaCheia\(\)\s*&&\s*innerWidth\s*<=\s*innerHeight/.test(html)
    || /estaEmTelaCheia\(\)\s*&&\s*innerWidth\s*<=\s*innerHeight/.test(html),
    'so deita o layout se a tela NAO estiver deitada');
  ok(!/innerWidth\s*>\s*innerHeight/.test(html), 'nao decide o giro por uma leitura unica do viewport');
  ok(/const aoMudarViewport/.test(html), 'reavalia em toda mudanca de viewport');
  ok(/addEventListener\('resize',\s*aoMudarViewport\)/.test(html), 'o resize reavalia o giro');
  ok(/visualViewport\.addEventListener\('resize',\s*aoMudarViewport\)/.test(html), 'o visualViewport reavalia o giro');
  ok(/orientationchange[\s\S]{0,200}aoMudarViewport/.test(html), 'o orientationchange reavalia o giro');

  // O layout girado cobre a tela (senao sobraria espaco em branco).
  ok(/body\.girado\s+#jogador\s*\{[^}]*rotate\(90deg\)/s.test(css), 'o layout girado roda 90 graus');
  ok(/body\.girado\s+#jogador\s*\{[^}]*width:\s*100vh/s.test(css), 'as dimensoes trocam no giro');
  ok(/body\.girado\s+#jogador\s*\{[^}]*height:\s*100vw/s.test(css), 'altura vira a largura do viewport');
  ok(/body\.girado\s+#jogador\s*\{[^}]*margin-left:\s*100vw/s.test(css), 'a caixa girada e puxada para dentro da tela');

  // O botao de tela cheia continua visivel e clicavel nos DOIS modos.
  ok(/body\.cheia\s+#controles\s*\{[^}]*position:\s*fixed/s.test(css), 'em tela cheia a barra flutua sobre o jogo');
  ok(/body\.cheia\s+#controles\s*\{[^}]*left:\s*50%/s.test(css), 'a barra fica no meio');
  ok(/body\.cheia\s+#controles\s*>\s*\*\s*\{\s*pointer-events:\s*auto/.test(css), 'o botao continua clicavel');
  ok(/body\.cheia\s+#cheia\s*\{[^}]*opacity/s.test(css), 'o botao fica translucido (nao atrapalha)');
  ok(/body\.cheia\s+#parar,\s*\nbody\.cheia\s+#status\s*\{\s*display:\s*none/.test(css),
    'esconde PARAR/status em tela cheia (so sobra o botao de sair)');
  ok(/body\.girado\s+#controles\s*\{[^}]*position:\s*fixed/s.test(css), 'no layout girado a barra tambem flutua');
  ok(/'⛶ SAIR'/.test(html), 'o texto do botao muda para SAIR');
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

await test('!topgear aparece no menu arcade e no blockPv (deixou de ser experimental)', async () => {
  const arcade = fs.readFileSync(path.join(PROJECT, 'dados/src/menus/menuarcade.js'), 'utf-8');
  ok(arcade.includes('topgear'), 'menuarcade cita topgear');
  const blockPv = fs.readFileSync(path.join(PROJECT, 'dados/src/utils/blockPv.js'), 'utf-8');
  ok(blockPv.includes('topgear'), 'blockPv cita topgear');
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
  if (!SITE) return pular('site');
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
    for (const { nome, dados } of lerZip(path.join(SITE, 'jogos/arcade', nomeZip))) {
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
  const pasta = path.join(SITE, 'jogos/arcade');
  ok(!fs.existsSync(path.join(pasta, 'kof2.zip')), 'kof2.zip nao existe mais (foi unificado)');
});

await test('as capas dos jogos existem (senao o card cai para texto)', () => {
  if (!SITE) return pular('site');
  const cat = JSON.parse(fs.readFileSync(path.join(PROJECT, 'dados/emugames/jogos.json'), 'utf-8'));
  for (const j of cat.jogos) {
    // O card procura `capas/<capa>`; sem o campo `capa`, cai no convencional
    // `<id>.gif`. A capa e um GIF animado (a fork converte p/ MP4 no envio).
    const arquivo = j.capa || `${j.id}.gif`;
    ok(arquivo.endsWith('.gif'), `${j.id}: a capa e um .gif (veio ${arquivo})`);
    const capa = path.join(SITE, 'capas', arquivo);
    ok(fs.existsSync(capa), `capa ${arquivo} existe`);
    if (fs.existsSync(capa)) {
      const b = fs.readFileSync(capa);
      ok(b.slice(0, 3).toString('latin1') === 'GIF', `${arquivo} e um GIF`);
    }
  }
  const card = fs.readFileSync(path.join(PROJECT, 'dados/src/topgear/index.js'), 'utf-8');
  ok(card.includes('capas/'), 'o card procura a capa em capas/');
  ok(card.includes('jogo.capa'), 'o card usa o campo capa do catalogo');
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
  if (!SITE) return pular('site');
  const ig = path.join(SITE, '.assetsignore');
  ok(fs.existsSync(ig), '.assetsignore existe');
  const txt = fs.readFileSync(ig, 'utf-8');
  const linhas = txt.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  ok(linhas.includes('jogos/arcade/kof97.zip'), 'exclui o kof97.zip do upload');
  // .git tambem precisa sair: o wrangler varre a RAIZ e o pack do .git guarda o
  // blob do kof97.zip (27,6 MiB) -> sem isto o deploy morre com "Asset too large".
  ok(linhas.includes('.git'), 'exclui o .git da varredura de assets');
  ok(linhas.includes('node_modules') && linhas.includes('.wrangler'), 'exclui node_modules/.wrangler');
  // So regras de exclusao (nada de reincluir arquivo): nenhuma linha com `!`.
  ok(!linhas.some((l) => l.startsWith('!')), 'nao reinclui nenhum arquivo');
});

await test('o host (Cloudflare) nao depende de espelho externo', () => {
  if (!SITE) return pular('site');
  // O GitHub Pages foi abandonado: tudo sai do MESMO host (Cloudflare). O
  // kof97.zip grande nao sobe (esta no .assetsignore) — quem sobe sao as partes.
  const ig = fs.readFileSync(path.join(SITE, '.assetsignore'), 'utf-8');
  const linhas = ig.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  ok(linhas.includes('jogos/arcade/kof97.zip'), 'o zip grande nao sobe');
  ok(!linhas.some((l) => l.endsWith('.p1') || l.endsWith('.p2')), 'as partes sobem normalmente');
});

await test('o player NAO define EJS_paths (quebra o boot do EmulatorJS)', () => {
  if (!SITE) return pular('site');
  const html = fs.readFileSync(path.join(SITE, 'index.html'), 'utf-8');
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
  if (!SITE) return pular('site');
  const html = fs.readFileSync(path.join(SITE, 'index.html'), 'utf-8');
  // O EmulatorJS, por padrao, EXTRAI a BIOS em arquivos soltos. O FBNeo procura
  // "neogeo.zip" -- sem o zip ele acusa "one of your romsets is missing files".
  ok(/window\.EJS_dontExtractBIOS = true/.test(html), 'liga EJS_dontExtractBIOS');
  ok(/if \(j\.bios\)/.test(html), 'so quando o jogo tem BIOS');

  const cat = JSON.parse(fs.readFileSync(path.join(PROJECT, 'dados/emugames/jogos.json'), 'utf-8'));
  for (const j of cat.jogos) {
    if (!j.bios) continue;
    // a BIOS tem de estar na RAIZ do site: o EJS grava o arquivo no CWD do FS
    // e o FBNeo procura o zip pelo nome na raiz.
    ok(!j.bios.includes('/'), `${j.id}: bios na raiz do site (veio ${j.bios})`);
    ok(fs.existsSync(path.join(SITE, j.bios)), `${j.id}: ${j.bios} existe`);
  }
  // e o zip da BIOS tem os arquivos essenciais do FBNeo
  const essenciais = { 'sm1.sm1': '94416d67', 'sfix.sfix': 'c2ea0cfd', '000-lo.lo': '5a86cff2' };
  const entradas = (nome) => {
    const m = new Map();
    for (const { nome: n, dados } of lerZip(path.join(SITE, nome))) m.set(n, dados);
    return m;
  };
  const bios = entradas('neogeo.zip');
  for (const [nome, esperado] of Object.entries(essenciais)) {
    ok(bios.has(nome) && (zlib.crc32(bios.get(nome)) >>> 0).toString(16).padStart(8, '0') === esperado,
      `BIOS tem ${nome} com CRC oficial`);
  }
});

await test('ROM grande e servida em PARTES e remontada no player', () => {
  if (!SITE) return pular('site');
  const cat = JSON.parse(fs.readFileSync(path.join(PROJECT, 'dados/emugames/jogos.json'), 'utf-8'));
  const html = fs.readFileSync(path.join(SITE, 'index.html'), 'utf-8');
  const LIMITE = 25 * 1024 * 1024;
  const pasta = path.join(SITE, 'jogos/arcade');

  // Toda ROM acima do limite do Cloudflare tem de vir em partes, e cada parte
  // tem de caber no limite (senao o deploy inteiro falha).
  for (const j of cat.jogos) {
    const p = path.join(SITE, j.rom);
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
    ok(j.mirror === undefined, `${j.id} nao depende de espelho`);
  }

  // o player remonta num Blob e da o nome do ARQUIVO ao romset (arcade)
  ok(/function remontarRom/.test(html), 'o player remonta as partes');
  ok(/new Blob\(/.test(html), 'remonta num Blob');
  ok(/j\.partes/.test(html), 'usa o campo partes do catalogo');
  ok(/j\.console === 'arcade'\) window\.EJS_gameName = j\.rom\.split\('\/'\)\.pop\(\)/.test(html),
    'em arcade o nome do arquivo e o do romset (o core procura pelo nome)');

  // o .assetsignore exclui SO o zip grande (as partes precisam subir)
  const ig = fs.readFileSync(path.join(SITE, '.assetsignore'), 'utf-8');
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
