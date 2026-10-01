/**
 * Testes do `!impostor` (aliases `!among`, `!amongus`) e do módulo puro
 * `utils/impostor.js`.
 *
 * Ponto central: a palavra secreta NÃO vai para o PV. Ela é entregue por
 * mensagem invisível NO GRUPO (mesma entrega do `!rajar`: rotação de Sender Key
 * restrita a `allowedParticipants: [jogador]`). O teste captura essa entrega e
 * confirma que (a) cada jogador recebeu a SUA palavra, (b) o alvo de cada envio
 * é um único jogador e (c) nada foi mandado em PV.
 *
 * Uso: node tests/impostor.test.js
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.resolve(HERE, '..');

const TMP_DB = fs.mkdtempSync(path.join(os.tmpdir(), 'lizzy-impostor-db-'));
process.env.DATABASE_PATH = TMP_DB;
const GRUPOS_DIR = path.join(TMP_DB, 'grupos');
fs.mkdirSync(GRUPOS_DIR, { recursive: true });

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

function ok(condition, message) {
  if (condition) CURRENT.passed += 1;
  else {
    CURRENT.failed += 1;
    CURRENT.errors.push(`ASSERT FALHOU: ${message}`);
  }
}

function includes(haystack, needle, label) {
  ok(typeof haystack === 'string' && haystack.includes(needle), `${label ?? needle} — esperado conter "${needle}"`);
}

function notIncludes(haystack, needle, label) {
  ok(typeof haystack === 'string' && !haystack.includes(needle), `${label ?? needle} — não deveria conter "${needle}"`);
}

// ============================================================================
// MÓDULOS
// ============================================================================

const impostor = await import(new URL('../dados/src/utils/impostor.js', import.meta.url).href);
const indexModule = await import(new URL('../dados/src/index.js', import.meta.url).href);
const handleMessage = indexModule.default ?? indexModule;
if (typeof handleMessage !== 'function') throw new Error('index.js não exporta o handler');

const BANCO = JSON.parse(fs.readFileSync(path.join(PROJECT, 'dados/src/funcs/json/impostor.json'), 'utf-8'));

const BOT_JID = '5599999999999@s.whatsapp.net';
const BOT_LID = '111111111111111@lid';

// ============================================================================
// 1) MÓDULO PURO
// ============================================================================

await test('impostor: banco com categorias e pares válidos', () => {
  const cat = BANCO.categorias;
  ok(cat && typeof cat === 'object', 'tem categorias');
  ok(Object.keys(cat).length >= 5, `categorias suficientes (${Object.keys(cat).length})`);
  let total = 0;
  for (const [nome, pares] of Object.entries(cat)) {
    ok(Array.isArray(pares) && pares.length > 0, `${nome} tem pares`);
    for (const p of pares) {
      ok(Array.isArray(p) && p.length === 2 && p[0] && p[1] && p[0] !== p[1], `par válido em ${nome}`);
      total += 1;
    }
  }
  ok(total === 174, `174 pares (veio ${total})`);
});

await test('impostor: sortearPar respeita a categoria e devolve comum != impostor', () => {
  const par = impostor.sortearPar(BANCO, 'animais', () => 0);
  ok(par && par.categoria === 'animais', `categoria respeitada (${par?.categoria})`);
  ok(par.comum !== par.impostor, 'palavras diferentes');
  const aleatorio = impostor.sortearPar(BANCO, undefined, () => 0.5);
  ok(aleatorio && aleatorio.comum, 'sorteia sem categoria');
});

await test('impostor: escolherImpostores exige o mínimo e é determinístico com rng', () => {
  ok(impostor.escolherImpostores(['a', 'b']).impostores.length === 0, 'menos de 3 -> vazio');
  const r = impostor.escolherImpostores(['a', 'b', 'c'], 1, () => 0);
  ok(r.impostores.length === 1 && r.impostores[0] === 'a', 'rng 0 pega o primeiro');
  const r2 = impostor.escolherImpostores(['a', 'b', 'c'], 1, () => 0.99);
  ok(r2.impostores.length === 1 && r2.impostores[0] === 'c', 'rng alto pega o último');
});

await test('impostor: escolherImpostores com 2 não repete e exige 5 jogadores', () => {
  ok(impostor.escolherImpostores(['a', 'b', 'c', 'd'], 2).impostores.length === 0, '4 jogadores não bastam para 2');
  const r = impostor.escolherImpostores(['a', 'b', 'c', 'd', 'e'], 2, () => 0);
  ok(r.impostores.length === 2, 'escolheu 2');
  ok(new Set(r.impostores).size === 2, 'sem repetir');
  ok(impostor.minJogadores(1) === 3 && impostor.minJogadores(2) === 5, 'mínimos 3 e 5');
});

await test('impostor: montarAtribuicoes dá a comum aos inocentes e marca os impostores', () => {
  const par = { comum: 'leão', impostor: 'tigre', categoria: 'animais' };
  const atr = impostor.montarAtribuicoes(['a', 'b', 'c'], par, 'b');
  ok(atr.length === 3, 'um por jogador');
  ok(atr.filter((x) => x.ehImpostor).length === 1, 'um impostor');
  ok(atr.find((x) => x.jid === 'b').ehImpostor === true, 'o b é impostor');
  ok(atr.filter((x) => !x.ehImpostor).every((x) => x.palavra === 'leão'), 'inocentes com a comum');

  const dois = impostor.montarAtribuicoes(['a', 'b', 'c', 'd'], par, ['a', 'd']);
  ok(dois.filter((x) => x.ehImpostor).length === 2, 'dois impostores marcados');
  ok(dois.filter((x) => !x.ehImpostor).length === 2, 'dois inocentes');
});

await test('impostor: textoAtribuicao NÃO revela a palavra ao impostor', () => {
  const doImpostor = impostor.textoAtribuicao('tigre', true);
  includes(doImpostor, 'IMPOSTOR', 'avisa o impostor');
  includes(doImpostor, 'não ser descoberto', 'dá a missão do impostor');
  notIncludes(doImpostor, 'tigre', 'impostor NÃO recebe a palavra');
  const doComum = impostor.textoAtribuicao('leão', false);
  notIncludes(doComum, 'IMPOSTOR', 'não avisa impostor pro comum');
  includes(doComum, 'leão', 'mostra a palavra comum');
});

await test('impostor: votar valida jogador, alvo e voto em si', () => {
  const jogo = { jogadores: ['a', 'b', 'c'], votos: {} };
  ok(impostor.votar(jogo, 'a', 'b').ok === true, 'voto válido');
  ok(impostor.votar(jogo, 'x', 'b').motivo === 'nao_jogador', 'não-jogador recusado');
  ok(impostor.votar(jogo, 'a', 'x').motivo === 'alvo_invalido', 'alvo inválido recusado');
  ok(impostor.votar(jogo, 'a', 'a').motivo === 'voto_em_si', 'voto em si recusado');
  ok(jogo.votos.a === 'b', 'voto gravado');
});

await test('impostor: resolverVotacao acha o mais votado e detecta empate', () => {
  const vitoria = impostor.resolverVotacao({ a: 'b', c: 'b', d: 'a' });
  ok(vitoria.maisVotado === 'b' && vitoria.votos === 2 && !vitoria.empate, 'mais votado com 2 votos');
  const empate = impostor.resolverVotacao({ a: 'b', c: 'a' });
  ok(empate.empate === true, 'empate detectado');
  const vazio = impostor.resolverVotacao({});
  ok(vazio.maisVotado === null && vazio.lista.length === 0, 'sem votos');
});

await test('impostor: checarVotacao decide por maioria SEM esperar todos', () => {
  // 5 jogadores, 3 votos no mesmo alvo -> maioria absoluta (3 > 2,5).
  const jogo = { jogadores: ['a', 'b', 'c', 'd', 'e'], votos: { a: 'x', b: 'x', c: 'x' } };
  const r = impostor.checarVotacao(jogo);
  ok(r.decidido === true && r.motivo === 'maioria_absoluta', 'maioria absoluta decide');
  ok(r.pendentes === 2, 'ainda faltavam 2 votos');

  // 5 jogadores, 3 votam num e 2 em outro -> decidiu mesmo assim.
  const dividido = { jogadores: ['a', 'b', 'c', 'd', 'e'], votos: { a: 'x', b: 'x', c: 'x', d: 'y', e: 'y' } };
  ok(impostor.checarVotacao(dividido).decidido === true, '3x2 decide sem esperar');

  // Empate parcial (2x2, 1 pendente) -> aguarda.
  const empateParcial = { jogadores: ['a', 'b', 'c', 'd', 'e'], votos: { a: 'x', b: 'x', c: 'y', d: 'y' } };
  ok(impostor.checarVotacao(empateParcial).decidido === false, 'empate parcial aguarda');
  ok(impostor.checarVotacao(empateParcial).motivo === 'aguardando', 'motivo aguardando');

  // 3 jogadores, 1 voto -> aguarda.
  const comecando = { jogadores: ['a', 'b', 'c'], votos: { a: 'b' } };
  ok(impostor.checarVotacao(comecando).decidido === false, '1 voto de 3 aguarda');

  // 3 jogadores, 2 votos no mesmo -> maioria absoluta (2 > 1,5) decide.
  const dois = { jogadores: ['a', 'b', 'c'], votos: { a: 'b', c: 'b' } };
  ok(impostor.checarVotacao(dois).decidido === true, '2 de 3 decide');

  // Todos votaram com empate -> decide (empate).
  const empatou = { jogadores: ['a', 'b', 'c', 'd'], votos: { a: 'b', b: 'a', c: 'b', d: 'a' } };
  const re = impostor.checarVotacao(empatou);
  ok(re.decidido === true && re.motivo === 'empate', 'empate com todos votando decide');
});

await test('impostor: formatarResultado não deixa LID solto na lista de votos', () => {
  const jogo = {
    impostor: '555@lid', palavraComum: 'leão',
    votos: { a: '555@lid', b: '555@lid', c: '777@lid' }
  };
  const nomeDe = (jid) => `@${jid.split('@')[0]}`;
  const { texto, mentions } = impostor.formatarResultado(jogo, nomeDe);
  includes(texto, '@555', 'impostor com nome');
  includes(texto, '@777', 'o outro alvo votado TAMBÉM vira nome');
  ok(mentions.includes('777@lid'), 'o alvo votado entra nas mentions (o cliente resolve o @)');
  ok(mentions.includes('555@lid'), 'o impostor entra nas mentions');
});

await test('impostor: encerrarPartida acerta se o mais votado é um impostor', () => {
  const jogo = { impostores: ['b'], palavraComum: 'leão', votos: { a: 'b', c: 'b' } };
  const res = impostor.encerrarPartida(jogo);
  ok(res.acertaram === true, 'grupo acertou');
  ok(res.palavraComum === 'leão', 'revela a palavra do grupo');

  const errado = impostor.encerrarPartida({ impostores: ['b'], votos: { a: 'c', c: 'c' } });
  ok(errado.acertaram === false, 'grupo errou');

  const empatado = impostor.encerrarPartida({ impostores: ['b'], votos: { a: 'b', c: 'a' } });
  ok(empatado.acertaram === false && empatado.empate === true, 'empate não acerta');
});

await test('impostor: encerrarPartida com 2 impostores sabe se ainda falta algum', () => {
  // Expulsaram um impostor (b), mas o outro (d) continua.
  const umDeDois = impostor.encerrarPartida({ impostores: ['b', 'd'], votos: { a: 'b', c: 'b', e: 'b' } });
  ok(umDeDois.acertaram === true, 'acertou um impostor');
  ok(umDeDois.restantes === 1, 'ainda resta 1 impostor');
  ok(umDeDois.quantidadeImpostores === 2, 'sabe que eram 2');

  // Expulsaram o inocente -> impostores ganharam.
  const inocente = impostor.encerrarPartida({ impostores: ['b', 'd'], votos: { a: 'c', d: 'c' } });
  ok(inocente.acertaram === false, 'expulsou inocente');

  // Empate entre um impostor e um inocente -> empate.
  const empate = impostor.encerrarPartida({ impostores: ['b', 'd'], votos: { a: 'b', c: 'd' } });
  ok(empate.empate === true && empate.acertaram === false, 'empate não acerta');
});

await test('impostor: resolverRodada expulsa um impostor e a partida CONTINUA', () => {
  const jogo = { impostores: ['b', 'e'], jogadores: ['a', 'b', 'c', 'd', 'e'], votos: { a: 'b', c: 'b', d: 'b' } };
  const r = impostor.resolverRodada(jogo);
  ok(r.expulsou === 'b' && r.eraImpostor === true, 'expulsou um impostor');
  ok(r.continua === true && r.fim === null, 'a partida continua');
  ok(r.impostoresRestantes === 1, 'ainda resta 1 impostor');
  ok(r.impostoresVivos.join(',') === 'e', 'o impostor vivo é o e');
});

await test('impostor: resolverRodada expulsar o ÚLTIMO impostor dá a vitória ao grupo', () => {
  // Sobrou só o impostor 'b' (o outro já saiu antes): expulsar 'b' encerra.
  const jogo = { impostores: ['b', 'e'], expulsos: ['e'], jogadores: ['a', 'b', 'c', 'd', 'e'], votos: { a: 'b', c: 'b', d: 'b' } };
  const r = impostor.resolverRodada(jogo);
  ok(r.eraImpostor === true && r.fim === 'grupo', 'era o último -> grupo ganhou');
  ok(r.continua === false, 'não continua');
  ok(r.impostoresRestantes === 0, 'nenhum impostor vivo');
});

await test('impostor: resolverRodada expulsar inocente com 2 impostores dá a vitória aos impostores', () => {
  // 5 jogadores: a,b,c,d,e — impostores b e e. Expulsam c (inocente).
  // Restam inocentes a,d (2) e impostores b,e (2) -> impostores vencem.
  const jogo = { impostores: ['b', 'e'], jogadores: ['a', 'b', 'c', 'd', 'e'], votos: { a: 'c', b: 'c', e: 'c' } };
  const r = impostor.resolverRodada(jogo);
  ok(r.eraImpostor === false, 'expulsou inocente');
  ok(r.fim === 'impostores', 'impostores venceram');
});

await test('impostor: resolverRodada empate reinicia a rodada', () => {
  const jogo = { impostores: ['b'], jogadores: ['a', 'b', 'c'], votos: { a: 'b', c: 'a' } };
  const r = impostor.resolverRodada(jogo);
  ok(r.empate === true && r.reiniciar === true, 'empate reinicia');
  ok(r.expulsou === null, 'ninguém expulso');
});

await test('impostor: consumirRodada limpa os votos e avança a rodada', () => {
  const jogo = { impostores: ['b', 'e'], jogadores: ['a', 'b', 'c', 'd', 'e'], votos: { a: 'b', c: 'b', d: 'b' }, rodada: 1 };
  const { rodada, terminou } = impostor.consumirRodada(jogo);
  ok(terminou === false, 'não terminou');
  ok(jogo.expulsos.includes('b'), 'b foi marcado como expulso');
  ok(Object.keys(jogo.votos).length === 0, 'votos limpos');
  ok(jogo.rodada === 2, 'avançou para a rodada 2');
  ok(impostor.jogoJogadores(jogo).length === 4, '4 vivos');
});

await test('impostor: votar não aceita voto de quem foi expulso', () => {
  const jogo = { impostores: ['b', 'e'], jogadores: ['a', 'b', 'c', 'd', 'e'], expulsos: ['b'], votos: {} };
  ok(impostor.votar(jogo, 'b', 'e').motivo === 'nao_jogador', 'expulso não vota');
  ok(impostor.votar(jogo, 'a', 'b').motivo === 'alvo_invalido', 'não vota em quem já saiu');
  ok(impostor.votar(jogo, 'a', 'e').ok === true, 'voto válido entre vivos');
});

await test('impostor: iniciarPartida anuncia ANTES e entrega por enviarSecreto (sem PV)', async () => {
  const ordem = [];
  const entregas = [];
  const r = await impostor.iniciarPartida({
    membros: ['a', 'b', 'c'],
    banco: BANCO,
    rng: () => 0,
    anunciar: async (info) => { ordem.push({ tipo: 'anuncio', info }); },
    enviarSecreto: async (jid, texto) => { ordem.push({ tipo: 'entrega', jid }); entregas.push({ jid, texto }); return true; }
  });
  ok(r.ok === true, 'partida iniciou');
  ok(ordem[0]?.tipo === 'anuncio', 'o anúncio sai primeiro');
  ok(ordem[0].info.categoria, 'o anúncio traz a categoria (dica)');
  ok(ordem[0].info.total === 3, 'o anúncio traz o total de jogadores');
  ok(ordem.filter((x) => x.tipo === 'entrega').length === 3, 'três entregas depois');
  ok(entregas.every((e) => ['a', 'b', 'c'].includes(e.jid)), 'um cartão por jogador');
  const impostores = entregas.filter((e) => e.texto.includes('IMPOSTOR'));
  ok(impostores.length === 1, 'exatamente um impostor');
  ok(r.jogo.impostor === impostores[0].jid, 'o jogo concorda com o cartão');
});

await test('impostor: iniciarPartida falha fechado com poucos jogadores ou falha na entrega', async () => {
  const poucos = await impostor.iniciarPartida({ membros: ['a', 'b'], banco: BANCO, enviarSecreto: async () => true });
  ok(poucos.ok === false && poucos.motivo === 'poucos_jogadores', 'recusa com 2 jogadores');

  const falha = await impostor.iniciarPartida({
    membros: ['a', 'b', 'c'], banco: BANCO,
    enviarSecreto: async (jid) => jid !== 'b'  // um falha
  });
  ok(falha.ok === false && falha.motivo === 'falha_na_entrega', 'não inicia se alguém não recebeu');
  ok(falha.entregues === 2 && falha.total === 3, 'reporta entregues/total');
});

// ============================================================================
// 2) MÓDULO PURO — TEMPO
// ============================================================================

await test('impostor: parseDuracao aceita 5/5m e trava em 15 minutos', () => {
  ok(impostor.parseDuracao('5').minutos === 5, '5 -> 5 min');
  ok(impostor.parseDuracao('5m').ms === 5 * 60 * 1000, '5m -> ms');
  ok(impostor.parseDuracao('10min').minutos === 10, '10min');
  ok(impostor.parseDuracao('15m').excedeu === false, '15m não excede');
  const excedeu = impostor.parseDuracao('30m');
  ok(excedeu.minutos === 15 && excedeu.excedeu === true, '30m trava em 15 e marca excedeu');
  ok(impostor.parseDuracao('0') === null, '0 é inválido');
  ok(impostor.parseDuracao('abc') === null, 'texto inválido');
  ok(impostor.parseDuracao('') === null, 'vazio inválido');
  ok(impostor.DURACAO_MAX_MS === 15 * 60 * 1000, 'máximo é 15 min');
});

await test('impostor: msRestantes e tempoEsgotado', () => {
  const jogo = { expiraEm: 1000 };
  ok(impostor.msRestantes(jogo, 400) === 600, 'faltam 600ms');
  ok(impostor.msRestantes(jogo, 1000) === 0, 'no fim, 0');
  ok(impostor.msRestantes(jogo, 2000) === 0, 'depois do fim, 0 (não negativo)');
  ok(impostor.tempoEsgotado(jogo, 999) === false, 'antes do prazo, não esgotou');
  ok(impostor.tempoEsgotado(jogo, 1000) === true, 'no prazo, esgotou');
  ok(impostor.tempoEsgotado({}, 999999) === false, 'sem tempo, nunca esgota');
  ok(impostor.msRestantes({}, 999) === 0, 'sem tempo, 0');
});

await test('impostor: parseOpcoesCriar aceita tempo e impostores em QUALQUER ordem', () => {
  const a = impostor.parseOpcoesCriar(['5m', '2']);
  ok(a.duracaoMs === 300000 && a.quantidadeImpostores === 2 && !a.erro, '5m 2');
  const b = impostor.parseOpcoesCriar(['2', '5m']);
  ok(b.duracaoMs === 300000 && b.quantidadeImpostores === 2 && !b.erro, '2 5m');
  const c = impostor.parseOpcoesCriar(['2']);
  ok(c.duracaoMs === 0 && c.quantidadeImpostores === 2 && !c.erro, '2 (sem tempo)');
  const d = impostor.parseOpcoesCriar(['5m']);
  ok(d.duracaoMs === 300000 && d.quantidadeImpostores === 1 && !d.erro, '5m (1 impostor)');
  const e = impostor.parseOpcoesCriar(['5']);
  ok(e.duracaoMs === 300000 && e.quantidadeImpostores === 1 && !e.erro, '5 solto = 5 minutos');
  const f = impostor.parseOpcoesCriar([]);
  ok(f.duracaoMs === 0 && f.quantidadeImpostores === 1 && !f.erro, 'vazio = 1 impostor sem tempo');
  const g = impostor.parseOpcoesCriar(['20m', '2']);
  ok(g.excedeuTempo === true && g.duracaoMs === 900000, '20m trava em 15');
  const h = impostor.parseOpcoesCriar(['abc']);
  ok(h.erro, 'token inválido -> erro');
  const i = impostor.parseOpcoesCriar(['3m', '4']);
  ok(i.erro, '4 impostores -> erro');
  const j = impostor.parseOpcoesCriar(['1', '2']);
  ok(j.erro, 'quantidade repetida -> erro');
});

await test('impostor: com 2 impostores o mínimo é 5 e NÃO há teto de jogadores', () => {
  ok(impostor.minJogadores(1) === 3, '1 impostor: mínimo 3');
  ok(impostor.minJogadores(2) === 5, '2 impostores: mínimo 5');
  const lobby = impostor.criarLobby('a', 0, 2);
  for (const j of ['b', 'c', 'd', 'e', 'f', 'g']) {
    ok(impostor.entrarNoLobby(lobby, j).ok === true, `${j} entrou`);
  }
  ok(lobby.jogadores.length === 7, 'sem teto: entraram 7');
});

// ============================================================================
// 2) MÓDULO PURO — LOBBY
// ============================================================================

await test('impostor: criar/entrar/sair no lobby', () => {
  const lobby = impostor.criarLobby('a');
  ok(lobby.fase === 'lobby' && lobby.criador === 'a', 'criou a sala com o criador');
  ok(lobby.jogadores.includes('a'), 'o criador já entra');
  ok(impostor.entrarNoLobby(lobby, 'b').ok === true, 'b entrou');
  ok(impostor.entrarNoLobby(lobby, 'b').motivo === 'ja_esta', 'b não entra duas vezes');
  ok(impostor.entrarNoLobby({ fase: 'jogando', jogadores: [] }, 'c').motivo === 'sem_sala', 'não entra com partida rolando');
  ok(impostor.sairDoLobby(lobby, 'b').ok === true, 'b saiu');
  ok(!lobby.jogadores.includes('b'), 'b fora da lista');
  ok(impostor.sairDoLobby(lobby, 'x').motivo === 'nao_esta', 'quem não está não sai');
});

await test('impostor: sair sendo o criador fecha a sala', () => {
  const lobby = impostor.criarLobby('a');
  impostor.entrarNoLobby(lobby, 'b');
  const r = impostor.sairDoLobby(lobby, 'a');
  ok(r.ok === true && r.fechou === true, 'criador saindo fecha a sala');
  ok(!lobby.jogadores.includes('a'), 'criador fora');
});

await test('impostor: só o criador inicia e precisa do mínimo', () => {
  const lobby = impostor.criarLobby('a');
  ok(impostor.podeIniciar(lobby, 'a').motivo === 'poucos_jogadores', 'sozinho não inicia');
  impostor.entrarNoLobby(lobby, 'b');
  ok(impostor.podeIniciar(lobby, 'b').motivo === 'nao_criador', 'só o criador inicia');
  ok(impostor.podeIniciar(lobby, 'a').motivo === 'poucos_jogadores', 'com 2 ainda não');
  impostor.entrarNoLobby(lobby, 'c');
  ok(impostor.podeIniciar(lobby, 'a').ok === true, 'com 3 o criador inicia');
  ok(impostor.podeIniciar({ fase: 'jogando', criador: 'a', jogadores: ['a', 'b', 'c'] }, 'a').motivo === 'sem_sala', 'não inicia de novo');
});

// ============================================================================
// FIXTURES DO HANDLER
// ============================================================================

const BOT_LID2 = BOT_LID;

let groupCounter = 0;

/**
 * Cada grupo tem os SEUS próprios membros (LIDs únicos). Isso isola o throttle
 * do bot (3 comandos/5s por sender) entre os testes: um membro do grupo A nunca
 * colide com um do grupo B.
 */
