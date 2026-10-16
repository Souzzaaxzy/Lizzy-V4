/**
 * `!testefm` — formularios / mensagens interativas (WhatsApp Flows vs Native Flow).
 *
 * ## O contrato que este teste mede
 *
 * O comando existe para DEMONSTRAR o que o Baileys consegue enviar de verdade e
 * para nao confundir os tres formatos:
 *
 *   1. **WhatsApp Flows (Meta)** — formulario oficial; precisa de `flow_id` da
 *      WABA. Sem ele, o comando ORIENTA (nao finge que enviou formulario).
 *   2. **Native Flow** — o envelope `interactiveMessage.nativeFlowMessage`.
 *   3. **mensagens interativas** — botoes/listas no mesmo envelope.
 *
 * Roda o handler REAL (`NazuninhaBotExec`) com socket Baileys falso e passa o
 * que o comando montou pelo caminho REAL da fork (`generateWAMessageContent`),
 * conferindo o proto que sai — nao a intencao do codigo.
 *
 * Uso: node tests/form-test.test.js
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

// Banco temporario ANTES de importar o index (paths.js le DATABASE_PATH no load).
const TMP_DB = fs.mkdtempSync(path.join(os.tmpdir(), 'lizzy-fm-db-'));
process.env.DATABASE_PATH = TMP_DB;
process.env.CONFIG_PATH = path.join(TMP_DB, 'config.json');
fs.mkdirSync(path.join(TMP_DB, 'grupos'), { recursive: true });
fs.writeFileSync(
  path.join(TMP_DB, 'config.json'),
  JSON.stringify({ nomebot: 'Lizzy', prefixo: '!', numerodono: '5511999999999', nomedono: 'Dono' }, null, 2)
);

const RESULTS = [];
let CURRENT = null;

function test(name, fn) {
  CURRENT = { name, passed: 0, failed: 0, errors: [] };
  RESULTS.push(CURRENT);
  try {
    const r = fn();
    if (r && typeof r.then === 'function') {
      return r.then(() => finish(name)).catch((e) => { CURRENT.failed++; CURRENT.errors.push(`EXCEÇÃO: ${e?.stack || e}`); finish(name); });
    }
    finish(name);
  } catch (e) {
    CURRENT.failed++; CURRENT.errors.push(`EXCEÇÃO: ${e?.stack || e}`); finish(name);
  }
  return Promise.resolve();
}
function finish(name) {
  console.log(`${CURRENT.failed === 0 ? '✅' : '❌'} ${name} (${CURRENT.passed} ok, ${CURRENT.failed} falhas)`);
  for (const e of CURRENT.errors) console.log(`     ${e.split('\n')[0]}`);
}
function ok(c, m) { if (c) CURRENT.passed++; else { CURRENT.failed++; CURRENT.errors.push(`ASSERT FALHOU: ${m}`); } }
function includes(hay, needle, label) {
  ok(typeof hay === 'string' && hay.includes(needle), `${label ?? needle} — esperado conter "${needle}"`);
}

const BOT_JID = '5599999999999@s.whatsapp.net';
const BOT_LID = '111111111111111@lid';
const OUTRO_LID = '111000000000003@lid';

let groupCounter = 0;
let authorCounter = 0;
const GRUPOS = path.join(TMP_DB, 'grupos');

/** Autor unico por execucao: o handler aplica throttle de 3 comandos/5s por
 * remetente — reutilizar o mesmo mediria o rate limit. */
function nextAuthor() {
  authorCounter++;
  return {
    lid: `98${String(authorCounter).padStart(6, '0')}888@lid`,
    jid: `5598${String(authorCounter).padStart(6, '0')}777@s.whatsapp.net`,
  };
}

function makeGroup() {
  groupCounter++;
  const jid = `1203639600000000${String(groupCounter).padStart(3, '0')}@g.us`;
  fs.writeFileSync(path.join(GRUPOS, `${jid}.json`), JSON.stringify({ groupName: 'G' }, null, 2));
  return jid;
}

