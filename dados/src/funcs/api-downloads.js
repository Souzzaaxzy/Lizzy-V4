/**
 * API Interna Centralizada de Downloads/Pesquisa (Fachada)
 *
 * FASE 1 — Apenas fachada: encaminha as chamadas para os módulos existentes.
 * NÃO substitui a VexAPI, NÃO implementa scraping novo, NÃO altera módulos.
 *
 * Como o projeto usa ESM ("type": "module"), cada módulo é um singleton por URL:
 * importá-lo aqui e no exports.js retorna a MESMA instância (cache de módulos
 * do ESM), portanto não há duplicação de instâncias nem estado duplo.
 *
 * Exportação default = objeto único `API` com namespaces por plataforma.
 */

// --- Named exports (import * as ns) ---
import * as tiktokMod from './downloads/tiktok.js';
import * as youtubeMod from './downloads/youtube.js';
import * as igdlMod from './downloads/igdl.js';
import * as pinterestMod from './downloads/pinterest.js';
import * as canvasMod from './downloads/canvas.js';
import * as kwaiMod from './downloads/kwai.js';
import * as editsMod from './edits/index.js';
import * as logosMod from './logos/index.js';

// --- Default exports (objeto) ---
import spotifyMod from './downloads/spotify.js';
import soundcloudMod from './downloads/soundcloud.js';
import facebookMod from './downloads/facebook.js';
import imagetoolsMod from './utils/imagetools.js';

// --- Default exports (função) ---
import getLyrics from './downloads/lyrics.js';
import apkMod from './downloads/apkmod.js';
import buscarPlugin from './downloads/mcplugins.js';

/**
 * Módulos de exportação nomeada expõem seus métodos diretamente no objeto
 * retornado por `import * as`. Apenas filtramos possíveis chaves internas
 * do ESM (`default`, `__esModule`) para manter o namespace limpo.
 */
function pickNamed(ns) {
    const out = {};
    for (const key of Object.keys(ns)) {
        if (key === 'default' || key === '__esModule') continue;
        out[key] = ns[key];
    }
    return out;
}

/**
 * Para módulos cujo default export é uma FUNÇÃO (lyrics, apkmod, mcplugins),
 * expomos a própria função como namespace (preservando a chamada direta antiga,
 * ex.: `Lyrics(q)`) e anexamos a função também como propriedade nomeada
 * (`API.lyrics.getLyrics`, `API.apkmod.apkMod`, `API.mcplugins.buscarPlugin`).
 */
function callable(fn, aliasName) {
    const obj = (...args) => fn(...args);
    obj[aliasName] = fn;
    return obj;
}

const API = {
    tiktok: pickNamed(tiktokMod),        // { search, dl }
    youtube: pickNamed(youtubeMod),      // { search, mp3, mp4, ytmp3, ytmp4 }
    instagram: pickNamed(igdlMod),       // { dl }
    pinterest: pickNamed(pinterestMod),  // { search, dl }
    canvas: pickNamed(canvasMod),        // { gerarbrat, gerarbratvid, gerarwelcomecard }
    kwai: pickNamed(kwaiMod),            // { dl }
    edits: pickNamed(editsMod),          // { geraredit }
    logos: pickNamed(logosMod),          // { gerarLogo }

    spotify: spotifyMod,                 // { download, search, searchDownload }
    soundcloud: soundcloudMod,           // { download, search, searchDownload }
    facebook: facebookMod,              // { downloadHD }
    imagetools: imagetoolsMod,           // { removeBg, upscale }

    lyrics: callable(getLyrics, 'getLyrics'),        // lyrics(q) e lyrics.getLyrics(q)
    apkmod: callable(apkMod, 'apkMod'),             // apkmod(q) e apkmod.apkMod(q)
    mcplugins: callable(buscarPlugin, 'buscarPlugin'), // mcplugins(q) e mcplugins.buscarPlugin(q)
};

export default API;
