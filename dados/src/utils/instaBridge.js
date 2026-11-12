/**
 * PONTE DO INSTAGRAM — faz o bot responder DM no Instagram com os MESMOS
 * comandos do WhatsApp.
 *
 * ## Por que existe
 *
 * A lib `insta` (repo `Souzzaaxzy/Insta`) é a camada de protocolo (a "Baileys
 * do Instagram"): ela dá `makeInstaClient`, `dm.received` e `sendMessage`. Este
 * arquivo é a PONTE: pega a DM que chega, monta um `info` no formato que o
 * handler do bot já entende e chama o MESMO `NazuninhaBotExec` — então TODO
 * comando (`!ping`, `!menu`, os ~1900) funciona sem reescrever nada.
 *
 * ## A sessão vem do MESMO arquivo do `!keyig`
 *
 * O `!keyig` já grava o cookie em `data/instagram/cookies.txt`. A lib lê esse
 * arquivo (`sessionIdFromCookiesFile`). Então **não há pareamento novo**: o
 * cookie que já está configurado é a sessão.
 *
 * ## Desligado por padrão
 *
 * Só liga com `INSTA_DM=1` no ambiente. Sem isso, nada acontece (nenhuma
 * conexão, nenhuma requisição) — o bot fica exatamente como está.
 *
 * ## O `nazu` da ponte
 *
 * O handler foi escrito para o Baileys (grupos, mídia, metadata). Numa DM do
 * Instagram nada disso existe, então a ponte monta um `nazu` com a SUPERFÍCIE
 * que o handler usa: `sendMessage` traduz o conteúdo do bot para o que a lib
 * do Instagram entende; os métodos de grupo viram no-op seguro. O objetivo é
 * que o comando NUNCA quebre por causa de um método ausente — no pior caso ele
 * avisa.
 */

import path from 'node:path';
import { caminhoCookies, lerSessionId } from './instagramCookies.js';

/** Ligado? (opt-in explícito por env) */
export function instaDmLigado() {
  return String(process.env.INSTA_DM || '') === '1';
}

/**
 * Constrói o `info` no MESMO formato que o handler do bot espera.
 *
 * O handler lê: `info.key.{remoteJid,fromMe,id,participant}`, `info.message`,
 * `info.pushName`, `info.messageTimestamp`. Para DM do Instagram:
 *   - `remoteJid` = o id da THREAD (é o "chat");
 *   - `participant` = quem mandou (o id do usuário);
 *   - `messageTimestamp` = em SEGUNDOS (o bot faz `* 1000`).
 *
 * @param {object} msg  o que a lib emite em `dm.received`
 * @returns {object|null} o `info`, ou null se não for mensagem de texto
 */
export function infoDoDm(msg) {
  if (!msg || typeof msg !== 'object') return null;
  const texto = msg.text ?? msg.message?.text ?? null;
  if (typeof texto !== 'string' || !texto.trim()) return null;

  const threadId = String(msg.thread_id ?? msg.threadId ?? '');
  const autor = String(msg.user_id ?? msg.from ?? msg.userId ?? '');
  if (!threadId || !autor) return null;

  // `item_type` 'text' é o que interessa; o resto (reação, like, mídia) não é
  // comando. Ausente conta como texto (alguns patches não trazem o campo).
  const tipo = msg.item_type ?? msg.itemType ?? 'text';
  if (tipo !== 'text') return null;

  // O BOT não responde às PRÓPRIAS mensagens — sem isto, a resposta do bot
  // volta pelo message-sync e vira um loop de eco.
  if (msg.is_sent_by_viewer === true) return null;

  const id = String(msg.id ?? msg.item_id ?? `ig-${Date.now()}`);
  const ts = msg.timestamp ?? msg.timestamp_ms ?? Date.now();
  // O handler espera SEGUNDOS (ele multiplica por 1000).
  const tsSeg = ts > 1e12 ? Math.floor(ts / 1000) : Math.floor(ts > 1e9 ? ts : Date.now() / 1000);

  return {
    key: {
      remoteJid: threadId,
      fromMe: false,
      id,
      participant: autor,
    },
    message: { conversation: texto },
    messageTimestamp: tsSeg,
    pushName: msg.username ?? msg.push_name ?? msg.raw?.user?.username ?? '',
    // Marca a origem — o handler não usa, mas ajuda no log.
    _origem: 'instagram',
  };
}

/**
 * Traduz o `content` que o bot manda (`nazu.sendMessage(chatId, content)`) para
 * o formato da lib do Instagram e envia.
 *
 * O bot manda `{ text }`, `{ image: buffer, caption }`, `{ video: buffer }`,
 * `{ audio: buffer }`, `{ sticker }`, `{ document }`. O Instagram tem rota para
 * texto, foto, vídeo, voz e GIF; figurinha e documento NÃO têm — nesses casos a
 * ponte avisa em texto em vez de sumir.
 *
 * @returns {Promise<object|null>}
 */
export async function enviarParaInsta(insta, threadId, content = {}, log = console) {
  const alvo = String(threadId);
  const caption = typeof content?.caption === 'string' ? content.caption : undefined;
  const texto = typeof content?.text === 'string' ? content.text : undefined;

  try {
    if (content?.image) return await insta.sendMessage(alvo, { image: content.image, caption });
    if (content?.video) return await insta.sendMessage(alvo, { video: content.video, caption });
    if (content?.audio) return await insta.sendMessage(alvo, { audio: content.audio });
    if (content?.gif && typeof insta.direct?.sendGif === 'function') {
      return await insta.direct.sendGif(alvo, content.gif);
    }
    const fallback = texto ?? caption;
    if (fallback) return await insta.sendMessage(alvo, { text: String(fallback) });
    if (content?.sticker || content?.document) {
      return await insta.sendMessage(alvo, { text: '(o Instagram não aceita figurinha/documento por aqui)' });
    }
    return null;
  } catch (e) {
    log.error?.('[INSTA-DM] falha ao enviar:', e?.message || e);
    return null;
  }
}

