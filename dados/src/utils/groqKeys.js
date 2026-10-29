/**
 * AS CHAVES DO GROQ — ate' 10, com troca automatica quando uma acaba.
 *
 * ## O pedido do dono
 *
 * *"o plano e' gratis e acaba, entao quero adicionar mais de uma chave para que
 * quando uma acabar usar a proxima imediatamente"* — com os comandos
 * `!keygroq1` ate' `!keygroq10` (o `1` e' a chave de sempre).
 *
 * ## Por que o failover e' por CHAVE (e nao por "tentar de novo")
 *
 * O Groq responde **401/403** quando a chave e' invalida e **429** quando a cota
 * acabou. Nos dois casos tentar a MESMA chave de novo nao adianta — o que
 * resolve e' a PROXIMA. Por isso a rotacao so' acontece nesses dois motivos: um
 * erro de rede nao deve queimar a cota de outra chave a toa.
 *
 * ## Os nomes no `.env`
 *
 *   slot 1  -> GROQ_API_KEY      (a de sempre: `!keygroq`)
 *   slot 2  -> GROQ_API_KEY_2    (`!keygroq2`)
 *   ...
 *   slot 10 -> GROQ_API_KEY_10   (`!keygroq10`)
 *
 * O slot 1 mantem o nome antigo de proposito: quem ja' configurou nao perde
 * nada, e o `.env` continua legivel.
 *
 * Modulo PURO: recebe o `env` por parametro e nao abre socket.
 */

/** Quantas chaves cabem (o dono pediu 10). */
export const MAX_SLOTS = 10;

/** O nome da variavel de um slot. */
export function nomeDaVar(slot) {
  const n = Number.parseInt(slot, 10);
  if (!Number.isFinite(n) || n <= 1) return 'GROQ_API_KEY';
  return `GROQ_API_KEY_${n}`;
}

/**
 * Le' as chaves configuradas, NA ORDEM dos slots.
 *
 * Slot sem valor simplesmente nao entra — entao uma lista com "buracos"
 * (1, 3, 5) funciona: a rotacao passa de uma para a outra.
 *
 * @param {object} [env] padrao: `process.env`
 * @returns {Array<{slot: number, var: string, chave: string}>}
 */
export function lerChaves(env = process.env) {
  const saida = [];
  for (let slot = 1; slot <= MAX_SLOTS; slot++) {
    const valor = String((env || {})[nomeDaVar(slot)] || '').trim();
    if (valor) saida.push({ slot, var: nomeDaVar(slot), chave: valor });
  }
  return saida;
}

/** Mostra so' o comeco e o fim (nunca a chave inteira em log/mensagem). */
export function mascarar(chave) {
  const s = String(chave || '');
  if (!s) return 'nao configurada';
  if (s.length <= 8) return '*'.repeat(s.length);
  return `${s.slice(0, 4)}...${s.slice(-4)}`;
}

/**
 * O proximo indice, dando a volta no fim.
 *
 * Dar a volta e' proposital: uma chave que estourou o limite agora pode ter
 * voltado (as cotas do Groq sao por minuto/dia).
 */
export function proximoIndice(indice, total) {
  if (!total || total < 1) return 0;
  return (Number(indice) + 1) % total;
}

/** O nome de comando de um slot (`!keygroq`, `!keygroq2`, ...). */
export function comandoDoSlot(slot) {
  const n = Number.parseInt(slot, 10);
  return (!Number.isFinite(n) || n <= 1) ? 'keygroq' : `keygroq${n}`;
}

/**
 * Le' o slot a partir do NOME DO COMANDO.
 *
 * `keygroq` -> 1, `keygroq7` -> 7. Devolve `null` quando nao e' um comando de
 * chave (ou o numero esta fora da faixa).
 *
 * @param {string} comando
 * @returns {number|null}
 */
export function slotDoComando(comando) {
  const c = String(comando || '').toLowerCase().trim();
  if (c === 'keygroq' || c === 'groqkey') return 1;
  const m = c.match(/^(?:keygroq|groqkey)(\d{1,2})$/);
  if (!m) return null;
  const n = Number.parseInt(m[1], 10);
  return (n >= 1 && n <= MAX_SLOTS) ? n : null;
}

/**
 * Atualiza (ou cria/remove) a linha de UM slot no conteudo do `.env`.
 *
 * Puro: devolve o conteudo novo, nao escreve arquivo. Assim da' para testar a
 * manipulacao de texto sem tocar no `.env` de verdade.
 *
 * @param {string} conteudo o `.env` inteiro
 * @param {number} slot
 * @param {string|null} valor `null`/vazio REMOVE a linha
 * @returns {string}
 */
export function atualizarEnv(conteudo, slot, valor) {
  const nome = nomeDaVar(slot);
  const linhas = String(conteudo || '').split('\n');
  const re = new RegExp(`^${nome}=`);
  const novo = valor == null ? '' : String(valor).trim();

  let achou = false;
  const saida = [];
  for (const linha of linhas) {
    if (re.test(linha)) {
      achou = true;
      // Remover = apaga a linha; definir = troca pelo valor novo.
      if (novo) saida.push(`${nome}=${novo}`);
      continue;
    }
    saida.push(linha);
  }

  if (!achou && novo) {
    // Acrescenta no fim, respeitando se o arquivo termina com \n.
    const texto = saida.join('\n');
    return texto.endsWith('\n') || texto === ''
      ? `${texto}${nome}=${novo}\n`
      : `${texto}\n${nome}=${novo}\n`;
  }

  return saida.join('\n');
}
