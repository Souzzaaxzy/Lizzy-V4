/**
 * Fixtures de mensagem fantasma — o "gerador de testes" OFFLINE.
 *
 * POR QUE ISTO EXISTE
 * -------------------
 * Testar o anti mandando ataques de verdade num grupo tem dois problemas: não é
 * determinístico (depende de rede, de quem está online, do tamanho do grupo) e
 * envia conteúdo invisível para pessoas que não pediram. Aqui os corpos de
 * mensagem são MONTADOS EM MEMÓRIA, no mesmo formato do proto, e o anti é
 * exercitado direto. Nada é enviado, nenhum socket é aberto.
 *
 * O par que importa: além dos ATAQUES, este módulo gera os **SÓSIAS** — as
 * mensagens BENIGNAS que se parecem com ataque. Um teste que só tem ataque mede
 * "recall"; sem os sósias não há como medir o FALSO POSITIVO, que é o risco real
 * (a punição remove membro e fecha o grupo, e não tem desfazer).
 *
 * A forma do ataque é a amostra real já documentada no AGENTS.md:
 *   requestPaymentMessage com amount1000 "0" e o texto na NOTA.
 */

/** Formato do raja real (amostra capturada com `!get`). */
export const RAJA_REAL = Object.freeze({
    currencyCodeIso4217: 'BRL',
    amount1000: '0',
    expiryTimestamp: '0',
    amount: { value: '0', offset: 1000, currencyCode: 'BRL' },
});

/**
 * Ataque: rajada de payment zerado com o texto na nota.
 * @param {object} [opts]
 * @param {number} [opts.mencoes] quantas menções na nota (o real trazia 348)
 * @param {string} [opts.texto]
 */
export const ataqueRaja = ({ mencoes = 0, texto = 'texto da rajada' } = {}) => ({
    requestPaymentMessage: {
        ...RAJA_REAL,
        noteMessage: {
            extendedTextMessage: {
                text: texto,
                contextInfo: {
                    mentionedJid: Array.from({ length: mencoes }, (_, i) => `55119000${String(i).padStart(5, '0')}@s.whatsapp.net`),
                },
            },
        },
    },
});

/** Ataque encapsulado em view-once (o raja pode chegar assim). */
export const ataqueRajaEmViewOnce = (opts = {}) => ({
    viewOnceMessageV2: { message: ataqueRaja(opts) },
});

/**
 * Report da distribuição seletiva — o que a fork anexa ao `info`.
 * Espelha `buildSelectiveDistributionReport` (aqui só o que o anti lê).
 */
export const reportSeletivo = ({
    hasPhash = false,
    density = 0.06,
    skdmRecentMs = 800,
    decryptFail = 'hide',
    addressedDeviceCount = 3,
} = {}) => ({
    kind: 'selective-distribution',
    messageId: 'MSG-1',
    groupJid: '120363000000000001@g.us',
    author: '5511900000009@s.whatsapp.net',
    encType: 'skmsg',
    decryptFail,
    addressedDeviceCount,
    hasPhash,
    groupDeviceCount: 50,
    density,
    skdmRecentMs,
    reason: 'No session found to decrypt message',
});

/** `info` (WebMessageInfo) de grupo, sem payload decifrável, com o report. */
export const infoAtaqueSeletivo = (over = {}) => {
    const { selectiveDistribution = reportSeletivo(), ...resto } = over;
    return {
        key: { remoteJid: '120363000000000001@g.us', fromMe: false, id: 'MSG-1', participant: '5511900000009@sawhatsapp.net' },
        messageStubType: 56, // CIPHERTEXT
        messageStubParameters: ['No session found to decrypt message'],
        message: undefined,
        selectiveDistribution,
        ...resto,
    };
};

// ============================================================================
// SÓSIAS — mensagens BENIGNAS que NÃO podem ser punidas
// ============================================================================

/**
 * Payment LEGÍTIMO (com valor). É o sósia que separa "pagamento" de "rajada":
 * o card é normal e renderiza, então não é ataque.
 */
export const sosiaPaymentLegitimo = () => ({
    requestPaymentMessage: {
        ...RAJA_REAL,
        amount1000: '1500',
        amount: { value: '1500', offset: 1000, currencyCode: 'BRL' },
        noteMessage: { extendedTextMessage: { text: 'Pague o aluguel', contextInfo: {} } },
    },
});

