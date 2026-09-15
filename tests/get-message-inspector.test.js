/**
 * Testes do comando "!get" (dados/src/index.js) e do motor de inspeção
 * (dados/src/utils/messageInspector.js).
 *
 * Executa o handler real (NazuninhaBotExec) com um socket Baileys falso,
 * cobrindo texto, mídias, viewOnce, payment, request payment, amount "0",
 * menções, citação, grupo, encaminhadas e tipos desconhecidos.
 *
 * Uso: node tests/get-message-inspector.test.js
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { getContentType, proto } from '@itsliaaa/baileys';
import protobufjs from 'protobufjs/minimal.js';

// O Baileys codifica campos int64/uint64 do proto como Long (protobufjs).
// É exatamente esse formato que quebra JSON.stringify sem proteção.
const Long = protobufjs.util.Long;

const RESULTS = [];
let CURRENT = null;

function test(name, fn) {
  CURRENT = { name, passed: 0, failed: 0, errors: [] };
  RESULTS.push(CURRENT);
  try {
    const result = fn();
    if (result && typeof result.then === 'function') {
      return result.then(() => finishTest(name)).catch((error) => {
        CURRENT.failed += 1;
        CURRENT.errors.push(`EXCEÇÃO: ${error?.stack || error}`);
        finishTest(name);
      });
    }
    finishTest(name);
  } catch (error) {
    CURRENT.failed += 1;
    CURRENT.errors.push(`EXCEÇÃO: ${error?.stack || error}`);
    finishTest(name);
  }
  return Promise.resolve();
}

function finishTest(name) {
  const status = CURRENT.failed === 0 ? '✅' : '❌';
  console.log(`${status} ${name} (${CURRENT.passed} ok, ${CURRENT.failed} falhas)`);
  for (const err of CURRENT.errors) console.log(`     ${err.split('\n')[0]}`);
}

function ok(condition, message) {
  if (condition) {
    CURRENT.passed += 1;
  } else {
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
// CARGA DO HANDLER REAL
// ============================================================================

// Redireciona o banco para um diretório temporário ANTES de importar o handler:
// assim os grupos usados nos testes não são gravados no dados/database real.
const TMP_DB = fs.mkdtempSync(path.join(os.tmpdir(), 'lizzy-get-db-'));
process.env.DATABASE_PATH = TMP_DB;
fs.mkdirSync(path.join(TMP_DB, 'grupos'), { recursive: true });

const INDEX_PATH = new URL('../dados/src/index.js', import.meta.url).href;
const indexModule = await import(INDEX_PATH);
const handleMessage = indexModule.default ?? indexModule;
if (typeof handleMessage !== 'function') {
  throw new Error('index.js não exporta a função handler — impossível testar !get');
}

// ============================================================================
// FAKE SOCKET BAILEYS
// ============================================================================

const GROUP_JID = '120363000000000000@g.us';
const BOT_JID = '5599999999999@s.whatsapp.net';
const BOT_LID = '111111111111111@lid';
// Identificadores ficticios (nao usam dados reais do dono do bot).
const ADMIN_JID = '5511000000001@s.whatsapp.net';
const ADMIN_LID = '111000000000001@lid';
const MEMBER_JID = '5511888888888@s.whatsapp.net';
const MEMBER_LID = '222222222222222@lid';
const QUOTED_JID = '5511777777777@s.whatsapp.net';

function makeNazu({ sent, groupParticipants = [], groupJid = GROUP_JID, subject = 'Grupo Teste' } = {}) {
  const participants = groupParticipants.length
    ? groupParticipants
    : [
        { id: ADMIN_LID, admin: 'superadmin', phoneNumber: ADMIN_JID },
        { id: BOT_LID, admin: 'admin', phoneNumber: BOT_JID },
        { id: MEMBER_LID, admin: null, phoneNumber: MEMBER_JID },
      ];

  return {
    // ---- envio ----
    sendMessage: async (jid, content, options) => {
      sent.push({ jid, content, options });
      return { key: { id: 'SENT' } };
    },
    // ---- identidade ----
    user: { id: `${BOT_JID.split('@')[0]}:5@s.whatsapp.net`, lid: BOT_LID, name: 'Abyss' },
    // ---- LID <-> PN ----
    onWhatsApp: async (jid) => {
      const map = {
        [ADMIN_JID]: ADMIN_LID,
        [MEMBER_JID]: MEMBER_LID,
        [BOT_JID]: BOT_LID,
        [QUOTED_JID]: '333333333333333@lid',
      };
      let lid = map[jid];
      // Admins únicos gerados por runGet() também têm LID derivado, para que a
      // resolução PN->LID do relatório seja exercitada de verdade.
      const dynamic = /^5511000000(\d{3})@s\.whatsapp\.net$/.exec(jid || '');
      if (!lid && dynamic) lid = `9990000000000${dynamic[1]}@lid`;
      return lid ? [{ jid, exists: true, lid }] : [{ jid, exists: false }];
    },
    signalRepository: {
      lidMapping: {
        getPNForLID: async (lid) => {
          const map = {
            [ADMIN_LID]: ADMIN_JID,
            [MEMBER_LID]: MEMBER_JID,
            [BOT_LID]: BOT_JID,
            '333333333333333@lid': QUOTED_JID,
          };
          if (map[lid]) return map[lid];
          const dynamic = /^9990000000000(\d{3})@lid$/.exec(lid || '');
          return dynamic ? `5511000000${dynamic[1]}@s.whatsapp.net` : null;
        },
      },
    },
    // ---- grupos ----
    groupMetadata: async () => ({ id: groupJid, subject, participants }),
    groupParticipantsUpdate: async () => ({}),
    groupRequestParticipantsList: async () => [],
    groupRequestParticipantsUpdate: async () => ({}),
    // ---- eventos ----
    ev: { on: () => {}, emit: () => {}, removeAllListeners: () => {} },
    // ---- diversos ----
    readMessages: async () => {},
    sendPresenceUpdate: async () => {},
    profilePictureUrl: async () => 'https://example.com/pic.jpg',
  };
}

// ============================================================================
// FACTORY DE MENSAGENS
// ============================================================================

function makeInfo({ message, key = {}, pushName = 'Fulano', ...rest }) {
  return {
    key: { remoteJid: GROUP_JID, fromMe: false, id: 'MSGID123', participant: MEMBER_LID, ...key },
    message,
    messageTimestamp: 1757900000,
    pushName,
    ...rest,
  };
}

/** Mensagem de texto do usuário com o comando !get e uma citação opcional. */
function makeGetCommand({ quotedMessage, quotedStanzaId = 'QUOTED1', quotedParticipant = QUOTED_JID, messageKey = {} }) {
  const contextInfo = {
    stanzaId: quotedStanzaId,
    participant: quotedParticipant,
    remoteJid: GROUP_JID,
  };
  if (quotedMessage) contextInfo.quotedMessage = quotedMessage;

  const commandMessage = {
    extendedTextMessage: {
      text: '!get',
      contextInfo,
    },
  };

  // Quem chama é um admin do grupo: !get exige admin/moderador.
  return makeInfo({
    message: commandMessage,
    key: { id: 'CMD-MESSAGE-ID', participant: ADMIN_LID, ...messageKey },
    pushName: 'QuemChamou',
  });
}

/** Executa o handler e devolve o texto enviado pelo reply. */
let senderCounter = 0;

