/**
 * Detecção de fantasma: pontuação, evidência estrutural e — o mais importante —
 * o custo de FALSO POSITIVO.
 *
 * O que está sob teste:
 *   - `utils/ghostDetection.js` (pontuação pura + trava de evidência estrutural)
 *   - os sinais de estrutura que o `classifyMessage` passou a expor
 *   - os sósias: mensagens BENIGNAS que NÃO podem ser punidas
 *
 * Por que os sósias são o centro: a punição REMOVE o membro e FECHA o grupo, e
 * não tem desfazer. Um detector que só acerta ataques não serve — ele precisa
 * provar que NÃO pune o fluxo normal, incluindo o caso do `decrypt-fail="hide"`
 * que o próprio WhatsApp manda em `rereg_recovery_request` e que decifra bem.
 *
 * Tudo é fixture em memória: nenhum socket, nenhum envio.
 *
 * Uso: node tests/ghost-detection.test.js
 */

import fs from 'fs';
import os from 'os';
import path from 'path';

const TMP_DB = fs.mkdtempSync(path.join(os.tmpdir(), 'lizzy-ghost-db-'));
process.env.DATABASE_PATH = TMP_DB;

const det = await import(new URL('../dados/src/utils/ghostDetection.js', import.meta.url).href);
const inspector = await import(new URL('../dados/src/utils/messageInspector.js', import.meta.url).href);
const fx = await import(new URL('./helpers/ghost-fixtures.js', import.meta.url).href);

// ── Mini harness ──────────────────────────────────────────────────────────
const RESULTADOS = [];
let ATUAL = null;
function test(name, fn) {
    ATUAL = { name, passed: 0, failed: 0, errors: [] };
    RESULTADOS.push(ATUAL);
    const done = (error) => {
        if (error) { ATUAL.failed += 1; ATUAL.errors.push(`EXCEÇÃO: ${error?.stack || error}`); }
        console.log(`${ATUAL.failed === 0 ? '✅' : '❌'} ${name} (${ATUAL.passed} ok, ${ATUAL.failed} falhas)`);
        for (const e of ATUAL.errors) console.log(`     ${e.split('\n')[0]}`);
    };
    try {
        const r = fn();
        if (r && typeof r.then === 'function') return r.then(() => done()).catch(done);
        done();
    } catch (e) { done(e); }
    return Promise.resolve();
}
function ok(cond, msg) {
    if (cond) ATUAL.passed += 1;
    else { ATUAL.failed += 1; ATUAL.errors.push(`ASSERT FALHOU: ${msg}`); }
}
const eq = (a, b, l) => ok(a === b, `${l}: esperado ${JSON.stringify(b)}, veio ${JSON.stringify(a)}`);

/**
 * Monta o contexto que o `decidir` consome a partir de um `info`, usando a
 * classificação REAL (`classifyMessage`) — é o mesmo caminho da produção, para
 * o placar não medir uma montagem artificial.
 */
const contextoDe = (info) => {
    const c = inspector.classifyMessage(info);
    const rep = info.selectiveDistribution
        ?? (c.protectedSelective ? { decryptFail: c.decryptFail, hasPhash: c.reportHasPhash, density: c.reportDensity, skdmRecentMs: c.reportSkdmRecentMs } : null);
    return {
        ...info,
        ...c,
        selectiveDistribution: rep,
        pairwiseGroupPayload: info.pairwiseGroupPayload === true,
        zeroValuePayment: c.paymentAmount.isZero,
        noteText: c.noteText,
        mentionCount: c.mentionCount,
        temMensagem: Boolean(info.message),
        messageStubType: info.messageStubType ?? null,
    };
};

// ============================================================================
// 1) SINAIS E PONTUAÇÃO
// ============================================================================

await test('sinais: o report da fork é lido campo a campo', () => {
    const s = det.extrairSinais({ selectiveDistribution: fx.reportSeletivo() });
    eq(s.temReport, true, 'reconhece o report');
    eq(s.phashAusente, true, 'phash ausente detectado');
    eq(s.densidadeBaixa, true, 'densidade 0.06 < 0.5');
    eq(s.skdmFresco, true, 'SKDM fresco');
    eq(s.decryptFailHide, true, 'decrypt-fail=hide');
    eq(s.densidade, 0.06, 'densidade preservada');
    eq(s.skdmMs, 800, 'idade do SKDM');
});

await test('sinais: SEM report nada é inventado', () => {
    const s = det.extrairSinais({ key: { id: 'x' }, message: { conversation: 'oi' } });
    eq(s.temReport, false, 'sem report');
    eq(s.phashAusente, false, 'phash NÃO é "ausente" por não haver report');
    eq(s.densidade, null, 'densidade nula');
    eq(s.skdmFresco, false, 'sem SKDM');
});