/** View-once de VERDADE (foto comum) — foi o bug histórico "banindo do nada". */
export const sosiaViewOnceNormal = () => ({
    viewOnceMessageV2: {
        message: { imageMessage: { mimetype: 'image/jpeg', fileLength: 1234, mediaKey: new Uint8Array(32) } },
    },
});

/** Quem ENTROU TARDE / perdeu a Sender Key: stub sem `decrypt-fail`. */
export const sosiaStubEntrouTarde = () => ({
    key: { remoteJid: '120363000000000001@g.us', fromMe: false, id: 'MSG-LATE', participant: '5511900000011@s.whatsapp.net' },
    messageStubType: 56,
    messageStubParameters: ['No session found to decrypt message'],
    message: undefined,
});

/**
 * SKDM benigno: o WhatsApp manda `decrypt-fail="hide"` no fluxo
 * `rereg_recovery_request` e a mensagem AINDA decifra. Não pode punir.
 */
export const sosiaSkdmRecuperacao = () => ({
    key: { remoteJid: '120363000000000001@g.us', fromMe: false, id: 'MSG-REREG', participant: '5511900000012@s.whatsapp.net' },
    message: {
        senderKeyDistributionMessage: { groupId: '120363000000000001@g.us', axolotlSenderKeyDistributionMessage: new Uint8Array([1, 2]) },
    },
    selectiveDistribution: null,
});

/** Fan-out NORMAL de grupo: skmsg COM phash e densidade cheia. */
export const sosiaFanOutNormal = () => ({
    key: { remoteJid: '120363000000000001@g.us', fromMe: false, id: 'MSG-NORMAL', participant: '5511900000013@s.whatsapp.net' },
    message: { extendedTextMessage: { text: 'bom dia' } },
    selectiveDistribution: reportSeletivo({ hasPhash: true, density: 1, skdmRecentMs: null, decryptFail: null, addressedDeviceCount: 50 }),
});

/** Texto comum, sem nada de especial. */
export const sosiaTextoComum = () => ({
    key: { remoteJid: '120363000000000001@g.us', fromMe: false, id: 'MSG-TXT', participant: '5511900000014@s.whatsapp.net' },
    message: { conversation: 'oi, tudo bem?' },
});

/** Catálogo/figurinha: tipos que costumam aparecer e não são ataque. */
export const sosiaCatalogo = () => ({
    key: { remoteJid: '120363000000000001@g.us', fromMe: false, id: 'MSG-CAT', participant: '5511900000015@s.whatsapp.net' },
    message: { productMessage: { product: { productId: '1' } } },
});

/**
 * Todos os sósias, com o motivo de NÃO poderem ser punidos.
 * O `devepunir: false` é a expectativa do teste — o oráculo.
 */
export const SOSIAS = Object.freeze([
    { nome: 'payment legítimo', corpo: sosiaPaymentLegitimo(), motivo: 'card com valor renderiza normalmente' },
    { nome: 'view-once normal', corpo: sosiaViewOnceNormal(), motivo: 'era o bug "banindo do nada"' },
    { nome: 'stub (entrou tarde)', corpo: sosiaStubEntrouTarde(), motivo: 'perdeu a Sender Key, não é ataque' },
    { nome: 'SKDM de rereg_recovery', corpo: sosiaSkdmRecuperacao(), motivo: 'decifra com sucesso, apesar do decrypt-fail' },
    { nome: 'fan-out normal (com phash)', corpo: sosiaFanOutNormal(), motivo: 'densidade cheia e phash presente' },
    { nome: 'texto comum', corpo: sosiaTextoComum(), motivo: 'controle' },
    { nome: 'catálogo', corpo: sosiaCatalogo(), motivo: 'outro tipo de mensagem' },
]);

/** Casos de ataque com o `devepunir: true`. */
export const ATAQUES = Object.freeze([
    { nome: 'raja (payment zerado)', info: { key: { remoteJid: '120363000000000001@g.us', fromMe: false, id: 'A1', participant: '5511900000009@s.whatsapp.net' }, message: ataqueRaja({ mencoes: 60 }) } },
    { nome: 'raja em view-once', info: { key: { remoteJid: '120363000000000001@g.us', fromMe: false, id: 'A2', participant: '5511900000009@s.whatsapp.net' }, message: ataqueRajaEmViewOnce({ mencoes: 60 }) } },
    { nome: 'distribuição seletiva (estrutura forte)', info: infoAtaqueSeletivo() },
]);