function makeGroup(n = 4) {
  groupCounter += 1;
  const jid = `1203638500000000${String(groupCounter).padStart(3, '0')}@g.us`;
  const members = [];
  const participants = [{ id: BOT_LID2, lid: BOT_LID2, phoneNumber: BOT_JID, admin: 'admin' }];
  for (let i = 0; i < n; i++) {
    const lid = `77${String(groupCounter).padStart(4, '0')}${String(i).padStart(3, '0')}@lid`;
    // Telefone DISTINTO do LID, para o resolvedor de nome ter o que usar.
    const pn = `55119${String(groupCounter).padStart(4, '0')}${String(i).padStart(3, '0')}@s.whatsapp.net`;
    members.push(lid);
    participants.push({ id: lid, lid, phoneNumber: pn, admin: null });
  }
  fs.writeFileSync(
    path.join(GRUPOS_DIR, `${jid}.json`),
    JSON.stringify({ modobrincadeira: true, groupName: 'Grupo Impostor' }, null, 2)
  );
  return { jid, members, participants };
}

/**
 * Socket falso que captura (a) o `sendMessage` normal e (b) a entrega
 * invisível (`relayGroupMessageWithSenderKeyRotation`).
 */
function makeNazu({ sent, relay, group }) {
  return {
    sendMessage: async (jid, content, options) => {
      sent.push({ jid, content, options });
      return { key: { id: `SENT-${sent.length}` } };
    },
    // O `!impostor` usa isto para a mensagem invisível (igual ao !rajar).
    relayGroupMessageWithSenderKeyRotation: async (jid, message, opts) => {
      relay.push({ jid, message, opts });
      return { key: { id: `RELAY-${relay.length}` } };
    },
    user: { id: `${BOT_JID.split('@')[0]}:5@s.whatsapp.net`, lid: BOT_LID2, name: 'Lizzy' },
    // Resolvedor de nome da lib: devolve um NOME por JID/LID (como em produção).
    contacts: {
      getName: (jid) => {
        const base = String(jid).split('@')[0];
        const p = group.participants.find((x) => String(x.id).split('@')[0] === base || String(x.lid).split('@')[0] === base || String(x.phoneNumber).split('@')[0] === base);
        return p && p.admin ? 'Lizzy' : (p ? `User${base.slice(-3)}` : null);
      }
    },
    onWhatsApp: async (jid) => [{ jid, exists: true, lid: jid.replace('@s.whatsapp.net', '@lid') }],
    signalRepository: { lidMapping: { getPNForLID: async () => null } },
    groupMetadata: async () => ({ id: group.jid, subject: 'Grupo Impostor', participants: group.participants }),
    groupParticipantsUpdate: async () => ({}),
    groupRequestParticipantsList: async () => [],
    groupRequestParticipantsUpdate: async () => ({}),
    ev: { on: () => {}, emit: () => {}, removeAllListeners: () => {} },
    readMessages: async () => {},
    sendPresenceUpdate: async () => {},
    profilePictureUrl: async () => 'x',
    react: async () => ({}),
  };
}