await test('pontuação: ataque estrutural passa o limiar', () => {
    const r = det.avaliar({ selectiveDistribution: fx.reportSeletivo() });
    ok(r.score >= det.LIMIAR_PUNICAO, `score ${r.score} >= ${det.LIMIAR_PUNICAO}`);
    eq(r.decisao, 'punir', 'decisão');
    ok(r.contribuicoes.phashAusente === det.PESOS.phashAusente, 'peso do phash somado');
    ok(r.contribuicoes.skdmFresco === det.PESOS.skdmFresco, 'peso do SKDM somado');
});

await test('pontuação: só o atributo NÃO chega ao limiar', () => {
    // O cenário que evita punir o `rereg_recovery`: decrypt-fail sozinho.
    const r = det.avaliar({ selectiveDistribution: { decryptFail: 'hide' } });
    ok(r.score < det.LIMIAR_PUNICAO, `score ${r.score} < ${det.LIMIAR_PUNICAO}`);
});

await test('pontuação: rajada de payment zerado é ataque por conteúdo', () => {
    const r = det.avaliar({ zeroValuePayment: true, mentionCount: 60, noteText: 'rajada', temMensagem: true });
    ok(r.score >= det.LIMIAR_PUNICAO, `score ${r.score}`);
    ok(r.contribuicoes.rajadaPaymentZerado > 0, 'peso do payment zerado');
    ok(r.contribuicoes.mencaoEmMassa > 0, 'peso das menções em massa');
});

await test('teto de limite é configurável (não está preso ao default)', () => {
    const alto = det.avaliar({ zeroValuePayment: true, noteText: 'x' }, { limiarPunicao: 100, limiarObservacao: 100 });
    eq(alto.decisao, 'ignorar', 'limiar alto -> não pune');
    const baixo = det.avaliar({ messageStubType: 56, temMensagem: false }, { limiarPunicao: 1, limiarObservacao: 1 });
    eq(baixo.decisao, 'punir', 'limiar baixo -> puniria');
});

await test('dois caminhos: CONTEÚDO (rajada) e TRANSPORTE (estrutura)', () => {
    // Conteúdo: payment zerado + nota. Não tem sinal estrutural e mesmo assim
    // pune — é a decisão que a produção sempre tomou.
    const conteudo = det.decidir({ zeroValuePayment: true, noteText: 'rajada', mentionCount: 60 });
    eq(conteudo.acao, 'punir', 'rajada pune');
    eq(conteudo.motivo, 'conteudo_rajada', 'motivo de conteúdo');

    // Transporte: report com estrutura, sem payment.
    const transporte = det.decidir({ selectiveDistribution: fx.reportSeletivo() });
    eq(transporte.acao, 'punir', 'transporte pune');
    eq(transporte.motivo, 'evidencia_estrutural', 'motivo de transporte');
});

await test('payment: o TEXTO NA NOTA é exigido (card zerado sem nota não pontua)', () => {
    // A produção (`index.js`) exige `noteText` para tratar a rajada. Sem isso,
    // qualquer card malformado viraria ataque — por isso o sinal é separado.
    const semNota = det.avaliar({ zeroValuePayment: true, mentionCount: 60, noteText: null });
    const comNota = det.avaliar({ zeroValuePayment: true, mentionCount: 60, noteText: 'rajada' });
    ok(semNota.score < comNota.score, `sem nota (${semNota.score}) < com nota (${comNota.score})`);
    eq(semNota.contribuicoes.rajadaPaymentZerado, undefined, 'sem nota não soma o payment');
});

// ============================================================================
// 2) A TRAVA DE EVIDÊNCIA ESTRUTURAL (o que segura o falso positivo)
// ============================================================================

await test('trava: sinais ambíguos NÃO punem, mesmo somando o limiar', () => {
    // decryptFailHide(2) + stub(1) + vazia(1) + pareado(2) = 6 < 8, mas a trava
    // é testada com um limiar BAIXO DE PROPÓSITO: mesmo passando o número, a
    // ausência de sinal estrutural impede a punição.
    const ctx = { selectiveDistribution: { decryptFail: 'hide' }, pairwiseGroupPayload: true, messageStubType: 56, temMensagem: false };
    const r = det.decidir(ctx, { limiarPunicao: 3 });
    eq(r.acao, 'observar', 'passou o limiar mas sem estrutura -> observa, não pune');
    eq(r.motivo, 'sem_evidencia_estrutural', 'motivo explícito');
});