async function runGet({ message, key, pushName, messagesCacheEntries = [], ...rest }) {
  const sent = [];
  const messagesCache = new Map();
  for (const [k, v] of messagesCacheEntries) messagesCache.set(k, v);

  // Duas fontes de estado global do bot exigem isolamento entre execuções:
  //  - throttle de 3 comandos/5s por sender;
  //  - cache de metadados do grupo (TTL).
  // Cada execução usa então um grupo e um admin próprios, sem alterar o
  // comportamento do handler — apenas evitando medir o cache/throttle.
  senderCounter += 1;
  const suffix = String(senderCounter).padStart(3, '0');
  const uniqueAdmin = `5511000000${suffix}@s.whatsapp.net`;
  const groupJid = `12036300000000${suffix}@g.us`;

  const groupParticipants = [
    { id: ADMIN_LID, admin: 'superadmin', phoneNumber: ADMIN_JID },
    { id: BOT_LID, admin: 'admin', phoneNumber: BOT_JID },
    { id: MEMBER_LID, admin: null, phoneNumber: MEMBER_JID },
    { id: uniqueAdmin, admin: 'admin', phoneNumber: uniqueAdmin },
  ];

  const nazu = makeNazu({ sent, groupParticipants, groupJid, subject: 'Grupo Teste' });
  const info = makeInfo({
    message,
    key: { ...key, remoteJid: groupJid, participant: uniqueAdmin },
    pushName,
    ...rest,
  });
  await handleMessage(nazu, info, null, messagesCache, null);

  const replyText = sent.map((s) => s.content?.text).filter(Boolean).join('\n---\n');
  return { sent, replyText, nazu, sender: uniqueAdmin, groupJid };
}

// ============================================================================
// MENSAGENS DE TESTE
// ============================================================================

const NO_MESSAGE = {
  conversation: 'oi',
};

const TEXT = { conversation: 'mensagem simples de texto' };

const EXTENDED = {
  extendedTextMessage: {
    text: 'texto estendido com link https://example.com',
    contextInfo: {
      expiration: 86400,
      ephemeralSettingTimestamp: 1757800000,
      forwardingScore: 5,
      isForwarded: true,
    },
  },
};

const IMAGE = {
  imageMessage: {
    url: 'https://mmg.whatsapp.net/v/t62.7118-24/abc',
    mimetype: 'image/jpeg',
    caption: 'legenda da imagem',
    fileSha256: Buffer.from('fake-sha-256-value-for-testing!!'),
    fileLength: 123456,
    height: 1080,
    width: 1920,
    mediaKey: Buffer.from('0123456789abcdef0123456789abcdef'),
    fileEncSha256: Buffer.from('enc-sha'),
    directPath: '/v/t62.7118-24/abc',
    mediaKeyTimestamp: 1757900000,
    jpegThumbnail: Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
    scanLengths: [1, 2, 3],
  },
};

const VIDEO = {
  videoMessage: {
    url: 'https://mmg.whatsapp.net/v/video',
    mimetype: 'video/mp4',
    fileName: 'clip.mp4',
    fileLength: 9876543,
    seconds: 42,
    height: 720,
    width: 1280,
    gifPlayback: false,
    caption: 'meu vídeo',
    jpegThumbnail: Buffer.from([0xff, 0xd8]),
    mediaKey: Buffer.from('videokeyvideokeyvideokeyvideokey'),
    mediaKeyTimestamp: 1757900001,
    streamingSidecar: Buffer.from('sidecar'),
  },
};

const AUDIO = {
  audioMessage: {
    url: 'https://mmg.whatsapp.net/v/audio',
    mimetype: 'audio/ogg; codecs=opus',
    fileLength: 54321,
    seconds: 12,
    ptt: true,
    waveform: Buffer.from([1, 2, 3, 4]),
    mediaKey: Buffer.from('audiokeyaudiokeyaudiokeyaudiokey'),
    directPath: '/v/audio',
  },
};

const DOCUMENT = {
  documentMessage: {
    url: 'https://mmg.whatsapp.net/v/doc',
    mimetype: 'application/pdf',
    fileName: 'relatorio final.pdf',
    fileLength: 654321,
    pageCount: 12,
    title: 'Relatório',
    mediaKey: Buffer.from('dockeydockeydockeydockeydocke'),
    jpegThumbnail: Buffer.from([0xff, 0xd8]),
  },
};

const STICKER = {
  stickerMessage: {
    url: 'https://mmg.whatsapp.net/v/sticker',
    mimetype: 'image/webp',
    fileLength: 24680,
    height: 512,
    width: 512,
    isAnimated: true,
    isAvatar: false,
    mediaKey: Buffer.from('stickkeyxstickkeyxstickkeyxstick'),
    directPath: '/v/sticker',
  },
};

const STICKER_WITH_PACK = {
  stickerMessage: {
    url: 'https://mmg.whatsapp.net/v/sticker2',
    mimetype: 'image/webp',
    fileLength: 111,
    height: 512,
    width: 512,
    isAnimated: false,
    emoticon: '😀',
    packname: 'Meu Pack',
    author: 'Autor do pack',
  },
};

const VIEW_ONCE_IMAGE = {
  viewOnceMessage: {
    message: {
      imageMessage: {
        url: 'https://mmg.whatsapp.net/v/vo-image',
        mimetype: 'image/jpeg',
        caption: 'view once caption',
        fileLength: 111111,
        height: 1600,
        width: 1200,
        mediaKey: Buffer.from('viewonceimagekeyviewonceimageke'),
        jpegThumbnail: Buffer.from([0xff, 0xd8, 0xff]),
      },
    },
  },
};

const VIEW_ONCE_VIDEO_V2 = {
  viewOnceMessageV2: {
    message: {
      videoMessage: {
        url: 'https://mmg.whatsapp.net/v/vo-video',
        mimetype: 'video/mp4',
        fileLength: 2222222,
        seconds: 7,
        height: 1080,
        width: 1920,
        mediaKey: Buffer.from('viewoncevideokeyviewoncevideok'),
        jpegThumbnail: Buffer.from([0xff, 0xd8]),
      },
    },
  },
};

const VIEW_ONCE_V2_EXT = {
  viewOnceMessageV2Extension: {
    message: {
      audioMessage: {
        url: 'https://mmg.whatsapp.net/v/vo-audio',
        mimetype: 'audio/ogg',
        fileLength: 3333,
        seconds: 3,
        ptt: true,
        mediaKey: Buffer.from('viewonceaudiokeyviewonceaudiok'),
      },
    },
  },
};

const EPHEMERAL_VIEW_ONCE = {
  ephemeralMessage: {
    message: {
      viewOnceMessageV2: {
        message: {
          videoMessage: {
            url: 'https://mmg.whatsapp.net/v/eph-vo-video',
            mimetype: 'video/mp4',
            fileLength: 4444,
            seconds: 5,
            mediaKey: Buffer.from('ephemeralviewoncekeyephemeralv'),
          },
        },
      },
    },
  },
};

/** amount1000 = 0 como Long do protobuf (o caso que quebra JSON.stringify). */
const REQUEST_PAYMENT_ZERO = {
  requestPaymentMessage: {
    currencyCodeIso4217: 'BRL',
    amount1000: Long.fromNumber(0),
    requestFrom: QUOTED_JID,
    expiryTimestamp: Long.fromNumber(1757909999),
    noteMessage: { extendedTextMessage: { text: 'nota do pagamento' } },
    amount: { value: Long.fromNumber(0), offset: 100, currencyCode: 'BRL' },
    background: { id: 'bg-1', placeholderArgb: 1 },
  },
};

