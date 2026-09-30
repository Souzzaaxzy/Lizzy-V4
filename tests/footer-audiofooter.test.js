/**
 * Testes do !footer — proto `audioFooter` (InteractiveMessage.Footer.audioMessage).
 *
 * O que este teste garante:
 *
 * O `audioFooter` é um atalho da fork que coloca um `AudioMessage` no rodapé de
 * uma mensagem interativa. O comando manda o conteúdo pelo MESMO caminho que a
 * fork usa (`generateWAMessageContent`), e conferimos o payload resultante:
 *   - `interactiveMessage.footer.audioMessage` presente (não o `footer.text`);
 *   - `footer.hasMediaAttachment === true`;
 *   - o áudio foi para o pipeline de upload como mediaType "audio";
 *   - o áudio de teste (dados/src/midias/footer_test.ogg) existe e é OGG Opus.
 *
 * Sem isso, um teste que só olha "tem um campo text" passaria mesmo que o
 * comando mandasse um card comum — que é exatamente o que não queremos.
 *
 * Uso: node --test tests/footer-audiofooter.test.js
 */

import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'url';

import { generateWAMessageContent } from '@itsliaaa/baileys';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const AUDIO_PATH = path.resolve(HERE, '../dados/src/midias/footer_test.ogg');

/** Upload falso: registra o mediaType de cada arquivo enviado. */
const makeUpload = () => {
  const calls = [];
  const upload = async (_filePath, opts) => {
    calls.push(opts?.mediaType);
    return { url: 'https://mmg.whatsapp.net/fake', directPath: '/v/fake' };
  };
  return { upload, calls };
};

async function build(content) {
  const { upload, calls } = makeUpload();
  const message = await generateWAMessageContent(content, {
    userJid: '5511999999999@s.whatsapp.net',
    upload,
    jid: '120363000000000001@g.us'
  });
  return { message, calls, footer: message?.interactiveMessage?.footer };
}

describe('!footer — audioFooter', () => {
  it('o áudio de teste existe e é OGG Opus', () => {
    assert.ok(fs.existsSync(AUDIO_PATH), `áudio ausente: ${AUDIO_PATH}`);
    const buf = fs.readFileSync(AUDIO_PATH);
    assert.equal(buf.subarray(0, 4).toString('latin1'), 'OggS', 'assinatura OggS');
    assert.ok(buf.includes(Buffer.from('OpusHead')), 'cabeçalho OpusHead');
  });

  it('monta interactiveMessage.footer.audioMessage (e não footer.text)', async () => {
    const audio = fs.readFileSync(AUDIO_PATH);
    const { footer } = await build({
      text: '🎧 Teste do audioFooter',
      audioFooter: audio,
      nativeFlow: [{ text: '👍🏻 Curti', id: '#footer-ok' }]
    });

    assert.ok(footer, 'footer presente');
    assert.equal(footer.hasMediaAttachment, true);
    assert.ok(footer.audioMessage, 'footer.audioMessage presente');
    assert.equal(footer.text, undefined, 'footer.text não é usado junto com áudio');
  });

  it('o áudio vai para o upload como mediaType "audio"', async () => {
    const audio = fs.readFileSync(AUDIO_PATH);
    const { calls } = await build({
      text: 't',
      audioFooter: audio,
      nativeFlow: [{ text: 'ok', id: '#ok' }]
    });

    assert.deepEqual(calls, ['audio'], 'o áudio passou pelo pipeline como "audio"');
  });

  it('preserva o corpo, o mimetype e o fileLength do áudio', async () => {
    const audio = fs.readFileSync(AUDIO_PATH);
    const { message, footer } = await build({
      text: '🎧 Teste do audioFooter',
      audioFooter: audio,
      nativeFlow: [{ text: 'ok', id: '#ok' }]
    });

    assert.equal(message.interactiveMessage.body.text, '🎧 Teste do audioFooter');
    assert.equal(footer.audioMessage.mimetype, 'audio/ogg; codecs=opus');
    // `fileLength` é um Long do protobufjs, não um number.
    assert.equal(Number(footer.audioMessage.fileLength), audio.length);
  });
});
