/**
 * Testes do `!divcanal` — divulgação do CARD de "seguir canal".
 *
 * Mesma linha do `!divdono` (registrar canais, legenda, envio, status), mas o
 * conteudo e o card NATIVO (`newsletterFollowerInviteMessageV2`) em vez de
 * texto/imagem.
 *
 * O teste roda o handler REAL e passa o conteudo capturado pelo caminho REAL da
 * fork (`generateWAMessage`), conferindo que o tipo chega intacto — sem isso um
 * teste que so olha "enviou algo" passaria mesmo com o card quebrado.
 *
 * Uso: node tests/divcanal.test.js
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

import { generateWAMessage, getContentType } from '@itsliaaa/baileys';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const TMP_DB = fs.mkdtempSync(path.join(os.tmpdir(), 'lizzy-divcanal-'));
process.env.DATABASE_PATH = TMP_DB;
const GRUPOS_DIR = path.join(TMP_DB, 'grupos');
const DONO_DIR = path.join(TMP_DB, 'dono');
fs.mkdirSync(GRUPOS_DIR, { recursive: true });
fs.mkdirSync(DONO_DIR, { recursive: true });

// Canal do PROJETO (global.json -> channel), como o bot usa nos cabecalhos.
const CANAL_PROJETO = '120363410980452460@newsletter';
fs.writeFileSync(path.join(TMP_DB, 'global.json'), JSON.stringify({
  channel: { channelJid: CANAL_PROJETO, channelName: 'Lizzy' },
}, null, 2));

const mod = await import(new URL('../dados/src/utils/canalDivulgacao.js', import.meta.url).href);

const RESULTS = [];
let CURRENT = null;
function test(name, fn) {
  CURRENT = { name, passed: 0, failed: 0, errors: [] };
  RESULTS.push(CURRENT);
  try {
    const r = fn();
    if (r && typeof r.then === 'function') {
      return r.then(() => finish(name)).catch((e) => { CURRENT.failed += 1; CURRENT.errors.push(`EXCECAO: ${e?.stack || e}`); finish(name); });
    }
    finish(name);
  } catch (e) { CURRENT.failed += 1; CURRENT.errors.push(`EXCECAO: ${e?.stack || e}`); finish(name); }
  return Promise.resolve();
}
function finish(name) {
  console.log(`${CURRENT.failed === 0 ? 'OK ' : 'ERR'} ${name} (${CURRENT.passed} ok, ${CURRENT.failed} falhas)`);
  for (const err of CURRENT.errors) console.log(`     ${err.split('\n')[0]}`);
}
function ok(c, m) { if (c) CURRENT.passed += 1; else { CURRENT.failed += 1; CURRENT.errors.push(`ASSERT FALHOU: ${m}`); } }
function contem(h, n, l) { ok(typeof h === 'string' && h.includes(n), `${l ?? n} — esperado conter "${n}"`); }
function naoContem(h, n, l) { ok(typeof h === 'string' && !h.includes(n), `${l ?? n} — NAO deveria conter "${n}"`); }

// ============================================================================
// 1) MODULO PURO
// ============================================================================

await test('1. interpretarCanalEntrada entende link, JID e codigo', () => {
  ok(mod.interpretarCanalEntrada(CANAL_PROJETO)?.tipo === 'jid', 'JID pronto');
  const link = mod.interpretarCanalEntrada('https://whatsapp.com/channel/0029VaAbCdEfGh');
  ok(link?.tipo === 'codigo' && link.valor === '0029VaAbCdEfGh', 'link -> codigo');
  ok(mod.interpretarCanalEntrada('0029VaAbCdEfGh')?.tipo === 'codigo', 'codigo cru');
  ok(mod.interpretarCanalEntrada('') === null, 'vazio -> null');
});

await test('2. buildFollowChannelContent monta o card com raw:true', () => {
  const { object, tipo } = mod.buildFollowChannelContent({ jid: CANAL_PROJETO, nome: 'Lizzy', caption: 'Siga!' });
  ok(tipo === 'newsletterFollowerInviteMessageV2', 'tipo do card');
  ok(object.raw === true, 'raw: true (senao a fork lanca Invalid media type)');
  const inner = object.newsletterFollowerInviteMessageV2;
  ok(inner.newsletterJid === CANAL_PROJETO, 'jid no card');
  ok(inner.newsletterName === 'Lizzy', 'nome no card');
  ok(inner.caption === 'Siga!', 'legenda no card');
  let erro = null;
  try { mod.buildFollowChannelContent({ jid: 'abc@s.whatsapp.net' }); } catch (e) { erro = e; }
  ok(erro && /canal/i.test(erro.message), 'recusa jid que nao e canal');
});

await test('3. normalizar/adicionar/remover canais', () => {
  ok(mod.normalizarCanais([CANAL_PROJETO, { jid: '120363000000000001@newsletter', nome: 'X' }]).length === 2, 'normaliza');
  ok(mod.normalizarCanais([CANAL_PROJETO, CANAL_PROJETO]).length === 1, 'dedup');
  ok(mod.normalizarCanais(['lixo', null, 42]).length === 0, 'descarta invalidos');
  const a = mod.adicionarCanal([], { jid: CANAL_PROJETO, nome: 'Lizzy' });
  ok(a.adicionado && a.canais.length === 1, 'adiciona');
  const a2 = mod.adicionarCanal(a.canais, { jid: CANAL_PROJETO, nome: 'Novo' });
  ok(!a2.adicionado && a2.canais[0].nome === 'Novo', 'nao duplica, atualiza o nome');
  ok(mod.removerCanal(a.canais, CANAL_PROJETO).removido, 'remove');
  ok(!mod.removerCanal(a.canais, 'x@newsletter').removido, 'remover inexistente');
});

// ============================================================================
// 2) HANDLER REAL
// ============================================================================

const indexModule = await import(new URL('../dados/src/index.js', import.meta.url).href);
const handleMessage = indexModule.default ?? indexModule;

const BOT_JID = '5599999999999@s.whatsapp.net';
const BOT_LID = '111111111111111@lid';
const CFG = (() => {
  try {
    const p = process.env.CONFIG_PATH || path.join(HERE, '..', 'dados', 'src', 'config.json');
    return JSON.parse(fs.readFileSync(p, 'utf-8')) || {};
  } catch { return {}; }
})();
const DONO_NUM = String(CFG.numerodono || '').replace(/\D/g, '');
const OWNER_JID = `${DONO_NUM}@s.whatsapp.net`;
const OWNER_LID = CFG.lidowner || `${DONO_NUM}@lid`;

let groupCounter = 0;
function makeGroup() {
  groupCounter += 1;
  const jid = `1203631500000000${String(groupCounter).padStart(3, '0')}@g.us`;
  fs.writeFileSync(path.join(GRUPOS_DIR, `${jid}.json`), JSON.stringify({ modobrincadeira: true }, null, 2));
  return jid;
}
const CONFIG_FILE = path.join(DONO_DIR, 'divulgacao_canal.json');
function lerCfg() { try { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8')); } catch { return {}; } }

async function rodar(text, { link = null } = {}) {
  const sent = [];
  const gid = makeGroup();
  const nazu = {
    sendMessage: async (jid, content, options) => { sent.push({ jid, content, options }); return { key: { id: `SENT-${sent.length}` } }; },
    user: { id: `${BOT_JID.split('@')[0]}:5@s.whatsapp.net`, lid: BOT_LID, name: 'Lizzy' },
    onWhatsApp: async (jid) => [{ jid, exists: true }],
    signalRepository: { lidMapping: { getPNForLID: async () => null } },
    contacts: { getName: () => undefined }, getName: () => undefined,
    // newsletterMetadata resolve o LINK -> JID (é o que o `add` usa)
    newsletterMetadata: async (tipo, valor) => {
      if (tipo === 'invite') return { id: link || CANAL_PROJETO, name: 'Canal do Link' };
      return { id: valor, name: 'Canal' };
    },
    groupMetadata: async () => ({
      id: gid, subject: 'G', owner: `${DONO_NUM}@s.whatsapp.net`,
      participants: [
        { id: BOT_LID, lid: BOT_LID, phoneNumber: BOT_JID, admin: 'admin' },
        { id: OWNER_LID, lid: OWNER_LID, phoneNumber: OWNER_JID, admin: 'admin' },
      ],
    }),
    profilePictureUrl: async () => 'x', react: async () => ({}),
    groupParticipantsUpdate: async () => ({}), readMessages: async () => {}, sendPresenceUpdate: async () => {},
    ev: { on: () => {}, emit: () => {}, removeAllListeners: () => {} },
  };
  const info = {
    key: { remoteJid: gid, fromMe: true, id: `M-${Math.random().toString(36).slice(2, 8)}`, participant: OWNER_LID },
    message: { extendedTextMessage: { text, contextInfo: { remoteJid: gid } } },
    messageTimestamp: 1757900000, pushName: 'Dono',
  };
  await handleMessage(nazu, info, null, new Map(), null);
  await new Promise((r) => setTimeout(r, 250));
  const texto = sent.map((s) => s.content?.text ?? s.content?.caption ?? '').filter(Boolean).join('\n');
  const cards = sent.filter((s) => s.content?.newsletterFollowerInviteMessageV2);
  return { sent, texto, cards, gid };
}

/** Passa o card pelo caminho REAL da fork e devolve o tipo que chega. */
async function tipoDoPayload(content) {
  const full = await generateWAMessage('120363000000000000@g.us', content, {
    userJid: `${BOT_JID.split('@')[0]}@s.whatsapp.net`,
    upload: async () => ({ url: 'https://x/y', directPath: '/v' }),
  });
  const tipo = getContentType(full.message);
  return { tipo, card: full.message?.newsletterFollowerInviteMessageV2 };
}