/** Executa um comando do impostor no handler real. */
async function rodar(group, texto, { sender, mentioned = null } = {}) {
  const sent = [];
  const relay = [];
  const nazu = makeNazu({ sent, relay, group });
  const senderLid = sender || group.members[0];
  const contextInfo = { remoteJid: group.jid };
  if (mentioned) { contextInfo.mentionedJid = mentioned; contextInfo.participant = mentioned[0]; }
  await handleMessage(nazu, {
    key: { remoteJid: group.jid, fromMe: false, id: `IMP-${Math.random().toString(36).slice(2, 9)}`, participant: senderLid },
    message: { extendedTextMessage: { text: texto, contextInfo } },
    messageTimestamp: 1757900000,
    pushName: 'Tester',
  }, null, new Map(), null);
  const out = sent.map((s) => s.content?.text ?? '').filter(Boolean).join('\n');
  const pv = sent.filter((s) => s.jid && (s.jid.endsWith('@s.whatsapp.net') || s.jid.endsWith('@lid')));
  const mentions = sent.flatMap((s) => s.content?.mentions || s.options?.mentions || []);
  return { sent, relay, text: out, pv, mentions };
}

/** Extrai o texto de dentro da mensagem invisível entregue (texto normal). */
const textoDoRelay = (r) => r.message?.extendedTextMessage?.text || '';
const mencoesDoRelay = (r) => r.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];