function makeNazu({ sent, groupJid, author }) {
  return {
    sendMessage: async (jid, content, options) => { sent.push({ jid, content, options }); return { key: { id: `S-${sent.length}` } }; },
    user: { id: `${BOT_JID.split('@')[0]}:5@s.whatsapp.net`, lid: BOT_LID, name: 'Lizzy' },
    onWhatsApp: async (jid) => [{ jid, exists: true, lid: jid === author.jid ? author.lid : jid }],
    signalRepository: { lidMapping: { getPNForLID: async () => author.jid } },
    groupMetadata: async () => ({
      id: groupJid, subject: 'G',
      participants: [
        { id: author.lid, admin: null, phoneNumber: author.jid },
        { id: OUTRO_LID, admin: null, phoneNumber: '5511000000003@s.whatsapp.net' },
        { id: BOT_LID, admin: 'admin', phoneNumber: BOT_JID },
      ],
    }),
    groupParticipantsUpdate: async () => [{ status: '200' }],
    groupRequestParticipantsList: async () => [],
    groupRequestParticipantsUpdate: async () => ({}),
    ev: { on: () => {}, emit: () => {}, removeAllListeners: () => {} },
    readMessages: async () => {},
    sendPresenceUpdate: async () => {},
    profilePictureUrl: async () => 'x',
    react: async () => ({}),
  };
}

const indexModule = await import(new URL('../dados/src/index.js', import.meta.url).href);
const handleMessage = indexModule.default ?? indexModule;
if (typeof handleMessage !== 'function') throw new Error('index.js não exporta o handler');

const formTest = await import(new URL('../dados/src/utils/formTest.js', import.meta.url).href);
const { generateWAMessageContent } = await import('@itsliaaa/baileys');
const { parseFlowResponse } = await import('@itsliaaa/baileys');

const SRC = fs.readFileSync(new URL('../dados/src/index.js', import.meta.url), 'utf8');

/** Executa um comando de texto no handler real. */
async function runCmd(text, opts = {}) {
  const sent = [];
  const author = opts.author || nextAuthor();
  const groupJid = opts.groupJid || makeGroup();
  const nazu = makeNazu({ sent, groupJid, author, ...opts });
  const info = {
    key: { remoteJid: groupJid, fromMe: false, id: `CMD-${groupCounter}-${Math.random().toString(36).slice(2, 7)}`, participant: author.lid },
    message: { extendedTextMessage: { text, contextInfo: { remoteJid: groupJid } } },
    messageTimestamp: 1757900000, pushName: 'Autor',
  };
  await handleMessage(nazu, info, null, new Map(), null);
  const out = sent.map((s) => s.content?.text ?? '').filter(Boolean).join('\n');
  return { sent, out, groupJid, author };
}

const fakeUpload = async () => ({ url: 'https://mmg.whatsapp.net/fake', directPath: '/v/fake' });

console.log('\n=== 1) O PAINEL (o que da para fazer e o que falta) ===\n');

await test('!testefm sem argumento mostra o painel com os TRES formatos', async () => {
  const r = await runCmd('!testefm');
  includes(r.out, 'Native Flow', 'cita o Native Flow');
  includes(r.out, 'WhatsApp Flows', 'cita o WhatsApp Flows oficial');
  includes(r.out, 'flow_id', 'diz que o oficial precisa do flow_id');
  includes(r.out, 'NAO EXISTEM', 'diz que flowMessage/flowResponseMessage nao existem');
  ok(!r.out.includes('undefined'), 'sem undefined');
  ok(!r.out.includes('null'), 'sem null');
});

await test('o painel ensina os modos', async () => {
  const r = await runCmd('!testefm');
  includes(r.out, 'testefm nativo', 'mostra o modo nativo');
  includes(r.out, 'testefm flow', 'mostra o modo flow');
});

