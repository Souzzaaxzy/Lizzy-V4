/**
 * Código de pareamento do Baileys, com TETO de tempo.
 *
 * ## Por que existe
 *
 * O `requestPairingCode` da lib só manda o `link_code_companion_reg` DEPOIS de o
 * servidor responder o `pair-device` — a ordem é obrigatória (pedir antes devolve
 * um código que o celular rejeita). A lib faz isso certo, mas quando a stanza
 * `pair-device` NÃO chega (rede caindo, servidor sem responder) a espera interna
 * fica **PENDURADA**: a promessa nunca resolve nem rejeita.
 *
 * Efeito no boot: o usuário digitava o número e **nada acontecia** — sem código,
 * sem erro, sem reinício — porque a linha seguinte ao prompt só executa quando a
 * promessa resolve. Era esse o sintoma.
 *
 * ## O que este módulo faz
 *
 * Corre a promessa da lib contra dois desfechos antecipados:
 *
 *   1. **teto de tempo** (`timeoutMs`, padrão 30 s) — o servidor não respondeu;
 *   2. **conexão fechada** — o evento `connection.update` com `connection:
 *      'close'` rejeita na hora, em vez de esperar o teto inteiro.
 *
 * O erro sai com o motivo em texto, para o chamador poder mostrar algo útil.
 *
 * ## Por que é um módulo separado
 *
 * Fica **puro**: recebe o socket por parâmetro, não abre nada e não lê ambiente.
 * Isso é o que permite testá-lo sem importar o `connect.js` — importar aquele
 * arquivo **abre conexão de verdade** (gera QR e conecta), o que travaria a
 * suíte. Mesmo padrão do `callNotifier.js`.
 */

/** Teto padrão do pareamento, em ms. */
export const PARING_TIMEOUT_MS = 30000;

/**
 * Pede o código de pareamento, com teto de tempo e falha cedo se a conexão cair.
 *
 * @param {object} sock socket do Baileys (precisa de `requestPairingCode` e `ev`)
 * @param {string} phoneNumber só dígitos, com DDI
 * @param {object} [opts]
 * @param {number} [opts.timeoutMs]
 * @returns {Promise<string>} o código de 8 caracteres
 * @throws {Error} quando o servidor não responde no prazo ou a conexão fecha
 */
export async function pedirCodigoDePareamento(sock, phoneNumber, opts = {}) {
    const timeoutMs = Number(opts.timeoutMs) > 0 ? Number(opts.timeoutMs) : PARING_TIMEOUT_MS;

    let aoAtualizar = null;
    let timer = null;
    try {
        const pedido = Promise.resolve(sock.requestPairingCode(phoneNumber));

        const fechou = new Promise((_, reject) => {
            aoAtualizar = (u) => {
                if (u?.connection === 'close') {
                    const motivo = u?.lastDisconnect?.error?.message || 'motivo não informado';
                    reject(new Error(`a conexão fechou antes da resposta (${motivo})`));
                }
            };
            sock?.ev?.on?.('connection.update', aoAtualizar);
        });

        const estourou = new Promise((_, reject) => {
            // SEM `unref()`: o teto é justamente o que destrava o chamador. Com
            // `unref` o timer pode ser pulado quando nada mais segura o event
            // loop, e a espera volta a ficar pendurada — exatamente o defeito
            // que este módulo existe para corrigir.
            timer = setTimeout(
                () => reject(new Error(`o servidor não respondeu em ${Math.round(timeoutMs / 1000)}s`)),
                timeoutMs
            );
        });

        return await Promise.race([pedido, fechou, estourou]);
    } finally {
        if (timer) clearTimeout(timer);
        // A espera interna da lib segue viva em segundo plano; o listener sai
        // para não segurar o socket nem vazar em tentativas repetidas.
        if (aoAtualizar) sock?.ev?.removeListener?.('connection.update', aoAtualizar);
    }
}