// ============================================================================
// 2) HANDLER
// ============================================================================

await test('!impostor criar: abre a sala com o criador dentro', async () => {
  const group = makeGroup();
  const r = await rodar(group, '!impostor criar', { sender: group.members[0] });
  includes(r.text, 'SALA DO IMPOSTOR CRIADA', 'confirma a criação');
  includes(r.text, 'Criador', 'mostra o criador');
  includes(r.text, 'sem limite', 'sem tempo = sem limite');
  const sala = global.impostorGames[group.jid];
  ok(sala && sala.fase === 'lobby', 'sala em lobby');
  ok(sala.jogadores.length === 1 && sala.jogadores[0] === group.members[0], 'o criador já entrou');
  ok(sala.duracaoMs === 0, 'sem duração definida');
});

await test('!impostor criar 5m: sala com tempo definido', async () => {
  const group = makeGroup();
  const r = await rodar(group, '!impostor criar 5m', { sender: group.members[0] });
  includes(r.text, '5 min', 'mostra o tempo na criação');
  ok(global.impostorGames[group.jid].duracaoMs === 5 * 60 * 1000, 'guardou 5 minutos');
});

await test('!impostor criar: tempo acima de 15m trava em 15', async () => {
  const group = makeGroup();
  const r = await rodar(group, '!impostor criar 99m', { sender: group.members[0] });
  includes(r.text, '15 min', 'travou em 15');
  includes(r.text, 'máximo', 'avisa do máximo');
  ok(global.impostorGames[group.jid].duracaoMs === 15 * 60 * 1000, 'guardou 15 minutos');
});

