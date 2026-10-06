import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateWAMessage } from '@itsliaaa/baileys';

const ROOT = path.dirname(fileURLToPath(import.meta.url));

function lerConfig() {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf-8'));
  } catch {
    return {};
  }
}

function raiz() {
  const cfg = lerConfig();
  const base = process.env.TOPGEAR_PUBLIC_URL || cfg.publicUrl;
  return base ? String(base).replace(/\/$/, '').replace(/\/index\.html$/, '') : '';
}

function pagina(jogoId) {
  const base = raiz();
  if (!base) return '';
  return jogoId ? `${base}/?jogo=${encodeURIComponent(jogoId)}` : base;
}

/**
 * Monta e envia o card do jogo: capa (GIF animado) + texto + botao webview.
 * Tudo em UMA mensagem. Se a capa falhar, cai para texto + botao.
 *
 * A capa e um `.gif` (docs/emugames/capas/<id>.gif). O WhatsApp nao anima um
 * `.gif` cru como imagem/video — ele exige MP4 + `gifPlayback`. Quem faz essa
 * conversao e a fork (`@itsliaaa/baileys`), pelo tipo `gif:` (vira
 * videoMessage com gifPlayback), que o header interativo aceita.
 */
async function enviarCard({ nazu, from, jogo }) {
  const base = raiz();
  if (!base) return { ok: false, msg: 'URL do jogo nao configurada.' };
  if (!jogo || !jogo.id) return { ok: false, msg: 'Jogo invalido.' };

  const url = pagina(jogo.id);
  const texto = `${jogo.emoji || '🎮'} *${jogo.nome}*\n\n${jogo.descricao}\n\n🎮 Toque em *JOGAR* para abrir o jogo.`;
  const botao = [{ text: '🎮 JOGAR', url, useWebview: true }];
  const footer = 'Lizzy · EmuGames';

  const capaUrl = `${base}/capas/${encodeURIComponent(jogo.id)}.gif`;

  let msg;
  try {
    msg = await generateWAMessage(from, {
      gif: { url: capaUrl },
      caption: texto,
      footer,
      nativeFlow: botao
    }, { userJid: nazu.user.id, upload: nazu.waUploadToServer });
  } catch (e) {
    console.error(`[EMUGAMES] capa falhou (${jogo.id}), enviando so texto:`, e?.message);
    msg = await generateWAMessage(from, { text: texto, footer, nativeFlow: botao },
      { userJid: nazu.user.id, upload: nazu.waUploadToServer });
  }

  await nazu.relayMessage(from, msg.message, { messageId: msg.key.id });
  return { ok: true };
}

export default { pagina, raiz, enviarCard, config: lerConfig };
