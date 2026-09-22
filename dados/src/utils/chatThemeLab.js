/**
 * LABORATÓRIO EXPERIMENTAL — chat theme / wallpaper (comando `!tema`).
 *
 * Este módulo é PURO: recebe um sender injetado (a função de envio da fork) e
 * não fala com socket, disco ou rede. É o que permite testar os argumentos e o
 * payload sem abrir conexão.
 *
 * O que ele NÃO é
 * ---------------
 * Não é um recurso oficial, não altera aparencia por conta própria e não afirma
 * efeito visual. Ele monta UM payload suportado pelo protocolo descoberto e
 * registra o que saiu, para o dono comparar com o que o cliente mostra.
 *
 * Protocolo (descoberto no WAProto da fork, não suposto)
 * -----------------------------------------------------
 *   ProtocolMessage.type = CHAT_THEME_SETTING (34)
 *   ProtocolMessage.chatThemeSetting             (campo 30)
 *   ChatThemeSetting: 1 settingTimestampMs INT64, 2 clearTheme BOOL,
 *     3 colorSchemeId STRING e o oneof `wallpaper`:
 *       10 defaultWallpaper | 11 solidColor | 12 stockImage
 *       13 customImage     | 14 animatedWallpaper
 */

/** Sintaxe de uso, sem citar efeito. */
export const TEMA_USAGE =
    '🧪 *CHAT THEME LAB*\n\n' +
    'Uso (UMA variacao por execucao):\n' +
    '• !tema teste — defaultWallpaper\n' +
    '• !tema stock <ID> [dim] — stockImage\n' +
    '• !tema animated <ID> [dim] — animatedWallpaper\n' +
    '• !tema color <#light> <#dark> — solidColor\n' +
    '• !tema scheme <ID> — colorSchemeId\n' +
    '• !tema reset — clearTheme\n\n' +
    '_Protocolo experimental. Nao garante alteracao de aparencia._';

/**
 * Interpreta os argumentos do comando e devolve os campos do `ChatThemeSetting`.
 *
 * @param {string[]} args
 * @returns {{ok:true, input:object, variant:string|null, rotulo:string}[]
 *          | {ok:false, reason:string}}
 */
export const parseTemaArgs = (args = []) => {
    const [sub, ...rest] = args.map((a) => String(a).trim()).filter(Boolean);
    const acao = (sub || 'teste').toLowerCase();

    const parseDim = (raw) => {
        if (raw === undefined || raw === '') return undefined;
        const n = Number(raw);
        if (!Number.isFinite(n)) return NaN;
        return n;
    };

    if (acao === 'teste' || acao === 'test') {
        return { ok: true, input: { wallpaper: { defaultWallpaper: {} } }, variant: 'defaultWallpaper', rotulo: 'defaultWallpaper' };
    }

    if (acao === 'reset' || acao === 'limpar' || acao === 'clear') {
        return { ok: true, input: { clearTheme: true }, variant: null, rotulo: 'clearTheme' };
    }

    if (acao === 'stock' || acao === 'stockimage') {
        const id = rest[0];
        if (!id) return { ok: false, reason: 'informe o ID: !tema stock <ID> [dim]' };
        const dim = parseDim(rest[1]);
        if (Number.isNaN(dim)) return { ok: false, reason: 'dim precisa ser numero (ex.: 0.25)' };
        const w = { stockImageId: id };
        if (dim !== undefined) w.dimLevel = dim;
        return { ok: true, input: { wallpaper: { stockImage: w } }, variant: 'stockImage', rotulo: `stockImage ${id}` };
    }

    if (acao === 'animated' || acao === 'animado') {
        const id = rest[0];
        if (!id) return { ok: false, reason: 'informe o ID: !tema animated <ID> [dim]' };
        const dim = parseDim(rest[1]);
        if (Number.isNaN(dim)) return { ok: false, reason: 'dim precisa ser numero (ex.: 0.25)' };
        const w = { animatedWallpaperId: id };
        if (dim !== undefined) w.dimLevel = dim;
        return { ok: true, input: { wallpaper: { animatedWallpaper: w } }, variant: 'animatedWallpaper', rotulo: `animatedWallpaper ${id}` };
    }

    if (acao === 'color' || acao === 'solid' || acao === 'solido') {
        const clara = rest[0];
        const escura = rest[1];
        if (!clara || !escura) return { ok: false, reason: 'informe as duas cores: !tema color <#clara> <#escura>' };
        return {
            ok: true,
            input: { wallpaper: { solidColor: { colorLight: clara, colorDark: escura } } },
            variant: 'solidColor',
            rotulo: `solidColor ${clara}/${escura}`
        };
    }

    if (acao === 'scheme' || acao === 'cores' || acao === 'colorscheme') {
        const id = rest[0];
        if (!id) return { ok: false, reason: 'informe o ID: !tema scheme <ID>' };
        return { ok: true, input: { colorSchemeId: id }, variant: null, rotulo: `colorSchemeId ${id}` };
    }

    return { ok: false, reason: `acao desconhecida: ${acao}` };
};