await test('!impostor criar: tempo/opção inválida é recusada', async () => {
  const group = makeGroup();
  const r = await rodar(group, '!impostor criar abc', { sender: group.members[0] });
  includes(r.text, 'inválida', 'recusa opção inválida');
  ok(global.impostorGames[group.jid] === undefined, 'não criou sala');
});

await test('!impostor criar 2: sala com 2 impostores e sem tempo', async () => {
  const group = makeGroup();
  const r = await rodar(group, '!impostor criar 2', { sender: group.members[0] });
  includes(r.text, 'Impostores: *2*', 'mostra 2 impostores');
  includes(r.text, 'sem limite', 'sem tempo');
  const sala = global.impostorGames[group.jid];
  ok(sala.quantidadeImpostores === 2, 'guardou 2 impostores');
  ok(sala.duracaoMs === 0, 'sem duração');
});

await test('!impostor criar 5m 2: tempo E 2 impostores (em qualquer ordem)', async () => {
  const group = makeGroup();
  const r = await rodar(group, '!impostor criar 5m 2', { sender: group.members[0] });
  includes(r.text, '5 min', 'tempo');
  includes(r.text, 'Impostores: *2*', 'impostores');
  const g2 = makeGroup();
  const r2 = await rodar(g2, '!impostor criar 2 5m', { sender: g2.members[0] });
  includes(r2.text, '5 min', 'tempo (ordem invertida)');
  includes(r2.text, 'Impostores: *2*', 'impostores (ordem invertida)');
  ok(global.impostorGames[g2.jid].quantidadeImpostores === 2, 'guardou 2');
});

await test('!impostor entrar: com 2 impostores não há teto (mínimo 5)', async () => {
  const group = makeGroup(7);
  await rodar(group, '!impostor criar 2', { sender: group.members[0] });
  for (let i = 1; i <= 6; i++) {
    await rodar(group, '!impostor entrar', { sender: group.members[i] });
  }
  ok(global.impostorGames[group.jid].jogadores.length === 7, 'entraram 7 (sem teto)');
});

