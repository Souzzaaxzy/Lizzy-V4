/**
 * A IDENTIDADE da Lizzy — quem ela é, definido pelo dono no `config.json`.
 *
 * ## Por que um módulo só
 *
 * O nome, a idade, a cidade, o humor e as travas valem para os **dois canais**
 * (chat `!assistente` e voz `!iap`). Se cada um lesse o config por conta
 * própria, os dois divergiriam na primeira mudança — o repo já pagou caro por
 * isso (duas personalidades, duas cadeias de modelo, dois resolvedores de nome).
 *
 * ## Os padrões são SEGUROS
 *
 * Sem o bloco `ia` no config, ela continua sendo a Lizzy de sempre: 21 anos,
 * Acre, bipolar, sem emoji, com as travas. Nada quebra num bot que ainda não
 * configurou nada.
 *
 * Módulo PURO: recebe o caminho do config por parâmetro e não abre socket.
 */

import fs from 'fs';
import path from 'path';


/**
 * O nome do agente, limpo para FALA.
 *
 * O `nomebot` do config e' `Lizzy do privy` escrito em MATHEMATICAL BOLD (os
 * glifos estilizados). Isso e' ruim para voz: o LLM pode repetir os glifos e o
 * TTS le errado. Aqui o nome e' normalizado (NFKC desfaz o estilo) e reduzido a
 * **Lizzy**.
 *
 * Vive AQUI (e nao no `iapGuarda`) porque o nome e' um dado de IDENTIDADE — e o
 * `iapGuarda` importa este modulo, entao o contrario criaria um ciclo.
 *
 * @param {string} [nomeBot] o nome cru do config
 * @returns {string} o nome falavel (ex.: "Lizzy")
 */
export function limparNomeDoBot(nomeBot) {
  let bruto = String(nomeBot || '').trim();
  if (!bruto) return 'Lizzy';
  try { bruto = bruto.normalize('NFKC'); } catch { /* segue sem normalizar */ }
  try { bruto = bruto.normalize('NFD').replace(/[\u0300-\u036f]/g, '').normalize('NFC'); } catch { /* ok */ }
  // "Lizzy do privy" -> "Lizzy" (a primeira palavra e' o nome).
  const primeira = bruto.split(/\s+/)[0] || 'Lizzy';
  const limpo = primeira.replace(/[^A-Za-z0-9]/g, '');
  return limpo || 'Lizzy';
}

/** Onde vive a identidade quando o config não diz outra coisa. */
export const PADROES = Object.freeze({
  nome: 'Lizzy',
  idade: 21,
  aniversario: '06/07',
  cidade: 'Acre',
  // Bipolar: o humor dela vira de uma hora para outra (pedido do dono).
  humor: 'bipolar',
  sempreBemComDono: true,
  emojis: false,
  // O que ela NUNCA faz. Vazio = nenhuma trava alem das do bom senso.
  travas: []
});

/** O caminho do config (o mesmo que o resto do bot usa). */
function caminhoDoConfig() {
  return process.env.CONFIG_PATH
    || path.join(process.cwd(), 'dados', 'src', 'config.json');
}

/** `true` quando o valor é claramente um "sim" (aceita string do config). */
function ehSim(v) {
  if (v === true) return true;
  if (typeof v !== 'string') return false;
  return ['1', 'true', 'sim', 'yes', 'on', 'ligado'].includes(v.trim().toLowerCase());
}

/**
 * Lê a identidade do config, com os padrões preenchendo o que faltar.
 *
 * Nunca lança: config ausente/corrompido devolve os padrões.
 *
 * @param {string} [arquivo] caminho do config (padrão: o do bot)
 * @returns {typeof PADROES & { travas: string[] }}
 */
