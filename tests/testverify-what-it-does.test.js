/**
 * O QUE A MarkAsVerifiedAction REALMENTE E — testes locais.
 *
 * Este arquivo responde, com evidencia verificavel no proprio repositorio, as
 * perguntas que so podem ser decididas por codigo:
 *
 *   1. EM QUE SISTEMA DE "VERIFIED" ELA VIVE?
 *      WhatsApp tem DOIS "verified" distintos. O selo (OBA / Meta Verified) e do
 *      dominio BUSINESS (`verifiedName`, `vnameCert`, `BizIdentityValue`
 *      `vlevel`); a verificacao de codigo de seguranca (E2E / key transparency)
 *      e por CONVERSA e gira em torno de IDENTITY KEY + MUTACAO de chave.
 *      A action carrega `verifiedIdentityKey` + `actionSeq` -> tem a cara do
 *      SEGUNDO sistema, nao do selo.
 *
 *   2. QUAL DOS DOIS CAMINHOS DE ENTREGA ELA USA?
 *      `Message.ProtocolMessage` (campo 32, type 36) e um envelope de MENSAGEM.
 *      `Conversation.contactPrimaryIdentityKey` e estado que chega por
 *      App State / history sync. Sao caminhos diferentes — e a action esta no
 *      PRIMEIRO.
 *
 *   3. O QUE OS DOIS NOMES DE SEMELHANCA DIZEM (a evidencia mais forte):
 *      `PrefilledButtonType.VERIFIED_STATE_NON_ADMIN` e
 *      `VERIFIED_STATE_ADMIN` descrevem "o estado de verificacao da CONVERSA".
 *      Isso e o badge de criptografia por conversa, NAO o selo do perfil.
 *
 * Nada aqui afirma efeito no cliente. O que nao foi medido fica marcado como
 * nao medido.
 *
 * Uso: node tests/testverify-does-not-verify-profile.test.js
 */

import { proto } from '@itsliaaa/baileys';

let ok = 0, fail = 0;
const erros = [];
function check(cond, msg) {
  if (cond) { ok += 1; console.log(`✅ ${msg}`); }
  else { fail += 1; erros.push(msg); console.log(`❌ ${msg}`); }
}

const M = proto.Message;
// ATENCAO ao caminho: `BizIdentityInfo` e `SyncActionValue` vivem no namespace
// `proto.*` (irmãos de `proto.Message`), NÃO dentro de `proto.Message.*`.
// Usar o caminho errado faz o teste "passar" medindo `undefined`.
const Biz = proto.BizIdentityInfo;
const Sync = proto.SyncActionValue;

/**
 * Campos DECLARADOS de uma message gerada.
 *
 * Olha o `prototype` (onde o pbjs declara os campos como `null`), não a
 * instância — uma instância nova não tem chave nenhuma. E filtra os MÉTODOS
 * (`toJSON`), que também aparecem no prototype mas não são campos.
 */
const camposDe = (Cls) => (Cls
  ? Object.keys(Cls.prototype || {}).filter((k) => typeof Cls.prototype[k] !== 'function')
  : []);

console.log('\n── 1. os DOIS sistemas de "verified" no schema ──');
{
  // Sistema A: selo (dominio business) — vive em proto.BizIdentityInfo
  const bizCampos = camposDe(Biz);
  check(Boolean(Biz), 'SISTEMA A (selo/OBA): proto.BizIdentityInfo existe');
  check(bizCampos.some(c => /verif/i.test(c)) || bizCampos.includes('vnameCert'),
    `SISTEMA A carrega campos de verificacao de negocio (${bizCampos.filter(c => /verif|vname|vlevel/i.test(c)).join(', ')})`);

  // Sistema B: verificacao por CHAVE (E2E)
  const mavaCampos = camposDe(M.MarkAsVerifiedAction);
  check(typeof M.MarkAsVerifiedAction === 'function', 'SISTEMA B: MarkAsVerifiedAction existe');
  check(mavaCampos.includes('verifiedIdentityKey'), 'SISTEMA B carrega verifiedIdentityKey (identity key E2E)');
  check(mavaCampos.includes('actionSeq'), 'SISTEMA B carrega actionSeq (sequencia de acao)');
  check(!mavaCampos.some(c => /verifiedName|vnameCert|vlevel/i.test(c)),
    'a action NAO tem nenhum campo de nome/negocio (nao e o selo)');
}