const REQUEST_PAYMENT_NONZERO = {
  requestPaymentMessage: {
    currencyCodeIso4217: 'USD',
    amount1000: Long.fromNumber(15000),
    requestFrom: ADMIN_JID,
    expiryTimestamp: Long.fromNumber(1757999999),
    noteMessage: { conversation: 'pagamento da conta' },
  },
};

const REQUEST_PAYMENT_STRING_ZERO = {
  requestPaymentMessage: {
    currencyCodeIso4217: 'BRL',
    amount1000: '0',
    requestFrom: QUOTED_JID,
    expiryTimestamp: '0',
  },
};

const SEND_PAYMENT = {
  sendPaymentMessage: {
    requestMessageKey: { remoteJid: GROUP_JID, id: 'REQKEY1', fromMe: false },
    transactionData: Buffer.from('txndata'),
    background: { id: 'bg-2' },
  },
};

const PAYMENT_INVITE = {
  paymentInviteMessage: {
    serviceType: 2,
    expiryTimestamp: Long.fromNumber(1800000000),
    incentiveEligible: true,
    referralId: 'ref-123',
  },
};

const STUB_PAYMENT = {
  protocolMessage: { type: 0, key: { id: 'OLDMSGID', remoteJid: GROUP_JID } },
};

const MENTIONS = {
  extendedTextMessage: {
    text: 'olá @5511888888888',
    contextInfo: {
      mentionedJid: [MEMBER_JID, ADMIN_JID, '222222222222222@lid'],
      stanzaId: 'X',
    },
  },
};

const GROUP_MENTIONS = {
  extendedTextMessage: {
    text: 'aviso geral',
    contextInfo: {
      groupMentions: [{ groupJid: GROUP_JID, groupSubject: 'Todos' }],
      nonJidMentions: 3,
    },
  },
};

const REACTION = {
  reactionMessage: {
    key: { remoteJid: GROUP_JID, fromMe: false, id: 'TARGETID' },
    text: '❤️',
    senderTimestampMs: Long.fromNumber(1757900000),
  },
};

const PROTOCOL_EDIT = {
  protocolMessage: {
    type: 14,
    key: { remoteJid: GROUP_JID, fromMe: false, id: 'EDITEDID' },
    editedMessage: { conversation: 'texto editado' },
    timestampMs: Long.fromNumber(1757900001),
  },
};

const PROTOCOL_REVOKE = {
  protocolMessage: {
    type: 0,
    key: { remoteJid: GROUP_JID, fromMe: false, id: 'DELETEDID' },
  },
};

const CONTACT = {
  contactMessage: {
    displayName: 'João da Silva',
    vcard: 'BEGIN:VCARD\nVERSION:3.0\nFN:João da Silva\nEND:VCARD',
  },
};

const LOCATION = {
  locationMessage: {
    degreesLatitude: -23.5505,
    degreesLongitude: -46.6333,
    name: 'São Paulo',
    address: 'Av. Paulista',
    jpegThumbnail: Buffer.from([0xff, 0xd8]),
  },
};

const LIVE_LOCATION = {
  liveLocationMessage: {
    degreesLatitude: -23.5,
    degreesLongitude: -46.6,
    accuracyInMeters: 10,
    speedInMps: 1.5,
    degreesClockwiseFromMagneticNorth: 90,
    caption: 'estou aqui',
    sequenceNumber: Long.fromNumber(1),
  },
};

const BUTTONS = {
  buttonsMessage: {
    contentText: 'escolha uma opção',
    footerText: 'rodapé',
    headerType: 1,
    buttons: [{ buttonId: 'b1', buttonText: { displayText: 'Botão 1' }, type: 1 }],
  },
};

const BUTTON_REPLY = {
  buttonsResponseMessage: {
    selectedButtonId: 'b1',
    selectedDisplayText: 'Botão 1',
    contextInfo: { stanzaId: 'BTN1', participant: QUOTED_JID },
  },
};

const LIST_RESPONSE = {
  listResponseMessage: {
    title: 'Lista',
    singleSelectReply: { selectedRowId: 'row-1' },
    contextInfo: { stanzaId: 'LIST1', participant: QUOTED_JID },
  },
};

const INTERACTIVE = {
  interactiveMessage: {
    body: { text: 'corpo interativo' },
    footer: { text: 'rodapé' },
    nativeFlowMessage: { name: 'menu', buttons: [{ name: 'quick_reply', buttonParamsJson: '{"id":"x"}' }] },
  },
};

const POLL = {
  pollCreationMessage: {
    name: 'Qual a melhor?',
    selectableOptionsCount: 1,
    options: [{ optionName: 'A' }, { optionName: 'B' }],
    contextInfo: { stanzaId: 'POLL1', participant: ADMIN_JID },
  },
};

const POLL_UPDATE = {
  pollUpdateMessage: {
    pollCreationMessageKey: { remoteJid: GROUP_JID, id: 'POLL1', fromMe: false },
    vote: { selectedOptions: [Buffer.from('hash')] },
    senderTimestampMs: Long.fromNumber(1757900002),
  },
};

const PRODUCT = {
  productMessage: {
    product: {
      title: 'Produto X',
      description: 'descrição',
      currencyCode: 'BRL',
      priceAmount1000: Long.fromNumber(5000),
      retailerId: 'ret-1',
      url: 'https://example.com/p',
    },
    businessOwnerJid: ADMIN_JID,
  },
};

const TEMPLATE = {
  templateMessage: {
    hydratedTemplate: {
      hydratedContentText: 'conteúdo do template',
      hydratedFooterText: 'rodapé do template',
    },
  },
};

const DOC_WIDTH_CAPTION = {
  documentWithCaptionMessage: {
    message: {
      documentMessage: {
        url: 'https://mmg.whatsapp.net/v/doc2',
        mimetype: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        fileName: 'contrato.docx',
        fileLength: 12345,
        caption: 'segue o contrato',
        mediaKey: Buffer.from('docwithcaptionkeydocwithcapti'),
      },
    },
  },
};

/** Tipo totalmente desconhecido — o !get deve inspecionar genericamente. */
const UNKNOWN_TYPE = {
  superNovoMessageV9: {
    campoEstranho: 'valor',
    numero: 42,
    grande: Long.fromString('9007199254740993'),
    binario: Buffer.from([1, 2, 3, 4, 5]),
    aninhado: { nivel2: { nivel3: { nivel4: { nivel5: 'fundo' } } } },
  },
};

/** Estrutura hostil: BigInt, circular, undefined, NaN, profundidade excessiva. */
function makeHostileMessage() {
  const circular = { name: 'loop' };
  circular.self = circular;
  const deep = { l1: { l2: { l3: { l4: { l5: { l6: { l7: { l8: { l9: { l10: 'muito fundo' } } } } } } } } } };  // 10 níveis

  return {
    extendedTextMessage: {
      text: 'mensagem hostil',
      contextInfo: {
        stanzaId: 'HOSTILE1',
        participant: QUOTED_JID,
        quotedMessage: { conversation: 'citada' },
        circular,
        deep,
        big: 12345678901234567890n,
        naoDefinido: undefined,
        naoNumero: NaN,
        infinito: Infinity,
        array: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35],
      },
    },
    // Campos do proto que são binários grandes
    messageContextInfo: {
      messageSecret: Buffer.alloc(32, 7),
      deviceListMetadata: { senderKeyHash: Buffer.alloc(16, 3) },
    },
  };
}

