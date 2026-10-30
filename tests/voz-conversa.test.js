/**
 * A VOZ da conversa — "Lizzy, manda um áudio aí" manda ÁUDIO COMUM.
 *
 * Pedido do dono: *"vamos pelo áudio, primeiro vamos configurar apenas o
 * 'lizzy, manda um audio ai' só pra testar, depois automatizamos"* — e depois:
 * *"eu quero áudio normal mesmo, sem nota de voz, aquele áudio que o usuário
 * grava e manda seco no grupo"*.
 *
 * Uso: node tests/voz-conversa.test.js
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';

const TMP_DB = fs.mkdtempSync(path.join(os.tmpdir(), 'lizzy-voz-'));
process.env.DATABASE_PATH = TMP_DB;
process.env.CONFIG_PATH = path.join(TMP_DB, 'config.json');
fs.mkdirSync(path.join(TMP_DB, 'grupos'), { recursive: true });
fs.mkdirSync(path.join(TMP_DB, 'dono'), { recursive: true });
fs.writeFileSync(process.env.CONFIG_PATH, JSON.stringify({
  prefixo: '!', nomebot: 'Lizzy do privy', nomedono: 'Kannon',
  numerodono: '5511978819676', debug: false
}, null, 2));

const voz = await import(new URL('../dados/src/utils/vozDaConversa.js', import.meta.url).href);
const { sintetizarMp3 } = await import(new URL('../dados/src/utils/iapTts.js', import.meta.url).href);

/** Ha' ffmpeg no PATH? (so' para CONFERIR o MP3 gerado de verdade) */
function temFfmpeg() {
  const bin = process.env.FFMPEG_PATH || 'ffmpeg';
  try { return spawnSync(bin, ['-version'], { stdio: 'ignore' }).status === 0; } catch { return false; }
}
const FFMPEG = temFfmpeg();

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

const INDEX = fs.readFileSync(new URL('../dados/src/index.js', import.meta.url), 'utf-8');

// ───────────────────────────────────────────────────────────────────────────
// 1) RECONHECER O PEDIDO (o gatilho do dono)
// ───────────────────────────────────────────────────────────────────────────

await test('1. reconhece o pedido "manda um áudio aí" (o do dono)', () => {
  const casos = [
    'manda um áudio ai',
    'Lizzy, manda um áudio aí',
    'manda um audio',
    'me manda audio',
    'me manda um áudio',
    'manda áudio sobre o jogo',
    'grava um audio',
    'quero ouvir sua voz',
    'manda sua voz',
    'envia um áudio',
    'fala isso pra mim',
    'manda um audio do flamengo'
  ];
  for (const c of casos) ok(voz.ehPedidoDeAudio(c) === true, `reconheceu: "${c}"`);
});

await test('2. NAO confunde conversa normal com pedido de áudio', () => {
  const nao = [
    'oi tudo bem',
    'toca uma música',
    'manda a foto do grupo',
    'qual é o seu nome',
    'me manda o link',
    'kkkk',
    '',
    'manda'
  ];
  for (const c of nao) ok(voz.ehPedidoDeAudio(c) === false, `nao reconheceu (correto): "${c}"`);
});

await test('3. o TEMA sai do pedido (a moldura e removida)', () => {
  ok(voz.temaDoAudio('manda um áudio ai') === '', 'sem tema -> vazio');
  ok(voz.temaDoAudio('Lizzy, manda um áudio aí') === '', 'com a mencao -> vazio');
  ok(voz.temaDoAudio('manda áudio sobre o jogo') === 'o jogo', 'sobre o jogo');
  ok(voz.temaDoAudio('manda um audio do flamengo') === 'flamengo', 'do flamengo');
  ok(voz.temaDoAudio('grava um audio') === '', 'grava -> vazio');
  ok(voz.temaDoAudio('manda sua voz') === '', 'sua voz -> vazio');
});

await test('4. a FALA e montada a partir do tema', () => {
  ok(voz.falaDoAudio('').length > 0, 'sem tema tem uma fala padrao');
  ok(voz.falaDoAudio('o jogo').includes('o jogo'), 'com tema, o tema entra na fala');
});

// ───────────────────────────────────────────────────────────────────────────
// 2) GERAR A NOTA DE VOZ (PCM -> WAV -> OGG/Opus)
// ───────────────────────────────────────────────────────────────────────────

/** Dublê de TTS: MP3 de mentira (so' para medir o contrato). */
const sintetizarFake = async () => ({ ok: true, mp3: Buffer.from('ID3' + 'x'.repeat(200)), fonte: 'fake' });

await test('5. gera o AUDIO (MP3) — sem ffmpeg, sem rede', async () => {
  const r = await voz.gerarAudio({ texto: 'oi', sintetizarMp3: sintetizarFake });
  ok(r.ok === true, `gerou (motivo ${r.motivo || '-'})`);
  ok(Buffer.isBuffer(r.mp3) && r.mp3.length > 0, 'tem bytes');
  ok(r.mp3.slice(0, 3).toString('ascii') === 'ID3', 'e um MP3 (o dublê comeca com ID3)');
  ok(r.fonte === 'fake', 'reporta a fonte do TTS');
});

await test('5b. o TTS REAL gera MP3 de verdade (msedge-tts)', async () => {
  const r = await voz.gerarAudio({ texto: 'Oi! Aqui é a Lizzy.', sintetizarMp3 });
  if (!r.ok) { console.log(`     (pulado: ${r.motivo} — sem msedge-tts neste ambiente)`); return; }
  ok(Buffer.isBuffer(r.mp3) && r.mp3.length > 1000, `gerou ${r.mp3?.length} bytes`);
  // MP3: ID3 ou frame (0xFF 0xEx/0xFx).
  const h = r.mp3;
  const ehMp3 = h.slice(0, 3).toString('ascii') === 'ID3' || (h[0] === 0xFF && (h[1] & 0xE0) === 0xE0);
  ok(ehMp3, 'tem cabecalho de MP3');
  ok(r.fonte === 'msedge-tts', `fonte msedge-tts (veio ${r.fonte})`);
});