console.log('\n=== 2) O FORMULARIO NATIVO (o que renderiza hoje) ===\n');

await test('!testefm nativo envia o formulario nativo', async () => {
  const r = await runCmd('!testefm nativo');
  ok(r.sent.length === 1, `uma mensagem (veio ${r.sent.length})`);
  const c = r.sent[0].content;
  includes(c.text, 'FICHA DE ALUGUEL', 'tem o titulo');
  ok(Array.isArray(c.nativeFlow) && c.nativeFlow.length >= 3, 'tem os botoes do formulario');
});

await test('o formulario nativo traz os campos do exemplo (plano/periodo/confirmar)', async () => {
  const c = formTest.montarFormularioNativo();
  const textos = c.nativeFlow.map((b) => b.text).join(' | ');
  includes(textos, 'Plano', 'plano');
  includes(textos, 'Período', 'periodo');
  includes(textos, 'Pronto', 'confirmacao (botao que gera o PDF)');
  includes(textos, 'Cancelar', 'cancelar');
  // Os planos e periodos estao nas rows.
  const rows = c.nativeFlow[0].sections[0].rows.map((x) => x.title).join(',');
  ok(rows.includes('Básico') && rows.includes('Pro'), 'os planos do exemplo');
  ok(c.nativeFlow[1].sections[0].rows.length === 3, 'tres periodos');
});

await test('os 5 campos pedidos estao representados', () => {
  const nomes = formTest.CAMPOS_EXEMPLO.map((c) => c.nome).join(' | ');
  for (const campo of ['Nome de exibição', 'Plano', 'Período', 'Observações', 'Confirmação']) {
    includes(nomes, campo, campo);
  }
});

await test('o payload nativo vira interactiveMessage.nativeFlowMessage no proto REAL', async () => {
  const c = formTest.montarFormularioNativo();
  const m = await generateWAMessageContent(
    { text: c.text, footer: c.footer, nativeFlow: c.nativeFlow },
    { upload: fakeUpload }
  );
  ok(m.interactiveMessage, 'veio interactiveMessage');
  ok(m.interactiveMessage.nativeFlowMessage, 'tem nativeFlowMessage');
  const btns = m.interactiveMessage.nativeFlowMessage.buttons;
  ok(btns.length === 4, `4 botoes (veio ${btns.length})`);
  const nomes = btns.map((b) => b.name);
  ok(nomes.includes('single_select'), 'plano/periodo sao single_select (a bottom-sheet nativa)');
  ok(nomes.includes('quick_reply'), 'confirmar/cancelar sao quick_reply');
  // Sobrevive ao encode/decode.
  const { proto } = await import('@itsliaaa/baileys');
  const volta = proto.Message.decode(proto.Message.encode(proto.Message.fromObject(m)).finish());
  ok(volta.interactiveMessage.nativeFlowMessage.buttons.length === 4, 'sobrevive ao encode/decode');
});
console.log('\n=== 2b) O CARD RICO (richResponseMessage — o que RENDERIZA) ===\n');

await test('!testefm rich envia a ficha como richResponse', async () => {
  const r = await runCmd('!testefm rich');
  ok(r.sent.length === 1, `uma mensagem (veio ${r.sent.length})`);
  const c = r.sent[0].content;
  ok(Array.isArray(c.richResponse) && c.richResponse.length >= 3, 'tem os sub-blocos ricos');
  includes(c.disclaimerText, 'FICHA', 'tem o rotulo do card');
});

