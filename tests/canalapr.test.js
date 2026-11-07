/**
 * !canalapr <jid> — o canal pode publicar status?
 *
 * O comando consulta a capability `CHANNEL_STATUS_PRODUCER` (valor 19) pelo IQ
 * `w:mex` (query_id 9801384413216421). O teste roda o HANDLER REAL com um socket
 * falso que devolve a resposta do servidor e confere a leitura.
 *
 * Uso: node tests/canalapr.test.js
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'lizzy-canalapr-'));
process.env.DATABASE_PATH = TMP;
process.env.CONFIG_PATH = path.join(TMP, 'config.json');
fs.mkdirSync(path.join(TMP, 'grupos'), { recursive: true });
fs.writeFileSync(process.env.CONFIG_PATH, JSON.stringify({ nomebot: 'Lizzy', prefixo: '!', numerodono: '5599999999999', nomedono: 'Dono' }));

const RESULTS = []; let CURRENT = null;
function test(n, fn) { CURRENT = { n, p: 0, f: 0, e: [] }; RESULTS.push(CURRENT);
  try { const r = fn(); if (r?.then) return r.then(()=>fin()).catch(e=>{CURRENT.f++;CURRENT.e.push('EXC: '+(e?.stack||e));fin();}); fin(); }
  catch (e) { CURRENT.f++; CURRENT.e.push('EXC: '+(e?.stack||e)); fin(); } return Promise.resolve(); }
function fin() { console.log(`${CURRENT.f===0?'✅':'❌'} ${CURRENT.n} (${CURRENT.p} ok, ${CURRENT.f} falhas)`); for (const x of CURRENT.e) console.log('     '+x.split('\n')[0]); }
function ok(c,m){ if(c)CURRENT.p++; else {CURRENT.f++;CURRENT.e.push('ASSERT: '+m);} }
function contem(h,n,m){ ok(typeof h==='string'&&h.includes(n), `${m||n} — esperado "${n}"`); }

const mod = await import(new URL('../dados/src/index.js', import.meta.url).href);
const handle = mod.default ?? mod;

let gc = 0; const JID = '120363410980452460@newsletter';

/** Socket falso. `caps` controla o que o servidor "responde". */
function makeNazu({ sent, caps = [], erro = null, semResult = false }) {
  return {
    sendMessage: async (jid, c, o) => { sent.push({ jid, content: c, options: o }); return { key: { id: 'X'+sent.length } }; },
    user: { id: '5599999999999:5@s.whatsapp.net', lid: '111111111111111@lid', name: 'Lizzy' },
    generateMessageTag: () => 'TAG'+Math.random().toString(36).slice(2),
    query: async (node) => {
      const vars = JSON.parse(node.content[0].content.toString());
      // confere o IQ montado
      sent.push({ iq: node, vars });
      if (erro) return { content: [{ tag: 'result', content: Buffer.from(JSON.stringify({ errors: [erro] })) }] };
      if (semResult) return { content: [] };
      return { content: [{ tag: 'result', content: Buffer.from(JSON.stringify({
        data: { xwa2_newsletter_admin: { capabilities: caps } }
      })) }] };
    },
    onWhatsApp: async (j) => [{ jid: j, exists: true }],
    signalRepository: { lidMapping: { getPNForLID: async () => null } },
    groupMetadata: async () => ({ id: 'x@g.us', subject: 'G', participants: [] }),
    ev: { on: () => {}, emit: () => {}, removeAllListeners: () => {} },
    readMessages: async () => {}, sendPresenceUpdate: async () => {},
    profilePictureUrl: async () => 'x', react: async () => ({}),
  };
}