/**
 * Monta o `nazu` que o handler usa. `sendMessage` é a ponte real; os métodos de
 * grupo/metadata viram no-op (não existem numa DM) para o comando não quebrar.
 */
export function criarNazuInsta(insta, info, log = console) {
  const userId = insta?.userId ?? insta?.me?.pk ?? insta?.me?.id ?? '';
  const noop = async () => undefined;
  return {
    // `getBotId()` faz `nazu.user.id.split(':')` — TEM de ser string.
    user: { id: String(userId), lid: '' },
    store: { contacts: {} },
    sendMessage: async (chatId, content) => enviarParaInsta(insta, chatId || info.key.remoteJid, content, log),
    getName: async () => info.pushName || '',
    // O handler resolve LID->PN com `onWhatsApp`; numa DM nao existe LID. Sem
    // este metodo, o handler loga "nazu.onWhatsApp is not a function" a cada
    // mensagem. Lista vazia = "nao sei o LID" -> ele segue com o proprio id.
    onWhatsApp: async () => [],
    // Grupo/metadata: não se aplica a DM — no-op seguro (o comando avisa em vez
    // de explodir).
    groupMetadata: async () => ({}),
    getCachedGroupMetadata: async () => ({}),
    groupParticipantsUpdate: noop,
    groupRequestParticipantsUpdate: noop,
    groupRequestParticipantsList: async () => [],
    groupGetRequestParticipants: async () => [],
    groupInviteCode: async () => null,
    chatModify: noop,
    updateBlockStatus: noop,
    readMessages: noop,
    react: noop,
    profilePictureUrl: async () => null,
    ev: { on: () => {}, off: () => {}, emit: () => {} },
  };
}

/**
 * Liga a ponte: conecta no Instagram, escuta `dm.received` e responde usando o
 * handler do bot.
 *
 * @param {object} deps
 * @param {Function} deps.executar  o handler (`NazuninhaBotExec`)
 * @param {object}   [deps.log]     logger (padrão: console)
 * @param {object}   [deps.authDir] diretório do auth state
 * @returns {Promise<{client: object, parar: Function}|null>}
 */
export async function ligarPonteInstagram({ executar, log = console, authDir, _fabricaInsta } = {}) {
  if (!instaDmLigado()) return null;
  if (typeof executar !== 'function') {
    log.error?.('[INSTA-DM] sem handler — a ponte não sobe.');
    return null;
  }

  const cookiesFile = caminhoCookies();
  if (!cookiesFile) {
    log.error?.('[INSTA-DM] sem cookie. Configure com `!keyig` antes de ligar a ponte.');
    return null;
  }
  const sid = lerSessionId();
  if (!sid) {
    log.error?.('[INSTA-DM] cookie sem sessionid. Renove com `!keyig`.');
    return null;
  }

  let makeInstaClient, useFileAuthState, sessionIdFromCookiesFile;
  try {
    const lib = await import('insta');
    ({ makeInstaClient, useFileAuthState, sessionIdFromCookiesFile } = lib);
  } catch (e) {
    log.error?.('[INSTA-DM] pacote `insta` não instalado:', e?.message || e);
    return null;
  }
  // Seam de teste: injeta uma fabrica de cliente em vez de abrir o MQTT real.
  const fabrica = typeof _fabricaInsta === 'function' ? _fabricaInsta : makeInstaClient;

  const dir = authDir || path.join(process.env.DATABASE_PATH || path.join(process.cwd(), 'dados', 'database'), 'insta-auth');
  const { state, saveCreds } = await useFileAuthState(dir);
  // A sessão sai do MESMO arquivo que o `!keyig` grava.
  state.creds.authorization_data = { sessionid: sessionIdFromCookiesFile(cookiesFile) || sid };

  const insta = fabrica({ auth: state, log: (...a) => log.log?.('[INSTA-DM]', ...a) });
  insta.ev.on('creds.update', saveCreds);

  // Ids já processados — o message-sync pode reentregar o mesmo item.
  const vistos = new Set();

  insta.ev.on('dm.received', async (msg) => {
    try {
      const info = infoDoDm(msg);
      if (!info) return; // reação, like, eco do bot, mídia sem texto: não é comando
      if (vistos.has(info.key.id)) return;
      vistos.add(info.key.id);
      if (vistos.size > 500) vistos.clear();

      log.log?.(`[INSTA-DM] DM recebida: "${String(info.message.conversation).slice(0, 40)}" (thread ${info.key.remoteJid})`);
      const nazu = criarNazuInsta(insta, info, log);
      await executar(nazu, info, null, new Map(), null);
    } catch (e) {
      log.error?.('[INSTA-DM] erro ao processar DM:', e?.message || e);
    }
  });

  try {
    const me = typeof insta.connect === 'function' ? await insta.connect() : (insta.me ?? null);
    log.log?.(`[INSTA-DM] conectado como @${me?.username ?? me?.pk ?? '?'}`);
    if (typeof insta.realtimeConnect === 'function') await insta.realtimeConnect();
    await insta.realtime?.subscribeDirect?.();
    log.log?.('[INSTA-DM] escutando DMs (MQTT).');
  } catch (e) {
    log.error?.('[INSTA-DM] falha ao conectar:', e?.message || e);
    return null;
  }

  return {
    client: insta,
    parar: async () => {
      try { await insta.logout?.(); } catch { /* já caiu */ }
    },
  };
}