await test('6. a cadeia e FALHA FECHADA (erros controlados, sem lixo)', async () => {
  ok((await voz.gerarAudio({ texto: 'oi' })).motivo === 'sem_dependencias', 'sem deps');
  ok((await voz.gerarAudio({ texto: '', sintetizarMp3: sintetizarFake })).motivo === 'texto_vazio', 'texto vazio');
  ok((await voz.gerarAudio({ texto: 'oi', sintetizarMp3: async () => ({ ok: false, motivo: 'sem_tts' }) })).motivo === 'sem_tts', 'TTS falhou -> propaga');
  ok((await voz.gerarAudio({ texto: 'oi', sintetizarMp3: async () => { throw new Error('x'); } })).motivo === 'tts_falhou', 'TTS lancou -> controlado');
  ok((await voz.gerarAudio({ texto: 'oi', sintetizarMp3: async () => ({ ok: true, mp3: 'nao-e-buffer' }) })).motivo === 'audio_invalido', 'nao-buffer -> controlado');
});

await test('7. a mensagem de erro diz o que fazer', () => {
  for (const m of ['tts_falhou', 'sem_dependencias', 'texto_vazio', 'audio_invalido', 'tts_desativado', 'x']) {
    const t = voz.erroDaVoz(m);
    ok(typeof t === 'string' && t.length > 5 && !/undefined|null/.test(t), `motivo ${m} tem texto`);
  }
});

// ───────────────────────────────────────────────────────────────────────────
// 3) A INTEGRACAO NO HANDLER
// ───────────────────────────────────────────────────────────────────────────

await test('8. o handler manda AUDIO COMUM (ptt: false), nao nota de voz', () => {
  ok(INDEX.includes("from './utils/vozDaConversa.js'"), 'importa o modulo');
  ok(INDEX.includes('ehPedidoDeAudio(textoLimpo)'), 'usa o gatilho explicito');
  ok(INDEX.includes('gerarAudio('), 'chama a geracao');
  const i = INDEX.indexOf('gerarAudio(');
  // Sem os comentarios: o comentario do bloco CITA "ptt: true" para explicar
  // por que NAO se usa — comparar com o texto cru daria falso positivo.
  const bloco = INDEX.slice(i, i + 1400)
    .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  ok(/audio:\s*voz\.mp3/.test(bloco), 'manda o MP3 como audio');
  ok(/audio\/mpeg/.test(bloco), 'com o mimetype audio/mpeg');
  // O `ptt` NAO pode aparecer — nem `true` nem `false`.
  //
  // MEDIDO: no proto o `ptt` e' `optional`, entao `ptt: false` NAO e' omitido:
  // ele ESCREVE o campo no fio (tag 0x30, valor 0). E o WhatsApp trata **campo
  // presente** como nota de voz, mesmo valendo `false` — era o bug. O `!play`
  // (que sai como audio normal) NAO manda o campo.
  // `ptt: false` VOLTA (da' a marca de audio) e o `contextInfo` fica FORA.
  //
  // O que o dono MEDIU no aparelho (a tabela que fecha o caso):
  //   ptt:false + contextInfo  -> NOTA DE VOZ
  //   sem ptt   + contextInfo  -> NOTA DE VOZ   <- o `ptt` NAO era a causa
  //   sem ptt   + sem ctx      -> audio normal, mas o cliente desenha como
  //                               ENCAMINHAMENTO
  //
  // Entao: quem virava nota de voz era o `contextInfo`; e sem o `ptt` o audio
  // perde a marca de "do proprio bot" e sai como encaminhado.
  ok(/ptt:\s*false/.test(bloco), 'manda `ptt: false` (marca de audio)');
  ok(!/ptt:\s*true/.test(bloco), 'e NAO como nota de voz');
  ok(!/contextInfo\s*:/.test(bloco), 'NAO manda contextInfo (era o que virava nota de voz)');
  ok(!/gerarContextNewsletter/.test(bloco), 'nem o cabecalho de canal');
  // E nao depende de ffmpeg neste caminho.
  ok(!/toOggOpus/.test(bloco), 'nao passa por OGG/Opus (sem ffmpeg)');
  // E o gatilho roda ANTES do LLM de texto (senao ela responderia texto).
  const iPedido = INDEX.indexOf('ehPedidoDeAudio(textoLimpo)');
  const iIA = INDEX.indexOf('ia.makeAssistentRequest(', iPedido);
  ok(iPedido > 0 && iIA > iPedido, 'o pedido de audio e tratado antes do LLM de texto');
});

await test('9. o pedido de audio NAO e tratado como conversa normal (early return)', () => {
  const i = INDEX.indexOf('ehPedidoDeAudio(textoLimpo)');
  const bloco = INDEX.slice(i, i + 1600);
  // Tem de haver um `return` depois do envio (nao segue pro LLM de texto).
  ok(bloco.includes('return;'), 'ha early return (nao cai no fluxo de texto)');
});

console.log('\n============================================================');
const tot = RESULTS.reduce((a, r) => a + r.passed, 0);
const fal = RESULTS.reduce((a, r) => a + r.failed, 0);
console.log(`RESULTADO: ${RESULTS.length} testes | ${tot} asserções ok | ${fal} falhas`);
if (!FFMPEG) console.log('(sem ffmpeg: os testes de conversao foram pulados)');
console.log('============================================================');
process.exit(fal ? 1 : 0);