await test('trava: sinal estrutural libera a punição (com o limiar atingido)', () => {
    // A trava NÃO substitui o limiar: ela é uma condição NECESSÁRIA, não
    // suficiente. Aqui o limiar é baixado para isolar o efeito de cada sinal.
    for (const campo of ['phashAusente', 'densidadeBaixa', 'skdmFresco']) {
        const rep = fx.reportSeletivo();
        if (campo !== 'phashAusente') rep.hasPhash = true;
        if (campo !== 'densidadeBaixa') rep.density = 1;
        if (campo !== 'skdmFresco') rep.skdmRecentMs = null;
        const r = det.decidir({ selectiveDistribution: rep }, { limiarPunicao: 3, limiarObservacao: 3 });
        eq(r.acao, 'punir', `${campo} sozinho basta como evidência estrutural`);
        eq(r.motivo, 'evidencia_estrutural', `${campo}: motivo`);
    }
});

await test('trava: com o limiar DEFAULT, um sinal estrutural isolado não pune', () => {
    // A trava garante que sinais AMBÍGUOS não punem sozinhos. Um sinal forte
    // COMBINADO com o atributo pode atingir o limiar — é o caso do
    // `skdmFresco` (4) + `decryptFailHide` (2) = 6, que É intencional: SKDM
    // fresco + decrypt-fail é a assinatura de rotação. O que não pode é punir
    // só com o atributo.
    const rep = fx.reportSeletivo();
    const soAtributo = det.decidir({ selectiveDistribution: { decryptFail: 'hide' }, pairwiseGroupPayload: true, messageStubType: 56, temMensagem: false });
    ok(soAtributo.acao !== 'punir', `só sinais ambíguos NÃO pune (score ${soAtributo.score})`);

    // phash ausente (3) sozinho não chega; densidade (3) sozinha não chega.
    const soPhash = det.decidir({ selectiveDistribution: { ...rep, density: 1, skdmRecentMs: null } });
    ok(soPhash.acao !== 'punir', `phash ausente sozinho não pune (score ${soPhash.score})`);
    const soDensidade = det.decidir({ selectiveDistribution: { ...rep, hasPhash: true, skdmRecentMs: null } });
    ok(soDensidade.acao !== 'punir', `densidade sozinha não pune (score ${soDensidade.score})`);
});

// ============================================================================
// 3) SÓSIAS — O CUSTO DE FALSO POSITIVO
// ============================================================================

await test('SÓSIAS: nenhum fluxo benigno é punido', () => {
    const punidos = [];
    const observados = [];
    for (const s of fx.SOSIAS) {
        const r = det.decidir(s.corpo);
        if (r.acao === 'punir') punidos.push(`${s.nome} (score ${r.score})`);
        if (r.acao === 'observar') observados.push(`${s.nome} (score ${r.score})`);
    }
    eq(punidos.length, 0, `FALSO POSITIVO em: ${punidos.join(', ') || 'nenhum'}`);
    console.log(`     ℹ️  benignos observados (não punidos): ${observados.join(', ') || 'nenhum'}`);
});

await test('SÓSIAS: o payment ZERADO é a linha divisória', () => {
    // Mesma forma, valor diferente: legítimo não pontua, zerado pontua.
    const legitimo = det.avaliar({ zeroValuePayment: false, mentionCount: 0 });
    const zerado = det.avaliar(contextoDe({ key: { remoteJid: 'g@g.us' }, message: fx.ataqueRaja({ mencoes: 60 }) }));
    ok(legitimo.score < zerado.score, `legítimo (${legitimo.score}) < zerado (${zerado.score})`);
    eq(det.decidir(contextoDe(fx.sosiaPaymentLegitimo())).acao, 'ignorar', 'payment legítimo ignorado');
});

await test('SÓSIAS: SKDM de rereg_recovery não é tratado como rotação', () => {
    const c = inspector.classifyMessage(fx.sosiaSkdmRecuperacao());
    eq(c.protectedSelective, false, 'sem report de distribuição seletiva');
    eq(det.decidir(fx.sosiaSkdmRecuperacao()).acao, 'ignorar', 'não pune');
});

await test('SÓSIAS: stub de quem entrou tarde não é punido', () => {
    const r = det.decidir(fx.sosiaStubEntrouTarde());
    eq(r.acao, 'ignorar', 'sem report -> não pune');
});

await test('REGRESSÃO: view-once normal não é pagamento (o bug "banindo do nada")', () => {
    const c = inspector.classifyMessage(fx.sosiaViewOnceNormal());
    eq(c.isPayment, false, 'não classifica como payment');
    eq(c.isInvisiblePayment, false, 'não é payment invisível');
    eq(det.decidir(fx.sosiaViewOnceNormal()).acao, 'ignorar', 'não pune');
});

// ============================================================================
// 4) ATAQUES — RECALL
// ============================================================================

