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

  const id = String(msg.id ?? msg.item_id ?? `ig-${Date.now()}`);
  // `item_type` 'text' é o que interessa; o resto (reação, like) é ignorado.
  const tipo = msg.item_type ?? msg.itemType ?? 'text';
  if (tipo !== 'text') return null;

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
    pushName: msg.username ?? msg.push_name ?? '',
    // Marca a origem — o handler não usa, mas ajuda no log e em comandos
    // que queiram saber (ex.: futuros).
    _origem: 'instagram',
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
export async function ligarPonteInstagram({ executar, log = console, authDir } = {}) {
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

  let makeInstaClient, useFileAuthState, sessionIdFromCookiesFile, RealtimeClient;
  try {
    const lib = await import('insta');
    ({ makeInstaClient, useFileAuthState, sessionIdFromCookiesFile } = lib);
    RealtimeClient = lib.RealtimeClient;
  } catch (e) {
    log.error?.('[INSTA-DM] pacote `insta` não instalado:', e?.message || e);
    return null;
  }

  const dir = authDir || path.join(process.env.DATABASE_PATH || path.join(process.cwd(), 'dados', 'database'), 'insta-auth');
  const { state, saveCreds } = await useFileAuthState(dir);
  // A sessão sai do MESMO arquivo que o `!keyig` grava.
  state.creds.authorization_data = { sessionid: sessionIdFromCookiesFile(cookiesFile) || sid };

  const insta = makeInstaClient({ auth: state, log: (...a) => log.log?.('[INSTA-DM]', ...a) });
  insta.ev.on('creds.update', saveCreds);

  insta.ev.on('dm.received', async (msg) => {
    try {
      const info = infoDoDm(msg);
      if (!info) return; // reação, like, mídia sem texto: não é comando
      // O handler responde por `nazu.sendMessage(chatId, content)`; a thread é
      // o `chatId`. Montamos um `nazu` mínimo com essa assinatura.
      const nazu = {
        sendMessage: async (chatId, content) => {
          const alvo = chatId || info.key.remoteJid;
          if (typeof content?.text === 'string') {
            return insta.sendMessage(alvo, { text: content.text });
          }
          // Mídia ainda não implementada na ponte: avisa em vez de sumir.
          return insta.sendMessage(alvo, { text: content?.caption || '(mídia não suportada na ponte ainda)' });
        },
        user: state.creds.me,
      };
      await executar(nazu, info, null, new Map(), null);
    } catch (e) {
      log.error?.('[INSTA-DM] erro ao processar DM:', e?.message || e);
    }
  });

  try {
    const me = await insta.connect();
    log.log?.(`[INSTA-DM] conectado como @${me?.username ?? me?.pk ?? '?'}`);
    await insta.realtimeConnect();
    log.log?.('[INSTA-DM] escutando DMs (MQTT).');
  } catch (e) {
    log.error?.('[INSTA-DM] falha ao conectar:', e?.message || e);
    return null;
  }

  return {
    client: insta,
    parar: async () => {
      try { await insta.logout(); } catch { /* já caiu */ }
    },
  };
}
