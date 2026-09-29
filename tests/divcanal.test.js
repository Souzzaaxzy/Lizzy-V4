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

import { generateWAMessage, generateWAMessageContent, getContentType } from '@itsliaaa/baileys';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const TMP_DB = fs.mkdtempSync(path.join(os.tmpdir(), 'lizzy-divcanal-'));
process.env.DATABASE_PATH = TMP_DB;
const GRUPOS_DIR = path.join(TMP_DB, 'grupos');
const DONO_DIR = path.join(TMP_DB, 'dono');
fs.mkdirSync(GRUPOS_DIR, { recursive: true });
fs.mkdirSync(DONO_DIR, { recursive: true });

// Canal do PROJETO (global.json -> channel), como o bot usa nos cabecalhos.
const CANAL_PROJETO = '120363410980452460@newsletter';
// JPEG minimo (base64) para provar que a foto vai no card
const FOTO_B64 = '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==';
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

await test('1. normalizarIdGrupo aceita JID e digitos, recusa nao-grupo', () => {
  ok(mod.normalizarIdGrupo('120363000000000001@g.us') === '120363000000000001@g.us', 'JID pronto');
  ok(mod.normalizarIdGrupo('120363000000000001') === '120363000000000001@g.us', 'digitos ganham sufixo');
  ok(mod.normalizarIdGrupo('') === null, 'vazio -> null');
  ok(mod.normalizarIdGrupo(CANAL_PROJETO) === null, 'canal NAO e grupo');
});

await test('1b. ehJidCanal valida o canal padrao', () => {
  ok(mod.ehJidCanal(CANAL_PROJETO), 'canal valido');
  ok(!mod.ehJidCanal('120363000000000001@g.us'), 'grupo nao e canal');
});

await test('2. buildFollowChannelContent usa o formato NATIVO (newsletterInvite)', async () => {
  const { object, tipo } = mod.buildFollowChannelContent({ jid: CANAL_PROJETO, nome: 'Lizzy', caption: 'Siga!' });
  ok(tipo === 'newsletterFollowerInviteMessageV2', 'tipo do card');
  ok(object.newsletterInvite?.jid === CANAL_PROJETO, 'formato nativo da fork');
  // o card MONTADO (pela fork) tem os campos do proto
  const card = await cardDe(object);
  ok(card?.newsletterJid === CANAL_PROJETO, 'jid no card');
  ok(card?.newsletterName === 'Lizzy', 'nome no card');
  ok(card?.caption === 'Siga!', 'legenda no card');
  let erro = null;
  try { mod.buildFollowChannelContent({ jid: 'abc@s.whatsapp.net' }); } catch (e) { erro = e; }
  ok(erro && /canal/i.test(erro.message), 'recusa jid que nao e canal');
});