// limpa o estado entre os testes de handler
function limpar() { try { fs.rmSync(CONFIG_FILE, { force: true }); } catch {} }

await test('4. sem nada registrado, o envio usa o CANAL DO PROJETO', async () => {
  limpar();
  const { cards } = await rodar('!divcanal send');
  ok(cards.length === 1, 'enviou 1 card');
  const inner = cards[0].content.newsletterFollowerInviteMessageV2;
  ok(inner.newsletterJid === CANAL_PROJETO, `usou o canal do projeto (${inner.newsletterJid})`);
});

await test('5. add com LINK resolve via newsletterMetadata e registra', async () => {
  limpar();
  const { texto } = await rodar('!divcanal add https://whatsapp.com/channel/0029VaXyz', { link: CANAL_PROJETO });
  contem(texto, 'Canal registrado', 'confirmou');
  const cfg = lerCfg();
  ok(cfg.canais?.length === 1, 'gravou 1 canal');
  ok(cfg.canais[0].jid === CANAL_PROJETO, 'gravou o JID resolvido (nao o codigo)');
});

await test('6. add com JID direto tambem funciona; duplicado nao duplica', async () => {
  limpar();
  await rodar(`!divcanal add ${CANAL_PROJETO}`);
  const r2 = await rodar(`!divcanal add ${CANAL_PROJETO}`);
  contem(r2.texto, 'já estava registrado', 'avisa duplicado');
  ok(lerCfg().canais?.length === 1, 'continua com 1');
});