await test('!impostor iniciar com 2 impostores: exige 5 jogadores e entrega 2 cartões de impostor', async () => {
  const group = makeGroup(5);
  await rodar(group, '!impostor criar 2', { sender: group.members[0] });
  await rodar(group, '!impostor entrar', { sender: group.members[1] });
  await rodar(group, '!impostor entrar', { sender: group.members[2] });
  await rodar(group, '!impostor entrar', { sender: group.members[3] });
  // Com 4 ainda falta 1 (mínimo 5 para 2 impostores).
  const cedo = await rodar(group, '!impostor iniciar', { sender: group.members[0] });
  includes(cedo.text, 'Faltam jogadores', 'com 4 não inicia para 2 impostores');

  await rodar(group, '!impostor entrar', { sender: group.members[4] });
  const r = await rodar(group, '!impostor iniciar', { sender: group.members[0] });
  includes(r.text, '*Impostores:* 2', 'anúncio avisa 2 impostores');
  ok(r.relay.length === 5, 'um cartão por jogador');
  const cartoes = r.relay.map(textoDoRelay);
  ok(cartoes.filter((c) => c.includes('IMPOSTOR')).length === 2, 'exatamente 2 cartões de impostor');
  ok(cartoes.filter((c) => c.includes('Sua palavra é')).length === 3, '3 inocentes com palavra');
  ok(global.impostorGames[group.jid].impostores.length === 2, 'jogo guarda 2 impostores');
});

await test('!impostor iniciar: partida com prazo mostra o tempo e cria expiraEm', async () => {
  const group = makeGroup();
  await rodar(group, '!impostor criar 5m', { sender: group.members[0] });
  await rodar(group, '!impostor entrar', { sender: group.members[1] });
  await rodar(group, '!impostor entrar', { sender: group.members[2] });
  const r = await rodar(group, '!impostor iniciar', { sender: group.members[0] });
  includes(r.text, 'Tempo', 'anúncio mostra o tempo');
  const jogo = global.impostorGames[group.jid];
  ok(jogo.duracaoMs === 5 * 60 * 1000, 'jogo tem 5 min');
  ok(jogo.expiraEm > Date.now(), 'expiraEm no futuro');
});

await test('!impostor: quando o tempo acaba, a partida encerra sozinha', async () => {
  const group = makeGroup();
  await rodar(group, '!impostor criar 5m', { sender: group.members[0] });
  await rodar(group, '!impostor entrar', { sender: group.members[1] });
  await rodar(group, '!impostor entrar', { sender: group.members[2] });
  await rodar(group, '!impostor iniciar', { sender: group.members[0] });
  const jogo = global.impostorGames[group.jid];
  // Simula o tempo esgotado (expiraEm no passado).
  jogo.expiraEm = Date.now() - 1000;
  const r = await rodar(group, '!impostor', { sender: group.members[1] });
  includes(r.text, 'Tempo esgotado', 'avisa que o tempo acabou');
  includes(r.text, 'RESULTADO DO IMPOSTOR', 'publica o resultado');
  ok(global.impostorGames[group.jid] === undefined, 'partida encerrada');
});

await test('!impostor entrar/sair: atualiza a sala', async () => {
  const group = makeGroup();
  await rodar(group, '!impostor criar', { sender: group.members[0] });
  const r = await rodar(group, '!impostor entrar', { sender: group.members[1] });
  includes(r.text, 'entrou na sala', 'confirma a entrada');
  ok(global.impostorGames[group.jid].jogadores.length === 2, '2 jogadores');

  const dup = await rodar(group, '!impostor entrar', { sender: group.members[1] });
  includes(dup.text, 'já está na sala', 'não entra duas vezes');

  const saiu = await rodar(group, '!impostor sair', { sender: group.members[1] });
  includes(saiu.text, 'saiu da sala', 'confirma a saída');
  ok(global.impostorGames[group.jid].jogadores.length === 1, '1 jogador');
});

await test('!impostor: criador saindo fecha a sala', async () => {
  const group = makeGroup();
  await rodar(group, '!impostor criar', { sender: group.members[0] });
  const r = await rodar(group, '!impostor sair', { sender: group.members[0] });
  includes(r.text, 'fechada', 'avisa que fechou');
  ok(global.impostorGames[group.jid] === undefined, 'sala removida');
});

await test('!impostor: status mostra a sala e quantos faltam', async () => {
  const group = makeGroup();
  const sem = await rodar(group, '!impostor');
  includes(sem.text, 'nenhuma sala', 'sem sala avisa');

  await rodar(group, '!impostor criar', { sender: group.members[0] });
  const r = await rodar(group, '!impostor', { sender: group.members[0] });
  includes(r.text, 'SALA DO IMPOSTOR', 'mostra a sala');
  includes(r.text, 'Faltam', 'diz quantos faltam');
});

await test('!impostor fechar: só o criador fecha', async () => {
  const group = makeGroup();
  await rodar(group, '!impostor criar', { sender: group.members[0] });
  await rodar(group, '!impostor entrar', { sender: group.members[1] });
  const naoCriador = await rodar(group, '!impostor fechar', { sender: group.members[1] });
  includes(naoCriador.text, 'Só quem criou', 'recusa não-criador');
  ok(global.impostorGames[group.jid] !== undefined, 'sala continua');

  const criador = await rodar(group, '!impostor fechar', { sender: group.members[0] });
  includes(criador.text, 'fechada', 'criador fecha');
  ok(global.impostorGames[group.jid] === undefined, 'sala removida');
});

await test('!impostor iniciar: só o criador inicia e precisa do mínimo', async () => {
  const group = makeGroup();
  await rodar(group, '!impostor criar', { sender: group.members[0] });
  await rodar(group, '!impostor entrar', { sender: group.members[1] });
  const cedo = await rodar(group, '!impostor iniciar', { sender: group.members[0] });
  includes(cedo.text, 'Faltam jogadores', 'com 2 não inicia');

  await rodar(group, '!impostor entrar', { sender: group.members[2] });
  const naoCriador = await rodar(group, '!impostor iniciar', { sender: group.members[1] });
  includes(naoCriador.text, 'Só quem criou', 'só o criador inicia');
  ok(global.impostorGames[group.jid].fase === 'lobby', 'segue em lobby');
});

await test('!impostor iniciar: anúncio público com regras + dica ANTES das palavras', async () => {
  const group = makeGroup();
  await rodar(group, '!impostor criar', { sender: group.members[0] });
  await rodar(group, '!impostor entrar', { sender: group.members[1] });
  await rodar(group, '!impostor entrar', { sender: group.members[2] });
  const r = await rodar(group, '!impostor iniciar', { sender: group.members[0] });
  includes(r.text, 'IMPOSTOR', 'anuncia a partida');
  includes(r.text, 'Regras básicas', 'traz as regras');
  includes(r.text, 'Dica', 'traz a dica');
  includes(r.text, 'categoria', 'a dica é a categoria');
  includes(r.text, 'recebeu a palavra selecionada', 'avisa que logo abaixo veio a palavra');
  includes(r.text, 'Jogadores', 'lista os jogadores');
  ok(r.pv.length === 0, `nada em PV (veio ${r.pv.length})`);
});