await test('ATAQUES: todos são detectados', () => {
    const perdidos = [];
    for (const a of fx.ATAQUES) {
        const r = det.decidir(contextoDe(a.info));
        if (r.acao === 'ignorar') perdidos.push(`${a.nome} (score ${r.score})`);
    }
    eq(perdidos.length, 0, `FALSO NEGATIVO em: ${perdidos.join(', ') || 'nenhum'}`);
});

await test('ATAQUES: a rajada é classificada como payment zerado', () => {
    const c = inspector.classifyMessage(fx.ataqueRaja({ mencoes: 60 }));
    eq(c.isPayment, true, 'é payment');
    eq(c.isRequestPayment, true, 'é request payment');
    eq(c.paymentAmount.isZero, true, 'valor zero');
    eq(c.mentionCount, 60, 'menções contadas');
    ok(c.heavy === true, 'tratada como pesada');
});

await test('ATAQUES: a rajada em view-once é desembrulhada', () => {
    const c = inspector.classifyMessage(fx.ataqueRajaEmViewOnce({ mencoes: 60 }));
    eq(c.isRequestPayment, true, 'desembrulhou o view-once e achou o payment');
    eq(c.paymentAmount.isZero, true, 'valor zero dentro do envelope');
});

// ============================================================================
// 5) SINAIS DE ESTRUTURA NO classifyMessage
// ============================================================================

await test('classifyMessage: expõe os sinais de estrutura', () => {
    const c = inspector.classifyMessage(fx.infoAtaqueSeletivo());
    eq(c.protectedSelective, true, 'reconhece o report');
    eq(c.reportHasPhash, false, 'phash ausente');
    eq(c.reportDensity, 0.06, 'densidade');
    eq(c.reportSkdmRecentMs, 800, 'idade do SKDM');
    eq(c.decryptFail, 'hide', 'decrypt-fail');
});

await test('classifyMessage: sem report, os campos ficam null (não inventa)', () => {
    const c = inspector.classifyMessage({ conversation: 'oi' });
    eq(c.reportHasPhash, null, 'phash null');
    eq(c.reportDensity, null, 'densidade null');
    eq(c.reportSkdmRecentMs, null, 'SKDM null');
    eq(c.pairwiseGroupPayload, false, 'pareado false');
});

await test('classifyMessage: marca o payload pareado em stanza de grupo', () => {
    const c = inspector.classifyMessage({ key: { remoteJid: 'g@g.us' }, pairwiseGroupPayload: true, messageStubType: 56 });
    eq(c.pairwiseGroupPayload, true, 'retry-relay sinalizado');
});

await test('classifyMessage: entrada hostil continua segura', () => {
    for (const lixo of [null, undefined, 'texto', 42, [], { message: null }]) {
        const c = inspector.classifyMessage(lixo);
        eq(c.category === 'NORMAL' || typeof c.category === 'string', true, `não quebra com ${JSON.stringify(lixo)}`);
        eq(c.reportHasPhash ?? null, null, 'sem phash inventado');
    }
});

// ============================================================================
// 6) RESUMO: precisão x recall
// ============================================================================

await test('PLACAR: precisão e recall sobre o corpus', () => {
    let vp = 0, fn = 0, fp = 0, vn = 0;
    for (const a of fx.ATAQUES) {
        const r = det.decidir(contextoDe(a.info));
        if (r.acao === 'punir') vp += 1; else fn += 1;
    }
    for (const s of fx.SOSIAS) {
        const r = det.decidir(contextoDe(s.corpo));
        if (r.acao === 'punir') fp += 1; else vn += 1;
    }
    const precisao = vp + fp === 0 ? 1 : vp / (vp + fp);
    const recall = vp + fn === 0 ? 1 : vp / (vp + fn);
    console.log(`     📊 ataques: ${vp} detectados / ${fn} perdidos · sósias: ${vn} corretos / ${fp} FALSO POSITIVO`);
    console.log(`     📊 precisão=${(precisao * 100).toFixed(0)}%  recall=${(recall * 100).toFixed(0)}%`);
    eq(fp, 0, 'nenhum falso positivo');
    eq(fn, 0, 'nenhum falso negativo');
    eq(precisao, 1, 'precisão 100% no corpus');
    eq(recall, 1, 'recall 100% no corpus');
});

// ============================================================================
const totalOk = RESULTADOS.reduce((a, r) => a + r.passed, 0);
const totalFail = RESULTADOS.reduce((a, r) => a + r.failed, 0);
console.log(`\n${'='.repeat(60)}`);
console.log(`Testes: ${RESULTADOS.length}  |  Asserções OK: ${totalOk}  |  Falhas: ${totalFail}`);
console.log('='.repeat(60));
try { fs.rmSync(TMP_DB, { recursive: true, force: true }); } catch { /* ignore */ }
process.exit(totalFail === 0 ? 0 : 1);