/**
 * Executa UM teste controlado.
 *
 * @param {object} params
 * @param {Function} params.sendChatTheme a função da fork (`nazu.sendChatTheme`)
 * @param {string} params.jid
 * @param {string[]} params.args
 * @param {Function} [params.now] injetável para teste; padrão Date.now
 * @returns {Promise<{ok:boolean, text:string, reason?:string}>}
 */
export const runTemaTest = async ({ sendChatTheme, jid, args, now = Date.now }) => {
    if (typeof sendChatTheme !== 'function') {
        return { ok: false, reason: 'sem_suporte', text: '❌ Sua fork do Baileys nao expoe `sendChatTheme`. Atualize a fork.' };
    }
    if (typeof jid !== 'string' || !jid.trim()) {
        return { ok: false, reason: 'sem_jid', text: '❌ Nao consegui identificar a conversa.' };
    }

    const parsed = parseTemaArgs(args);
    if (!parsed.ok) {
        return { ok: false, reason: 'args', text: `❌ ${parsed.reason}\n\n${TEMA_USAGE}` };
    }

    const input = { ...parsed.input, settingTimestampMs: now() };
    const chatType = jid.endsWith('@g.us') ? 'grupo' : 'privado';

    let result;
    try {
        result = await sendChatTheme({ jid, testId: Date.now(), ...input });
    } catch (e) {
        return { ok: false, reason: 'excecao', text: `❌ Falha ao montar o payload: ${e?.message || e}` };
    }

    if (!result?.ok) {
        return {
            ok: false,
            reason: result?.reason || 'transporte',
            text: `❌ O payload nao saiu (${result?.reason || 'erro'}).\n${result?.error || ''}`.trim()
        };
    }

    const wp = parsed.variant ? input.wallpaper?.[parsed.variant] : null;
    const linhas = [
        '🧪 *CHAT THEME LAB*',
        '',
        `🎯 Alvo: ${chatType}`,
        `📦 Payload: ChatThemeSetting`,
        `🎨 Wallpaper: ${parsed.rotulo}`,
        wp?.dimLevel !== undefined ? `🌗 DimLevel: ${wp.dimLevel}` : null,
        input.colorSchemeId ? `🎛️ ColorScheme: ${input.colorSchemeId}` : null,
        `🕒 Timestamp: ${input.settingTimestampMs}`,
        `🆔 ID: ${result.messageId || 'n/d'}`,
        '',
        '📤 Enviado pela via normal (relayMessage).',
        '',
        '_Isto NAO confirma alteracao visual._',
        '_O efeito e do cliente do WhatsApp — pode ser aceito e ignorado._'
    ].filter(Boolean);

    return { ok: true, variant: parsed.variant, messageId: result.messageId, text: linhas.join('\n') };
};