/** Mensagem com aparência de credencial — não pode vazar. */
const SECRET_LOOKING = {
  extendedTextMessage: {
    text: 'teste de redação',
    contextInfo: {
      stanzaId: 'SEC1',
      participant: QUOTED_JID,
      quotedMessage: {
        conversation: 'segredo',
        apiKey: 'APIKEY_SUPER_SECRETA_123',
        privateKey: 'PRIVATE_KEY_VALUE_XYZ',
        token: 'BEARER_TOKEN_ABC',
      },
    },
  },
};

// ============================================================================
// TESTES DO SERIALIZADOR (unidade)
// ============================================================================

const inspector = await import(new URL('../dados/src/utils/messageInspector.js', import.meta.url).href);

await test('serializador: BigInt não quebra e é marcado', () => {
  const out = inspector.safeJsonStringify({ big: 123n });
  includes(out, '"123n"', 'BigInt serializado');
});

await test('serializador: Buffer vira resumo com tamanho/sha', () => {
  const out = inspector.safeJsonStringify({ buf: Buffer.from([1, 2, 3]) });
  includes(out, '"__binary": true', 'flag binária');
  includes(out, '"bytes": 3', 'tamanho');
  includes(out, 'sha256', 'hash');
});

await test('serializador: referência circular não estoura', () => {
  const a = { n: 1 };
  a.self = a;
  const out = inspector.safeJsonStringify(a);
  includes(out, '[referência circular]');
});

await test('serializador: Long do protobuf vira string', () => {
  const out = inspector.safeJsonStringify({ v: Long.fromNumber(1757900000) });
  includes(out, '"1757900000"');
});

await test('serializador: redige campos sensíveis', () => {
  const out = inspector.safeJsonStringify({
    apiKey: 'SEGREDO_TOTAL',
    token: 'TOKEN_TOTAL',
    sessionKey: 'SESSION_TOTAL',
    password: 'SENHA_TOTAL',
    innocuous: 'pode aparecer',
  });
  notIncludes(out, 'SEGREDO_TOTAL', 'apiKey');
  notIncludes(out, 'TOKEN_TOTAL', 'token');
  notIncludes(out, 'SESSION_TOTAL', 'sessionKey');
  notIncludes(out, 'SENHA_TOTAL', 'password');
  includes(out, 'pode aparecer');
  includes(out, '[REDACTED');
});

await test('serializador: undefined/NaN/Infinity tratados', () => {
  const out = inspector.safeJsonStringify({ u: undefined, n: NaN, i: Infinity, ni: -Infinity });
  includes(out, '"NaN"');
  includes(out, '"Infinity"');
  includes(out, '"-Infinity"');
});

await test('serializador: profundidade excessiva é cortada', () => {
  let deep = { fim: 'aqui' };
  for (let i = 0; i < 30; i++) deep = { nivel: deep };
  const out = inspector.safeJsonStringify(deep);
  includes(out, '[profundidade máxima atingida]');
});

await test('classifyAmount: distingue zero de ausente', () => {
  ok(inspector.classifyAmount(undefined, false).estado.includes('ausente'), 'undefined+ausente');
  ok(inspector.classifyAmount(null, true).estado.includes('null'), 'null');
  ok(inspector.classifyAmount(0, true).estado.includes('"0"'), 'number 0');
  ok(inspector.classifyAmount(Long.fromNumber(0), true).estado.includes('"0"'), 'Long 0');
  ok(inspector.classifyAmount('0', true).estado.includes('"0"'), 'string "0"');
  ok(inspector.classifyAmount(0n, true).estado.includes('"0"'), 'BigInt 0n');
  ok(inspector.classifyAmount(15000, true).estado.includes('diferente'), 'number 15000');
  ok(inspector.classifyAmount('0.5', true).estado.includes('diferente'), 'string 0.5');
});

await test('resolveTypeChain: viewOnce -> imagem', () => {
  const r = inspector.resolveTypeChain(VIEW_ONCE_IMAGE);
  ok(r.chain[0] === 'viewOnceMessage', 'primeiro elo');
  ok(r.innerType === 'imageMessage', 'tipo interno');
});

await test('resolveTypeChain: ephemeral -> viewOnceV2 -> video', () => {
  const r = inspector.resolveTypeChain(EPHEMERAL_VIEW_ONCE);
  ok(r.chain.join(' -> ') === 'ephemeralMessage -> viewOnceMessageV2 -> videoMessage', `cadeia = ${r.chain.join(' -> ')}`);
});

// ============================================================================
// TESTES DE INTEGRAÇÃO — handler real
// ============================================================================

await test('1. texto normal (admin, citação de texto)', async () => {
  const cmd = makeGetCommand({ quotedMessage: TEXT });
  const { replyText } = await runGet({ message: cmd.message, key: cmd.key });
  includes(replyText, 'GET MESSAGE');
  includes(replyText, 'conversation');
  includes(replyText, 'mensagem simples de texto');
});

await test('1b. !get sem citação é recusado com instrução (comportamento preservado)', async () => {
  const { replyText, sent } = await runGet({
    message: { conversation: '!get' },
    key: { participant: ADMIN_LID },
  });
  ok(sent.length === 1, 'uma mensagem enviada');
  includes(replyText, 'Marque uma mensagem');
});

await test('1c. contexto sem quotedMessage cai na própria mensagem (fonte self)', async () => {
  // Alguns eventos trazem contextInfo (participant/stanzaId) sem quotedMessage.
  const { replyText, sent } = await runGet({
    message: {
      extendedTextMessage: {
        text: '!get',
        contextInfo: { stanzaId: 'SEM-QUOTE', participant: QUOTED_JID, remoteJid: GROUP_JID },
      },
    },
    key: { participant: ADMIN_LID },
  });
  ok(sent.length === 1, 'uma mensagem enviada');
  includes(replyText, 'GET MESSAGE');
  includes(replyText, 'a própria mensagem do comando', 'fonte = self');
});

await test('2. imagem citada', async () => {
  const cmd = makeGetCommand({ quotedMessage: IMAGE });
  const { replyText, sent } = await runGet({ message: cmd.message, key: cmd.key });
  console.log('DEBUG teste2 sent=' + sent.length + ' len=' + replyText.length);
  console.log('DEBUG teste2 primeiros 200: ' + replyText.slice(0, 200));
  includes(replyText, 'imageMessage');
  includes(replyText, 'MEDIA');
  includes(replyText, 'image/jpeg');
  includes(replyText, '1920');
  includes(replyText, 'legenda da imagem');
  includes(replyText, 'mediaKey');
});

await test('3. vídeo citado', async () => {
  const cmd = makeGetCommand({ quotedMessage: VIDEO });
  const { replyText } = await runGet({ message: cmd.message, key: cmd.key });
  includes(replyText, 'videoMessage');
  includes(replyText, 'clip.mp4');
  includes(replyText, 'video/mp4');
  includes(replyText, '42');
});

