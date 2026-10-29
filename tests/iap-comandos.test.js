/**
 * Comandos por VOZ do `!iap` — o dono pede falando e a Lizzy executa.
 *
 * Roda o modulo PURO (`iapComandos.js`) e o caminho REAL do `pensarComIa`
 * (comandos injetados), sem socket e sem LLM.
 */
import { identificarComando, COMANDOS_VOZ, frasesDeAjuda, ehComandoPermitido }
  from '../dados/src/utils/iapComandos.js';
import { pensarComIa } from '../dados/src/utils/iapSessao.js';
import { setGroqHttpForTest } from '../dados/src/utils/groqClient.js';

const RESULTS = [];
async function test(nome, fn) {
  let ok = 0, fail = 0;
  try { await fn((cond, msg) => { if (cond) ok++; else { fail++; console.log(`     ASSERT FALHOU: ${msg}`); } }); }
  catch (e) { fail++; console.log(`     EXCECAO: ${e?.message || e}`); }
  RESULTS.push({ nome, ok, fail });
  console.log(`${fail === 0 ? '✅' : '❌'} ${nome} (${ok} ok, ${fail} falhas)`);
}

// ============================================================================
// 1) IDENTIFICACAO (modulo puro)
// ============================================================================

await test('identifica: !play por varias frases', (ok) => {
  const casos = [
    ['oi Lizzy, procura a musica Evidencias para mim', 'Evidencias'],
    ['toca aquela musica do Legiao Urbana', 'Legiao Urbana'],
    ['Lizzy, coloca Back to Black', 'Back to Black'],
    ['toca Evidencias', 'Evidencias'],
    ['baixa a musica Blinding Lights', 'Blinding Lights'],
    ['quero ouvir musica do Djavan', 'Djavan'],
    ['bota um som do Tim Maia', 'Tim Maia']
  ];
  for (const [fala, esperado] of casos) {
    const r = identificarComando(fala);
    ok(r && r.comando === 'play', `"${fala}" -> play (${r ? r.comando : 'null'})`);
    ok(r && r.args === esperado, `args de "${fala}" = "${r?.args}" (esperado "${esperado}")`);
  }
});

await test('identifica: !tiktok (link e nome)', (ok) => {
  const link = identificarComando('baixa o video do tiktok https://vm.tiktok.com/xyz');
  ok(link && link.comando === 'tiktok', 'reconheceu o tiktok pelo link');
  ok(link && link.args === 'https://vm.tiktok.com/xyz', `link preservado (${link?.args})`);
  const nome = identificarComando('Lizzy baixa o video do tiktok do gato');
  ok(nome && nome.comando === 'tiktok' && nome.args === 'gato', `por nome (${nome?.args})`);
});

await test('identifica: !pin (pinterest)', (ok) => {
  const a = identificarComando('procura no pinterest gatinhos fofos');
  ok(a && a.comando === 'pin' && a.args === 'gatinhos fofos', `args (${a?.args})`);
  const b = identificarComando('Lizzy, pesquisa no pinterest decoracao de quarto');
  ok(b && b.comando === 'pin', 'reconheceu pelo "pesquisa no pinterest"');
});

await test('identifica: !figualeatoria (sem argumento)', (ok) => {
  for (const fala of ['manda uma figurinha aleatoria', 'Lizzy manda uma figura aleatoria', 'manda um sticker aleatorio']) {
    const r = identificarComando(fala);
    ok(r && r.comando === 'figualeatoria', `"${fala}" -> figualeatoria (${r?.comando})`);
    ok(r && r.args === '', 'nao inventa argumento');
  }
});

await test('NAO confunde conversa com comando (falsos positivos)', (ok) => {
  const naoComandos = [
    'oi Lizzy tudo bem?', 'que musica boa essa', 'eu amo essa musica',
    'como toca violao?', 'toca piano', 'nao toca nada agora',
    'me conta uma piada', 'qual seu nome?', 'obrigado Lizzy', ''
  ];
  for (const fala of naoComandos) {
    const r = identificarComando(fala);
    ok(r === null, `"${fala}" virou conversa (${r ? r.comando : 'ok'})`);
  }
});

await test('desambigua: "procura a musica X" x "procura no pinterest X"', (ok) => {
  // A plataforma vence a acao generica — senao o pinterest viraria play.
  ok(identificarComando('procura no pinterest gatinhos')?.comando === 'pin', 'pinterest -> pin');
  ok(identificarComando('procura a musica Evidencias')?.comando === 'play', 'musica -> play');
  ok(identificarComando('toca o video do tiktok do gato')?.comando === 'tiktok', 'tiktok vence');
});

await test('a lista de comandos e a FONTE UNICA (allowlist)', (ok) => {
  ok(Object.keys(COMANDOS_VOZ).sort().join(',') === 'figualeatoria,pin,play,tiktok',
    `os 4 comandos (${Object.keys(COMANDOS_VOZ).join(',')})`);
  ok(ehComandoPermitido('play') === true, 'play permitido');
  ok(ehComandoPermitido('ban') === false, 'ban NAO permitido por voz');
  ok(ehComandoPermitido('kick') === false, 'kick NAO permitido');
  ok(/toca a musica Evidencias/.test(frasesDeAjuda()), 'a ajuda cita o exemplo do play');
});

// ============================================================================
// 2) EXECUCAO (pensarComIa, com o executor injetado)
// ============================================================================

