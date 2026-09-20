/**
 * Validação ponta a ponta: o adaptador (arquivo entregue ao usuário) falando com
 * a API REAL da Lizzy, com a KEY REAL criada pelo servidor.
 *
 * Não usa mock: sobe o servidor de verdade, cria uma KEY de verdade, aponta o
 * adaptador para ele e executa uma ação de verdade.
 *
 * Uso: node tests/antifantasma-e2e.test.js
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import http from 'node:http';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.resolve(HERE, '..');
const require = createRequire(import.meta.url);

const TMP_DB = fs.mkdtempSync(path.join(os.tmpdir(), 'lizzy-af-e2e-'));
process.env.DATABASE_PATH = TMP_DB;
fs.mkdirSync(path.join(TMP_DB, 'antifantasma'), { recursive: true });

const api = await import(new URL('../dados/src/antifantasma/api.js', import.meta.url).href);

let ok = 0;
let fail = 0;
const erros = [];

function check(cond, msg) {
  if (cond) { ok += 1; console.log(`✅ ${msg}`); }
  else { fail += 1; erros.push(msg); console.log(`❌ ${msg}`); }
}

// ── 1) Sobe a API real ──────────────────────────────────────────────────────
const server = api.iniciarApi(0);
await new Promise((r) => setTimeout(r, 150));
const porta = server.address().port;
check(Boolean(porta), `API real no ar (porta ${porta})`);

// ── 2) O servidor cria uma KEY real ────────────────────────────────────────
const key = api.criarKey('instalacao e2e');
check(/^MTX-[0-9A-F]{6}$/.test(key), `KEY criada no formato MTX-XXXXXX (${key})`);

// ── 3) Prepara o adaptador EXATAMENTE como o usuário recebe ────────────────
const fonteOriginal = fs.readFileSync(
  path.join(PROJECT, 'dados', 'src', 'antifantasma-cliente', 'antifantasma.js'), 'utf-8'
);
const adaptadorPath = path.join(TMP_DB, 'antifantasma.cjs');
fs.writeFileSync(
  adaptadorPath,
  fonteOriginal
    .replace(/const API_URL = '[^']*';/, `const API_URL = 'http://127.0.0.1:${porta}/api/antifantasma/exec';`)
    .replace(/const KEY = '[^']*';/, `const KEY = '${key}';`)
);
const af = require(adaptadorPath);
check(typeof af.executar === 'function', 'adaptador carregado com a KEY configurada');

// ── 4) Execução real: ataque -> fecha/bani/reabre ──────────────────────────
const chamadas = [];
const sock = {
  groupSettingUpdate: async (g, tipo) => { chamadas.push(`setting:${tipo}`); },
  groupParticipantsUpdate: async (g, alvos, acao) => { chamadas.push(`participants:${acao}:${alvos[0]}`); },
  sendMessage: async (g, m) => { chamadas.push('aviso'); },
};

af.ativar();
const r = await af.executar({
  sock,
  grupo: '120363000000000000@g.us',
  autor: '5511999999999@s.whatsapp.net',
  contexto: {
    isGroup: true,
    botIsAdmin: true,
    sender: '5511999999999@s.whatsapp.net',
    selectiveDistribution: true,
    undecryptableGroupMessage: true,
  },
});

check(r.ok === true, 'execução retornou ok');
check(chamadas.includes('setting:announcement'), 'grupo foi FECHADO (close_group)');
check(chamadas.includes('participants:remove:5511999999999@s.whatsapp.net'), 'autor foi BANIDO (ban_user)');
check(chamadas.includes('setting:not_announcement'), 'grupo foi REABERTO (open_group)');
check(chamadas.includes('aviso'), 'aviso publicado no grupo');
check(r.acoes.length === 3, `três ações executadas (${r.acoes})`);

// ── 5) Mensagem normal: nada acontece ─────────────────────────────────────
const antes = chamadas.length;
const r2 = await af.executar({
  sock, grupo: '1200000000@g.us', autor: '5511999999999@s.whatsapp.net',
  contexto: { isGroup: true, botIsAdmin: true, sender: '5511999999999@s.whatsapp.net' },
});
check(r2.ok === true && r2.acoes.length === 0, 'mensagem normal não gera ação');
check(chamadas.length === antes, 'nenhuma operação de grupo para mensagem normal');

// ── 6) Desativado: nem chega na API ───────────────────────────────────────
af.desativar();
const antes2 = chamadas.length;
const r3 = await af.executar({
  sock, grupo: 'g@g.us', autor: 'x@s.whatsapp.net',
  contexto: { isGroup: true, botIsAdmin: true, sender: 'x@s.whatsapp.net', selectiveDistribution: true, undecryptableGroupMessage: true },
});
check(r3.ok === true && r3.acoes.length === 0, 'desativado não executa nada');
check(chamadas.length === antes2, 'desativado não toca no grupo');
af.ativar();

// ── 7) KEY revogada pelo servidor -> recusada ─────────────────────────────
api.revogarKey(key);
const respostas = [];
const r4 = await af.executar({
  sock, grupo: 'g@g.us', autor: 'x@s.whatsapp.net',
  reply: async (t) => respostas.push(t),
  contexto: { isGroup: true, botIsAdmin: true, sender: 'x@s.whatsapp.net', selectiveDistribution: true, undecryptableGroupMessage: true },
});
check(r4.ok === false, 'KEY revogada não executa');
check(respostas.some((t) => t.includes('KEY do AntiFantasma inválida')), 'avisa KEY inválida/revogada');

// ── 8) KEY nova funciona de novo (revogação é por KEY) ────────────────────
const key2 = api.criarKey('segunda');
const af2Path = path.join(TMP_DB, 'af2.cjs');
fs.writeFileSync(
  af2Path,
  fonteOriginal
    .replace(/const API_URL = '[^']*';/, `const API_URL = 'http://127.0.0.1:${porta}/api/antifantasma/exec';`)
    .replace(/const KEY = '[^']*';/, `const KEY = '${key2}';`)
);
const af2 = require(af2Path);
af2.ativar();
const chamadas2 = [];
const r5 = await af2.executar({
  sock: { groupSettingUpdate: async (g, t) => chamadas2.push(t), groupParticipantsUpdate: async () => chamadas2.push('ban'), sendMessage: async () => {} },
  grupo: 'g@g.us', autor: 'x@s.whatsapp.net',
  contexto: { isGroup: true, botIsAdmin: true, sender: 'x@s.whatsapp.net', selectiveDistribution: true, undecryptableGroupMessage: true },
});
check(r5.ok === true && chamadas2.length > 0, 'KEY nova volta a funcionar');

// ── 9) Tentativa de obter o código pela API ───────────────────────────────
const tentar = (caminho) => new Promise((resolve) => {
  const req = http.request({ hostname: '127.0.0.1', port: porta, path: caminho, method: 'GET' }, (res) => {
    let t = ''; res.on('data', (d) => { t += d; }); res.on('end', () => resolve({ status: res.statusCode, body: t }));
  });
  req.on('error', () => resolve({ status: 0, body: '' }));
  req.end();
});

for (const caminho of ['/core.js', '/api/antifantasma/source', '/api/antifantasma/code']) {
  const res = await tentar(caminho);
  check(res.status === 404, `${caminho} -> 404`);
  check(!/function|decidir|selectiveDistribution/.test(res.body), `${caminho} não devolve implementação`);
}

await new Promise((r) => server.close(r));

console.log('\n════════════════════════════════════════');
console.log(`E2E: ${ok} ok | ${fail} falhas`);
console.log('════════════════════════════════════════');

fs.rmSync(TMP_DB, { recursive: true, force: true });

if (fail) {
  console.log('\nFALHAS:');
  for (const e of erros) console.log(`- ${e}`);
  process.exit(1);
}
console.log('✅ FLUXO PONTA A PONTA VALIDADO');
process.exit(0);