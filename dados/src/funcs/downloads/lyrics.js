/**
 * Lyrics - Implementação própria (sem VexAPI)
 *
 * Conteúdo público, sem login, sem bypass de autenticação/CAPTCHA.
 *
 * - getLyrics(topic): busca a letra na API pública e gratuita do lrclib.net
 *   (GET /api/search?q=..., sem chave) e enriquece com capa/link de música
 *   da API pública do iTunes (itunes.apple.com/search, sem chave), usada só
 *   para o thumbnail opcional e para o link público da música.
 *   O enriquecimento é best-effort: se o iTunes falhar, retorna só o texto.
 *
 * Formato de retorno preservado (idêntico ao módulo original):
 *   sucesso: { text, image? }   (template 🎵/👤/🔗/📜)
 *   erro:    throw new Error(...)  (o comando já trata com try/catch)
 *
 * Sem cache (o módulo original também não tinha). Timeout via AbortController (25s).
 */

const LYRICS_UA = 'Lizzy-V4 AbyssBot (https://github.com/Souzzaaxzy/Lizzy-V4)';

async function fetchWithTimeout(url, opts = {}, ms = 25000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal, redirect: 'follow' });
  } finally {
    clearTimeout(timer);
  }
}

// Capa e link público da música via iTunes (best-effort; nunca derruba o fluxo).
async function fetchTrackMedia(topic, title, artist) {
  const terms = [`${artist} ${title}`, title, topic];
  for (const term of terms) {
    if (!term || !term.trim()) continue;
    try {
      const res = await fetchWithTimeout(
        `https://itunes.apple.com/search?term=${encodeURIComponent(term.trim())}&media=music&entity=song&limit=1`
      );
      const data = await res.json();
      const item = data?.results?.[0];
      if (item?.artworkUrl100) {
        return {
          image: item.artworkUrl100.replace('/100x100bb.jpg', '/600x600bb.jpg'),
          link: item.trackViewUrl || ''
        };
      }
    } catch {
      // tenta o próximo termo
    }
  }
  return { image: null, link: '' };
}

async function getLyrics(topic) {
  try {
    const query = String(topic || '').trim();

    if (!query) {
      throw new Error('Letra não encontrada');
    }

    // Busca no lrclib. Se a query completa não achar nada (ex.: usuário
    // mandou artista junto e a base não tem essa combinação), vai cortando
    // a última palavra até achar (máx. 4 tentativas).
    const words = query.split(/\s+/);
    let results = null;
    let lastError = null;

    for (let len = words.length; len > 0 && results === null; len--) {
      const q = words.slice(0, len).join(' ');
      if (words.length - len >= 3) break;
      try {
        const res = await fetchWithTimeout(
          `https://lrclib.net/api/search?q=${encodeURIComponent(q)}`,
          { headers: { 'User-Agent': LYRICS_UA } }
        );
        const data = await res.json();
        if (Array.isArray(data) && data.length > 0) {
          results = data;
          break;
        }
      } catch (err) {
        lastError = err;
      }
    }

    if (!results) {
      if (lastError) throw new Error('Falha ao consultar o serviço de letras');
      throw new Error(`Letra não encontrada para: ${query}`);
    }

    const music = results[0];

    const title = music.trackName || 'Título não disponível';
    const artist = music.artistName || 'Artista desconhecido';
    const lyrics = music.plainLyrics?.trim() || 'Letra não disponível';

    // thumbnail + link público (opcional; falhas não quebram o fluxo)
    const media = await fetchTrackMedia(query, title, artist);
    const image = media.image || null;
    const link = media.link || '';

    const text = `
🎵 *${title}* 🎵
👤 Artista: ${artist}
🔗 ${link}

📜 *Letra:*

${lyrics}
`.trim();

    if (image) {
      return { text, image };
    }

    return { text };
  } catch (err) {
    throw new Error(`Erro: ${err.message}`);
  }
}

export default getLyrics;