await test('4. áudio citado', async () => {
  const cmd = makeGetCommand({ quotedMessage: AUDIO });
  const { replyText } = await runGet({ message: cmd.message, key: cmd.key });
  includes(replyText, 'audioMessage');
  includes(replyText, 'audio/ogg');
  includes(replyText, 'PTT (voz)');
});

await test('5. documento citado', async () => {
  const cmd = makeGetCommand({ quotedMessage: DOCUMENT });
  const { replyText } = await runGet({ message: cmd.message, key: cmd.key });
  includes(replyText, 'documentMessage');
  includes(replyText, 'relatorio final.pdf');
  includes(replyText, 'application/pdf');
});

await test('6. sticker citado + sticker com pack/author', async () => {
  const cmd = makeGetCommand({ quotedMessage: STICKER });
  const { replyText } = await runGet({ message: cmd.message, key: cmd.key });
  includes(replyText, 'stickerMessage');
  includes(replyText, 'image/webp');
  includes(replyText, 'Animado');

  const cmd2 = makeGetCommand({ quotedMessage: STICKER_WITH_PACK });
  const { replyText: reply2 } = await runGet({ message: cmd2.message, key: cmd2.key });
  includes(reply2, 'Meu Pack');
  includes(reply2, 'Autor do pack');
});

await test('7. ViewOnce (V1 imagem)', async () => {
  const cmd = makeGetCommand({ quotedMessage: VIEW_ONCE_IMAGE });
  const { replyText } = await runGet({ message: cmd.message, key: cmd.key });
  includes(replyText, 'VIEW ONCE');
  includes(replyText, 'É ViewOnce: Sim');
  includes(replyText, 'Versão: viewOnceMessage');
  includes(replyText, 'viewOnceMessage -> imageMessage');
});

await test('8. ViewOnce V2 de imagem', async () => {
  const cmd = makeGetCommand({ quotedMessage: { viewOnceMessageV2: { message: { imageMessage: IMAGE.imageMessage } } } });
  const { replyText } = await runGet({ message: cmd.message, key: cmd.key });
  includes(replyText, 'VIEW ONCE');
  includes(replyText, 'viewOnceMessageV2 -> imageMessage');
});

await test('9. ViewOnce V2 de vídeo e ViewOnce V2 Extension', async () => {
  const cmd = makeGetCommand({ quotedMessage: VIEW_ONCE_VIDEO_V2 });
  const { replyText } = await runGet({ message: cmd.message, key: cmd.key });
  includes(replyText, 'viewOnceMessageV2 -> videoMessage');
  includes(replyText, 'Thumbnail interna: Sim');

  const cmd2 = makeGetCommand({ quotedMessage: VIEW_ONCE_V2_EXT });
  const { replyText: reply2 } = await runGet({ message: cmd2.message, key: cmd2.key });
  includes(reply2, 'viewOnceMessageV2Extension -> audioMessage');
});

await test('10. mensagem respondida (contexto + citação)', async () => {
  const cmd = makeGetCommand({ quotedMessage: TEXT, quotedStanzaId: 'QUOTED-TEXT-1' });
  const { replyText } = await runGet({ message: cmd.message, key: cmd.key });
  includes(replyText, 'CONTEXT');
  includes(replyText, 'QUOTED-TEXT-1');
  includes(replyText, 'conversation');
  includes(replyText, 'mensagem simples de texto');
});

await test('11. mensagem com menções (JID + LID)', async () => {
  const cmd = makeGetCommand({ quotedMessage: MENTIONS });
  const { replyText } = await runGet({ message: cmd.message, key: cmd.key });
  includes(replyText, 'MENTIONS');
  includes(replyText, MEMBER_JID);
  includes(replyText, 'LID');
  includes(replyText, '3 item(ns)');
});

await test('11b. groupMentions + nonJidMentions', async () => {
  const cmd = makeGetCommand({ quotedMessage: GROUP_MENTIONS });
  const { replyText } = await runGet({ message: cmd.message, key: cmd.key });
  includes(replyText, 'groupMentions');
  includes(replyText, 'nonJidMentions');
});

await test('12. mensagem em grupo (participant/admins/metadados)', async () => {
  const cmd = makeGetCommand({ quotedMessage: TEXT });
  const { replyText, groupJid } = await runGet({ message: cmd.message, key: cmd.key });
  includes(replyText, groupJid, 'JID do grupo');
  includes(replyText, 'Grupo Teste');
  includes(replyText, 'Cargo do autor no grupo: Administrador');
  includes(replyText, 'Total de membros: 4');
  includes(replyText, 'É grupo: Sim');
  includes(replyText, 'Tipo de chat: Grupo');
});

await test('13. payment (paymentInviteMessage)', async () => {
  const cmd = makeGetCommand({ quotedMessage: PAYMENT_INVITE });
  const { replyText } = await runGet({ message: cmd.message, key: cmd.key });
  includes(replyText, 'PAYMENT');
  includes(replyText, 'paymentInviteMessage');
  includes(replyText, 'referralId');
  includes(replyText, '1800000000');
});

await test('13b. payment (sendPaymentMessage com Buffer em transactionData)', async () => {
  const cmd = makeGetCommand({ quotedMessage: SEND_PAYMENT });
  const { replyText } = await runGet({ message: cmd.message, key: cmd.key });
  includes(replyText, 'PAYMENT');
  includes(replyText, 'sendPaymentMessage');
  includes(replyText, 'REQKEY1');
});

await test('14. request payment (com valor != 0)', async () => {
  const cmd = makeGetCommand({ quotedMessage: REQUEST_PAYMENT_NONZERO });
  const { replyText } = await runGet({ message: cmd.message, key: cmd.key });
  includes(replyText, 'Tipo: Request Payment');
  includes(replyText, 'requestPaymentMessage');
  includes(replyText, 'requestFrom');
  includes(replyText, '15000');
  includes(replyText, 'USD');
  includes(replyText, 'expiryTimestamp');
});

await test('15. request payment com amount "0" (Long) — detecção explícita', async () => {
  const cmd = makeGetCommand({ quotedMessage: REQUEST_PAYMENT_ZERO });
  const { replyText } = await runGet({ message: cmd.message, key: cmd.key });
  includes(replyText, 'Tipo: Request Payment');
  includes(replyText, 'ANÁLISE DE VALOR');
  includes(replyText, 'presente com valor "0"', 'amount1000 = Long 0');
  includes(replyText, 'amount.value', 'campo amount.value');
  includes(replyText, 'amount.offset', 'offset preservado (100)');
});

await test('15b. request payment com amount "0" (string) e expiry "0"', async () => {
  const cmd = makeGetCommand({ quotedMessage: REQUEST_PAYMENT_STRING_ZERO });
  const { replyText } = await runGet({ message: cmd.message, key: cmd.key });
  includes(replyText, 'presente com valor "0"');
});

await test('16. mensagens encaminhadas (isForwarded/forwardingScore)', async () => {
  const cmd = makeGetCommand({ quotedMessage: EXTENDED });
  const { replyText } = await runGet({ message: cmd.message, key: cmd.key });
  includes(replyText, 'encaminhada');
  includes(replyText, 'forwardingScore');
  includes(replyText, 'isForwarded');
  includes(replyText, 'Mensagem encaminhada (isForwarded=true', 'seção MENSAGENS ESPECIAIS');
});