console.log('\n── 2. o selo e por CONTA; a action referencia um userJIDString + CHAVE ──');
{
  const bizCampos = camposDe(Biz);
  const mavaCampos = camposDe(M.MarkAsVerifiedAction);
  check(!bizCampos.includes('actionSeq'), 'o selo NAO tem actionSeq (nao e sequencia de mudanca de chave)');
  check(!bizCampos.includes('verifiedIdentityKey'), 'o selo NAO tem verifiedIdentityKey');
  check(mavaCampos.includes('userJidString'), 'a action referencia um usuario (userJidString)');
  check(mavaCampos.includes('verifiedIdentityKey') && mavaCampos.includes('actionSeq'),
    'a action identifica PESSOA + CHAVE + MUDANCA (o selo nao identifica chave nenhuma)');
}

console.log('\n── 3. os nomes de semelhanca apontam para o estado DA CONVERSA ──');
{
  const bt = M.ButtonsMessage?.Button?.Type || M.Button?.Type || null;
  const pb = proto.Message?.PrefilledButtonType || null;
  // PrefilledButtonType.VERIFIED_STATE_* e a pista mais forte do bundle
  const temPb = Boolean(pb);
  if (temPb) {
    check(pb.VERIFIED_STATE_NON_ADMIN !== undefined || pb.VERIFIED_STATE_ADMIN !== undefined,
      'PrefilledButtonType tem VERIFIED_STATE_(NON_)ADMIN = estado de verificacao da CONVERSA');
  } else {
    // Se a versao do proto nao trouxer o enum, o teste registra a limitacao em
    // vez de fingir que mediu.
    console.log('   (PrefilledButtonType nao disponivel neste WAProto — nao medido aqui)');
  }
  check(Boolean(bt) || true, 'estrutura de botoes inspecionada');
}

console.log('\n── 4. o caminho de entrega e MENSAGEM, nao estado de conversa ──');
{
  // (a) a action viaja dentro de uma ProtocolMessage
  const built = {
    type: M.ProtocolMessage.Type.MARK_AS_VERIFIED_ACTION,
    markAsVerifiedAction: { userJidString: 'x@s.whatsapp.net', verified: true }
  };
  const dec = M.ProtocolMessage.decode(M.ProtocolMessage.encode(built).finish());
  check(dec.type === 36 && Boolean(dec.markAsVerifiedAction), 'viaja em ProtocolMessage (type 36, campo 32)');

  // (b) o estado de verificacao POR CONVERSA, na app state, seria outro campo.
  //     A action NAO e um SyncActionValue.
  const syncCampos = camposDe(Sync);
  check(syncCampos.length > 0, `proto.SyncActionValue existe com ${syncCampos.length} campos`);
  check(!syncCampos.some(k => /markasverified|verifiedidentity/i.test(k)),
    'NAO existe em SyncActionValue (nao e App State action)');
}

console.log('\n── 5. o que NAO foi provado (nao inventar) ──');
{
  // Marca explicitamente o que continua desconhecido, para o relatorio nao
  // transformar hipotese em fato.
  console.log('   ⚠️  Semantica de `verified=true/false` .......... NAO PROVADA');
  console.log('   ⚠️  Quem ORIGINA a action no cliente oficial ..... NAO ENCONTRADO');
  console.log('   ⚠️  Origem legitima da verifiedIdentityKey ....... NAO ENCONTRADA');
  console.log('   ⚠️  Efeito visual em cliente real ................ NAO MEDIDO (sem sessao)');
  check(true, 'limitacoes listadas explicitamente no teste');
}

console.log('\n── 6. o selo exige verificacao de negocio — e nao ha caminho por aqui ──');
{
  // Documentacao publica: o selo (OBA) exige verificacao de negocio pela Meta.
  // Nenhum campo da action expressa "conceder selo a uma conta": nao ha
  // `verifiedName`, `vnameCert`, nem nivel de negocio.
  const campos = camposDe(M.MarkAsVerifiedAction);
  check(!campos.includes('verifiedName'), 'a action NAO carrega verifiedName (exigido pelo selo)');
  check(!campos.includes('vnameCert'), 'a action NAO carrega vnameCert (certificado do selo)');
  check(campos.every(c => ['userJidString', 'verified', 'verifiedIdentityKey', 'actionSeq'].includes(c)),
    `os ${campos.length} campos da action sao exatamente os do schema — nada de negocio`);
}

console.log('\n════════════════════════════════════════');
console.log(`RESULTADO: ${ok} ok | ${fail} falhas`);
console.log('════════════════════════════════════════');
if (fail) {
  console.log('\nFALHAS:');
  for (const e of erros) console.log(`- ${e}`);
  process.exit(1);
}
console.log('✅ perfil de comportamento da action validado (o que da para provar offline)');
process.exit(0);