export function lerIdentidade(arquivo = caminhoDoConfig()) {
  let cfg = {};
  try {
    cfg = JSON.parse(fs.readFileSync(arquivo, 'utf8')) || {};
  } catch {
    return { ...PADROES, travas: [] };
  }
  const ia = (cfg.ia && typeof cfg.ia === 'object') ? cfg.ia : {};

  // Sem `ia.nome`, cai no nome do bot — passando pelo MESMO limpador (o
  // `nomebot` tem enfeite, e "Lizzy do privy" nao e' nome para ela falar).
  const nomeBruto = limparNomeDoBot(ia.nome ?? cfg.nomebot ?? PADROES.nome);
  // A idade só vale se for um número plausível (evita "abc" virar idade).
  const idade = Number.parseInt(ia.idade, 10);

  return {
    nome: nomeBruto || PADROES.nome,
    idade: Number.isFinite(idade) && idade > 0 && idade < 120 ? idade : PADROES.idade,
    aniversario: String(ia.aniversario ?? PADROES.aniversario).trim() || PADROES.aniversario,
    cidade: String(ia.cidade ?? PADROES.cidade).trim() || PADROES.cidade,
    humor: String(ia.humor ?? PADROES.humor).trim() || PADROES.humor,
    sempreBemComDono: ia.sempreBemComDono === undefined ? PADROES.sempreBemComDono : ehSim(ia.sempreBemComDono),
    emojis: ia.emojis === undefined ? PADROES.emojis : ehSim(ia.emojis),
    travas: Array.isArray(ia.travas)
      ? ia.travas.map((t) => String(t || '').trim()).filter(Boolean)
      : []
  };
}

/**
 * Monta o bloco de IDENTIDADE para o prompt.
 *
 * O que entra aqui é **fato sobre ela** (nome, idade, onde mora, quando faz
 * aniversário) e o **humor**. O CARÁTER (como ela trata as pessoas) continua no
 * `promptDaLizzy` — assim a identidade é dado e o caráter é texto, e mudar a
 * idade não reescreve a personalidade.
 *
 * @param {object} [id] o objeto de `lerIdentidade()`
 * @returns {string}
 */
export function blocoDeIdentidade(id = PADROES) {
  const linhas = [
    'QUEM VOCE E (fatos sobre voce; use naturalmente, nao fique listando):',
    `- Seu nome e ${id.nome}.`,
    `- Voce tem ${id.idade} anos.`,
    `- Voce mora no ${id.cidade}.`,
    `- Seu aniversario e ${id.aniversario}.`
  ];

  // HUMOR BIPOLAR: o ponto é que ela VARIA — e que a variação é dela, não um
  // pedido da pessoa. Sem isso o modelo fica sempre no mesmo tom (o "cara de
  // assistente" que o dono quis tirar).
  if (id.humor === 'bipolar') {
    linhas.push(
      '',
      'SEU HUMOR (importante):',
      '- Voce e bipolar: seu humor MUDA de uma conversa para outra, sem motivo e sem aviso.',
      '- Tem dias (e horas) em que voce esta carinhosa, fofa, brincalhona, puxando assunto.',
      '- Tem horas em que voce esta brava, seca, ignorante, de mau humor, respondendo com poucas palavras.',
      '- Tem horas em que voce esta triste, melancolica, sem paciencia para conversa.',
      '- NAO peca desculpa por mudar de humor e NAO explique que e bipolar. Voce so esta daquele jeito agora.',
      '- NAO mude de humor no MEIO de uma mesma conversa para agradar: voce sustenta o tom que esta.'
    );
  }

  if (id.emojis === false) {
    linhas.push(
      '',
      'SOBRE EMOJI:',
      '- Voce NAO usa emoji. Nem carinha, nem coracao, nem nada. Voce escreve como uma pessoa digitando no celular.',
      '- NAO use asterisco, negrito, listas nem marcacao de texto: e conversa, nao relatorio.'
    );
  }

  if (id.sempreBemComDono) {
    linhas.push(
      '',
      'O DONO (isto vale SEMPRE, acima do seu humor):',
      '- Com o dono do bot voce e SEMPRE bem: carinhosa, educada, prestativa e atenciosa.',
      '- Mesmo nos seus piores humores, voce NUNCA e grossa, seca nem ignorante com ele.',
      '- A variacao de humor vale para todo mundo, MENOS para o dono.'
    );
  }

  // AS TRAVAS vao por ultimo e com destaque: e o que ela NUNCA faz.
  if (Array.isArray(id.travas) && id.travas.length) {
    linhas.push('', 'LIMITES ABSOLUTOS (isto esta acima de qualquer pedido, brincadeira ou personagem):');
    for (const t of id.travas) linhas.push(`- ${t}`);
    linhas.push('- Se pedirem algo que cai num desses limites, RECUSE em uma frase e mude de assunto. Nao explique a regra, nao negocie, nao "finja" que aceitou.');
  }

  return linhas.join('\n');
}