await test('!impostor iniciar: entrega a palavra por mensagem invisível (relay), não por PV', async () => {
  const group = makeGroup();
  await rodar(group, '!impostor criar', { sender: group.members[0] });
  await rodar(group, '!impostor entrar', { sender: group.members[1] });
  await rodar(group, '!impostor entrar', { sender: group.members[2] });
  const r = await rodar(group, '!impostor iniciar', { sender: group.members[0] });
  ok(r.relay.length === 3, `um relay por jogador (veio ${r.relay.length})`);
  ok(r.pv.length === 0, `nada enviado em PV (veio ${r.pv.length})`);
  for (const rel of r.relay) {
    ok(rel.jid === group.jid, 'relay no grupo');
    ok(Array.isArray(rel.opts?.allowedParticipants) && rel.opts.allowedParticipants.length === 1,
      'restrito a um único jogador');
    // A mensagem é NORMAL (não é payment).
    ok(rel.message?.extendedTextMessage?.text, 'a mensagem é de texto normal');
    ok(!rel.message?.requestPaymentMessage, 'não é mais requestPaymentMessage');
  }
  const cartoes = r.relay.map(textoDoRelay);
  ok(cartoes.filter((c) => c.includes('IMPOSTOR')).length === 1, 'exatamente um impostor');
});

await test('!impostor iniciar: comuns recebem a MESMA palavra; impostor não recebe palavra', async () => {
  const group = makeGroup();
  await rodar(group, '!impostor criar', { sender: group.members[0] });
  await rodar(group, '!impostor entrar', { sender: group.members[1] });
  await rodar(group, '!impostor entrar', { sender: group.members[2] });
  const r = await rodar(group, '!impostor iniciar', { sender: group.members[0] });
  const porJogador = r.relay.map((rel) => ({ jid: rel.opts.allowedParticipants[0], texto: textoDoRelay(rel) }));
  const impostor = porJogador.find((x) => x.texto.includes('IMPOSTOR'));
  const comuns = porJogador.filter((x) => !x.texto.includes('IMPOSTOR'));
  ok(impostor, 'achou o cartão do impostor');
  const palavraDe = (t) => (/\*([^*]+)\*/.exec(t.split('Sua palavra é:')[1] || '') || [])[1];
  const palavrasComuns = comuns.map((c) => palavraDe(c.texto));
  ok(palavrasComuns.every((p) => p === palavrasComuns[0] && p), 'todos os comuns têm a mesma palavra');
  includes(impostor.texto, 'não ser descoberto', 'impostor recebe só a missão');
  ok(!palavrasComuns.includes(palavraDe(impostor.texto)), 'impostor não tem a palavra do grupo');
});

await test('!impostor votar: registra o voto com LID real (não número)', async () => {
  const group = makeGroup();
  await rodar(group, '!impostor criar', { sender: group.members[0] });
  await rodar(group, '!impostor entrar', { sender: group.members[1] });
  await rodar(group, '!impostor entrar', { sender: group.members[2] });
  await rodar(group, '!impostor iniciar', { sender: group.members[0] });

  const [m1, m2] = group.members;
  const r = await rodar(group, '!impostor votar', { sender: m1, mentioned: [m2] });
  includes(r.text, 'Voto de', 'confirma o voto');
  includes(r.text, 'Já votaram', 'mostra quem já votou');
  includes(r.text, 'Faltam', 'mostra quem falta');
  includes(r.text, '1/3', 'progresso dos votos');
  // A menção no texto é o LID (o mesmo jid do jogador), não um número.
  includes(r.text, `@${m2.split('@')[0]}`, 'cita o alvo pelo LID');
  const jogo = global.impostorGames[group.jid];
  ok(jogo.votos[m1] === m2, 'o voto guardado é o LID do alvo');
  ok(jogo.votos[m1].includes('@lid'), 'o alvo é um LID');
  // Quem votou e quem falta aparecem pelo LID (o cliente resolve o @).
  includes(r.text, `@${m1.split('@')[0]}`, 'quem já votou aparece na lista');
  ok(r.mentions.includes(m1) && r.mentions.includes(m2), 'mentions cobrem votante e alvo');
  ok(r.mentions.includes(group.members[2]), 'quem falta também entra nas mentions');
});

await test('!impostor: votação encerra AUTOMATICAMENTE por maioria (sem esperar todos)', async () => {
  const group = makeGroup();
  await rodar(group, '!impostor criar', { sender: group.members[0] });
  await rodar(group, '!impostor entrar', { sender: group.members[1] });
  await rodar(group, '!impostor entrar', { sender: group.members[2] });
  await rodar(group, '!impostor iniciar', { sender: group.members[0] });

  const jogo = global.impostorGames[group.jid];
  const impostorJid = jogo.impostor;
  // 3 jogadores: 2 votos no impostor já é maioria (2 > 1,5) -> fecha a rodada.
  const votantes = jogo.jogadores.filter((j) => j !== impostorJid);
  let ultimo;
  for (const j of votantes) {
    ultimo = await rodar(group, '!impostor votar', { sender: j, mentioned: [impostorJid] });
  }
  includes(ultimo.text, 'RESULTADO DA RODADA', 'a maioria fechou a rodada sozinha');
  includes(ultimo.text, 'ERA IMPOSTOR', 'era o impostor');
  includes(ultimo.text, 'GRUPO GANHOU', 'veredito correto');
  ok(global.impostorGames[group.jid] === undefined, 'partida encerrada automaticamente');
});