await test('DONO pedindo "toca Evidencias" -> executa o play', async (ok) => {
  const chamadas = [];
  const r = await pensarComIa('toca Evidencias', [], {
    quemFalou: 'dono@s.whatsapp.net',
    ehDono: (jid) => jid === 'dono@s.whatsapp.net',
    executarComando: async (cmd, args, quem) => { chamadas.push([cmd, args, quem]); return true; }
  });
  ok(chamadas.length === 1, `executou uma vez (${chamadas.length})`);
  ok(chamadas[0]?.[0] === 'play', `comando play (${chamadas[0]?.[0]})`);
  ok(chamadas[0]?.[1] === 'Evidencias', `args (${chamadas[0]?.[1]})`);
  ok(/executei o play/i.test(r), `respondeu que executou (${r})`);
});

await test('QUALQUER pessoa pedindo comando -> EXECUTA (decisao do dono)', async (ok) => {
  // O dono pediu: "qualquer pessoa pode usar". A mensagem e' reemitida com QUEM
  // FALOU como autor, entao as permissoes do bot valem para ele normalmente.
  const chamadas = [];
  const r = await pensarComIa('toca Evidencias', [], {
    quemFalou: 'membro@s.whatsapp.net',
    ehDono: () => false,
    executarComando: async (cmd, args, quem) => { chamadas.push([cmd, args, quem]); return true; }
  });
  ok(chamadas.length === 1, `executou (${chamadas.length})`);
  ok(chamadas[0]?.[0] === 'play', 'comando play');
  ok(chamadas[0]?.[2] === 'membro@s.whatsapp.net', `em nome de quem falou (${chamadas[0]?.[2]})`);
  ok(/executei o play/i.test(r), `confirmou (${r})`);
});

await test('sem saber quem falou -> executa sem autor definido', async (ok) => {
  // Qualquer um pode pedir; sem `participantJid` o comando roda com o autor
  // original da mensagem (o bot). Nao ha' recusa por permissao aqui.
  const chamadas = [];
  await pensarComIa('toca Evidencias', [], {
    quemFalou: null,
    executarComando: async (cmd, args, quem) => { chamadas.push([cmd, quem]); return true; }
  });
  ok(chamadas.length === 1, 'executou');
  ok(chamadas[0]?.[1] === null, 'sem autor (quemFalou nulo)');
});

await test('pedido de comando SEM argumento -> pergunta, nao executa as cegas', async (ok) => {
  const chamadas = [];
  const r = await pensarComIa('baixa um video do tiktok', [], {
    quemFalou: 'dono@s.whatsapp.net',
    ehDono: () => true,
    executarComando: async (cmd, args) => { chamadas.push([cmd, args]); return true; }
  });
  ok(chamadas.length === 0, 'nao executou sem o termo');
  ok(/o que voce quer|fala o nome/i.test(r), `perguntou (${r})`);
});

await test('figualeatoria executa SEM argumento', async (ok) => {
  const chamadas = [];
  await pensarComIa('manda uma figurinha aleatoria', [], {
    quemFalou: 'dono@s.whatsapp.net',
    ehDono: () => true,
    executarComando: async (cmd, args) => { chamadas.push([cmd, args]); return true; }
  });
  ok(chamadas.length === 1 && chamadas[0][0] === 'figualeatoria', 'executou a figurinha');
});

await test('conversa normal NAO chama o executor (vai para o LLM)', async (ok) => {
  let chamouExecutor = false;
  let chamouLLM = false;
  setGroqHttpForTest(async () => {
    chamouLLM = true;
    return { data: { choices: [{ message: { content: 'Oi! Tudo bem?' } }] } };
  });
  const antiga = process.env.GROQ_API_KEY;
  process.env.GROQ_API_KEY = 'gsk_teste';
  const r = await pensarComIa('oi Lizzy, tudo bem?', [], {
    quemFalou: 'dono@s.whatsapp.net',
    ehDono: () => true,
    executarComando: async () => { chamouExecutor = true; return true; }
  });
  if (antiga !== undefined) process.env.GROQ_API_KEY = antiga;
  setGroqHttpForTest(null);
  ok(chamouExecutor === false, 'nao executou comando');
  ok(chamouLLM === true, 'foi para o LLM (conversa)');
  ok(r === 'Oi! Tudo bem?', `respondeu a conversa (${r})`);
});

await test('executor que falha -> responde sem quebrar', async (ok) => {
  const r = await pensarComIa('toca Evidencias', [], {
    quemFalou: 'dono@s.whatsapp.net',
    ehDono: () => true,
    executarComando: async () => { throw new Error('relay fora'); }
  });
  ok(/nao consegui executar/i.test(r), `erro tratado (${r})`);
});

await test('sem o executor injetado, o pedido NAO executa', async (ok) => {
  // Falha fechado: sem como executar, nao inventa.
  let chamouLLM = false;
  setGroqHttpForTest(async () => {
    chamouLLM = true;
    return { data: { choices: [{ message: { content: 'ok' } }] } };
  });
  const antiga = process.env.GROQ_API_KEY;
  process.env.GROQ_API_KEY = 'gsk_teste';
  await pensarComIa('toca Evidencias', [], { quemFalou: 'dono@s.whatsapp.net', ehDono: () => true });
  if (antiga !== undefined) process.env.GROQ_API_KEY = antiga;
  setGroqHttpForTest(null);
  ok(chamouLLM === true, 'seguiu como conversa (nao ha o que executar)');
});

// ============================================================================
// FIM
// ============================================================================

let totalOk = 0, totalFail = 0;
for (const r of RESULTS) { totalOk += r.ok; totalFail += r.fail; }
console.log('\n' + '='.repeat(60));
console.log(`TOTAL: ${RESULTS.length} testes | ${totalOk} asserções ok | ${totalFail} falhas`);
console.log('='.repeat(60));
process.exit(totalFail === 0 ? 0 : 1);