await test('17. mensagens especiais (reação, poll, voto, contato, local, botões, lista, interactive, template)', async () => {
  const cases = [
    [REACTION, 'Reação'],
    [POLL, 'Enquete'],
    [POLL_UPDATE, 'Voto de enquete'],
    [CONTACT, 'Contato'],
    [LOCATION, 'Localização'],
    [LIVE_LOCATION, 'Localização'],
    [BUTTONS, 'botões'],
    [BUTTON_REPLY, 'botões'],
    [LIST_RESPONSE, 'lista'],
    [INTERACTIVE, 'interativa'],
    [TEMPLATE, 'Template'],
    [DOC_WIDTH_CAPTION, 'DOCUMENTO'],
  ];
  for (const [quoted, expected] of cases) {
    const cmd = makeGetCommand({ quotedMessage: quoted });
    const { replyText } = await runGet({ message: cmd.message, key: cmd.key });
    includes(replyText, expected, `tipo especial: ${expected}`);
  }
});

await test('18. protocolMessage (edição e revogação)', async () => {
  const edit = makeGetCommand({ quotedMessage: PROTOCOL_EDIT });
  const { replyText } = await runGet({ message: edit.message, key: edit.key });
  includes(replyText, 'ProtocolMessage');
  includes(replyText, 'MESSAGE_EDIT', 'tipo 14 traduzido');
  includes(replyText, 'texto editado');

  const revoke = makeGetCommand({ quotedMessage: PROTOCOL_REVOKE });
  const { replyText: r2 } = await runGet({ message: revoke.message, key: revoke.key });
  includes(r2, 'REVOKE', 'tipo 0 traduzido');
});

await test('19. tipo totalmente desconhecido é inspecionado genericamente', async () => {
  const cmd = makeGetCommand({ quotedMessage: UNKNOWN_TYPE });
  const { replyText } = await runGet({ message: cmd.message, key: cmd.key });
  includes(replyText, 'superNovoMessageV9');
  includes(replyText, 'campoEstranho');
  includes(replyText, 'valor');
  includes(replyText, '9007199254740993', 'Long grande preservado como string');
  ok(!/Tipo desconhecido/i.test(replyText), 'não deve rotular como "tipo desconhecido"');
});

await test('20. estrutura hostil (BigInt/Buffer/circular/NaN/deep) não quebra', async () => {
  const cmd = makeGetCommand({ quotedMessage: makeHostileMessage() });
  const { replyText } = await runGet({ message: cmd.message, key: cmd.key });
  includes(replyText, 'GET MESSAGE');
  includes(replyText, 'mensagem hostil');
  includes(replyText, 'referência circular');
  includes(replyText, '"NaN"');
  includes(replyText, '12345678901234567890n', 'BigInt textual');
  includes(replyText, '__binary', 'Buffer resumido');
});

await test('21. secretos não vazam no relatório', async () => {
  const cmd = makeGetCommand({ quotedMessage: SECRET_LOOKING });
  const { replyText } = await runGet({ message: cmd.message, key: cmd.key });
  notIncludes(replyText, 'APIKEY_SUPER_SECRETA_123', 'apiKey');
  notIncludes(replyText, 'PRIVATE_KEY_VALUE_XYZ', 'privateKey');
  notIncludes(replyText, 'BEARER_TOKEN_ABC', 'token');
  includes(replyText, 'REDACTED');
});

await test('22. sem citação e sem menção → pede para marcar mensagem', async () => {
  const { replyText, sent } = await runGet({ message: { conversation: '!get' } });
  includes(replyText, 'Marque uma mensagem');
  ok(sent.length === 1, 'apenas uma mensagem enviada');
});

await test('23. não-admin é bloqueado (permissão preservada)', async () => {
  const sent = [];
  const nazu = makeNazu({ sent });
  const messagesCache = new Map();
  // Sender é membro comum (não admin): o grupo tem MEMBER_LID sem admin.
  const info = makeInfo({
    message: { conversation: '!get' },
    key: { participant: '444444444444444@lid' },
  });
  await handleMessage(nazu, info, null, messagesCache, null);
  const text = sent.map((s) => s.content?.text).filter(Boolean).join('\n');
  includes(text, 'Comando restrito');
});

await test('24. reaproveita a mensagem original completa do messagesCache', async () => {
  const cachedKey = `${GROUP_JID}_CACHED-MSG-1`;
  const cachedMessage = {
    key: { remoteJid: GROUP_JID, fromMe: false, id: 'CACHED-MSG-1', participant: MEMBER_LID },
    message: {
      imageMessage: {
        url: 'https://mmg.whatsapp.net/v/cached',
        mimetype: 'image/png',
        fileLength: 999,
        mediaKey: Buffer.from('cachedkeycachedkeycachedkeyca'),
        directPath: '/v/cached-direct-path',
        height: 100,
        width: 200,
      },
    },
    messageTimestamp: 1757000000,
    pushName: 'DonoDaImagem',
    status: 4,
    verifiedBizName: 'Loja Verificada',
  };

  const cmd = makeGetCommand({
    quotedMessage: { imageMessage: { mimetype: 'image/png' } }, // resumo pobre do contextInfo
    quotedStanzaId: 'CACHED-MSG-1',
  });

  const { replyText } = await runGet({
    message: cmd.message,
    key: cmd.key,
    messagesCacheEntries: [[cachedKey, cachedMessage]],
  });

  includes(replyText, 'cache interno (mensagem original completa)', 'origem dos dados');
  includes(replyText, '/v/cached-direct-path', 'directPath vindo do cache');
  includes(replyText, 'DonoDaImagem', 'pushName vindo do cache');
  includes(replyText, 'Loja Verificada', 'verifiedBizName vindo do cache');
  includes(replyText, 'READ', 'status 4 traduzido');
});

await test('25. uma única mensagem visível, sem prefixo que colapse a prévia', async () => {
  const cmd = makeGetCommand({ quotedMessage: IMAGE });
  const { sent } = await runGet({ message: cmd.message, key: cmd.key });
  ok(sent.length === 1, `deveria enviar 1 mensagem, enviou ${sent.length}`);
  const content = sent[0].content?.text || '';
  // O !get NÃO usa o invisível do "ler mais": ele colapsaria a mensagem na
  // prévia e esconderia os dados. O relatório começa visível.
  ok(!content.startsWith('\u200e'), 'sem prefixo invisível de "ler mais"');
  ok(content.startsWith('🔎'), 'começa direto no resumo visível');
  includes(content, 'GET MESSAGE');
  includes(content, 'RAW MESSAGE');
  includes(content, 'IDENTIDADE');
  includes(content, 'MEDIA');
  // O reply do bot sempre marca as respostas como encaminhadas (comportamento
  // preexistente); o importante aqui é não gerar mensagens duplicadas.
  ok(sent.length === 1, 'nenhuma mensagem extra foi enviada');
});

