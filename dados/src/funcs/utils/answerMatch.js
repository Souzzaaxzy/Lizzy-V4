/**
 * Comparação de respostas dos jogos de adivinhação (!quiz, !quemsoueu,
 * !filme, !emojiquiz).
 *
 * Puro: sem socket, sem disco. Recebe o chute e a lista de respostas aceitas
 * e diz se acertou.
 *
 * Motivo de existir: a comparação antiga era
 *   `normalizar(r) === chute || chute.includes(normalizar(r))`
 * — duas falhas concretas:
 *
 * 1. **Pontuação/caixa/acento separavam o que é a mesma resposta.** O nome de
 *    exibição pode trazer ponto e maiúscula ("Batman.") enquanto a resposta
 *    aceita é "batman": `normalizar` só tira acento e baixa a caixa, então
 *    "batman" !== "batman." e o chute era recusado.
 * 2. **`chute.includes(resposta)` dava falso positivo.** Com a resposta "it",
 *    "acho que nao e nada disso" era aceito (o "it" está dentro de "disso").
 *
 * A regra agora exige que o chute seja a resposta inteira — ignorando apenas
 * caixa, acento, pontuação e espaços — em vez de "estar contido em".
 */

/** Tira acento, baixa a caixa e colapsa espaços. Base da comparação. */
export function normalizarResposta(texto) {
  if (!texto || typeof texto !== 'string') return '';
  return texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * Forma comparável: sem acento, sem caixa, sem pontuação, sem espaços.
 * É o que faz "Batman." e "batman" virarem o mesmo "batman", e
 * "Homem-Aranha" casar com "homem aranha".
 */
export function canonizarResposta(texto) {
  return normalizarResposta(texto).replace(/[^\p{L}\p{N}\s]/gu, '');
}

/** Idem, mas sem espaços — para "homem-aranha" == "homem aranha". */
function chaveColada(texto) {
  return canonizarResposta(texto).replace(/\s+/g, '');
}

/**
 * Confere um chute contra a lista de respostas aceitas.
 *
 * Aceita quando o chute é a resposta inteira (ignorando caixa, acento,
 * pontuação e espaços) ou quando o chute **contém** a resposta como uma
 * sequência de palavras inteira (ex.: "eu acho que é batman" contém "batman",
 * mas "disso" não contém "it").
 */
export function respostaCorreta(chute, respostas) {
  const chuteChave = chaveColada(chute);
  if (!chuteChave) return false;
  if (!Array.isArray(respostas)) return false;
  const chutePalavras = canonizarResposta(chute).split(/\s+/).filter(Boolean);

  return respostas.some((resposta) => {
    const chave = chaveColada(resposta);
    if (!chave) return false;
    if (chave === chuteChave) return true;

    const alvo = canonizarResposta(resposta).split(/\s+/).filter(Boolean);

    // Resposta de uma palavra: vale como palavra INTEIRA dentro do chute.
    if (alvo.length <= 1) return chutePalavras.includes(chave);

    // Resposta de várias palavras: vale como sequência contígua no chute.
    for (let i = 0; i + alvo.length <= chutePalavras.length; i++) {
      if (alvo.every((palavra, j) => chutePalavras[i + j] === palavra)) return true;
    }
    return false;
  });
}
