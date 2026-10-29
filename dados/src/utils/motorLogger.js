/**
 * Logger do MOTOR da call (`zapo`) — filtra o ruido de CHAT, mantem o da CALL.
 *
 * ## O problema que isto resolve (MEDIDO nos logs do dono)
 *
 * O `zapo` e' um client COMPLETO do WhatsApp. O bot o usa SO' para a call, mas
 * ele processa TODO o trafego da sessao: historico, mensagens de grupo, addons
 * (reacao/edicao), retry receipts. Como a sessao dele nao tem as chaves Signal
 * de tudo isso, o resultado sao centenas de `warn` por minuto:
 *
 *     failed to send retry receipt for decrypt failure { ... 'noise session not ready' }
 *     offline batch request failed, giving up { attempts: 5, remainingStanzas: 12462, ... }
 *     noise session is not established
 *     addon parent message secret not found { ... }
 *     wa client error { ... }
 *
 * E o pior nao e' o ruido: esse trabalho roda na MESMA thread do bot e o
 * **travava**. O `!vozp` subia e o bot inteiro parava de responder.
 *
 * ## O que este logger faz (e o que NAO faz)
 *
 * Ele NAO desliga o motor nem a call: ele so' **para de imprimir** o que e'
 * consequencia de processar chat que o motor nao precisa processar. O que
 * interessa na call — estado, relay, roster, fim de chamada, erros reais —
 * continua saindo, com o prefixo `[MOTOR]`.
 *
 * A correcao de verdade esta' em `zapoCall.js` (desligar history/addons e
 * filtrar as stanzas de chat); este logger e' a rede de seguranca para o que
 * ainda escapar.
 */

/** Frases que sao CONSEQUENCIA de processar chat — ruido para quem so' faz call. */
const RUIDO = [
  'failed to send retry receipt',
  'offline batch request failed',
  'offline resume forced complete',
  'noise session is not established',
  'noise session not ready',
  'addon parent message secret not found',
  'failed to decrypt addon',
  'decrypt failure',
  'wa client error'
];

/**
 * Uma mensagem e' ruido? (comparacao por substring, caixa baixa)
 *
 * @param {string} msg
 * @returns {boolean}
 */
export function ehRuidoDoMotor(msg) {
  const m = String(msg || '').toLowerCase();
  return RUIDO.some((r) => m.includes(r));
}

/**
 * Cria o logger do motor: mesma interface do `Logger` do `zapo-js`, mas
 * silenciando o ruido conhecido.
 *
 * `error` NUNCA e' silenciado — um erro de verdade (call, relay) tem de
 * aparecer. O filtro vale para `trace`/`debug`/`info`/`warn`.
 *
 * @param {object} [opts]
 * @param {'trace'|'debug'|'info'|'warn'|'error'} [opts.nivel] nivel minimo (padrao `warn`)
 * @param {(msg: string, ctx?: object) => void} [opts.escrever] destino (padrao console)
 * @returns {object} logger compativel com o do `zapo-js`
 */
export function criarLoggerDoMotor({ nivel = 'warn', escrever } = {}) {
  const PRIORIDADE = { trace: 0, debug: 1, info: 2, warn: 3, error: 4 };
  const minimo = PRIORIDADE[nivel] ?? PRIORIDADE.warn;
  const saida = escrever || ((msg, ctx) => {
    // Uma linha por evento, com o prefixo do motor para ser filtravel.
    const extra = ctx && Object.keys(ctx).length ? ` | ${JSON.stringify(ctx)}` : '';
    console.log(`[MOTOR] ${msg}${extra}`);
  });

  const emitir = (nivelDoLog, mensagem, contexto) => {
    if (PRIORIDADE[nivelDoLog] < minimo) return;
    // `error` passa sempre: silenciar erro e' pior que o ruido.
    if (nivelDoLog !== 'error' && ehRuidoDoMotor(mensagem)) return;
    try {
      saida(mensagem, contexto);
    } catch { /* log nunca derruba o motor */ }
  };

  const logger = {
    level: nivel,
    trace: (m, c) => emitir('trace', m, c),
    debug: (m, c) => emitir('debug', m, c),
    info: (m, c) => emitir('info', m, c),
    warn: (m, c) => emitir('warn', m, c),
    error: (m, c) => emitir('error', m, c),
    child: () => logger
  };
  return logger;
}

/** As frases filtradas (diagnostico/testes). */
export function frasesDeRuido() {
  return [...RUIDO];
}

/**
 * Tipos de `<notification>` que sao CONTEUDO de chat — o que gera o flood no
 * motor que so' faz call.
 *
 * Tudo o que NAO esta' aqui passa: o PARECIMENTO (`passkey_prologue_request`,
 * `companion_reg_refresh`), registro, device, server e account_sync sao infra e
 * o motor precisa deles.
 */
export const TIPOS_NOTIFICACAO_DE_CHAT = Object.freeze([
  'w:gp2',        // evento de grupo
  'business',     // perfil comercial
  'newsletter',   // canal
  'picture',      // foto de perfil
  'mediaretry',   // reenvio de midia
  'encrypt'       // renegociacao de criptografia
]);

/**
 * Decide se uma stanza de ENTRADA e' de chat (e pode ser descartada).
 *
 * Pura de proposito: o filtro do motor chama isto por stanza, e a regra fica
 * testavel sem abrir conexao.
 *
 * @param {{tag?: string, attrs?: object}} node
 * @returns {boolean} `true` = descartar
 */
export function ehStanzaDeChat(node) {
  if (node?.tag === 'message') return true;
  if (node?.tag === 'notification') {
    return TIPOS_NOTIFICACAO_DE_CHAT.includes(node.attrs?.type);
  }
  return false;
}

