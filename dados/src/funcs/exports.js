import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

// ESM-compatible __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// createRequire is only used for JSON or true CJS modules
const require = createRequire(import.meta.url);

function loadJsonSync(filePath) {
    try {
        const fullPath = path.resolve(__dirname, filePath);
        const data = fs.readFileSync(fullPath, 'utf-8');
        return JSON.parse(data);
    } catch (error) {
        console.error(`[ERRO] Falha ao carregar o arquivo JSON: ${filePath}. Erro: ${error.message}`);
        return undefined;
    }
}

let modulesPromise;

async function loadModules() {
    if (modulesPromise) return modulesPromise;

    modulesPromise = (async () => {
        const modules = {};

        // --- downloads ---
        const [
            youtubeMod, tiktokMod, pinterestMod, igdlMod, lyricsMod, 
            mcpluginsMod, spotifyMod, soundcloudMod, facebookMod, 
            kwaiMod, logos, edits, canvas
        ] = await Promise.all([
            import('./downloads/youtube.js'),
            import('./downloads/tiktok.js'),
            import('./downloads/pinterest.js'),
            import('./downloads/igdl.js'),
            import('./downloads/lyrics.js'),
            import('./downloads/mcplugins.js'),
            import('./downloads/spotify.js'),
            import('./downloads/soundcloud.js'),
            import('./downloads/facebook.js'),
            import('./downloads/kwai.js'),
            import('./logos/index.js'),
            import('./edits/index.js'),
            import('./downloads/canvas.js'),
        ]);

        modules.youtube = youtubeMod.default ?? youtubeMod;
        modules.tiktok = tiktokMod.default ?? tiktokMod;
        modules.pinterest = pinterestMod.default ?? pinterestMod;
        modules.igdl = igdlMod.default ?? igdlMod;
        modules.Lyrics = lyricsMod.default ?? lyricsMod;
        modules.mcPlugin = mcpluginsMod.default ?? mcpluginsMod;
        modules.spotify = spotifyMod.default ?? spotifyMod;
        modules.soundcloud = soundcloudMod.default ?? soundcloudMod;
        modules.facebook = facebookMod.default ?? facebookMod;
        modules.kwai = kwaiMod.default ?? kwaiMod;
        modules.logos = logos.default ?? logos;
        modules.edits = edits.default ?? edits;
        modules.canvas = canvas.default ?? canvas;

        // --- utils ---
        const [
            styleTextMod, LogosMod, LogosMod2, verifyUpdateMod, emojiMixMod,
            uploadMod, tictactoeMod, stickerMod, commandStatsMod, relationshipsMod,
            connect4Mod, unoMod, memoriaMod, achievementsMod, giftsMod,
            reputationMod, qrcodeMod, notesMod, calculatorMod, audioEditMod,
            transmissaoMod, gdriveMod, mediafireMod, twitterMod, searchMod,
            imagetoolsMod, freefireMod, smmApiMod, adoptionMod
        ] = await Promise.all([
            import('./utils/gerarnick.js'),
            import('./utils/logotipos.js'),
            import('./utils/logotipos2.js'),
            import('./utils/update-verify.js'),
            import('./utils/emojimix.js'),
            import('./utils/upload.js'),
            import('./utils/tictactoe.js'),
            import('./utils/sticker.js'),
            import('./utils/commandStats.js'),
            import('./utils/relationships.js'),
            import('./utils/connect4.js'),
            import('./utils/uno.js'),
            import('./utils/memoria.js'),
            import('./utils/achievements.js'),
            import('./utils/gifts.js'),
            import('./utils/reputation.js'),
            import('./utils/qrcode.js'),
            import('./utils/notes.js'),
            import('./utils/calculator.js'),
            import('./utils/audioEdit.js'),
            import('./utils/transmissao.js'),
            import('./utils/gdrive.js'),
            import('./utils/mediafire.js'),
            import('./utils/twitter.js'),
            import('./utils/search.js'),
            import('./utils/imagetools.js'),
            import('./utils/freefire.js'),
            import('./smmApi.js'),
            import('./utils/adoptionManager.js'),
        ]);

        modules.styleText = styleTextMod.default ?? styleTextMod;
        modules.Logos = LogosMod.default ?? LogosMod;
        modules.Logos2 = LogosMod2.default ?? LogosMod2;
        modules.VerifyUpdate = verifyUpdateMod.default ?? verifyUpdateMod;
        modules.emojiMix = emojiMixMod.default ?? emojiMixMod;
        modules.upload = uploadMod.default ?? uploadMod;
        modules.tictactoe = tictactoeMod.default ?? tictactoeMod;
        modules.stickerModule = stickerMod.default ?? stickerMod;
        modules.commandStats = commandStatsMod.default ?? commandStatsMod;
        modules.relationshipManager = relationshipsMod.default ?? relationshipsMod;
        modules.connect4 = connect4Mod.default ?? connect4Mod;
        modules.uno = unoMod.default ?? unoMod;
        modules.memoria = memoriaMod.default ?? memoriaMod;
        modules.achievements = achievementsMod.default ?? achievementsMod;
        modules.gifts = giftsMod.default ?? giftsMod;
        modules.reputation = reputationMod.default ?? reputationMod;
        modules.qrcode = qrcodeMod.default ?? qrcodeMod;
        modules.notes = notesMod.default ?? notesMod;
        modules.calculator = calculatorMod.default ?? calculatorMod;
        modules.audioEdit = audioEditMod.default ?? audioEditMod;
        modules.transmissao = transmissaoMod.default ?? transmissaoMod;
        modules.gdrive = gdriveMod.default ?? gdriveMod;
        modules.mediafire = mediafireMod.default ?? mediafireMod;
        modules.twitter = twitterMod.default ?? twitterMod;
        modules.search = searchMod.default ?? searchMod;
        modules.imagetools = imagetoolsMod.default ?? imagetoolsMod;
        modules.freefire = freefireMod.default ?? freefireMod;
        modules.smmApi = smmApiMod.default ?? smmApiMod;
        modules.adoptionManager = adoptionMod.default ?? adoptionMod;

        if (modules.stickerModule && modules.stickerModule.sendSticker) {
            modules.sendSticker = modules.stickerModule.sendSticker;
        }

        // --- private ---
        const [iaMod, temuScammerMod, antitoxicMod, iaExpandedMod, antipalavra] = await Promise.all([
            import('./private/ia.js'),
            import('./private/temuScammer.js'),
            import('./private/antitoxic.js'),
            import('./private/iaExpanded.js'),
            import('./private/antipalavra.js'),
        ]);

        modules.ia = iaMod.default ?? iaMod;
        modules.temuScammer = temuScammerMod.default ?? temuScammerMod;
        modules.antitoxic = antitoxicMod.default ?? antitoxicMod;
        modules.iaExpanded = iaExpandedMod.default ?? iaExpandedMod;
        modules.antipalavra = antipalavra.default ?? antipalavra;

        // --- JSONs ---
        const toolsJsonData = loadJsonSync('json/tools.json');
        const vabJsonData = loadJsonSync('json/vab.json');
        modules.toolsJson = () => toolsJsonData;
        modules.vabJson = () => vabJsonData;

        return modules;
    })();

    return modulesPromise;
}

export async function getModules() {
    return await loadModules();
}

const modules = await loadModules();

const safeModules = new Proxy(modules, {
    get(target, prop) {
        if (!(prop in target)) {
            console.warn(`[EXPORTS] Module '${prop}' not found in exports`);
            return undefined;
        }
        return target[prop];
    }
});

export default safeModules;