await test('o card rico vira richResponseMessage no proto REAL (tabela + texto)', async () => {
  const c = formTest.montarFormularioRico();
  const m = await generateWAMessageContent(
    { disclaimerText: c.disclaimerText, richResponse: c.richResponse },
    { upload: fakeUpload }
  );
  // O envelope: botForwardedMessage -> richResponseMessage
  ok(m.botForwardedMessage, 'vem como botForwardedMessage');
  const rich = m.botForwardedMessage.message.richResponseMessage;
  ok(rich, 'com richResponseMessage dentro');
  ok(rich.messageType === 1, 'tipo STANDARD (1)');
  ok(rich.submessages.length >= 3, `submessages (veio ${rich.submessages.length})`);
  const tipos = rich.submessages.map((s) => s.messageType);
  ok(tipos.includes(2), 'tem TEXT (2)');
  ok(tipos.includes(4), 'tem TABLE (4)');
  ok(rich.unifiedResponse, 'tem unifiedResponse (o que o cliente desenha)');
});

await test('a tabela do card rico sobrevive ao encode/decode', async () => {
  const c = formTest.montarFormularioRico();
  const m = await generateWAMessageContent(
    { disclaimerText: c.disclaimerText, richResponse: c.richResponse },
    { upload: fakeUpload }
  );
  const { proto } = await import('@itsliaaa/baileys');
  const volta = proto.Message.decode(proto.Message.encode(proto.Message.fromObject(m)).finish());
  const rich = volta.botForwardedMessage.message.richResponseMessage;
  const tab = rich.submessages.find((s) => s.tableMetadata);
  ok(tab, 'a tabela sobreviveu');
  ok(tab.tableMetadata.rows.length === 6, `6 linhas (veio ${tab.tableMetadata.rows?.length})`);
  ok(tab.tableMetadata.rows[0].items.includes('Campo'), 'cabecalho Campo/Valor');
});

await test('o card rico NAO e confundido com mensagem normal', async () => {
  const c = formTest.montarFormularioRico();
  const m = await generateWAMessageContent({ disclaimerText: c.disclaimerText, richResponse: c.richResponse }, { upload: fakeUpload });
  ok(!m.extendedTextMessage, 'nao e extendedTextMessage');
  ok(!m.conversation, 'nao e conversation');
});

await test('a ficha PREENCHIDA traz os valores escolhidos', async () => {
  const c = formTest.montarFichaPreenchida({ nome: 'Fulano', plano: 'Pro', periodo: 'Mensal' });
  const m = await generateWAMessageContent({ disclaimerText: c.disclaimerText, richResponse: c.richResponse }, { upload: fakeUpload });
  const rich = m.botForwardedMessage.message.richResponseMessage;
  const tab = rich.submessages.find((s) => s.tableMetadata);
  const linhas = tab.tableMetadata.rows.map((r) => r.items.join('|')).join(' ; ');
  includes(linhas, 'Pro', 'o plano escolhido');
  includes(linhas, 'Mensal', 'o periodo escolhido');
  includes(linhas, 'Fulano', 'o nome');
  ok(!linhas.includes('undefined'), 'sem undefined');
});

await test('a ficha preenchida tolera campo ausente (nao mostra undefined)', () => {
  const c = formTest.montarFichaPreenchida({});
  const linhas = c.richResponse[1].table.map((r) => (r.items || r).join('|')).join(' ; ');
  ok(!linhas.includes('undefined'), 'sem undefined');
  ok(!linhas.includes('null'), 'sem null');
  includes(linhas, '—', 'usa o traco para vazio');
});