await test('7. send envia o CARD com tipo intacto no payload da fork', async () => {
  limpar();
  await rodar(`!divcanal add ${CANAL_PROJETO}`);
  const { cards } = await rodar('!divcanal send');
  ok(cards.length === 1, 'um card');
  const p = await tipoDoPayload(cards[0].content);
  ok(p.tipo === 'newsletterFollowerInviteMessageV2', `tipo no payload (${p.tipo})`);
  ok(p.card?.newsletterJid === CANAL_PROJETO, 'jid no payload');
});

await test('8. a legenda salva vai no card e no envio', async () => {
  limpar();
  await rodar(`!divcanal add ${CANAL_PROJETO}`);
  await rodar('!divcanal msg Entre no canal 💜');
  const { cards } = await rodar('!divcanal send');
  ok(cards[0].content.newsletterFollowerInviteMessageV2.caption === 'Entre no canal 💜', 'legenda salva usada');
  // texto passado no send sobrescreve
  const r = await rodar('!divcanal send Legenda pontual');
  ok(r.cards[0].content.newsletterFollowerInviteMessageV2.caption === 'Legenda pontual', 'legenda do send vence');
});

await test('9. list e status mostram os canais', async () => {
  limpar();
  await rodar(`!divcanal add ${CANAL_PROJETO}`);
  const l = await rodar('!divcanal list');
  contem(l.texto, 'CANAIS REGISTRADOS', 'titulo da lista');
  contem(l.texto, CANAL_PROJETO, 'mostra o jid');
  const s = await rodar('!divcanal status');
  contem(s.texto, 'DIVULGAÇÃO DE CANAL', 'titulo do status');
  contem(s.texto, 'Canal do projeto', 'mostra o canal do projeto');
});

