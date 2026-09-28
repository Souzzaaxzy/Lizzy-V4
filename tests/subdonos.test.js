/**
 * Testes do SISTEMA DE SUBDONOS (`utils/subdonos.js`) + integração no handler.
 *
 * O sistema antigo tinha a lista em `subdonos.json` E uma "lista base" global em
 * `subOwnerCommands.json`, além de um `subowner_perms.json` que ninguém lia
 * (código morto). Tudo espalhado por `index.js`/`database.js`, com comparação
 * frágil por "base do número".
 *
 * O novo (modelo do bot de referência RAVENA-BOT):
 *   - permissões POR SUBDONO (`perms`) + uma lista base opcional;
 *   - identidade por qualquer forma (LID/JID/número);
 *   - escrita atômica, com migração do formato v1.
 *
 * Uso: node tests/subdonos.test.js
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const TMP_DB = fs.mkdtempSync(path.join(os.tmpdir(), 'lizzy-sub-'));
process.env.DATABASE_PATH = TMP_DB;
const DONO_DIR = path.join(TMP_DB, 'dono');
const DATABASE_DIR = TMP_DB;
fs.mkdirSync(DONO_DIR, { recursive: true });
const SUB_FILE = path.join(DONO_DIR, 'subdonos.json');

const sub = await import(new URL('../dados/src/utils/subdonos.js', import.meta.url).href);

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
  for (const err of CURRENT.errors) console.log(`     ${err.split('\n')[0]}`);
}
function ok(cond, msg) {
  if (cond) CURRENT.passed += 1;
  else { CURRENT.failed += 1; CURRENT.errors.push(`ASSERT FALHOU: ${msg}`); }
}
function eq(a, b, msg) {
  ok(a === b, `${msg} — esperado ${JSON.stringify(b)}, obtido ${JSON.stringify(a)}`);
}
function reset() {
  try { fs.rmSync(SUB_FILE, { force: true }); } catch {}
  try { fs.rmSync(path.join(DATABASE_DIR, 'subOwnerCommands.json'), { force: true }); } catch {}
}
function banco() {
  try { return JSON.parse(fs.readFileSync(SUB_FILE, 'utf-8')); } catch { return {}; }
}

const LID = '111000000000001@lid';
const JID = '5511999999999@s.whatsapp.net';
const NUM = '5511999999999';

// ============================================================================
// 1) IDENTIDADE
// ============================================================================

await test('1. normalizarJid / baseNumero / formasDeId', () => {
  eq(sub.normalizarJid('5511999999999'), JID, 'número -> JID');
  eq(sub.normalizarJid('5511999999999:14@s.whatsapp.net'), JID, 'remove :device');
  eq(sub.normalizarJid(LID), LID, 'LID fica');
  eq(sub.baseNumero(LID), '111000000000001', 'base do LID');
  ok(sub.formasDeId(JID).has(JID), 'formas inclui o JID');
  ok(sub.formasDeId(NUM).size >= 2, 'número gera várias formas');
});

await test('2. mesmoUsuario: JID, LID e número do MESMO telefone batem', () => {
  ok(sub.mesmoUsuario(JID, '5511999999999@s.whatsapp.net'), 'JID == JID');
  ok(sub.mesmoUsuario(JID, NUM), 'JID == número');
  ok(!sub.mesmoUsuario(JID, '5511888888888@s.whatsapp.net'), 'números diferentes');
});

// ============================================================================
// 2) MIGRAÇÃO (formato v1)
// ============================================================================

await test('3. migra a lista v1 (["id"]) para o formato v2 (objetos)', () => {
  reset();
  fs.writeFileSync(SUB_FILE, JSON.stringify({ subdonos: [LID, JID] }, null, 2));
  const bancoV2 = sub.carregar();
  eq(bancoV2.version, 2, 'virou v2');
  // LID=111000000000001 e JID=5511999999999 têm bases diferentes -> 2 registros.
  eq(bancoV2.subdonos.length, 2, 'manteve os 2 (bases diferentes)');
  ok(bancoV2.subdonos.every((s) => typeof s === 'object' && s.id), 'todos viraram objeto com id');
  // persistiu no formato novo
  ok(banco().version === 2, 'gravou v2 no disco');
});

await test('4. migra a "lista base" antiga (subOwnerCommands.json)', () => {
  reset();
  fs.writeFileSync(path.join(DATABASE_DIR, 'subOwnerCommands.json'), JSON.stringify(['play', 'ping']));
  const bancoV2 = sub.carregar();
  ok(bancoV2.basePerms.includes('play') && bancoV2.basePerms.includes('ping'), 'base veio do arquivo antigo');
});

await test('5. formato corrompido não explode (vira vazio)', () => {
  reset();
  fs.writeFileSync(SUB_FILE, '{ isso nao e json');
  const b = sub.carregar();
  eq(b.subdonos.length, 0, 'vazio');
  eq(b.basePerms.length, 0, 'base vazia');
  ok(sub.normalizarBanco('lixo').subdonos.length === 0, 'normalizarBanco aguenta string');
  ok(sub.normalizarBanco(null).subdonos.length === 0, 'normalizarBanco aguenta null');
});

// ============================================================================
// 3) CRUD
// ============================================================================

await test('6. adicionar: grava, aceita número e evita duplicado', () => {
  reset();
  const r1 = sub.adicionar(NUM);
  ok(r1.success && r1.criado, 'adicionou pelo número');
  ok(sub.isSubdono(NUM), 'achou pelo número');
  ok(sub.isSubdono(JID), 'achou pelo JID (mesma pessoa)');
  const r2 = sub.adicionar(JID);
  ok(!r2.success, 'não duplica');
  eq(sub.listar().length, 1, 'só 1');
});

await test('7. adicionar recusa o DONO', () => {
  reset();
  const r = sub.adicionar('5599999999999@s.whatsapp.net', { numerodono: '5599999999999' });
  ok(!r.success && /Dono principal/.test(r.message), 'recusou o dono');
});

await test('8. remover por id e por ÍNDICE', () => {
  reset();
  sub.adicionar('5511000000001@s.whatsapp.net');
  sub.adicionar('5511000000002@s.whatsapp.net');
  const porIndice = sub.remover(1);
  ok(porIndice.success, 'removeu pelo índice 1');
  eq(sub.listar().length, 1, 'sobrou 1');
  const porId = sub.remover('5511000000002@s.whatsapp.net');
  ok(porId.success, 'removeu pelo id');
  eq(sub.listar().length, 0, 'zerou');
  ok(!sub.remover('5511000000003@s.whatsapp.net').success, 'inexistente falha');
});

// ============================================================================
// 4) PERMISSÕES (o coração do novo modelo)
// ============================================================================

await test('9. permissões POR SUBDONO (o outro subdono NÃO herda)', () => {
  reset();
  sub.adicionar('5511000000001@s.whatsapp.net');
  sub.adicionar('5511000000002@s.whatsapp.net');
  sub.liberarComando('5511000000001@s.whatsapp.net', 'play');
  ok(sub.podeUsar('5511000000001@s.whatsapp.net', 'play'), 'o 1 pode');
  ok(!sub.podeUsar('5511000000002@s.whatsapp.net', 'play'), 'o 2 NÃO pode');
});

await test('10. a LISTA BASE vale para todos os subdonos', () => {
  reset();
  sub.adicionar('5511000000001@s.whatsapp.net');
  sub.adicionar('5511000000002@s.whatsapp.net');
  sub.addBasePerm('perfil');
  ok(sub.podeUsar('5511000000001@s.whatsapp.net', 'perfil'), 'o 1 pode pela base');
  ok(sub.podeUsar('5511000000002@s.whatsapp.net', 'perfil'), 'o 2 pode pela base');
  ok(!sub.podeUsar('5511999999999@s.whatsapp.net', 'perfil'), 'não-subdono NÃO pode');
});

await test('11. permissão efetiva = base + específicas', () => {
  reset();
  sub.adicionar('5511000000001@s.whatsapp.net');
  sub.addBasePerm('ping');
  sub.liberarComando('5511000000001@s.whatsapp.net', 'play');
  const perms = sub.permissoesDe('5511000000001@s.whatsapp.net');
  ok(perms.includes('ping') && perms.includes('play'), 'tem as duas');
});

await test('12. revogar remove a permissão específica', () => {
  reset();
  sub.adicionar('5511000000001@s.whatsapp.net');
  sub.liberarComando('5511000000001@s.whatsapp.net', 'play');
  ok(sub.podeUsar('5511000000001@s.whatsapp.net', 'play'), 'pode antes');
  const r = sub.revogarComando('5511000000001@s.whatsapp.net', 'play');
  ok(r.success, 'revogou');
  ok(!sub.podeUsar('5511000000001@s.whatsapp.net', 'play'), 'não pode depois');
});

await test('13. comandos com prefixo (!play) são normalizados', () => {
  reset();
  sub.adicionar('5511000000001@s.whatsapp.net');
  sub.liberarComando('5511000000001@s.whatsapp.net', '!play');
  ok(sub.podeUsar('5511000000001@s.whatsapp.net', 'play'), 'gravou sem prefixo');
  ok(sub.podeUsar('5511000000001@s.whatsapp.net', '/play'), 'aceita /');
});

await test('14. gerir permissão de quem NÃO é subdono falha', () => {
  reset();
  const r = sub.liberarComando('5511000000009@s.whatsapp.net', 'play');
  ok(!r.success && /não é subdono/.test(r.message), 'recusou');
});

// ============================================================================
// 5) PERSISTÊNCIA / ROBUSTEZ
// ============================================================================

await test('15. a escrita é atômica e o arquivo é JSON válido', () => {
  reset();
  sub.adicionar('5511000000001@s.whatsapp.net');
  sub.addBasePerm('ping');
  const bruto = fs.readFileSync(SUB_FILE, 'utf-8');
  const parsed = JSON.parse(bruto); // não lança = JSON válido
  eq(parsed.version, 2, 'tem version');
  ok(!bruto.includes('.tmp'), 'não sobrou arquivo temporário no conteúdo');
});

await test('16. resiliência: id inválido é recusado', () => {
  reset();
  ok(!sub.adicionar('').success, 'vazio');
  ok(!sub.adicionar(null).success, 'null');
  ok(!sub.adicionar('   ').success, 'espaços');
});

await test('17. listarBasePerms e permsProprias', () => {
  reset();
  sub.adicionar('5511000000001@s.whatsapp.net');
  sub.addBasePerm('ping');
  sub.liberarComando('5511000000001@s.whatsapp.net', 'play');
  eq(sub.listarBasePerms().join(','), 'ping', 'base só tem ping');
  eq(sub.permsProprias('5511000000001@s.whatsapp.net').join(','), 'play', 'próprias só tem play');
});

await test('18. IDENTIDADE entre formas: LID x número (o caso que quebrava)', () => {
  reset();
  const LID_USER = '5551000000003@lid';
  const PN_USER = '5511000000003@s.whatsapp.net';
  // O dono registra pelo NÚMERO (como o addsubdono faz via onWhatsApp).
  sub.adicionar(PN_USER);
  // Em grupo o remetente chega como LID -> as BASES diferem.
  ok(sub.isSubdonoEntre([LID_USER, PN_USER]), 'reconhece pelo conjunto de formas');
  ok(!sub.isSubdono(LID_USER), 'só o LID não bastaria (bases diferentes)');
  sub.liberarComando(PN_USER, 'play');
  ok(sub.podeUsarEntre([LID_USER, PN_USER], 'play'), 'pode pelo conjunto');
  ok(!sub.podeUsarEntre(['5511888888888@s.whatsapp.net'], 'play'), 'outro número NÃO pode');
});
await test('19. alias explícito passa a resolver a outra forma', () => {
  reset();
  const PN_USER = '5511000000004@s.whatsapp.net';
  const LID_USER = '5551000000004@lid';
  sub.adicionar(PN_USER);
  sub.addAlias(PN_USER, LID_USER);
  ok(sub.isSubdono(LID_USER), 'agora o LID resolve sozinho');
});
await test('20. MAX_SUBDONOS (5): o 6º não entra', () => {
  reset();
  for (let i = 1; i <= 5; i++) {
    ok(sub.adicionar(`551100000000${i}@s.whatsapp.net`).success, `adicionou o ${i}`);
  }
  eq(sub.listar().length, 5, '5 subdonos');
  const r6 = sub.adicionar('5511000000006@s.whatsapp.net');
  ok(!r6.success && /Limite de 5 subdonos/.test(r6.message), 'recusou o 6º com o teto');
  eq(sub.listar().length, 5, 'continua 5');
});

// ============================================================================
// RESUMO
// ============================================================================

const totalOk = RESULTS.reduce((a, r) => a + r.passed, 0);
const totalFail = RESULTS.reduce((a, r) => a + r.failed, 0);
console.log(`\n${totalFail === 0 ? '✅' : '❌'} ${RESULTS.length} testes / ${totalOk} asserções (${totalFail} falhas)`);
process.exit(totalFail === 0 ? 0 : 1);