await test('a resposta de plano/periodo monta a ficha e NAO vira conversa', async () => {
  const sent = [];
  const author = nextAuthor();
  const groupJid = makeGroup();
  const nazu = makeNazu({ sent, groupJid, author });
  const { buildFlowReply } = await import('@itsliaaa/baileys');
  // Duas escolhas: plano e periodo -> fecha a ficha.
  for (const id of ['plano:pro', 'periodo:mensal']) {
    await handleMessage(nazu, {
      key: { remoteJid: groupJid, fromMe: false, id: `F-${Math.random().toString(36).slice(2, 7)}`, participant: author.lid },
      message: buildFlowReply({ name: id.split(':')[0], paramsJson: JSON.stringify({ id }) }),
      messageTimestamp: 1757900000, pushName: 'Autor',
    }, null, new Map(), null);
  }
  // Um card por escolha: o primeiro mostra so o plano, o segundo ja com os dois.
  const rico = sent.filter((s) => s.content?.richResponse);
  ok(rico.length === 2, `um card por escolha (veio ${rico.length})`);
  const linhas = (r) => r.content.richResponse[1].table.map((x) => (x.items || x).join('|')).join(' ; ');
  includes(linhas(rico[0]), 'pro', 'o plano no 1o card');
  includes(linhas(rico[0]), 'pendente', 'e o periodo ainda pendente');
  includes(linhas(rico[1]), 'pro', 'o plano no 2o card');
  includes(linhas(rico[1]), 'mensal', 'e o periodo escolhido');
  ok(sent.every((s) => !s.content?.delete), 'nao foi apagada');
});


console.log('\n=== 2c) O BOTAO "PRONTO" -> PDF NO CHAT ===\n');

await test('o formulario nativo tem o botao "Pronto"', () => {
  const c = formTest.montarFormularioNativo();
  const textos = c.nativeFlow.map((b) => b.text).join(' | ');
  includes(textos, 'Pronto', 'o botao Pronto');
  const pronto = c.nativeFlow.find((b) => b.id === 'pronto');
  ok(pronto, 'com o id "pronto" (e o que o handler escuta)');
});

await test('o gerador de PDF produz um PDF de verdade', async () => {
  const { gerarFichaPdf } = await import(new URL('../dados/src/utils/fichaPdf.js', import.meta.url).href);
  const pdf = await gerarFichaPdf({ nome: 'Fulano', plano: 'Pro', periodo: 'Mensal', grupo: 'G', pedidoPor: '5511' });
  ok(Buffer.isBuffer(pdf), 'devolve Buffer');
  ok(pdf.length > 800, `tem conteudo (veio ${pdf.length} bytes)`);
  ok(pdf.subarray(0, 5).toString() === '%PDF-', 'magic %PDF-');
  ok(pdf.subarray(-6).toString().includes('%%EOF'), 'termina com %%EOF');
});

await test('o PDF nao quebra com campo ausente (nao vira undefined)', async () => {
  const { gerarFichaPdf } = await import(new URL('../dados/src/utils/fichaPdf.js', import.meta.url).href);
  const pdf = await gerarFichaPdf({});
  ok(pdf.subarray(0, 5).toString() === '%PDF-', 'PDF valido mesmo vazio');
  const txt = pdf.toString('latin1');
  ok(!txt.includes('undefined'), 'sem undefined no conteudo');
  ok(!txt.includes('null'), 'sem null no conteudo');
});

await test('tocar em "Pronto" envia o PDF como DOCUMENTO no chat', async () => {
  const sent = [];
  const author = nextAuthor();
  const groupJid = makeGroup();
  const nazu = makeNazu({ sent, groupJid, author });
  const { buildFlowReply } = await import('@itsliaaa/baileys');

  const envia = (id) => handleMessage(nazu, {
    key: { remoteJid: groupJid, fromMe: false, id: `P-${Math.random().toString(36).slice(2, 7)}`, participant: author.lid },
    message: buildFlowReply({ name: id.split(':')[0], paramsJson: JSON.stringify({ id }) }),
    messageTimestamp: 1757900000, pushName: 'Autor',
  }, null, new Map(), null);

  // Escolhe plano e periodo, depois aperta Pronto.
  await envia('plano:pro');
  await envia('periodo:mensal');
  await envia('pronto');

  const doc = sent.find((s) => s.content?.document);
  ok(doc, 'enviou um documento');
  ok(doc.content.mimetype === 'application/pdf', `mimetype pdf (veio ${doc.content.mimetype})`);
  ok(Buffer.isBuffer(doc.content.document), 'o documento e um Buffer');
  ok(doc.content.document.subarray(0, 5).toString() === '%PDF-', 'o Buffer e um PDF');
  includes(String(doc.content.fileName), '.pdf', 'nome com .pdf');
  // O card rico vem ANTES (a ficha na tela) e o PDF depois (o botao Pronto).
  const iCard = sent.findIndex((s) => s.content?.richResponse);
  const iDoc = sent.findIndex((s) => s.content?.document);
  ok(iCard > -1 && iDoc > iCard, 'o card rico vem antes do PDF (ordem do fluxo)');
});