await test('3. normalizar/adicionar/remover GRUPOS', () => {
  const g1 = '120363000000000001@g.us';
  const g2 = '120363000000000002';
  ok(mod.normalizarGrupos([g1, g2]).length === 2, 'normaliza (aceita digitos)');
  ok(mod.normalizarGrupos([g1, g1]).length === 1, 'dedup');
  ok(mod.normalizarGrupos(['lixo', null, 42, CANAL_PROJETO]).length === 0, 'descarta invalidos e canal');
  const a = mod.adicionarGrupo([], g1);
  ok(a.adicionado && a.grupos.length === 1, 'adiciona');
  ok(!mod.adicionarGrupo(a.grupos, g1).adicionado, 'nao duplica');
  ok(mod.removerGrupo(a.grupos, g1).removido, 'remove por jid');
  ok(mod.removerGrupo(a.grupos, 'x@newsletter').removido === false, 'remover inexistente');
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

async function rodar(text, { registrar = null } = {}) {
  const sent = [];
  const gid = makeGroup();
  // `registrar` = JID que o comando deve ver como "o grupo onde rodou".
  const grupoAtual = registrar || gid;
  const nazu = {
    sendMessage: async (jid, content, options) => { sent.push({ jid, content, options }); return { key: { id: `SENT-${sent.length}` } }; },
    user: { id: `${BOT_JID.split('@')[0]}:5@s.whatsapp.net`, lid: BOT_LID, name: 'Lizzy' },
    onWhatsApp: async (jid) => [{ jid, exists: true }],
    signalRepository: { lidMapping: { getPNForLID: async () => null } },
    contacts: { getName: () => undefined }, getName: () => undefined,
    // newsletterMetadata resolve o LINK -> JID (é o que o `add` usa)
    // preview = blob base64 (caminho simples, sem download) — como a fork devolve
    newsletterMetadata: async (tipo, valor) => ({
      id: tipo === 'jid' ? valor : CANAL_PROJETO,
      name: 'Canal',
      preview: FOTO_B64,
    }),
    groupMetadata: async (jidAlvo) => ({
      id: jidAlvo || grupoAtual, subject: 'Grupo Destino', owner: `${DONO_NUM}@s.whatsapp.net`,
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
    key: { remoteJid: grupoAtual, fromMe: true, id: `M-${Math.random().toString(36).slice(2, 8)}`, participant: OWNER_LID },
    message: { extendedTextMessage: { text, contextInfo: { remoteJid: grupoAtual } } },
    messageTimestamp: 1757900000, pushName: 'Dono',
  };
  await handleMessage(nazu, info, null, new Map(), null);
  await new Promise((r) => setTimeout(r, 250));
  const texto = sent.map((s) => s.content?.text ?? s.content?.caption ?? '').filter(Boolean).join('\n');
  const cards = sent.filter((s) => s.content?.newsletterInvite || s.content?.newsletterFollowerInviteMessageV2);
  return { sent, texto, cards, gid: grupoAtual };
}

/**
 * Extrai o card MONTADO a partir do conteudo enviado. O comando manda o formato
 * nativo (`newsletterInvite`); quem monta o `NewsletterFollowerInviteMessageV2`
 * e o `generateWAMessageContent` da fork — entao o teste passa pelo caminho real.
 */
async function cardDe(content) {
  if (content?.newsletterFollowerInviteMessageV2) return content.newsletterFollowerInviteMessageV2;
  const { proto } = await import('@itsliaaa/baileys');
  const gerado = await generateWAMessageContent(content, { userJid: '5599999999999@s.whatsapp.net', upload: async () => ({ url: 'x', directPath: '/v' }) });
  return gerado?.newsletterFollowerInviteMessageV2 || proto.Message.decode(proto.Message.encode(gerado).finish()).newsletterFollowerInviteMessageV2;
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

await test('4. sem grupo registrado, o envio RECUSA (nao sabe para onde mandar)', async () => {
  limpar();
  const { cards, texto } = await rodar('!divcanal send');
  ok(cards.length === 0, 'nao enviou card');
  contem(texto, 'Nenhum grupo registrado', 'explica que falta registrar');
});

await test('5. add SEM id registra o GRUPO onde o comando foi usado', async () => {
  limpar();
  const g = '120363000000000777@g.us';
  const { texto } = await rodar('!divcanal add', { registrar: g });
  contem(texto, 'Grupo registrado', 'confirmou');
  const cfg = lerCfg();
  ok(cfg.groups?.length === 1, 'gravou 1 grupo');
  ok(cfg.groups[0] === g, `gravou o grupo atual (${cfg.groups[0]})`); 
});

await test('6. add com ID direto funciona; duplicado nao duplica', async () => {
  limpar();
  const g = '120363000000000778@g.us';
  await rodar(`!divcanal add ${g}`);
  const r2 = await rodar(`!divcanal add ${g}`);
  contem(r2.texto, 'já está registrado', 'avisa duplicado');
  ok(lerCfg().groups?.length === 1, 'continua com 1');
});

await test('7. send envia o CARD (do canal do bot) com tipo intacto no payload', async () => {
  limpar();
  const g = '120363000000000779@g.us';
  await rodar(`!divcanal add ${g}`);
  const { cards } = await rodar('!divcanal send');
  ok(cards.length === 1, 'um card');
  // o destino e o GRUPO registrado, e o card aponta para o CANAL do bot
  ok(cards[0].jid === g, `enviou para o grupo registrado (${cards[0].jid})`);
  const p = await tipoDoPayload(cards[0].content);
  ok(p.tipo === 'newsletterFollowerInviteMessageV2', `tipo no payload (${p.tipo})`);
  ok(p.card?.newsletterJid === CANAL_PROJETO, 'jid do CANAL no payload');
});

await test('8. a legenda salva vai no card e no envio', async () => {
  limpar();
  await rodar('!divcanal add 120363000000000780@g.us');
  await rodar('!divcanal msg Entre no canal 💜');
  const a = await rodar('!divcanal send');
  ok((await cardDe(a.cards[0].content)).caption === 'Entre no canal 💜', 'legenda salva usada');
  // texto passado no send sobrescreve
  const r = await rodar('!divcanal send Legenda pontual');
  ok((await cardDe(r.cards[0].content)).caption === 'Legenda pontual', 'legenda do send vence');
});

await test('9. list e status mostram os GRUPOS e o canal padrao', async () => {
  limpar();
  const g = '120363000000000781@g.us';
  await rodar(`!divcanal add ${g}`);
  const l = await rodar('!divcanal list');
  contem(l.texto, 'GRUPOS REGISTRADOS', 'titulo da lista');
  contem(l.texto, g, 'mostra o grupo');
  contem(l.texto, CANAL_PROJETO, 'mostra o canal padrao usado');
  const st = await rodar('!divcanal status');
  contem(st.texto, 'DIVULGAÇÃO DE CANAL', 'titulo do status');
  contem(st.texto, 'Canal usado', 'mostra o canal');
  contem(st.texto, CANAL_PROJETO, 'jid do canal');
});

await test('10. rem remove por numero e por id', async () => {
  limpar();
  await rodar('!divcanal add 120363000000000782@g.us');
  await rodar('!divcanal add 120363000000000783@g.us');
  ok(lerCfg().groups.length === 2, 'tem 2');
  const r = await rodar('!divcanal rem 1');
  contem(r.texto, 'removido', 'removeu pelo numero');
  ok(lerCfg().groups.length === 1, 'sobrou 1');
  await rodar('!divcanal rem 120363000000000783@g.us');
  ok(lerCfg().groups.length === 0, 'removeu pelo id');
  contem((await rodar('!divcanal rem 999@g.us')).texto, 'não encontrado', 'inexistente avisa');
});

await test('11. add sem argumento mostra o uso', async () => {
  limpar();
  const { texto } = await rodar('!divcanal');
  contem(texto, 'divcanal add', 'mostra o help');
  contem(texto, 'Canal usado', 'explica qual canal sera usado');
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

await test('14. o card leva a FOTO do canal (jpegThumbnail)', async () => {
  limpar();
  await rodar('!divcanal add 120363000000000790@g.us');
  const { cards } = await rodar('!divcanal send');
  const inner = await cardDe(cards[0].content);
  ok(inner.jpegThumbnail?.length > 0, 'tem thumbnail');
  const { proto } = await import('@itsliaaa/baileys');
  const dec = proto.Message.decode(proto.Message.encode({ newsletterFollowerInviteMessageV2: inner }).finish());
  ok(dec.newsletterFollowerInviteMessageV2.jpegThumbnail?.length === inner.jpegThumbnail.length, 'thumb sobrevive ao encode');
});

await test('15. o card sai mesmo se a foto falhar (nunca quebra)', async () => {
  limpar();
  await rodar('!divcanal add 120363000000000791@g.us');
  const { texto, cards } = await rodar('!divcanal send');
  ok(cards.length === 1, 'o card saiu');
  contem(texto, 'Enviados: 1', 'confirmou o envio');
});

await test('16b. a mensagem setada leva o cabecalho "Ver canal" (newsletter)', async () => {
  limpar();
  await rodar('!divcanal add 120363000000000792@g.us');
  const { cards } = await rodar('!divcanal send');
  const inner = await cardDe(cards[0].content);
  const ci = inner.contextInfo;
  ok(ci, 'tem contextInfo');
  ok(ci.forwardedNewsletterMessageInfo?.newsletterJid === CANAL_PROJETO, `cabecalho aponta o canal (${ci.forwardedNewsletterMessageInfo?.newsletterJid})`);
  ok(ci.isForwarded === true && ci.forwardingScore === 999, 'encaminhamento de canal');
  // e sobrevive ao encode do proto (e o que chega no destino)
  const { proto } = await import('@itsliaaa/baileys');
  const dec = proto.Message.decode(proto.Message.encode({ newsletterFollowerInviteMessageV2: inner }).finish());
  ok(dec.newsletterFollowerInviteMessageV2.contextInfo?.forwardedNewsletterMessageInfo?.newsletterJid === CANAL_PROJETO, 'sobrevive ao encode');
});

await test('16. fotoDoMetadataNewsletter extrai o preview (e tolera lixo)', () => {
  ok(mod.fotoDoMetadataNewsletter({ preview: FOTO_B64 })?.length > 0, 'preview base64');
  ok(mod.fotoDoMetadataNewsletter({ preview: `data:image/jpeg;base64,${FOTO_B64}` })?.length > 0, 'data-uri');
  ok(mod.fotoDoMetadataNewsletter({ preview: { base64: FOTO_B64 } })?.length > 0, 'objeto com base64');
  ok(mod.fotoDoMetadataNewsletter({}) === null, 'sem preview -> null');
  ok(mod.fotoDoMetadataNewsletter(null) === null, 'null tolerado');
});

// ============================================================================
// RESUMO
// ============================================================================

const totalOk = RESULTS.reduce((a, r) => a + r.passed, 0);
const totalFail = RESULTS.reduce((a, r) => a + r.failed, 0);
console.log(`\n${totalFail === 0 ? 'OK' : 'ERR'} ${RESULTS.length} testes / ${totalOk} assercoes (${totalFail} falhas)`);
process.exit(totalFail === 0 ? 0 : 1);
