/**
 * Detecção de mensagem fantasma (rajada invisível / distribuição seletiva) por
 * SOMA DE EVIDÊNCIAS, em vez de um único gate booleano.
 *
 * POR QUE SOMA E NÃO UM GATE
 * --------------------------
 * O anti agiu, até agora, com `selectiveDistribution && undecryptable`. Isso
 * tem duas falhas opostas:
 *
 *   - **Falso negativo:** se o atacante não deixa a marca que o gate exige, nada
 *     acontece — mesmo quando há vários outros sinais no transporte.
 *   - **Falso positivo destrutivo:** o `decrypt-fail="hide"` também aparece em
 *     fluxos benignos (o `rereg_recovery_request` do próprio WhatsApp carrega o
 *     atributo e ainda decifra com sucesso). Um gate único que trate a mera
 *     presença do atributo como ataque pune quem não fez nada.
 *
 * A soma ataca os dois: cada sinal vale um peso, e a decisão é o TOTAL. Sinais
 * que não dependem do atacante (phash ausente, densidade baixa, SKDM fresco,
 * payload pareado) valem mais do que os que ele controla.
 *
 * IMPORTANTE — FALSO POSITIVO É DESTRUTIVO
 * ----------------------------------------
 * A punição remove o membro e fecha o grupo; não há desfazer. Por isso o limiar
 * é ALTO por padrão e os sinais ambíguos (stub de CIPHERTEXT, SKDM benigno)
 * valem pouco sozinhos. O módulo é puro: recebe sinais, devolve score e
 * decisão — quem aplica é o chamador, e só depois de medir.
 *
 * A classificação de PRODUÇÃO dos sinais de transporte vem da fork
 * (`info.selectiveDistribution` e os campos de estrutura que o report carrega);
 * aqui só se pondera.
 */

/**
 * Pesos por sinal. Documentados um a um para deixar claro o que é forte e o que
 * é ambíguo. Nenhum peso sozinho chega ao limiar de punição.
 */
export const PESOS = Object.freeze({
  // ── Fortes: estruturais, NÃO controlados pelo atacante ────────────────────
  // A stanza rotacionada não carrega phash (o fan-out normal carrega). Medido.
  phashAusente: 3,
  // Densidade de destinatários muito abaixo do grupo = subconjunto deliberado.
  densidadeBaixa: 3,
  // SenderKeyDistributionMessage fresco do MESMO autor no MESMO grupo: é o que
  // separa rotação de "entrei tarde" (este último não traz SKDM).
  skdmFresco: 4,
  // Stanza de grupo com enc pareado (type msg/pkmsg): transporte do retry, por
  // onde o conteúdo chega a quem foi excluído.
  payloadPareado: 2,

  // ── Médios: o atacante pode ligar/desligar ────────────────────────────────
  decryptFailHide: 2,
  // A rajada de payment zerado é uma assinatura de CONTEÚDO, não de transporte:
  // `isPayment` + valor zero + texto na nota. O peso sozinho já atinge o limiar
  // porque a combinação é específica — é o comportamento que a produção já
  // tinha (`isBurstByAmount`), preservado aqui.
  rajadaPaymentZerado: 6,
  mencaoEmMassa: 3,

  // ── Fracos: ambíguos de propósito (aparecem em fluxo normal) ──────────────
  stubCiphertext: 1,
  mensagemVazia: 1,
});

/**
 * Limiar de PUNIÇÃO. Calibrado para que:
 *   • a rajada de payment zerado (conteúdo, peso 6) atinja sozinha — preserva a
 *     decisão que a produção já tomava;
 *   • os sinais AMBÍGUOS somados (decryptFailHide 2 + payloadPareado 2 + stub 1
 *     + vazia 1 = 6) também atinjam o número, mas sejam barrados pela trava de
 *     evidência (ver `decidir`) — é para isso que a trava existe.
 * O de OBSERVAÇÃO é mais baixo: serve para log/telemetria sem agir.
 */
export const LIMIAR_PUNICAO = 6;
export const LIMIAR_OBSERVACAO = 3;

/** Limiar de "elevado" para a densidade (abaixo disto é subconjunto). */
export const DENSIDADE_MINIMA = 0.5;

/**
 * Extrai os sinais de um contexto (o `info` do Baileys ou o report da fork).
 * Aceita as duas formas que o projeto já usa (report/objeto ou booleano).
 *
 * @param {object} entrada
 * @returns {object} sinais normalizados (todos booleanos/números)
 */
export function extrairSinais(entrada = {}) {
  const e = entrada && typeof entrada === 'object' ? entrada : {};
  const rep = e.selectiveDistribution ?? e.report ?? null;
  const temReport = rep != null && rep !== false;
  const r = temReport && typeof rep === 'object' ? rep : {};

  // `hasPhash === false` só conta como sinal quando HÁ report: sem report não
  // sabemos nada, e tratar "desconhecido" como "ausente" inventaria evidência.
  const phashAusente = temReport && r.hasPhash === false;

  const densidade = typeof r.density === 'number' ? r.density : null;
  const densidadeBaixa = densidade !== null && densidade < DENSIDADE_MINIMA;

  const skdmMs = typeof r.skdmRecentMs === 'number' ? r.skdmRecentMs : null;
  const skdmFresco = skdmMs !== null;

  return {
    temReport,
    decryptFailHide: r.decryptFail === 'hide' || e.decryptFail === 'hide',
    phashAusente,
    densidade,
    densidadeBaixa,
    skdmFresco,
    skdmMs,
    payloadPareado: e.pairwiseGroupPayload === true,
    stubCiphertext: e.messageStubType != null,
    mensagemVazia: e.temMensagem === false,
    // O texto na nota é o que separa a RAJADA do card zerado legítimo: a
    // produção (`index.js`) exige a nota, e o sósia "payment com valor 0 sem
    // nota" não pode pontuar. Sem esta trava, qualquer card malformado viraria
    // ataque.
    notaDePagamento: typeof (e.noteText ?? e.nota) === 'string' && String(e.noteText ?? e.nota).trim().length > 0,
    rajadaPaymentZerado: e.zeroValuePayment === true || e.pagamento?.amount1000 === '0' || e.pagamento?.amount1000 === 0,
    mencaoEmMassa: typeof e.mentionCount === 'number' && e.mentionCount > 50,
  };
}

