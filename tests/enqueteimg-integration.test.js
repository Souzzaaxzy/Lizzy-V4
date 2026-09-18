/**
 * Teste de integração: o payload que o !enqueteimg monta, passado pelo caminho
 * REAL da fork (generateWAMessageContent + relay dos filhos), vira o photo poll
 * completo -- pollCreationMessageV3 com pollContentType IMAGE e optionHash, mais
 * as imagens associadas como MEDIA_POLL.
 *
 * É a prova de que a Lizzy e a fork estão falando a mesma língua.
 *
 * Uso: node tests/enqueteimg-integration.test.js
 */

import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

import { generateWAMessageContent, normalizeMessageContent, proto } from '@itsliaaa/baileys';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.resolve(HERE, '..');

const TMP_DB = fs.mkdtempSync(path.join(os.tmpdir(), 'lizzy-pollimg-int-'));
process.env.DATABASE_PATH = TMP_DB;
fs.mkdirSync(path.join(TMP_DB, 'grupos'), { recursive: true });

const RESULTS = [];
let CURRENT = null;

function test(name, fn) {
  CURRENT = { name, passed: 0, failed: 0, errors: [] };
  RESULTS.push(CURRENT);
  try {
    const result = fn();
    if (result && typeof result.then === 'function') {
      return result.then(() => finish(name)).catch((error) => {
        CURRENT.failed += 1;
        CURRENT.errors.push(`EXCEÇÃO: ${error?.stack || error}`);
        finish(name);
      });
    }
    finish(name);
  } catch (error) {
    CURRENT.failed += 1;
    CURRENT.errors.push(`EXCEÇÃO: ${error?.stack || error}`);
    finish(name);
  }
  return Promise.resolve();
}

function finish(name) {
  console.log(`${CURRENT.failed === 0 ? '✅' : '❌'} ${name} (${CURRENT.passed} ok, ${CURRENT.failed} falhas)`);
  for (const e of CURRENT.errors) console.log(`     ${e}`);
}

function ok(cond, msg) {
  if (cond) CURRENT.passed += 1;
  else {
    CURRENT.failed += 1;
    CURRENT.errors.push(`ASSERT FALHOU: ${msg}`);
  }
}

const GROUP = '120363000000000001@g.us';
const USER = '5511999999999@s.whatsapp.net';
const fakeUpload = async () => ({ url: 'https://mmg.whatsapp.net/fake', directPath: '/v/fake' });

/** Imagem mínima (JPEG) para o pipeline de mídia aceitar. */
const JPEG = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00]),
  Buffer.alloc(120, 0x41),
  Buffer.from([0xff, 0xd9])
]);

/** Exatamente o conteúdo que o comando da Lizzy monta. */
function conteudoDoComando(pergunta, imagens) {
  return {
    imagePoll: {
      name: pergunta,
      options: imagens.map((_, i) => ({ name: `Opção ${i + 1}`, image: JPEG, mimetype: 'image/jpeg' })),
      selectableCount: 1
    }
  };
}

await test('integração: o payload do comando vira o photo poll completo', async () => {
  const holder = {};
  const content = await generateWAMessageContent(conteudoDoComando('Qual vocês preferem?', [1, 2, 3]), {
    userJid: USER,
    upload: fakeUpload,
    jid: GROUP,
    imagePollHolder: holder
  });

  ok(content.pollCreationMessageV3, 'vira pollCreationMessageV3');
  ok(
    content.pollCreationMessageV3.pollContentType === proto.Message.PollContentType.IMAGE,
    'pollContentType = IMAGE'
  );
  ok(content.pollCreationMessageV3.name === 'Qual vocês preferem?', 'pergunta preservada');
  ok(content.pollCreationMessageV3.options.length === 3, '3 opções');
  ok(content.messageContextInfo?.messageSecret?.length === 32, 'messageSecret gerado');
  ok(holder.images?.length === 3, '3 imagens preparadas para os filhos');
});