await test('26. identidade JID x LID separadas e marcadas', async () => {
  const cmd = makeGetCommand({ quotedMessage: TEXT });
  const { replyText, sender } = await runGet({ message: cmd.message, key: cmd.key });
  includes(replyText, 'JID (número) x LID (identificador interno)');
  includes(replyText, 'JID do remetente');
  includes(replyText, 'LID do remetente');
  // O remetente é o admin único gerado por runGet(); o LID correspondente é
  // derivado pelo mesmo esquema do onWhatsApp fake.
  const expectedLid = `9990000000000${sender.match(/(\d{3})@/)[1]}@lid`;
  includes(replyText, `LID do remetente: ${expectedLid}`, 'LID do remetente resolvido via PN');
  includes(replyText, `JID do remetente: ${sender}`, 'JID do remetente');
  includes(replyText, QUOTED_JID, 'JID do autor citado');
  includes(replyText, sender, 'JID de quem chamou o comando');
  includes(replyText, 'participantAlt');
  includes(replyText, 'addressingMode');
  includes(replyText, 'senderPn');
  includes(replyText, 'senderLid');
  includes(replyText, '<campo inexistente nesta versão do Baileys>', 'campo ausente é declarado, não ocultado');
});

await test('27. stub type traduzido (WebMessageInfo)', async () => {
  const cmd = makeGetCommand({ quotedMessage: TEXT });
  const { replyText } = await runGet({
    message: cmd.message,
    key: cmd.key,
    messageStubType: 172,
    messageStubParameters: ['param1'],
  });
  includes(replyText, 'StubType');
  includes(replyText, '172');
  includes(replyText, 'GROUP_MEMBERSHIP_JOIN_APPROVAL_REQUEST_NON_ADMIN_ADD');
  includes(replyText, 'StubParameters');
});

await test('28. objetos de pagamento no WebMessageInfo (paymentInfo)', async () => {
  const cmd = makeGetCommand({ quotedMessage: TEXT });
  const { replyText } = await runGet({
    message: cmd.message,
    key: cmd.key,
    paymentInfo: {
      currency: 'BRL',
      amount1000: Long.fromNumber(0),
      receiverJid: ADMIN_JID,
      status: 4,
      transactionTimestamp: Long.fromNumber(1757900000),
      expiryTimestamp: Long.fromNumber(0),
      primaryAmount: { value: Long.fromNumber(0), offset: 100, currencyCode: 'BRL' },
    },
  });
  includes(replyText, 'paymentInfo');
  includes(replyText, 'amount1000');
  includes(replyText, 'presente com valor "0"');
});

await test('29. relatório enorme é DIVIDIDO em várias mensagens (nada vai pro terminal)', async () => {
  const filler = 'X'.repeat(500);
  const bigQuoted = {
    imageMessage: {
      ...IMAGE.imageMessage,
      // Muitos campos extras com strings longas para inflar o RAW
      ...Object.fromEntries(Array.from({ length: 400 }, (_, i) => [`campoExtra${i}`, filler])),
    },
  };
  const cmd = makeGetCommand({ quotedMessage: bigQuoted });
  const { sent } = await runGet({ message: cmd.message, key: cmd.key });

  ok(sent.length > 1, `deveria dividir em mais de uma mensagem, enviou ${sent.length}`);
  const texts = sent.map((s) => s.content?.text || '');
  // Cada parte precisa caber no limite do WhatsApp (medido em bytes).
  for (const [i, text] of texts.entries()) {
    ok(Buffer.byteLength(text, 'utf8') <= 56000, `parte ${i + 1} dentro do limite de bytes`);
  }
  // Nada é jogado fora: reconcatena as partes e confere que o relatório
  // continua íntegro de ponta a ponta.
  const joined = texts.join('\n');
  includes(joined, 'GET MESSAGE');
  includes(joined, 'CAMPOS DO PROTO');
  includes(joined, 'RAW MESSAGE');
  includes(joined, 'campoExtra0', 'primeiro campo extra presente');
  includes(joined, 'campoExtra399', 'ÚLTIMO campo extra presente (nada truncado)');
  notIncludes(joined, 'relatorio truncado', 'não há mais aviso de truncamento');
  notIncludes(joined, 'impresso no console', 'não manda mais o usuário para o console');
  includes(joined, `(1/${texts.length})`, 'numeração de partes');
});

await test('29b. acentos/emojis não corrompem o corte por bytes', async () => {
  const acentuado = 'áàâãéêíóôõúüçÁÀÂÃÉÊÍÓÔÕÚÜÇção çãõ '.repeat(200);
  const bigQuoted = { extendedTextMessage: { text: acentuado, contextInfo: { stanzaId: 'X' } } };
  const cmd = makeGetCommand({ quotedMessage: bigQuoted });
  const { sent } = await runGet({ message: cmd.message, key: cmd.key });
  const joined = sent.map((s) => s.content?.text || '').join('\n');
  for (const [i, part] of sent.entries()) {
    ok(Buffer.byteLength(part.content?.text || '', 'utf8') <= 56000, `parte ${i + 1} dentro do limite`);
  }
  // '\uFFFD' indica caractere quebrado no meio (corte no lugar errado).
  notIncludes(joined, '\uFFFD', 'nenhum caractere corrompido no corte');
  includes(joined, 'ç', 'acentos preservados');
});

await test('29c. splitTextForWhatsApp não perde nem corrompe conteúdo', () => {
  const { splitTextForWhatsApp } = inspector;

  const linhas = Array.from({ length: 3000 }, (_, i) => `${String(i).padStart(5, '0')} ${'a'.repeat(94)}`);
  const original = linhas.join('\n');
  const partes = splitTextForWhatsApp(original, 10000);
  ok(partes.length > 1, 'dividiu em várias partes');
  ok(partes.every((p) => Buffer.byteLength(p, 'utf8') <= 10000), 'todas as partes dentro do limite');
  ok(partes.join('\n') === original, 'conteúdo idêntico após dividir e reconcatenar');

  const multibyte = Array.from({ length: 3000 }, (_, i) => `çãõ ${i} 😀🎉 ${'é'.repeat(40)}`).join('\n');
  const partesMb = splitTextForWhatsApp(multibyte, 5000);
  ok(partesMb.every((p) => Buffer.byteLength(p, 'utf8') <= 5000), 'partes multibyte dentro do limite');
  ok(partesMb.join('\n') === multibyte, 'conteúdo multibyte idêntico');
  ok(!partesMb.join('').includes('\uFFFD'), 'nenhum caractere quebrado');

  const linhaGigante = 'á'.repeat(40000);
  const partesLinha = splitTextForWhatsApp(linhaGigante, 1000);
  ok(partesLinha.every((p) => Buffer.byteLength(p, 'utf8') <= 1000), 'linha gigante fatiada dentro do limite');
  ok(partesLinha.join('') === linhaGigante, 'linha gigante idêntica');
});

await test('30. processamento concorrente do !get não interfere entre si', async () => {
  const cases = [IMAGE, VIDEO, AUDIO, DOCUMENT, STICKER, VIEW_ONCE_IMAGE, REQUEST_PAYMENT_ZERO, UNKNOWN_TYPE];
  const runs = cases.map((quoted) => {
    const cmd = makeGetCommand({ quotedMessage: quoted });
    return runGet({ message: cmd.message, key: cmd.key });
  });
  const all = await Promise.all(runs);
  ok(all.length === cases.length, 'todos os relatórios gerados');
  for (const r of all) {
    includes(r.replyText, 'GET MESSAGE');
    ok(r.sent.length === 1, 'uma mensagem por execução');
  }
});

await test('31. handler continua responsivo após muitos relatórios', async () => {
  for (let i = 0; i < 15; i++) {
    const cmd = makeGetCommand({ quotedMessage: i % 2 ? IMAGE : VIEW_ONCE_VIDEO_V2 });
    const { replyText } = await runGet({ message: cmd.message, key: cmd.key });
    includes(replyText, 'GET MESSAGE');
  }
});

