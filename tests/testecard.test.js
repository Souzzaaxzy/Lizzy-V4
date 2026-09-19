/**
 * Testes do `!testecard` — Group Status com contexto do AUTOR original.
 *
 * O experimento investiga se o protocolo permite publicar, num único Group
 * Status, o CONTEÚDO de uma mensagem junto da IDENTIDADE de quem a escreveu,
 * deixando o cliente resolver nome/foto — em vez de o bot montar um card PNG.
 *
 * O que este teste prova (e o que NÃO prova):
 *   - PROVA: o helper monta o payload; `authorJid` viaja no wire (round-trip
 *     real de protobuf); as variantes isolam cada hipótese; a stanza continua
 *     sendo um Group Status do grupo certo; o comando reutiliza a resolução de
 *     identidade e não altera os outros comandos.
 *   - NÃO prova: que o WhatsApp renderiza o nome/foto do autor. Isso só o
 *     aparelho responde — a evidência de que daria certo é documental (o campo
 *     existe, tem essa finalidade no proto e é usado por outras bibliotecas).
 *
 * Uso: node tests/testecard.test.js
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.resolve(HERE, '..');

const TMP_DB = fs.mkdtempSync(path.join(os.tmpdir(), 'lizzy-card-db-'));
process.env.DATABASE_PATH = TMP_DB;
const GRUPOS_DIR = path.join(TMP_DB, 'grupos');
fs.mkdirSync(GRUPOS_DIR, { recursive: true });

const RESULTS = [];
let CURRENT = null;

function test(name, fn) {
  CURRENT = { name, passed: 0, failed: 0, errors: [] };
  RESULTS.push(CURRENT);
  const done = (error) => {
    if (error) {
      CURRENT.failed += 1;
      CURRENT.errors.push(`EXCEÇÃO: ${error?.stack || error}`);
    }
    console.log(`${CURRENT.failed === 0 ? '✅' : '❌'} ${name} (${CURRENT.passed} ok, ${CURRENT.failed} falhas)`);
    for (const err of CURRENT.errors) console.log(`     ${err.split('\n')[0]}`);
  };
  try {
    const result = fn();
    if (result && typeof result.then === 'function') return result.then(() => done()).catch(done);
    done();
  } catch (error) {
    done(error);
  }
  return Promise.resolve();
}

function ok(condition, message) {
  if (condition) CURRENT.passed += 1;
  else {
    CURRENT.failed += 1;
    CURRENT.errors.push(`ASSERT FALHOU: ${message}`);
  }
}

function includes(haystack, needle, label) {
  ok(typeof haystack === 'string' && haystack.includes(needle), `${label ?? needle} — esperado conter "${needle}"`);
}

function notIncludes(haystack, needle, label) {
  ok(typeof haystack === 'string' && !haystack.includes(needle), `${label ?? needle} — não deveria conter "${needle}"`);
}

// ============================================================================
// IMPORTS
// ============================================================================

const { proto, generateWAMessageContent } = await import('@itsliaaa/baileys');
const card = await import(new URL('../dados/src/utils/groupStatusCard.js', import.meta.url).href);

const indexModule = await import(new URL('../dados/src/index.js', import.meta.url).href);
const handleMessage = indexModule.default ?? indexModule;

const BOT_JID = '5599999999999@s.whatsapp.net';
const BOT_LID = '111111111111111@lid';
const GRUPO = '120363300000000001@g.us';

// ============================================================================
// 1) HELPERS PUROS
// ============================================================================

await test('readQuotedContent: extrai texto de vários formatos', () => {
  ok(card.readQuotedContent({ conversation: 'boa tarde galera' }).text === 'boa tarde galera', 'conversation');
  ok(card.readQuotedContent({ extendedTextMessage: { text: 'oi' } }).text === 'oi', 'extendedTextMessage');
  ok(card.readQuotedContent({ imageMessage: { caption: 'legenda' } }).text === 'legenda', 'legenda de imagem');
  ok(card.readQuotedContent({ imageMessage: { caption: 'l' } }).media?.type === 'imageMessage', 'detecta mídia');
  ok(
    card.readQuotedContent({ viewOnceMessageV2: { message: { extendedTextMessage: { text: 'vo' } } } }).text === 'vo',
    'dentro de view once'
  );
  ok(card.readQuotedContent(null).text === '', 'null -> vazio');
  ok(card.readQuotedContent({ stickerMessage: {} }).text === '', 'mídia sem legenda -> vazio');
  ok(card.readQuotedContent({ extendedTextMessage: { text: '   ' } }).text === '', 'só espaços -> vazio');
});

await test('buildAuthorAttribution: usa o campo REAL do proto (authorJid)', () => {
  const autor = '5511888888888@s.whatsapp.net';
  const a = card.buildAuthorAttribution(proto, autor);

  ok(Boolean(a), 'montou o atributo');
  ok(a.type === proto.StatusAttribution.Type.GROUP_STATUS, 'tipo GROUP_STATUS');
  ok(a.groupStatus?.authorJid === autor, 'authorJid preenchido');

  ok(card.buildAuthorAttribution(proto, null) === null, 'sem autor -> null');
  ok(card.buildAuthorAttribution(proto, '') === null, 'autor vazio -> null');
  ok(card.buildAuthorAttribution(null, autor) === null, 'sem proto -> null');
});

await test('não inventa campo: só authorJid é escrito no atributo', () => {
  const a = card.buildAuthorAttribution(proto, '5511888888888@s.whatsapp.net');
  const camposAtributo = Object.keys(a.toJSON ? a.toJSON() : a).filter((k) => a[k] !== undefined && a[k] !== null);
  // type + groupStatus (actionUrl fica ausente porque não foi setado)
  ok(camposAtributo.every((k) => ['type', 'groupStatus'].includes(k)), `só campos do proto (${camposAtributo})`);

  const dentro = Object.keys(a.groupStatus.toJSON ? a.groupStatus.toJSON() : a.groupStatus);
  ok(dentro.length === 1 && dentro[0] === 'authorJid', `GroupStatus só tem authorJid (${dentro})`);
});

await test('buildAuthorContextStatus: junta conteúdo + identidade + contexto + referência', () => {
  const content = card.buildAuthorContextStatus({
    proto,
    authorJid: '5511888888888@s.whatsapp.net',
    authorJidAlt: '999888777666555@lid',
    text: 'boa tarde galera',
    quotedMessage: { extendedTextMessage: { text: 'boa tarde galera' } },
    stanzaId: 'MSG-ORIGINAL',
    groupJid: GRUPO,
  });

  ok(Boolean(content), 'montou');
  ok(content.groupStatus === true, 'é Group Status');
  ok(content.text === 'boa tarde galera', 'conteúdo preservado');
  ok(content.contextInfo.participant === '5511888888888@s.whatsapp.net', 'contexto de participante');
  ok(content.contextInfo.participantAlt === '999888777666555@lid', 'identidade alternativa');
  ok(content.contextInfo.stanzaId === 'MSG-ORIGINAL', 'referência à mensagem');
  ok(content.contextInfo.remoteJid === GRUPO, 'remoteJid do grupo');
  ok(Boolean(content.contextInfo.quotedMessage), 'quotedMessage presente');
  ok(
    content.contextInfo.statusAttributions.some((a) => a.groupStatus?.authorJid),
    'atribuição de autor presente'
  );
  ok(content.contextInfo.isGroupStatus === undefined, 'isGroupStatus NÃO é montado à mão (a fork aplica)');
});

await test('buildAuthorContextStatus: exige texto e autor', () => {
  const base = { proto, authorJid: '5511888888888@s.whatsapp.net', text: 'oi' };
  ok(Boolean(card.buildAuthorContextStatus(base)), 'caso base monta');

  ok(card.buildAuthorContextStatus({ ...base, text: '' }) === null, 'sem texto -> null');
  ok(card.buildAuthorContextStatus({ ...base, text: '   ' }) === null, 'texto vazio -> null');
  ok(card.buildAuthorContextStatus({ ...base, authorJid: null }) === null, 'sem autor -> null');
  ok(card.buildAuthorContextStatus({ ...base, text: 123 }) === null, 'texto não-string -> null');
});

await test('variantes: cada uma isola uma hipótese', () => {
  const opts = {
    proto,
    authorJid: '5511888888888@s.whatsapp.net',
    authorJidAlt: '999888777666555@lid',
    text: 'boa tarde galera',
    quotedMessage: { extendedTextMessage: { text: 'boa tarde galera' } },
    stanzaId: 'MSG-ORIGINAL',
    groupJid: GRUPO,
  };

  const full = card.buildCardVariant('full', opts);
  const attr = card.buildCardVariant('attribution', opts);
  const quote = card.buildCardVariant('quote', opts);
  const plain = card.buildCardVariant('plain', opts);

  // full: tudo
  ok(Boolean(full.contextInfo.participant) && Boolean(full.contextInfo.stanzaId), 'full tem contexto+referência');
  ok(full.contextInfo.statusAttributions.some((a) => a.groupStatus?.authorJid), 'full tem autor');

  // attribution: só o autor (sem participant/quote) -> isola o efeito do autor
  ok(attr.contextInfo.statusAttributions.some((a) => a.groupStatus?.authorJid), 'attribution tem autor');
  ok(!attr.contextInfo.participant, 'attribution SEM participant (isola o autor)');
  ok(!attr.contextInfo.stanzaId, 'attribution SEM referência');

  // quote: contexto sem autor -> controle
  ok(Boolean(quote.contextInfo.participant), 'quote tem participant');
  ok(!quote.contextInfo.statusAttributions.some((a) => a.groupStatus?.authorJid), 'quote SEM autor');

  // plain: controle puro
  ok(!plain.contextInfo.participant, 'plain sem participant');
  ok(!plain.contextInfo.stanzaId, 'plain sem referência');
  ok(!plain.contextInfo.statusAttributions.some((a) => a.groupStatus?.authorJid), 'plain sem autor');

  ok(card.buildCardVariant('inexistente', opts) === null, 'variante inválida -> null');
  ok(card.CARD_VARIANTS.length === 5, 'cinco variantes');

  // poster: o campo literal 'quem postou o status' (ContextInfo.posterStatusId)
  const poster = card.buildCardVariant('poster', opts);
  ok(poster.contextInfo.posterStatusId === opts.authorJid, 'poster usa posterStatusId');
  ok(!poster.contextInfo.participant, 'poster sem participant');
  ok(!poster.contextInfo.statusAttributions.some((a) => a.groupStatus?.authorJid), 'poster sem atribuicao');
});

await test('describePayload: resumo de uma linha para diagnóstico', () => {
  const content = card.buildCardVariant('full', {
    proto,
    authorJid: '5511888888888@s.whatsapp.net',
    text: 'oi',
    stanzaId: 'X',
    groupJid: GRUPO,
  });
  const d = card.describePayload(content);
  includes(d, 'autor=5511888888888@s.whatsapp.net', 'mostra o autor');
  includes(d, 'quote=sim', 'mostra a citação');
  includes(d, 'remoteJid=' + GRUPO, 'mostra o destino');
});

// ============================================================================
// 2) PROVA NO WIRE: o payload sobrevive ao encode/decode real
// ============================================================================

await test('o payload VIRA um Group Status no fio, com autor e contexto', async () => {
  const content = card.buildCardVariant('full', {
    proto,
    authorJid: '5511888888888@s.whatsapp.net',
    authorJidAlt: '999888777666555@lid',
    text: 'boa tarde galera',
    quotedMessage: { extendedTextMessage: { text: 'boa tarde galera' } },
    stanzaId: 'MSG-ORIGINAL',
    groupJid: GRUPO,
  });

  const gerado = await generateWAMessageContent(content, {
    userJid: BOT_JID,
    upload: async () => ({ url: 'https://x/y', directPath: '/v/y' }),
  });

  const bytes = proto.Message.encode(proto.Message.create(gerado)).finish();
  const dec = proto.Message.decode(bytes);
  const inner = dec.groupStatusMessageV2?.message?.extendedTextMessage;
  const ci = inner?.contextInfo;

  ok(Boolean(inner), 'encapsulado em groupStatusMessageV2');
  ok(inner.text === 'boa tarde galera', 'conteúdo preservado no fio');
  ok(ci?.isGroupStatus === true, 'isGroupStatus aplicado pela fork');
  ok(
    ci?.statusAttributions?.some((a) => a.groupStatus?.authorJid === '5511888888888@s.whatsapp.net'),
    'authorJid sobrevive ao encode/decode (vai mesmo no fio)'
  );
  ok(ci?.participant === '5511888888888@s.whatsapp.net', 'participant sobrevive');
  ok(ci?.stanzaId === 'MSG-ORIGINAL', 'referência sobrevive');
  ok(Boolean(ci?.quotedMessage), 'quotedMessage sobrevive');
});

await test('authorJid em LID também sobrevive ao fio', async () => {
  const lid = '999888777666555@lid';
  const content = card.buildCardVariant('full', { proto, authorJid: lid, text: 'oi', groupJid: GRUPO });

  const gerado = await generateWAMessageContent(content, {
    userJid: BOT_JID,
    upload: async () => ({ url: 'https://x/y', directPath: '/v/y' }),
  });
  const dec = proto.Message.decode(proto.Message.encode(proto.Message.create(gerado)).finish());
  const ci = dec.groupStatusMessageV2.message.extendedTextMessage.contextInfo;

  ok(ci.statusAttributions.some((a) => a.groupStatus?.authorJid === lid), 'LID preservado como authorJid');
});

await test('campo inventado é DESCARTADO (prova de que authorJid é campo real)', async () => {
  // Se authorJid não existisse no proto, ele sumiria como este campo falso.
  const falso = proto.Message.create({
    groupStatusMessageV2: {
      message: { extendedTextMessage: { text: 'x', contextInfo: { campoInventadoXYZ: 'a' } } },
    },
  });
  const dec = proto.Message.decode(proto.Message.encode(falso).finish());
  const ci = dec.groupStatusMessageV2.message.extendedTextMessage.contextInfo;
  ok(ci.campoInventadoXYZ === undefined, 'campo fora do proto não sobrevive');

  // E o campo real sobrevive:
  const real = proto.Message.create({
    groupStatusMessageV2: {
      message: {
        extendedTextMessage: {
          text: 'x',
          contextInfo: { statusAttributions: [{ type: 5, groupStatus: { authorJid: 'a@s.whatsapp.net' } }] },
        },
      },
    },
  });
  const dec2 = proto.Message.decode(proto.Message.encode(real).finish());
  const ci2 = dec2.groupStatusMessageV2.message.extendedTextMessage.contextInfo;
  ok(ci2.statusAttributions[0].groupStatus.authorJid === 'a@s.whatsapp.net', 'authorJid (real) sobrevive');
});

// ============================================================================
// 3) HANDLER REAL DO COMANDO
// ============================================================================

// JID de grupo DETERMINÍSTICO e único por teste. O metadata do grupo é
// cacheado por grupo (TTL 10s), então reaproveitar um JID faria o teste
// seguinte enxergar o admin do anterior e receber "Apenas administradores" —
// medindo a coisa errada.
let grupoSeq = 0;
const fazerGrupo = (flags = {}) => {
  grupoSeq += 1;
  const jid = `1203634000000${String(grupoSeq).padStart(5, '0')}@g.us`;
  fs.writeFileSync(path.join(GRUPOS_DIR, `${jid}.json`), JSON.stringify({ groupName: 'Grupo Card', ...flags }, null, 2));
  return jid;
};

function makeNazu({ sent, groupJid, sender, comoAdmin = true }) {
  return {
    sendMessage: async (jid, content, options) => {
      sent.push({ jid, content, options });
      return { key: { id: `SENT-${sent.length}` } };
    },
    user: { id: `${BOT_JID.split('@')[0]}:5@s.whatsapp.net`, lid: BOT_LID, name: 'Lizzy' },
    onWhatsApp: async (jid) => [{ jid, exists: true, lid: jid.replace('@s.whatsapp.net', '@lid') }],
    signalRepository: { lidMapping: { getPNForLID: async () => null } },
    groupMetadata: async () => ({
      id: groupJid,
      subject: 'Grupo Card',
      participants: [
        { id: BOT_LID, lid: BOT_LID, phoneNumber: BOT_JID, admin: 'admin' },
        { id: sender, lid: sender, phoneNumber: '5511999999997@s.whatsapp.net', admin: comoAdmin ? 'admin' : null },
      ],
    }),
    groupParticipantsUpdate: async () => ({}),
    groupRequestParticipantsList: async () => [],
    groupRequestParticipantsUpdate: async () => ({}),
    ev: { on: () => {}, emit: () => {}, removeAllListeners: () => {} },
    readMessages: async () => {},
    sendPresenceUpdate: async () => {},
    profilePictureUrl: async () => 'x',
    react: async () => ({}),
  };
}

let senderSeq = 0;
async function rodar({ groupJid, text, quoted = null, autor = '5511888888888@s.whatsapp.net', admin = true, stanzaId = 'MSG-ORIGINAL' }) {
  senderSeq += 1;
  const sender = `22200000${String(senderSeq).padStart(5, '0')}@lid`;
  const sent = [];
  const nazu = makeNazu({ sent, groupJid, sender, comoAdmin: admin });
  const contextInfo = { remoteJid: groupJid };
  if (quoted) {
    contextInfo.quotedMessage = quoted;
    contextInfo.participant = autor;
    contextInfo.stanzaId = stanzaId;
  }
  await handleMessage(nazu, {
    key: { remoteJid: groupJid, fromMe: false, id: `M-${Math.random().toString(36).slice(2, 10)}`, participant: sender },
    message: { extendedTextMessage: { text, contextInfo } },
    messageTimestamp: 1757900000,
    pushName: 'Tester',
  }, null, new Map(), null);

  const texto = sent.map((s) => s.content?.text ?? '').filter(Boolean).join('\n');
  const publicacao = sent.find((s) => s.content?.groupStatus === true) || null;
  return { sent, texto, publicacao };
}

await test('!testecard: sem responder mensagem, explica o uso', async () => {
  const groupJid = fazerGrupo();
  const { texto, publicacao } = await rodar({ groupJid, text: '!testecard', quoted: null });
  includes(texto, 'Responda a uma mensagem', 'pede a mensagem');
  ok(!publicacao, 'não publica nada');
});

await test('!testecard: fora de grupo recusa', async () => {
  const { texto, publicacao } = await rodar({ groupJid: '5511999999999@s.whatsapp.net', text: '!testecard' });
  includes(texto, 'só funciona em grupos', 'restrição de grupo');
  ok(!publicacao, 'não publica');
});

await test('!testecard: membro comum não publica', async () => {
  const groupJid = fazerGrupo();
  const { texto, publicacao } = await rodar({
    groupJid, text: '!testecard', quoted: { conversation: 'oi' }, admin: false,
  });
  ok(!publicacao, 'não publica');
  includes(texto, 'Apenas administradores', 'explica a permissão');
});

await test('!testecard respondendo "boa tarde galera": publica o status do AUToR', async () => {
  const groupJid = fazerGrupo();
  const autor = '5511888888888@s.whatsapp.net';
  const { publicacao, texto } = await rodar({
    groupJid,
    text: '!testecard',
    quoted: { extendedTextMessage: { text: 'boa tarde galera' } },
    autor,
  });

  ok(Boolean(publicacao), 'publicou');
  ok(publicacao?.jid === groupJid, 'destino é o GRUPO (não status@broadcast)');
  ok(!String(publicacao?.jid || '').includes('status@broadcast'), 'não usa status@broadcast');
  includes(texto, 'Status experimental publicado', 'confirma');

  ok(publicacao?.content?.groupStatus === true, 'é Group Status');
  ok(publicacao?.content?.text === 'boa tarde galera', 'conteúdo é a mensagem do AUTOR');
  ok(texto.includes(autor) || texto.includes(autor.split('@')[0]),
     `informa o autor referenciado (obtido: ${texto.split('\n').find(l => l.includes('Autor referenciado')) || '-'})`);
});

await test('!testecard: o autor original vai no payload (não a Lizzy)', async () => {
  const groupJid = fazerGrupo();
  const autor = '5511888888888@s.whatsapp.net';
  const { publicacao } = await rodar({
    groupJid, text: '!testecard', quoted: { extendedTextMessage: { text: 'boa tarde galera' } }, autor,
  });

  const attrs = publicacao.content.contextInfo.statusAttributions || [];
  const autores = attrs.map((a) => a.groupStatus?.authorJid).filter(Boolean);
  // O handler normaliza a identidade para LID quando consegue converter; o que
  // importa é que a atribuição aponte para o AUTOR, e não para a Lizzy.
  ok(autores.length > 0, `authorJid presente (${autores})`);
  ok(
    autores.some((a) => String(a).split('@')[0] === autor.split('@')[0] || String(a) === autor),
    `authorJid aponta para o autor (${autores})`
  );
  ok(
    !autores.some((a) => String(a).includes(BOT_JID.split('@')[0]) || String(a).includes(BOT_LID.split('@')[0])),
    'NÃO atribui à Lizzy'
  );
  ok(
    String(publicacao.content.contextInfo.participant).split('@')[0] === autor.split('@')[0],
    `participant é o autor (${publicacao.content.contextInfo.participant})`
  );
});

await test('!testecard: mantém a atribuição de audiência que o statusgrupo já usa', async () => {
  const groupJid = fazerGrupo();
  const { publicacao } = await rodar({
    groupJid, text: '!testecard', quoted: { conversation: 'oi' },
  });
  const attrs = publicacao.content.contextInfo.statusAttributions || [];
  ok(attrs.some((a) => a.type === 10), 'mantém STATUS_CLOSE_SHARING (não quebra o status existente)');
  ok(publicacao.content.contextInfo.statusAudienceMetadata?.audienceType === 1, 'mantém a audiência');
  ok(publicacao.content.contextInfo.featureEligibilities?.canBeReshared === true, 'mantém a permissão de repostagem');
});

await test('!testecard author=<variante>: respeita a variante escolhida', async () => {
  const groupJid = fazerGrupo();

  const attr = await rodar({ groupJid, text: '!testecard attribution', quoted: { conversation: 'oi' } });
  ok(Boolean(attr.publicacao), 'attribution publica');
  ok(!attr.publicacao.content.contextInfo.participant, 'attribution sem participant');
  ok(
    (attr.publicacao.content.contextInfo.statusAttributions || []).some((a) => a.groupStatus?.authorJid),
    'attribution com autor'
  );

  const g2 = fazerGrupo();
  const plain = await rodar({ groupJid: g2, text: '!testecard plain', quoted: { conversation: 'oi' } });
  ok(Boolean(plain.publicacao), 'plain publica');
  ok(
    !(plain.publicacao.content.contextInfo.statusAttributions || []).some((a) => a.groupStatus?.authorJid),
    'plain (controle) sem autor'
  );

  const g3 = fazerGrupo();
  const ruim = await rodar({ groupJid: g3, text: '!testecard naoexiste', quoted: { conversation: 'oi' } });
  includes(ruim.texto, 'Variante desconhecida', 'avisa a variante inválida');
  ok(!ruim.publicacao, 'não publica com variante inválida');
});

await test('!testecard: mensagem sem texto não publica', async () => {
  const groupJid = fazerGrupo();
  const { texto, publicacao } = await rodar({
    groupJid, text: '!testecard', quoted: { stickerMessage: { url: 'https://x/y' } },
  });
  ok(!publicacao, 'não publica');
  includes(texto, 'não tem texto', 'explica');
});

await test('!testecard: registra o status para o !d poder apagar depois', async () => {
  const gs = await import(new URL('../dados/src/utils/groupStatus.js', import.meta.url).href);
  gs.clearPublishedGroupStatuses();
  const groupJid = fazerGrupo();
  await rodar({ groupJid, text: '!testecard', quoted: { conversation: 'oi' } });

  const ultimo = gs.getLastPublishedGroupStatus(groupJid);
  ok(Boolean(ultimo), `status registrado (${ultimo})`);
});

// ============================================================================
// 4) REGRESSÃO
// ============================================================================

await test('regressão: !statusgrupo continua funcionando', async () => {
  const groupJid = fazerGrupo();
  const { publicacao, texto } = await rodar({ groupJid, text: '!statusgrupo Bom dia', quoted: null });
  ok(Boolean(publicacao), 'statusgrupo ainda publica');
  ok(publicacao.content.text === 'Bom dia', 'conteúdo correto');
  includes(texto, 'Status publicado', 'mensagem de sucesso intacta');
});

await test('regressão: comando comum não vira status', async () => {
  const groupJid = fazerGrupo();
  const { sent, publicacao } = await rodar({ groupJid, text: '!s', quoted: null });
  ok(!publicacao, 'não publicou status');
  ok(sent.length > 0, 'respondeu normalmente');
});

await test('!testecard: autor identificado por LID (o caso que falhava)', async () => {
  // Regressão do bug real: `isValidJid` exige PN puro e REJEITA LID, então um
  // `participant` em LID fazia o comando responder "não identifiquei o autor".
  // Em grupo moderno o participant costuma ser LID — era o caso do relato.
  const gs = await import(new URL('../dados/src/utils/groupStatus.js', import.meta.url).href);
  gs.clearPublishedGroupStatuses();
  const groupJid = fazerGrupo();
  const autorLid = '999888777666555@lid';

  const { publicacao, texto } = await rodar({
    groupJid,
    text: '!testecard',
    quoted: { extendedTextMessage: { text: 'boa tarde galera' } },
    autor: autorLid,
  });

  ok(Boolean(publicacao), 'publicou com autor em LID');
  notIncludes(texto, 'Não consegui identificar', 'NÃO diz que não identificou');
  const autores = (publicacao?.content?.contextInfo?.statusAttributions || [])
    .map((a) => a.groupStatus?.authorJid)
    .filter(Boolean);
  ok(autores.some((a) => String(a).includes('999888777666555')), `authorJid é o LID do autor (${autores})`);
});

await test('!testecard: funciona quando o comando vem em mídia (contextInfo fora do texto)', async () => {
  // O `menc_prt` só olha `extendedTextMessage`. Se o comando chega como legenda
  // de uma imagem, o contextInfo fica em `imageMessage` — o comando precisa
  // achar o autor mesmo assim.
  const groupJid = fazerGrupo();
  const autor = '5511888888888@s.whatsapp.net';
  const sender = '222000000000099@lid';
  const sent = [];
  const nazu = makeNazu({ sent, groupJid, sender, comoAdmin: true });

  await handleMessage(nazu, {
    key: { remoteJid: groupJid, fromMe: false, id: 'CMD-MIDIA', participant: sender },
    message: {
      imageMessage: {
        url: 'https://x/y',
        mimetype: 'image/jpeg',
        // comando na legenda de uma imagem, respondendo a outra mensagem
        caption: '!testecard',
        contextInfo: {
          remoteJid: groupJid,
          participant: autor,
          stanzaId: 'MSG-ORIG',
          quotedMessage: { extendedTextMessage: { text: 'boa tarde galera' } },
        },
      },
    },
    messageTimestamp: 1757900000,
    pushName: 'Tester',
  }, null, new Map(), null);

  const publicacao = sent.find((s) => s.content?.groupStatus === true) || null;
  ok(Boolean(publicacao), 'publicou mesmo com o comando vindo em mídia');
  const autores = (publicacao?.content?.contextInfo?.statusAttributions || [])
    .map((a) => a.groupStatus?.authorJid)
    .filter(Boolean);
  ok(autores.some((a) => String(a).split('@')[0] === autor.split('@')[0]), `autor correto (${autores})`);
});

await test('!testecard: testa as 4 variantes sem quebrar', async () => {
  for (const v of card.CARD_VARIANTS) {
    const groupJid = fazerGrupo();
    const { publicacao } = await rodar({
      groupJid, text: `!testecard ${v}`, quoted: { extendedTextMessage: { text: 'oi' } },
    });
    ok(Boolean(publicacao), `variante ${v} publica`);
  }
});

await test('menuadm: !testecard listado', async () => {
  const src = fs.readFileSync(path.join(PROJECT, 'dados/src/menus/menuadm.js'), 'utf-8');
  includes(src, '${prefix}testecard', 'menuadm lista o comando');

  const mod = await import(new URL('../dados/src/menus/menuadm.js', import.meta.url).href);
  const saida = String(await (mod.default ?? mod)('!', 'Lizzy', 'Teste'));
  includes(saida, '!testecard', 'a saída do menu traz o comando');
});

// ============================================================================

const totalOk = RESULTS.reduce((a, r) => a + r.passed, 0);
const totalFail = RESULTS.reduce((a, r) => a + r.failed, 0);
console.log('\n════════════════════════════════════════');
console.log(`RESULTADO: ${RESULTS.length} testes | ${totalOk} asserções ok | ${totalFail} falhas`);
console.log('════════════════════════════════════════');

fs.rmSync(TMP_DB, { recursive: true, force: true });

if (totalFail > 0) {
  console.log('\nFALHAS:');
  for (const r of RESULTS) if (r.failed) for (const e of r.errors) console.log(`- [${r.name}] ${e}`);
  process.exit(1);
}
console.log('✅ TODOS OS TESTES PASSARAM');
process.exit(0);