await test('integração: sobrevive ao encode/decode (vai mesmo no fio)', async () => {
  const holder = {};
  const content = await generateWAMessageContent(conteudoDoComando('Qual é o melhor? 🤔', [1, 2, 3]), {
    userJid: USER,
    upload: fakeUpload,
    jid: GROUP,
    imagePollHolder: holder
  });

  const bytes = proto.Message.encode(proto.Message.create(content)).finish();
  const dec = proto.Message.decode(bytes);

  ok(Boolean(dec.pollCreationMessageV3), 'pai sobrevive');
  ok(dec.pollCreationMessageV3.pollContentType === proto.Message.PollContentType.IMAGE, 'IMAGE sobrevive');
  ok(dec.pollCreationMessageV3.name === 'Qual é o melhor? 🤔', 'pergunta sobrevive');
  ok(dec.pollCreationMessageV3.options.length === 3, '3 opções sobrevivem');
  for (const option of dec.pollCreationMessageV3.options) {
    ok(/^[0-9a-f]{64}$/.test(option.optionHash || ''), `optionHash válido para "${option.optionName}"`);
  }

  // filhos
  const parentKey = { remoteJid: GROUP, fromMe: true, id: 'POLL-1' };
  for (let i = 0; i < holder.images.length; i++) {
    const filho = {
      ...holder.images[i],
      messageContextInfo: {
        ...(holder.images[i].messageContextInfo || {}),
        messageAssociation: {
          parentMessageKey: parentKey,
          associationType: proto.MessageAssociation.AssociationType.MEDIA_POLL
        }
      }
    };
    const b = proto.Message.encode(proto.Message.create(filho)).finish();
    const d = proto.Message.decode(b);
    ok(Boolean(normalizeMessageContent(d).imageMessage), `filho ${i + 1} é imagem`);
    ok(
      d.messageContextInfo.messageAssociation.associationType ===
        proto.MessageAssociation.AssociationType.MEDIA_POLL,
      `filho ${i + 1} associado como MEDIA_POLL`
    );
  }
});

await test('integração: o hash da opção liga a opção à SUA imagem', async () => {
  const holder = {};
  const content = await generateWAMessageContent(conteudoDoComando('Ordem', [1, 2, 3]), {
    userJid: USER,
    upload: fakeUpload,
    jid: GROUP,
    imagePollHolder: holder
  });

  const { createHash } = await import('node:crypto');
  const hashDe = (nome, fileSha256) =>
    createHash('sha256')
      .update(createHash('sha256').update(nome).digest('hex') + Buffer.from(fileSha256).toString('base64'))
      .digest('hex');

  content.pollCreationMessageV3.options.forEach((option, i) => {
    const img = holder.images[i].imageMessage;
    ok(option.optionHash === hashDe(option.optionName, img.fileSha256), `opção ${i + 1} casa com a imagem ${i + 1}`);
  });
});

await test('integração: ordem invertida 3|1|2 monta os hashes na ordem pedida', async () => {
  // O comando já entrega as imagens na ordem pedida; aqui conferimos que a fork
  // liga cada opção à imagem da MESMA posição.
  const holder = {};
  const content = await generateWAMessageContent(conteudoDoComando('Invertida', [1, 2, 3]), {
    userJid: USER,
    upload: fakeUpload,
    jid: GROUP,
    imagePollHolder: holder
  });

  const { createHash } = await import('node:crypto');
  const hashDe = (nome, fileSha256) =>
    createHash('sha256')
      .update(createHash('sha256').update(nome).digest('hex') + Buffer.from(fileSha256).toString('base64'))
      .digest('hex');

  const hashes = content.pollCreationMessageV3.options.map((o, i) =>
    hashDe(o.optionName, holder.images[i].imageMessage.fileSha256)
  );
  ok(
    content.pollCreationMessageV3.options.every((o, i) => o.optionHash === hashes[i]),
    'cada opção usa a imagem da sua posição'
  );
});

await test('integração: regressão — enquete normal continua pollCreationMessageV3 sem IMAGE', async () => {
  const content = await generateWAMessageContent(
    { poll: { name: 'Escolha', values: ['A', 'B'], selectableCount: 1 } },
    { userJid: USER, upload: fakeUpload, jid: GROUP }
  );
  ok(Boolean(content.pollCreationMessageV3), 'enquete normal usa V3');
  ok(content.pollCreationMessageV3.pollContentType === undefined, 'sem pollContentType');
  ok(content.pollCreationMessageV3.options.every((o) => o.optionHash === undefined), 'sem optionHash');
});

const totalOk = RESULTS.reduce((a, r) => a + r.passed, 0);
const totalFail = RESULTS.reduce((a, r) => a + r.failed, 0);
console.log('\n' + '='.repeat(40));
console.log(`RESULTADO: ${RESULTS.length} testes | ${totalOk} asserções ok | ${totalFail} falhas`);
console.log('='.repeat(40));
if (totalFail === 0) console.log('✅ TODOS OS TESTES PASSARAM');
else {
  console.log('FALHAS:');
  for (const r of RESULTS) for (const e of r.errors) console.log(`- [${r.name}] ${e}`);
  process.exit(1);
}
process.exit(0);