await test('!impostor: com 2 impostores, expulsar um CONTINUA a partida (nova rodada)', async () => {
  const group = makeGroup(5);
  await rodar(group, '!impostor criar 2', { sender: group.members[0] });
  for (let i = 1; i <= 4; i++) await rodar(group, '!impostor entrar', { sender: group.members[i] });
  await rodar(group, '!impostor iniciar', { sender: group.members[0] });

  const jogo = global.impostorGames[group.jid];
  const [imp1, imp2] = jogo.impostores;
  // Votantes que NÃO são o criador (ele já gastou comandos no criar/iniciar) e
  // não são o impostor votado.
  const votantes = jogo.jogadores.filter((j) => j !== imp1 && j !== group.members[0]).slice(0, 3);
  let ultimo;
  for (const j of votantes) {
    ultimo = await rodar(group, '!impostor votar', { sender: j, mentioned: [imp1] });
  }
  includes(ultimo.text, 'RESULTADO DA RODADA', 'rodada fechou');
  includes(ultimo.text, 'ERA IMPOSTOR', 'expulsou um impostor');
  includes(ultimo.text, 'Ainda há', 'avisa que ainda falta impostor');
  ok(global.impostorGames[group.jid] !== undefined, 'a partida CONTINUA');
  ok(global.impostorGames[group.jid].expulsos.includes(imp1), 'imp1 marcado como expulso');
  ok(global.impostorGames[group.jid].rodada === 2, 'nova rodada');
  ok(Object.keys(global.impostorGames[group.jid].votos).length === 0, 'votos limpos');

  // Na rodada 2, expulsam o outro impostor -> grupo ganha e a partida encerra.
  const jogo2 = global.impostorGames[group.jid];
  const vivos = jogo2.jogadores.filter((j) => !jogo2.expulsos.includes(j));
  // Com 4 vivos, maioria = 3 votos. Votam todos os vivos menos o imp2.
  const votantes2 = vivos.filter((j) => j !== imp2);
  for (const j of votantes2) {
    ultimo = await rodar(group, '!impostor votar', { sender: j, mentioned: [imp2] });
  }
  includes(ultimo.text, 'GRUPO GANHOU', 'expulsou o último impostor');
  ok(global.impostorGames[group.jid] === undefined, 'partida encerrada');
});

await test('!impostor: a mensagem final não tem LID solto', async () => {
  const group = makeGroup();
  await rodar(group, '!impostor criar', { sender: group.members[0] });
  await rodar(group, '!impostor entrar', { sender: group.members[1] });
  await rodar(group, '!impostor entrar', { sender: group.members[2] });
  await rodar(group, '!impostor iniciar', { sender: group.members[0] });
  const jogo = global.impostorGames[group.jid];
  const impostorJid = jogo.impostor;
  const votantes = jogo.jogadores.filter((j) => j !== impostorJid);
  let ultimo;
  for (const j of votantes) {
    ultimo = await rodar(group, '!impostor votar', { sender: j, mentioned: [impostorJid] });
  }
  // Nenhuma menção do texto deve sobrar como `@<base numérica>` (LID cru).
  const basesLid = [...ultimo.text.matchAll(/@\d{6,}/g)].map((m) => m[0]);
  ok(basesLid.length === 0, `sem @<lid> no texto final (achou: ${JSON.stringify(basesLid)})`);
});

await test('!impostor encerrar: encerra na mão e revela as duas palavras', async () => {
  const group = makeGroup();
  await rodar(group, '!impostor criar', { sender: group.members[0] });
  await rodar(group, '!impostor entrar', { sender: group.members[1] });
  await rodar(group, '!impostor entrar', { sender: group.members[2] });
  await rodar(group, '!impostor iniciar', { sender: group.members[0] });
  const jogo = global.impostorGames[group.jid];
  const r = await rodar(group, '!impostor encerrar', { sender: group.members[0] });
  includes(r.text, 'RESULTADO DO IMPOSTOR', 'título do resultado');
  includes(r.text, jogo.palavraComum, 'revela a palavra do grupo');
  ok(global.impostorGames[group.jid] === undefined, 'partida encerrada');
});

await test('!impostor: sem a API de relay, falha fechado e não inicia', async () => {
  const group = makeGroup();
  await rodar(group, '!impostor criar', { sender: group.members[0] });
  await rodar(group, '!impostor entrar', { sender: group.members[1] });
  await rodar(group, '!impostor entrar', { sender: group.members[2] });

  const sent = [];
  const nazu = makeNazu({ sent, relay: [], group });
  delete nazu.relayGroupMessageWithSenderKeyRotation;
  await handleMessage(nazu, {
    key: { remoteJid: group.jid, fromMe: false, id: 'IMP-NORELAY', participant: group.members[0] },
    message: { extendedTextMessage: { text: '!impostor iniciar', contextInfo: { remoteJid: group.jid } } },
    messageTimestamp: 1757900000, pushName: 'Tester',
  }, null, new Map(), null);
  const text = sent.map((s) => s.content?.text ?? '').join('\n');
  includes(text, 'Não consegui entregar', 'avisa que não conseguiu entregar');
  ok(global.impostorGames[group.jid].fase === 'lobby', 'segue em lobby');
});

await test('!impostor: fora de grupo é recusado', async () => {
  const group = makeGroup();
  const sent = [];
  const nazu = makeNazu({ sent, relay: [], group });
  await handleMessage(nazu, {
    key: { remoteJid: '5511999998888@s.whatsapp.net', fromMe: false, id: 'IMP-PV', participant: group.members[0] },
    message: { extendedTextMessage: { text: '!impostor criar', contextInfo: {} } },
    messageTimestamp: 1757900000, pushName: 'Tester',
  }, null, new Map(), null);
  const text = sent.map((s) => s.content?.text ?? '').join('\n');
  includes(text, 'grupos', 'avisa que é só para grupos');
});


// ============================================================================
// 3) MENU / BLOCKPV
// ============================================================================

await test('menubn: !impostor está em JOGOS & DIVERSÃO (uma única vez)', async () => {
  const menus = await import(new URL('../dados/src/menus/menubn.js', import.meta.url).href);
  const layout = await import(new URL('../dados/src/menus/layout.js', import.meta.url).href);
  const texto = String(await menus.default('!', 'Lizzy', 'Tester', false));
  includes(texto, '!impostor', 'presente no menu');
  ok((texto.match(/!impostor\b/g) || []).length === 1, 'aparece uma única vez');
  const idxIni = texto.indexOf(layout.boldItalic('JOGOS & DIVERSÃO'));
  const idxFim = texto.indexOf(layout.boldItalic('NGL ANÔNIMO'));
  const bloco = texto.slice(idxIni, idxFim);
  includes(bloco, '!impostor', 'na primeira categoria');
});

await test('blockPv: impostor registrado no menubn', async () => {
  const blockPv = await import(new URL('../dados/src/utils/blockPv.js', import.meta.url).href);
  const lista = blockPv.menuCommandsMap?.menubn?.commands || [];
  ok(lista.includes('impostor'), 'impostor registrado');
});

// ============================================================================

const totalOk = RESULTS.reduce((a, r) => a + r.passed, 0);
const totalFail = RESULTS.reduce((a, r) => a + r.failed, 0);
console.log('\n════════════════════════════════════════');
console.log(`RESULTADO: ${RESULTS.length} testes | ${totalOk} asserções ok | ${totalFail} falhas`);
console.log('════════════════════════════════════════');

fs.rmSync(TMP_DB, { recursive: true, force: true });

if (totalFail > 0) {
  console.log('\nFALHAS:');
  for (const r of RESULTS) if (r.failed) for (const e of r.errors) console.log(`- [${r.name}] ${e}`);
  process.exit(1);
}
console.log('✅ TODOS OS TESTES PASSARAM');
process.exit(0);