let senderN = 0;
async function rodar({ text, caps, erro, semResult }) {
  const sent = [];
  const nazu = makeNazu({ sent, caps, erro, semResult });
  // Sender NOVO por chamada: o handler limita 3 comandos/5s por remetente, e
  // reusar o mesmo faria o 4o responder "Calma ai!" em vez do comando.
  senderN += 1;
  const sender = `551190000${String(senderN).padStart(4, '0')}@s.whatsapp.net`;
  await handle(nazu, {
    key: { remoteJid: '120363000000000001@g.us', fromMe: false, id: 'M'+Math.random(), participant: sender },
    message: { extendedTextMessage: { text, contextInfo: {} } },
    messageTimestamp: 1757900000, pushName: 'Tester'
  }, null, new Map(), null);
  const texto = sent.map((s) => s.content?.text ?? '').filter(Boolean).join('\n');
  return { sent, texto };
}

await test('1. canal AUTORIZADO (tem CHANNEL_STATUS_PRODUCER)', async () => {
  const { sent, texto } = await rodar({ text: '!canalapr '+JID, caps: ['INSIGHTS','QUESTIONS','CHANNEL_STATUS_PRODUCER'] });
  const iq = sent.find((s) => s.iq);
  ok(!!iq, 'fez a consulta');
  ok(iq.iq.attrs.xmlns === 'w:mex', 'xmlns w:mex');
  ok(iq.iq.attrs.to === 's.whatsapp.net', 'destino certo');
  ok(iq.iq.content[0].attrs.query_id === '9801384413216421', 'query_id certo');
  ok(iq.vars.variables.newsletter_id === JID, 'mandou o jid do canal');
  contem(texto, 'AUTORIZADO', 'diz que está autorizado');
  contem(texto, 'CHANNEL_STATUS_PRODUCER', 'lista a capability');
});

await test('2. canal NAO autorizado (sem a capability)', async () => {
  const { texto } = await rodar({ text: '!canalapr '+JID, caps: ['INSIGHTS','QUESTIONS'] });
  contem(texto, 'NÃO autorizado', 'diz que NÃO está autorizado');
  contem(texto, 'descarta em silêncio', 'explica a consequência');
  ok(!texto.includes('CHANNEL_STATUS_PRODUCER'), 'não lista a capability que falta');
});

await test('3. sem canal nenhum lista as permissoes', async () => {
  const { texto } = await rodar({ text: '!canalapr '+JID, caps: [] });
  contem(texto, 'NÃO autorizado', 'recusa sem capability');
  contem(texto, '(nenhuma)', 'mostra que não há permissões');
});

await test('4. sem argumento mostra o uso', async () => {
  const { sent, texto } = await rodar({ text: '!canalapr' });
  ok(!sent.find((s) => s.iq), 'não consultou nada');
  contem(texto, 'Use:', 'mostra o uso');
});

await test('5. JID que nao e canal e recusado', async () => {
  const { sent, texto } = await rodar({ text: '!canalapr 120363000000000001@g.us' });
  ok(!sent.find((s) => s.iq), 'não consultou');
  contem(texto, '@newsletter', 'explica o formato');
});

await test('6. erro do servidor e reportado (nao trava)', async () => {
  const { texto } = await rodar({ text: '!canalapr '+JID, erro: { message: 'Not Authorized' } });
  contem(texto, 'Not Authorized', 'mostra o erro do servidor');
});

await test('7. resposta sem dados avisa (nao quebra)', async () => {
  const { texto } = await rodar({ text: '!canalapr '+JID, semResult: true });
  contem(texto, 'sem dados', 'avisa que veio sem dados');
});

console.log('════════════════════════════════════════');
const tOk = RESULTS.reduce((a,r)=>a+r.p,0), tF = RESULTS.reduce((a,r)=>a+r.f,0);
console.log(`RESULTADO: ${RESULTS.length} testes | ${tOk} asserções ok | ${tF} falhas`);
console.log('════════════════════════════════════════');
fs.rmSync(TMP,{recursive:true,force:true});
if (tF > 0) { console.log('\nFALHAS:'); for (const r of RESULTS) if (r.f) for (const e of r.e) console.log(`- [${r.n}] ${e}`); process.exit(1); }
console.log('✅ TODOS OS TESTES PASSARAM'); process.exit(0);