await test('32. throttle de comandos do bot continua ativo (regressão)', async () => {
  // O throttle é 3 comandos / 5s por sender. Usa um admin DEDICADO (não
  // reutilizado em nenhum outro teste) para que a contagem seja determinística.
  const throttleJid = '5511000099999@s.whatsapp.net';
  const throttleLid = '111000009999999@lid';
  const groupJid = '120363999999999999@g.us';

  const replies = [];
  for (let i = 0; i < 4; i++) {
    const sent = [];
    const nazu = makeNazu({
      sent,
      groupJid,
      groupParticipants: [{ id: throttleLid, admin: 'admin', phoneNumber: throttleJid }],
    });
    // onWhatsApp fake precisa mapear este PN para o LID dedicado.
    nazu.onWhatsApp = async () => [{ jid: throttleJid, exists: true, lid: throttleLid }];
    const info = makeInfo({
      key: { remoteJid: groupJid, participant: throttleJid },
      message: makeGetCommand({ quotedMessage: TEXT }).message,
    });
    await handleMessage(nazu, info, null, new Map(), null);
    replies.push(sent.map((s) => s.content?.text).filter(Boolean).join('\n'));
  }

  ok(replies.slice(0, 3).every((r) => r.includes('GET MESSAGE')), '3 primeiros comandos processados');
  includes(replies[3], 'Calma aí', '4º comando bloqueado pelo throttle (comportamento preservado)');
});

await test('33. round-trip real do protobuf (encode/decode) é inspecionado', async () => {
  // Constrói mensagens com o PRÓPRIO proto do Baileys: é o formato que chega
  // em produção, com Long em int64 e Buffer em bytes.
  const build = (obj) => proto.Message.decode(proto.Message.encode(proto.Message.create(obj)).finish());

  const realImage = build({
    imageMessage: {
      url: 'https://mmg.whatsapp.net/v/t62/real',
      mimetype: 'image/jpeg',
      caption: 'imagem real',
      fileLength: 4242,
      height: 800,
      width: 600,
      mediaKey: Buffer.alloc(32, 9),
      fileSha256: Buffer.alloc(32, 4),
      jpegThumbnail: Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
      mediaKeyTimestamp: 1757900000,
    },
  });

  const realVo = build({
    viewOnceMessageV2: { message: { videoMessage: { url: 'https://mmg.whatsapp.net/v/vo', mimetype: 'video/mp4', fileLength: 1000, seconds: 6, mediaKey: Buffer.alloc(32, 1), jpegThumbnail: Buffer.from([0xff, 0xd8]) } } },
  });

  const realReqPay = build({
    requestPaymentMessage: {
      currencyCodeIso4217: 'BRL',
      amount1000: 0,
      requestFrom: QUOTED_JID,
      expiryTimestamp: 1800000000,
      noteMessage: { conversation: 'nota real' },
      amount: { value: 0, offset: 100, currencyCode: 'BRL' },
    },
  });

  for (const [label, msg, expectations] of [
    ['imagem real', realImage, ['imageMessage', 'image/jpeg', '4242', 'imagem real']],
    ['viewOnce real', realVo, ['VIEW ONCE', 'viewOnceMessageV2 -> videoMessage']],
    ['request payment real', realReqPay, ['Tipo: Request Payment', 'presente com valor "0"']],
  ]) {
    const cmd = makeGetCommand({ quotedMessage: msg });
    const { replyText } = await runGet({ message: cmd.message, key: cmd.key });
    for (const expected of expectations) includes(replyText, expected, `${label}: ${expected}`);
  }
});

await test('34. ViewOnce em grupo mostra participant e chat corretos', async () => {
  const cmd = makeGetCommand({ quotedMessage: VIEW_ONCE_VIDEO_V2, quotedParticipant: MEMBER_JID });
  const { replyText, groupJid } = await runGet({ message: cmd.message, key: cmd.key });
  includes(replyText, 'É ViewOnce: Sim');
  includes(replyText, groupJid, 'chat do alvo');
  includes(replyText, MEMBER_JID, 'participant do alvo');
  includes(replyText, 'participantAlt');
});

await test('35. mensagem própria do bot (fromMe) é identificada', async () => {
  const cmd = makeGetCommand({ quotedMessage: TEXT });
  const { replyText } = await runGet({
    message: cmd.message,
    key: { ...cmd.key, fromMe: true },
  });
  // O alvo é a mensagem citada (sem key próprio), então "fromMe" não existe
  // nela — o relatório declara isso em vez de inventar um valor.
  includes(replyText, 'FromMe: não fornecido (desconhecido para mensagens citadas)');
  // Já o envelope do comando informa fromMe e a origem do bot.
  includes(replyText, 'fromMe do comando: true');
  includes(replyText, 'Enviada pelo próprio bot (comando): Sim');
  // isBotSender é resolvido pelo handler comparando com o JID do próprio bot;
  // aqui o sender é um admin do grupo, então a origem é "terceiro".
  includes(replyText, 'Origem do bot (comando): terceiro');
});

await test('36. relatório inclui todas as seções obrigatórias', async () => {
  const cmd = makeGetCommand({
    quotedMessage: {
      viewOnceMessage: { message: { imageMessage: { ...IMAGE.imageMessage, caption: 'vo' } } },
    },
  });
  const { replyText } = await runGet({ message: cmd.message, key: cmd.key });
  for (const section of ['GET MESSAGE', 'IDENTIFICAÇÃO', 'IDENTIDADE', 'CHAT', 'CONTEÚDO', 'VIEW ONCE', 'MENTIONS', 'CONTEXT', 'MEDIA', 'CAMPOS DO PROTO', 'RAW MESSAGE']) {
    includes(replyText, section, `seção ${section}`);
  }
});

await test('37. conteúdo do próprio proto é listado na seção CONTEÚDO', async () => {
  const real = proto.Message.decode(proto.Message.encode(proto.Message.create({
    stickerMessage: { url: 'https://mmg.whatsapp.net/v/s', mimetype: 'image/webp', fileLength: 777, height: 512, width: 512, isAnimated: true, mediaKey: Buffer.alloc(32, 2) },
  })).finish());
  const cmd = makeGetCommand({ quotedMessage: real });
  const { replyText } = await runGet({ message: cmd.message, key: cmd.key });
  includes(replyText, 'Tipo do conteúdo: stickerMessage');
  includes(replyText, 'image/webp');
  includes(replyText, 'Animado');
});

// ============================================================================
// RELATÓRIO FINAL
// ============================================================================

// Remove o banco temporário criado por este teste.
fs.rmSync(TMP_DB, { recursive: true, force: true });

const totalPassed = RESULTS.reduce((acc, r) => acc + r.passed, 0);
const totalFailed = RESULTS.reduce((acc, r) => acc + r.failed, 0);

console.log('\n════════════════════════════════════════');
console.log(`RESULTADO: ${RESULTS.length} testes | ${totalPassed} asserções ok | ${totalFailed} falhas`);
console.log('════════════════════════════════════════');

if (totalFailed > 0) {
  console.log('\nFALHAS:');
  for (const r of RESULTS) {
    if (r.failed) for (const e of r.errors) console.log(`- [${r.name}] ${e}`);
  }
  process.exit(1);
}
console.log('✅ TODOS OS TESTES PASSARAM');
process.exit(0);
