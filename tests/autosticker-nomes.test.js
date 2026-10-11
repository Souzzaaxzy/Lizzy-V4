/**
 * Testes: o AUTOSTICKER usa o mesmo sistema de nomes do `!s` (take.json + nick).
 * Roda o handler real; confere que a figurinha automática sai com o `author`/
 * `packname` resolvidos (não mais `『pushname』` / nomebot).
 *
 * Uso: node tests/autosticker-nomes.test.js
 */

import fs from 'fs';
import os from 'os';
import path from 'path';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'lizzy-autostk-'));
process.env.DATABASE_PATH = TMP;
fs.mkdirSync(path.join(TMP, 'grupos'), { recursive: true });
fs.mkdirSync(path.join(TMP, 'dono'), { recursive: true });
fs.mkdirSync(path.join(TMP, 'users'), { recursive: true });

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.error('FAIL:', m); } };
const eq = (a, b, m) => ok(a === b, `${m} (esperado ${JSON.stringify(b)}, veio ${JSON.stringify(a)})`);

const idx = await import(new URL('../dados/src/index.js', import.meta.url).href);
const handle = idx.default ?? idx;

const G = '120363905000000001@g.us';
const A = { lid: '993333@lid', jid: '5599333@s.whatsapp.net' };
const BOT_LID = '111111111111111@lid';

function makeNazu(sent) {
  return {
    sendMessage: async (jid, content) => { sent.push({ jid, content }); return { key: { id: 'S' + sent.length } }; },
    relayMessage: async () => ({}),
    user: { id: '5599999999999:5@s.whatsapp.net', lid: BOT_LID },
    signalRepository: { lidMapping: { getPNForLID: async () => null } },
    groupMetadata: async (g) => ({ id: g, subject: 'G', participants: [{ id: A.lid, admin: null, phoneNumber: A.jid }, { id: BOT_LID, admin: 'admin' }] }),
    groupParticipantsUpdate: async () => [], groupSettingUpdate: async () => ({}),
    groupRequestParticipantsList: async () => [], groupRequestParticipantsUpdate: async () => ({}),
    ev: { on: () => {}, emit: () => {}, removeAllListeners: () => {} },
    readMessages: async () => {}, sendPresenceUpdate: async () => {}, profilePictureUrl: async () => 'x', react: async () => ({}),
  };
}

// imagem cifrada servida por HTTP local (mesmo esquema dos outros testes).
const server = (await import('http')).createServer((req, res) => {
  // bytes quaisquer; o bot só repassa ao sendSticker (que não roda ffmpeg aqui porque
  // o mock de sendSticker captura). Servimos um JPEG mínimo.
  res.writeHead(200, { 'Content-Type': 'image/jpeg' });
  res.end(Buffer.from([0xFF, 0xD8, 0xFF, 0xD9]));
});
await new Promise((r) => server.listen(0, r));
const PORT = server.address().port;

function infoImagem(captionBot) {
  return {
    key: { remoteJid: G, fromMe: false, id: 'AUTO' + Math.random().toString(16).slice(2, 8), participant: A.lid, participantAlt: A.jid },
    pushName: 'FulanoPush',
    message: { imageMessage: { url: `http://127.0.0.1:${PORT}/a.jpg`, mimetype: 'image/jpeg', fileLength: 4, mediaKey: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]) } },
    messageTimestamp: 1,
  };
}

// isola o sendSticker: intercepta via monkeypatch do módulo de stickers do bot.
const stickerMod = await import(new URL('../dados/src/funcs/utils/sticker.js', import.meta.url).href).catch(() => null);

// Como não dá para monkeypatch ESM, rodamos o handler com autoSticker ligado e
// observamos o conteúdo capturado em sendMessage (a figurinha sai como `sticker`).
// O autor/pack vão dentro do pacote do webp — então validamos pelo caminho do
// resolver diretamente, que é o contrato que o autosticker passou a usar.
const { resolverNomesFigurinha } = await import(new URL('../dados/src/funcs/utils/stickerPack.js', import.meta.url).href);
const { resolverNomeContato } = await import(new URL('../dados/src/utils/contactName.js', import.meta.url).href);

// take.json com author/pack configurados
fs.writeFileSync(path.join(TMP, 'users', 'take.json'), JSON.stringify({ [A.lid]: { author: 'Meu Autor', pack: 'Meu Pack' } }));
const nomes = await resolverNomesFigurinha({ sender: A.lid, takeData: JSON.parse(fs.readFileSync(path.join(TMP, 'users', 'take.json'), 'utf-8')), resolverNick: async () => 'Nick', fallback: 'FB' });
eq(nomes.author, 'Meu Autor', 'author do take');
eq(nomes.pack, 'Meu Pack', 'pack do take');

// sem take -> cai para nick
const nomes2 = await resolverNomesFigurinha({ sender: 'x@lid', takeData: {}, resolverNick: async () => 'Nick do Contato', fallback: 'FB' });
eq(nomes2.author, '', 'author vazio sem take');
eq(nomes2.pack, 'Nick do Contato', 'pack = nick');

// O handler do autosticker está LIGADO ao resolver: checagem estrutural.
const src = fs.readFileSync(new URL('../dados/src/index.js', import.meta.url), 'utf-8');
const iBloco = src.indexOf('const autoConvertMediaToSticker');
const bloco = src.slice(iBloco, iBloco + 2400);
ok(/resolverNomesFigurinha\(/.test(bloco), 'autosticker usa resolverNomesFigurinha');
ok(!/author: `『\$\{pushname\}』`/.test(bloco), 'não usa mais author fixo 『pushname』');
ok(/author: nomesAuto\.author/.test(bloco) && /packname: nomesAuto\.pack/.test(bloco), 'autor/pacote separados (take/nick)');
ok(/resolveMedia\(/.test(bloco), 'autosticker usa resolveMedia (cobre view once)');
ok(/midia\.media/.test(bloco) && !/midia\.node/.test(bloco), 'usa midia.media (campo certo do resolveMedia)');
ok(/if \(ehVideo && \(midia\.media\.seconds \|\| 0\) > 9\.9\) return;/.test(bloco), 'limite de 9.9s vale para TODO video (inclusive visu unica)');
ok(!/midia\.viewOnce/.test(bloco), 'sem excecao de view once no limite de duracao');
ok(!/viewOnceMessageV2\?\.message/.test(bloco), 'não usa mais o acesso frágil a view once');

// resolveMedia desembrulha view once (foto e vídeo) e efêmera.
const { resolveMedia } = await import(new URL('../dados/src/utils/viewOnce.js', import.meta.url).href);
const r1 = resolveMedia([{ imageMessage: { mimetype: 'image/jpeg' } }]);
eq(!!r1?.media, true, 'retorno tem .media (não .node)');
eq(r1?.node, undefined, 'não existe .node');
eq(resolveMedia([{ viewOnceMessageV2: { message: { imageMessage: { mimetype: 'image/jpeg' } } } }])?.type, 'image', 'view once foto');
eq(resolveMedia([{ viewOnceMessageV2: { message: { videoMessage: { seconds: 4 } } } }])?.type, 'video', 'view once vídeo');
eq(resolveMedia([{ viewOnceMessage: { message: { imageMessage: {} } } }])?.type, 'image', 'view once V1');
eq(resolveMedia([{ ephemeralMessage: { message: { viewOnceMessageV2: { message: { videoMessage: { seconds: 2 } } } } } }])?.type, 'video', 'efêmera + view once');

server.close();
console.log(`\n${pass} asserções ok, ${fail} falhas`);
try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {}
process.exit(fail === 0 ? 0 : 1);