await test('"Pronto" SEM escolher avisa em vez de mandar PDF vazio', async () => {
  const sent = [];
  const author = nextAuthor();
  const groupJid = makeGroup();
  const nazu = makeNazu({ sent, groupJid, author });
  const { buildFlowReply } = await import('@itsliaaa/baileys');
  await handleMessage(nazu, {
    key: { remoteJid: groupJid, fromMe: false, id: `Q-${Math.random().toString(36).slice(2, 7)}`, participant: author.lid },
    message: buildFlowReply({ name: 'pronto', paramsJson: JSON.stringify({ id: 'pronto' }) }),
    messageTimestamp: 1757900000, pushName: 'Autor',
  }, null, new Map(), null);
  const out = sent.map((s) => s.content?.text ?? '').filter(Boolean).join('\n');
  ok(!sent.some((s) => s.content?.document), 'nao mandou PDF');
  ok(/plano/i.test(out) && /per[íi]odo/i.test(out), 'pede para escolher plano e periodo');
});

await test('o handler usa o gerador de PDF (nao um stub)', () => {
  includes(SRC, 'gerarFichaPdf', 'importa e chama o gerador');
  includes(SRC, "id === 'pronto'", 'escuta o botao pronto');
  includes(SRC, "mimetype: 'application/pdf'", 'manda como application/pdf');
});



console.log('\n=== 3) O FLOW OFICIAL (o limite, dito na cara) ===\n');

await test('!testefm flow SEM id orienta em vez de fingir que enviou', async () => {
  const r = await runCmd('!testefm flow');
  includes(r.out, 'flow_id', 'pede o flow_id');
  includes(r.out, 'incompatível', 'explica o que acontece sem o id');
  includes(r.out, 'testefm nativo', 'aponta o caminho que funciona');
  ok(r.sent.every((s) => !s.content?.nativeFlow), 'nao enviou botao de flow quebrado');
});

await test('!testefm <flow_id> monta o botao `flow` com os nomes de campo da Meta', async () => {
  const c = formTest.montarFormularioFlow({ flowId: '1234567890' });
  const m = await generateWAMessageContent(
    { text: c.text, footer: c.footer, nativeFlow: c.nativeFlow },
    { upload: fakeUpload }
  );
  const btn = m.interactiveMessage.nativeFlowMessage.buttons[0];
  ok(btn.name === 'flow', `o botao se chama "flow" (veio ${btn.name})`);
  const p = JSON.parse(btn.buttonParamsJson);
  ok(p.flow_id === '1234567890', 'flow_id');
  ok(p.flow_action === 'navigate', 'flow_action');
  ok(p.flow_message_version === '3', 'flow_message_version');
  ok(typeof p.flow_token === 'string', 'flow_token');
  ok(typeof p.flow_cta === 'string' && p.flow_cta.length > 0, 'flow_cta');
});

await test('o comando envia o flow pelo handler quando recebe um id', async () => {
  const r = await runCmd('!testefm 555000111');
  ok(r.sent.length === 1, 'enviou');
  const c = r.sent[0].content;
  ok(Array.isArray(c.nativeFlow) && c.nativeFlow[0].flowId === '555000111', 'com o flowId informado');
});

console.log('\n=== 4) A RESPOSTA (interactiveResponseMessage) ===\n');

