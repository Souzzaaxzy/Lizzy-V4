/**
 * Extrai a lista de comandos REAIS do bot a partir do proprio código-fonte.
 *
 * A fonte é `dados/src/index.js`: cada comando é um `case '...':` do switch
 * principal, que fica com 6 espaços de indentação. Subcomandos (de dentro de
 * outro case, ex.: `set`/`style` do `configcmdnotfound`) têm indentação maior e
 * ficam de fora automaticamente — sem isso, digitar `set` sugeriria "set" como
 * comando válido, o que não existe.
 *
 * Lido uma única vez e cacheado em memória (o arquivo tem ~1.9 MB).
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Este módulo vive em `dados/src/utils/`, então o handler está um nível acima.
const INDEX_PATH = path.join(__dirname, '..', 'index.js');

/** Indentação dos `case` do switch principal (comandos de verdade). */
const NIVEL_COMANDO = 6;

let cache = null;

/**
 * Todos os comandos conhecidos (sem prefixo), em minúsculas e únicos.
 * @returns {string[]}
 */
export function getAllBotCommands() {
  if (cache) return cache;

  const comandos = new Set();
  try {
    const src = fs.readFileSync(INDEX_PATH, 'utf-8');
    for (const linha of src.split('\n')) {
      const m = /^( *)case '([^']+)':/.exec(linha);
      if (!m) continue;
      if (m[1].length !== NIVEL_COMANDO) continue; // ignora subcomandos
      const nome = m[2].trim().toLowerCase();
      // Só nomes plausíveis de comando (evita lixo do parser).
      if (nome && /^[a-z0-9_]+$/.test(nome) && nome.length >= 2) comandos.add(nome);
    }
  } catch (err) {
    console.error('⚠️ Falha ao montar a lista de comandos:', err.message);
  }

  cache = [...comandos];
  return cache;
}

/**
 * Distância de Levenshtein (nº mínimo de edições entre duas palavras).
 * Usada para achar o comando mais parecido com o que o usuário digitou.
 */
export function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a) return b.length;
  if (!b) return a.length;

  let anterior = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const atual = [i];
    for (let j = 1; j <= b.length; j++) {
      const custo = a[i - 1] === b[j - 1] ? 0 : 1;
      atual[j] = Math.min(
        anterior[j] + 1,       // remoção
        atual[j - 1] + 1,      // inserção
        anterior[j - 1] + custo // substituição
      );
    }
    anterior = atual;
  }
  return anterior[b.length];
}

/**
 * Acha o comando mais parecido com o que o usuário digitou.
 *
 * Critérios, em ordem: prefixo (começa com o texto ou vice-versa) vem antes de
 * distância de edição, e empate é desempatado pelo nome mais curto (mais
 * próximo do que foi digitado).
 *
 * @param {string} entrada o que o usuário digitou (ex.: 'pingg')
 * @param {string[]} [comandos] lista a considerar (padrão: todos os do bot)
 * @returns {string|null} o comando sugerido, ou null se nada for razoável
 */
export function findClosestCommand(entrada, comandos = null) {
  const alvo = String(entrada || '').trim().toLowerCase();
  if (!alvo) return null;

  const lista = comandos || getAllBotCommands();
  if (!Array.isArray(lista) || lista.length === 0) return null;

  // Um teto generoso evita sugerir algo nada a ver quando o usuário digita
  // qualquer coisa. Cresce com o tamanho da palavra.
  const limiteDistancia = Math.max(2, Math.ceil(alvo.length / 2));

  let melhor = null;
  let melhorPontuacao = Infinity;
  let melhorDistancia = Infinity;

  for (const cmd of lista) {
    if (typeof cmd !== 'string' || !cmd) continue;
    if (cmd === alvo) return cmd; // já é exato

    const distancia = levenshtein(alvo, cmd);
    if (distancia > limiteDistancia) continue;

    // 0 = um contém o outro (mais provável de ser o que a pessoa quis),
    // 1 = só parecido pela distância de edição.
    const comeca = cmd.startsWith(alvo) || alvo.startsWith(cmd) ? 0 : 1;
    const pontuacao = comeca * 1000 + distancia;

    if (pontuacao < melhorPontuacao || (pontuacao === melhorPontuacao && distancia < melhorDistancia)) {
      melhor = cmd;
      melhorPontuacao = pontuacao;
      melhorDistancia = distancia;
    }
  }

  return melhor;
}

/**
 * Resolve as variáveis extras da mensagem de comando não encontrado.
 *
 * Ficam separadas das básicas (`{command}`, `{prefix}`...) porque dependem de
 * calcular a sugestão, o que é mais caro.
 *
 * @param {string} commandName comando digitado pelo usuário
 * @param {string} prefix prefixo em uso
 * @returns {{cmdSm: string}} valores para `{cmdSm}`
 */
export function buildCmdNotFoundExtras(commandName, prefix) {
  const sugestao = findClosestCommand(commandName);
  return {
    // Sem sugestão, cai para o menu (nunca deixa a variável "vazia" no texto).
    cmdSm: sugestao ? `${prefix}${sugestao}` : `${prefix}menu`
  };
}