await test('10. rem remove por JID e por numero da lista', async () => {
  limpar();
  await rodar(`!divcanal add ${CANAL_PROJETO}`);
  await rodar('!divcanal add 120363000000000001@newsletter');
  ok(lerCfg().canais.length === 2, 'tem 2');
  const r = await rodar('!divcanal rem 1');
  contem(r.texto, 'removido', 'removeu pelo numero');
  ok(lerCfg().canais.length === 1, 'sobrou 1');
  await rodar(`!divcanal rem ${CANAL_PROJETO}`);
  contem((await rodar(`!divcanal rem x@newsletter`)).texto, 'não encontrado', 'inexistente avisa');
});

await test('11. add sem argumento mostra o uso', async () => {
  limpar();
  const { texto } = await rodar('!divcanal');
  contem(texto, 'divcanal add', 'mostra o help');
  contem(texto, 'canal do PROJETO', 'explica o padrao do projeto');
});

await test('12. so o dono usa o comando', async () => {
  limpar();
  const sent = [];
  const gid = makeGroup();
  const invasor = '333000000000099@lid';
  const nazu = {
    sendMessage: async (jid, content) => { sent.push({ jid, content }); return { key: { id: 'S' } }; },
    user: { id: `${BOT_JID.split('@')[0]}:5@s.whatsapp.net`, lid: BOT_LID },
    onWhatsApp: async (j) => [{ jid: j, exists: true }],
    signalRepository: { lidMapping: { getPNForLID: async () => null } },
    contacts: { getName: () => undefined }, getName: () => undefined,
    groupMetadata: async () => ({ id: gid, subject: 'G', owner: `${DONO_NUM}@s.whatsapp.net`, participants: [{ id: invasor, lid: invasor, admin: 'admin' }] }),
    profilePictureUrl: async () => 'x', react: async () => ({}),
    groupParticipantsUpdate: async () => ({}), readMessages: async () => {}, sendPresenceUpdate: async () => {},
    ev: { on: () => {}, emit: () => {}, removeAllListeners: () => {} },
  };
  await handleMessage(nazu, {
    key: { remoteJid: gid, fromMe: false, id: 'M1', participant: invasor },
    message: { extendedTextMessage: { text: '!divcanal send', contextInfo: { remoteJid: gid } } },
    messageTimestamp: 1757900000, pushName: 'X',
  }, null, new Map(), null);
  await new Promise((r) => setTimeout(r, 200));
  const t = sent.map((s) => s.content?.text ?? '').join('\n');
  contem(t, 'dono do bot', 'barra quem nao e dono');
  ok(!sent.some((s) => s.content?.newsletterFollowerInviteMessageV2), 'nao enviou card');
});

await test('13. menu: divcanal na MESMA categoria do divdono', () => {
  const src = fs.readFileSync(path.join(HERE, '..', 'dados/src/menus/menudono.js'), 'utf-8');
  contem(src, '${prefix}divcanal add', 'menu lista divcanal');
  // mesma secao TRANSMISSOES do divdono
  const iDiv = src.indexOf('${prefix}divdono add');
  const iCanal = src.indexOf('${prefix}divcanal add');
  const iFim = src.indexOf('╰', iDiv);
  ok(iDiv > 0 && iCanal > iDiv && iCanal < iFim, 'esta na mesma secao (entre divdono e o fim da caixa)');
});

// ============================================================================
// RESUMO
// ============================================================================

const totalOk = RESULTS.reduce((a, r) => a + r.passed, 0);
const totalFail = RESULTS.reduce((a, r) => a + r.failed, 0);
console.log(`\n${totalFail === 0 ? 'OK' : 'ERR'} ${RESULTS.length} testes / ${totalOk} assercoes (${totalFail} falhas)`);
process.exit(totalFail === 0 ? 0 : 1);