await test('a resposta do participante e reconhecida e formatada', async () => {
  const { buildFlowReply } = await import('@itsliaaa/baileys');
  const conteudo = buildFlowReply({ name: 'plano', paramsJson: JSON.stringify({ id: 'plano:pro' }) });
  // O handler precisa reconhecer o conteudo como resposta.
  const lida = parseFlowResponse(conteudo);
  ok(lida && lida.name === 'plano', 'o parser reconhece');
  const texto = formTest.formatarResposta(lida);
  includes(texto, 'RESPOSTA DO FORMULÁRIO', 'o titulo');
  includes(texto, 'plano:pro', 'a escolha');
});

await test('o handler real processa a resposta e avisa no grupo', async () => {
  const sent = [];
  const author = nextAuthor();
  const groupJid = makeGroup();
  const nazu = makeNazu({ sent, groupJid, author });
  const { buildFlowReply } = await import('@itsliaaa/baileys');
  const info = {
    key: { remoteJid: groupJid, fromMe: false, id: `R-${Math.random().toString(36).slice(2, 7)}`, participant: author.lid },
    message: buildFlowReply({ name: 'plano', paramsJson: JSON.stringify({ id: 'plano:premium' }) }),
    messageTimestamp: 1757900000, pushName: 'Autor',
  };
  await handleMessage(nazu, info, null, new Map(), null);
  const out = sent.map((s) => s.content?.text ?? '').filter(Boolean).join('\n');
  // Escolha de plano -> o card rico se ATUALIZA e os botoes voltam abaixo.
  const card = sent.find((s) => s.content?.richResponse);
  ok(card, 'reenviou o card rico atualizado');
  const linhas = card.content.richResponse[1].table.map((r) => (r.items || r).join('|')).join(' ; ');
  includes(linhas, 'premium', 'com a escolha no card');
  const btns = sent.find((s) => s.content?.nativeFlow);
  ok(btns, 'reenviou os botoes (uso unico: precisam voltar)');
  ok(sent.every((s) => !s.content?.delete), 'nao foi tratada como spam/apagada');
});

await test('a resposta NAO vira mensagem normal (nao passa pelos contadores)', () => {
  // O bloco roda antes dos contadores e da `return`.
  const i = SRC.indexOf('const respostaForm = parseFlowResponse(info.message);');
  ok(i > -1, 'o handler chama o parser');
  const bloco = SRC.slice(i, i + 2200);
  includes(bloco, 'return;', 'sai do fluxo (nao vira conversa)');
  const posReturn = bloco.indexOf('return;');
  const posContador = SRC.indexOf('userActivity', i);
  ok(posContador === -1 || posContador > i + 2200, 'o retorno vem antes dos contadores');
});

console.log('\n=== 5) O COMANDO ESTA LIGADO (menu/blockPv) ===\n');

await test('!testefm esta no bloco do switch e no blockPv', () => {
  includes(SRC, "case 'testefm':", 'a case existe');
  const BP = fs.readFileSync(new URL('../dados/src/utils/blockPv.js', import.meta.url), 'utf8');
  includes(BP, "'testefm'", 'registrado no blockPv');
});

await test('o modulo do comando nao inventa proto', () => {
  const FT = fs.readFileSync(new URL('../dados/src/utils/formTest.js', import.meta.url), 'utf8');
  includes(FT, 'flowId', 'usa flowId (o nome da API)');
  ok(!FT.includes('flowMessage:'), 'nao inventa um campo flowMessage');
  ok(!FT.includes('flowResponseMessage:'), 'nao inventa flowResponseMessage');
});

const totalOk = RESULTS.reduce((a, r) => a + r.passed, 0);
const totalFail = RESULTS.reduce((a, r) => a + r.failed, 0);
console.log('\n' + '='.repeat(40));
console.log(`RESULTADO: ${RESULTS.length} testes | ${totalOk} asserções ok | ${totalFail} falhas`);
console.log('='.repeat(40));
if (totalFail > 0) process.exit(1);
// Importar o index deixa timers/handles abertos: sem isto a suite fica pendurada.
process.exit(0);