/**
 * Calcula o score e a decisão.
 *
 * @param {object} entrada contexto (info do Baileys, report da fork, ou o
 *                         objeto que o adaptador monta)
 * @param {object} [opts]
 * @param {number} [opts.limiarPunicao]
 * @param {number} [opts.limiarObservacao]
 * @returns {{score:number, decisao:'punir'|'observar'|'ignorar', sinais:object, contribuicoes:object}}
 */
export function avaliar(entrada = {}, opts = {}) {
  const limiarPunicao = Number.isFinite(opts.limiarPunicao) ? opts.limiarPunicao : LIMIAR_PUNICAO;
  const limiarObservacao = Number.isFinite(opts.limiarObservacao) ? opts.limiarObservacao : LIMIAR_OBSERVACAO;

  const s = extrairSinais(entrada);
  const contribuicoes = {};
  let score = 0;

  const somar = (chave, ativo) => {
    if (!ativo) return;
    contribuicoes[chave] = PESOS[chave];
    score += PESOS[chave];
  };

  // Só avalia sinais de transporte quando HÁ um report: sem report, `decryptFail`
  // isolado é ambíguo e não deve somar.
  somar('phashAusente', s.phashAusente);
  somar('densidadeBaixa', s.densidadeBaixa);
  somar('skdmFresco', s.skdmFresco);
  somar('decryptFailHide', s.temReport && s.decryptFailHide);
  somar('payloadPareado', s.payloadPareado);
  somar('rajadaPaymentZerado', s.rajadaPaymentZerado && s.notaDePagamento);
  somar('mencaoEmMassa', s.mencaoEmMassa && s.notaDePagamento);
  somar('stubCiphertext', s.stubCiphertext);
  somar('mensagemVazia', s.mensagemVazia);

  const decisao = score >= limiarPunicao ? 'punir' : score >= limiarObservacao ? 'observar' : 'ignorar';
  return { score, decisao, sinais: s, contribuicoes };
}

/**
 * Há evidência ESTRUTURAL de distribuição seletiva? Exige um sinal que o
 * atacante NÃO controla (phash ausente, densidade baixa ou SKDM fresco).
 *
 * Isto vale para o ataque de TRANSPORTE. Um ataque de CONTEÚDO (payment zerado
 * com texto na nota) não produz esses sinais, e por isso é reconhecido por
 * `ataqueDeConteudo` — a trava não se aplica a ele, senão a rajada clássica
 * deixaria de ser punida (era a decisão que a produção já tomava).
 *
 * @returns {boolean}
 */
export function temEvidenciaEstrutural(entrada = {}) {
  const s = extrairSinais(entrada);
  return s.phashAusente || s.densidadeBaixa || s.skdmFresco;
}

/**
 * A assinatura de CONTEÚDO que a produção sempre usou: payment com valor zerado
 * E texto na nota (a rajada). Não é "um card malformado" — é o card zerado
 * carregando uma mensagem escondida na nota, que é o que o raja faz.
 *
 * @returns {boolean}
 */
export function ataqueDeConteudo(entrada = {}) {
  const s = extrairSinais(entrada);
  return s.rajadaPaymentZerado && s.notaDePagamento;
}

/**
 * Decisão final, aplicando a trava de evidência estrutural.
 *
 * A trava é uma condição NECESSÁRIA para o ataque de TRANSPORTE (o `rereg` e o
 * "entrei tarde" só têm sinais ambíguos, então nunca punem). Ela NÃO se aplica
 * ao ataque de CONTEÚDO, que se sustenta na própria assinatura.
 *
 * @returns {{acao:'punir'|'observar'|'ignorar', score:number, motivo:string, sinais:object, contribuicoes:object}}
 */
export function decidir(entrada = {}, opts = {}) {
  const { score, decisao, sinais, contribuicoes } = avaliar(entrada, opts);

  if (decisao !== 'punir') {
    return { acao: decisao, score, motivo: 'score_insuficiente', sinais, contribuicoes };
  }

  // Ataque de conteúdo: a assinatura (payment zerado + nota) basta.
  if (ataqueDeConteudo(entrada)) {
    return { acao: 'punir', score, motivo: 'conteudo_rajada', sinais, contribuicoes };
  }

  // Ataque de transporte: exige pelo menos um sinal estrutural.
  if (!temEvidenciaEstrutural(entrada)) {
    return { acao: 'observar', score, motivo: 'sem_evidencia_estrutural', sinais, contribuicoes };
  }
  return { acao: 'punir', score, motivo: 'evidencia_estrutural', sinais, contribuicoes };
}
