# AGENTS.md — Lizzy-V4 / Abyss Bot

## Arquitetura geral
- Bot de WhatsApp (Baileys) em **ESM** (`"type": "module"` no `package.json`).
- Entry: `package.json` main → `dados/src/connect.js` → importa `dados/src/index.js` (handlers) e `dados/src/funcs/exports.js` (carregador central de módulos).
- `dados/src/funcs/exports.js`: faz `Promise.all([import(...)])` de todos os módulos e monta um único objeto `modules` envolvido por um `Proxy` (`safeModules`) que avisa se faltar propriedade. `index.js` desestrutura `modules.default`.

## API interna centralizada (Fachada) — FASE 1 CONCLUÍDA
- Arquivo: **`dados/src/funcs/api-downloads.js`** (ÚNICO arquivo da API).
- É uma fachada: encaminha chamadas aos módulos existentes. **NÃO** substitui a VexAPI (exceto Pinterest — FASE 2, TikTok — FASE 3), **não** implementa scraping novo.
- Exporta `default API` com namespaces: `tiktok, youtube, instagram, pinterest, spotify, soundcloud, facebook, kwai, lyrics, canvas, edits, logos, imagetools, apkmod, mcplugins`.
- Integração em `exports.js`: `modules.API = (await import('./api-downloads.js')).default`. Os exports antigos (`modules.tiktok`, `modules.youtube`...) foram **preservados**.
- Sem duplicação de instâncias: em ESM cada módulo é singleton por URL, então importar o mesmo arquivo na fachada e no `exports.js` retorna a mesma referência (verificado: `modules.API === API`).

## FASE 2 — Pinterest migrado (sem VexAPI) ✅
- Arquivo: `dados/src/funcs/downloads/pinterest.js` reescrito (mantém `export { search, dl }`).
- **Removido**: `import verificarAPI`, `https`, `fs`, `CONFIG_FILE`, `apikey_vex`, `site_vex`. **Nenhuma** referência VexAPI resta no Pinterest.
- **search(query)**: Bing Image Search (HTML público) → extrai `murl` (URLs diretas de imagem). Retorna imagens gerais da web sobre o termo (não obrigatoriamente do Pinterest).
- **dl(url)**: resolve `pin.it`→`/pin/{id}/` (fetch segue redirect) e extrai OpenGraph `og:image`/`og:video` da página pública do pin → URL direta `i.pinimg.com`. Detecta vídeo via `og:video` ou `i.pinimg.com/videos/*.mp4`.
- Formato de retorno **preservado**: `{ ok, criador, type, mime, query?, count?, urls[] }` + `id` em `dl`. Erro: `{ ok:false, msg }`.
- Cache preservado (Map, TTL 30min, 1000). Timeout via `AbortController` (25s).
- Fachada e `exports.js` **não precisaram mudança** (já apontavam para `pinterest.js`). `API.pinterest` e `modules.pinterest` ambos expõem a nova implementação.
- Comando `!pinterest`/`!pin` e `handleAutoDownload` (Pinterest) **continuam funcionando sem alteração** (mesma interface `search`/`dl`, mesmo `urls[]`, `type`, `id`).
- Validado: search retorna 10 URLs; dl retorna URL direta acessível (HTTP 200, image/jpeg); boot do bot sem erros.

## FASE 3 — TikTok migrado (sem VexAPI) ✅
- Arquivo: `dados/src/funcs/downloads/tiktok.js` reescrito (mantém `export { search, dl }`).
- **Removido**: `import verificarAPI`, `https`, `fs`, `CONFIG_FILE`, `apikey_vex`, `site_vex`, chamadas a `/api/pesquisa/tiktok` e `/api/downloads/tiktok`. **Nenhuma** referência VexAPI resta no TikTok.
- **dl(url)**: consulta `tikwm.com/api/?url=<url>` (agregador público gratuito, sem apikey/login). Normaliza resposta para `{ ok, criador:'Hiudy', title, type, mime, urls[], author, username, views, likes, comments, shares, audio?, cover? }`. Trata photo slideshow (`data.images[]` → `type:'image'`). Mídia `play` (sem marca d'água) validada: 200, video/mp4.
- **search(query)**: Bing Videos Search `<query> tiktok` (HTML público, mesma abordagem do Pinterest) descobre URLs `tiktok.com/@user/video/ID` e aplica `dl()` em cada uma (até 3) montando `results[]`. Compat retroativa: espelha primeiro resultado no topo (`creator/title/urls/type/mime/audio/cover/link/views`). Respeita limite ~1 req/s do tikwm com `sleep(1200)` entre chamadas.
- Formato de retorno **preservado**: idêntico ao módulo original (mesmos campos `results[].urls[0]/title/cover/link`, fallback top-level `urls[0]`). Erro: `{ ok:false, msg }`.
- Cache preservado (Map, TTL 60min, 1000). Timeout via `AbortController` (25s).
- Fachada e `exports.js` **não precisaram mudança**. `API.tiktok` e `modules.tiktok` ambos expõem a nova implementação (mesmas funções `search`/`dl`; cache compartilhado por singleton ESM). `api.tiktok !== modules.tiktok` (objeto `pickNamed`), mas funções idênticas — comportamento esperado e idêntico ao Pinterest.
- Comando `!tiktok`/`!ttk`/`!tkk` (e aliases) e `handleAutoDownload` (TikTok) **continuam funcionando sem alteração** (mesma interface `search`/`dl`, mesmo `urls[0]`, `title`, `author`, `cover`, `link`).
- Validado: dl URL real (`vt.tiktok.com/ZSVMSaw8k/`) retorna todos os campos; search `gatos` retorna 3 resultados com play acessível; cache hit; erros graceful; 9 referências VexAPI confirmadas ausentes.

## FASE 4 — Instagram migrado (sem VexAPI) ✅
- Arquivo: `dados/src/funcs/downloads/igdl.js` reescrito (mantém `export { dl }`; nome do arquivo preservado).
- **Removido**: `import verificarAPI`, `https`, `fs`, `CONFIG_FILE`, `apikey_vex`, `site_vex`, chamada a `/api/downloads/instagram`. **Nenhuma** referência VexAPI resta no Instagram (o arquivo não tem mais nenhum `import`).
- **dl(url)**: extrai shortcode de `/p/`, `/reel/`, `/reels/`, `/tv/` (domínios `instagram.com`/`instagr.am`), converte para `media_id` (BigInt, alfabeto base64 do IG) e chama a **query GraphQL pública de posts deslogados** do Instagram (`PolarisLoggedOutDesktopWWWPostRootContentQuery`, doc_id `27130156389949648`), autenticada só com sessão anônima da homepage pública (token LSD + csrftoken; mesma abordagem do yt-dlp/parth-dl). Retorna só o que o IG libera anonimamente (`data.xig_polaris_media.if_not_gated_logged_out`).
- Sessão anônima cacheada por 10min (`getSession`), reduzindo requisições. **429/403 = fail-fast** com erro controlado (não queima cota com retry — quem tenta de novo é o chamador). Cache de resultados preservado (Map, TTL 60min, 1000). Timeout via `AbortController` (25s).
- **Carrossel completo**: `carousel_media[]` vira `data[]` na ordem original (cada item `{ type:image|video, url, mime }`). Vídeo = `video_versions[0].url`; imagem = `image_versions2.candidates[0].url`.
- Formato de retorno **preservado**: `{ ok, criador:'Hiudy', data:[...], count }` + **aditivos** `user:{username}` e `caption` (o autodownload já lia `result.user?.username`). Erro: `{ ok:false, msg }` (`Postagem não encontrada`, `Conteúdo privado ou indisponível sem login`, `Limite de requisições...`).
- Fachada e `exports.js` **não precisaram mudança**: `API.instagram.dl` e `modules.igdl.dl` expõem a nova implementação (mesma instância ESM).
- Comando `!instagram`/`!igdl`/`!ig`/`!instavideo`/`!igstory` (`index.js` ~19852, itera `data[]` enviando `{ [item.type]: { url } }`) e `handleAutoDownload` (Instagram, `index.js` ~1806/1884, usa `data[0]` e `user?.username`) **continuam funcionando sem alteração** — validado por simulação dos dois fluxos com `nazu` fake.
- Validado em Node: reel → 1 vídeo (`clips`), carrosseis de 13 e 7 imagens (CDN HTTP 200, video/mp4 / image/jpeg), post removido/URL inválida → `ok:false` graceful, cache hit, boot OK. Observação: sandbox datacenter sofre 429 no GraphQL anônimo do IG; em ~4min a cota volta.

## FASE 5 — Lyrics migrado (sem VexAPI) ✅
- Arquivo: `dados/src/funcs/downloads/lyrics.js` reescrito (mantém `export default getLyrics`).
- **Removido**: `import verificarAPI`, `https`, `fs`, `CONFIG_FILE`, `apikey_vex`, `site_vex`, chamada a `/api/pesquisa/letra`. **Nenhuma** referência VexAPI resta no Lyrics (arquivo sem imports).
- **getLyrics(topic)**: busca na API pública e gratuita do **lrclib.net** (`GET /api/search?q=...`, sem chave/login; UA identificável exigido por eles). Se a query completa não achar nada (usuário manda artista junto), corta palavras do fim até achar (máx. 4 tentativas). Enriquecimento best-effort via API pública do **iTunes** (`itunes.apple.com/search`, sem chave) para thumbnail opcional (`artworkUrl100` → 600x600) e link público (`trackViewUrl`); falhas no iTunes **não** derrubam o fluxo (só perde imagem/link).
- Formato de retorno **preservado**: `{ text, image? }` com o mesmo template (`🎵 *título*`/`👤 Artista`/`🔗 link`/`📜 *Letra:*`). Erro: **throw** (`Erro: ...`) — o comando `!letra`/`!lyrics` (`index.js` ~19684) já faz try/catch e também trata retorno string.
- **Sem cache** (o módulo original também não tinha). Timeout via `AbortController` (25s). Sem novas dependências.
- Fachada e `exports.js` **não precisaram mudança**: `API.lyrics(q)`, `API.lyrics.getLyrics(q)` e `modules.Lyrics(q)` expõem a nova implementação (mesma instância ESM via `callable()`).
- Validado: 20/20 testes (importação, letra com imagem HTTP 200, fallback de query reduzida, não-encontrada/vazia com erro controlado, branches do comando com/sem imagem, regressão Pinterest/TikTok/Instagram) + boot do bot OK.

## FASE 6 — YouTube migrado (sem VexAPI) ✅
- Arquivo: `dados/src/funcs/downloads/youtube.js` reescrito (mantém `export { search, mp3, mp4 }` + aliases `ytmp3`/`ytmp4`). **Zero dependências novas.**
- **Removido**: `import verificarAPI`, `https`, `fs` (config), `CONFIG_FILE`, chamadas a `/api/pesquisa/youtube`, `/api/downloads/youtubemp3`, `/api/downloads/youtubemp4`. **Nenhuma** referência VexAPI resta no YouTube.
- **search(query)**: usa **`yt-search` (dependência já existente)** — scraping da página pública de resultados. Retorno preservado: `{ ok, data: { videoId, url, title, description, thumbnail, seconds, timestamp, views, ago, author } }` | `{ ok:false, msg }`.
- **Stream URLs (mp3/mp4)**: POST público em `youtubei/v1/player` (chave Innertube que o próprio YouTube expõe nas suas páginas) com client **ANDROID** → o YouTube devolve URLs diretas **sem cifra "n"** (não quebra anti-bot). `playabilityStatus`: LOGIN_REQUIRED/UNPLAYABLE/erros → `{ ok:false, msg }` controlado (não faz login, não contorna proteção).
- **mp4(url, quality=360)**: prefere **muxado** (áudio+vídeo) `<= qualidade` (maior altura dentro do teto), senão menor muxado; sem muxado → funde melhor vídeo `<= qualidade` + melhor áudio com **FFmpeg do sistema** (`-c copy`) — FFmpeg é requisito instalado sempre pelo bot (`config.js`). Aceito 144–2160 (fallback 360).
- **mp3(url, bitrate=128)**: melhor stream de áudio (prefere audio/mp4) → transcode com **FFmpeg do sistema** para MP3 no bitrate (32–320, fallback 128). Temps em `os.tmpdir()` com `mkdtemp`, apagados sempre (testado: zero lixo).
- **Buffer preservado**: URL → download (stream, teto 256MB, timeout 180s) → Buffer → WhatsApp. Contrato idêntico: `{ ok, buffer, title, thumbnail, filename:'<título>.mp3|.mp4' }`.
- Timeout: `AbortController` 25s por chunk leitura/ocio + deadline total 180s; FFmpeg com timeout; erros controlados. Parâmetros de bitrate/qualidade sanitizados.
- Comandos `!play`, `!playvid`/`!ytmp4` (`index.js` ~19091/19598), autodownload (`index.js` ~1796/1841) validados por simulação (áudio `{audio:buffer,audio/mpeg}`, vídeo `{video:buffer,video/mp4}`, fallback documento).
- Validado no sandbox (ffmpeg estático só para testes): search ok (241s/16 anos/vistas/autor), mp3 3.41MB com header ID3, mp4 360p 11.8MB container `ftyp`, LOGIN_REQUIRED → erro controlado, 38/38, boot OK. **IP de datacenter do sandbox é fortemente flag (`LOGIN_REQUIRED` em alguns vídeos) — em VPS/residencial funciona; falha degradada com msg clara.**

## FASE 7 — Edits migrado (sem VexAPI) ✅ / Logos: resolvido na FASE 8 ✅
- Arquivo: `dados/src/funcs/edits/index.js` reescrito (mantém `export { geraredit }`).
- **Edits**: filtros de imagem **locais com `jimp` (dep existente)**: `blackwhite` greyscale, `desfoque` blur adaptativo, `jornal` greyscale+contraste+posterize, `cinema` letterbox. `wojakreaction` retorna **erro controlado** (exige arte/template que não existe no repo — honesto, não inventado). Cache/timeout/contrato `{ok, buffer}` preservados.
- **Logos** (decisão da época): 34 geradores de texto-estilizado exigem fontes/templates (VexAPI usava ephoto/textpro — CAPTCHA/Cloudflare, proibido). Scraping descartado; IA (pollinations) falha em renderizar o texto exato. Resolvido na **FASE 8** com renderização 100% local (jimp + fontes bitmap próprias). Comandos `!wojakreaction`/`!blackwhite`/`!jornal`/`!cinema`/`!desfoque` (index.js ~25347) validados com simulação (28/28 testes).

## FASE 8 — Logos migrado (sem VexAPI) ✅
- Arquivo: `dados/src/funcs/logos/index.js` reescrito (mantém `export { gerarLogo }` + aditivo `STYLES`).
- **Removido**: `import verificarAPI`, `https`, `fs`, `CONFIG_FILE`, `apikey_vex`, `site_vex`, chamada a `/api/logos/{type}`. **Nenhuma** referência VexAPI resta no Logos.
- **Implementação 100% local com `jimp` (dep existente)**: os 34 tipos (`amongus, royal, mascotemetal, firework, summerbeach, cloudsky, techstyle, watercolor, ligatures, graffitistyle, frozen, colorful, balloon, multicolor, metal, doubleexposure, mascoteneon, eraser, america, snow, sunset, halloween, blood, hallobat, cemiterio, ffavatar, vintage3d, hollywood, glitch, galaxy, glossy, dragonfire, pubgavatar, comics`) são presets em `STYLES` (gradiente de fundo + gradiente de texto + sombra/glow/outline/estrelas/glitch RGB).
- **Fontes bitmap próprias**: `logos/fonts/dejavu-bold-96.fnt` + `dejavu-bold-96_0.png` (~168KB), geradas uma vez offline (Pillow) a partir de **DejaVuSans-Bold** (licença permissiva — Bitstream Vera, redistribuível). Cobre ASCII 32-126 + Latin-1 160-255 (acentos PT-BR). Gerador **não** fica no repo.
- Renderização: canvas 1200×640, texto com wrap (maxWidth 1080), bbox alfa, downscale se exceder, `renderLogo()` → `getBuffer('image/png')`. Contrato preservado `{ ok, buffer }` + aditivo `mime:'image/png'`. Erro controlado: `{ ok:false, msg }` (query/type vazio, tipo desconhecido, texto não renderizável).
- Cache preservado (Map, TTL 60min, 1000). Type é normalizado (lowercase/trim) e validado contra `STYLES`.
- Bloco de comandos em `index.js` ~25280 (`amongus...comics` → `logos.gerarLogo({query,type:command})`) **funciona sem alteração**. Nota: segundo bloco (`pornhub, avengers, graffiti, captainamerica, stone3d, neon2, thor, deadpool, blackpink`) usa `Logos2` de `utils/logotipos2.js` (apisnodz — fora do escopo; site fora do ar hoje, não é VexAPI).
- Validado: 35/35 testes (import/facade, 34/34 tipos, PNG magic, query/type inválidos, cache hit, acentos/wrap, regressão de namespaces + edits real, zero refs VexAPI via grep, `node --check` OK).

## FASE 9 — Canvas migrado (sem VexAPI) ✅
- Arquivo: `dados/src/funcs/downloads/canvas.js` reescrito (mantém `export { gerarbrat, gerarbratvid, gerarwelcomecard }`, mesmas assinaturas).
- **Removido**: `verificarAPI`, `https`, `fs`(config), `CONFIG_FILE`, `apikey_vex`, `site_vex`, chamadas `/api/canvas/{brat,bratvideo,welcome2}`. **Zero** refs VexAPI (grep limpo).
- **Implementação 100% local**: `jimp` (dep existente) + fonte bitmap da FASE 8 (`../logos/fonts/dejavu-bold-96.fnt`) + **FFmpeg do sistema** (`process.env.FFMPEG_PATH || 'ffmpeg'`, spawn com timeout 60s SIGKILL, mesmo padrão do youtube.js) para codificar WebP.
- **gerarbrat(query,bg,text_color,blur)**: texto colorido (nomes de cor/hex/`%23` URL-encoded) com blur opcional sobre fundo sólido 512×512 → PNG → ffmpeg `libwebp` → **Buffer webp** (antes era URL). Cache preservado (Map, TTL 30min, 1000).
- **gerarbratvid(query,bg,text_color,bpm,blur)**: 16 frames com blur pulsando (ritmo por BPM) escritos em `mkdtemp` único → ffmpeg `libwebp_anim` 512×512 loop → **Buffer webp animado**. `tmpdir` limpo em `finally` (testado: zero lixo, sem conflito em concorrência, sem processo órfão).
- **gerarwelcomecard(avatar,nome,texto,fundo,corMoldura,corLinhas,glow)**: card 1200×600 — fundo por URL (cover+sombra) com fallback gradiente, avatar circular 300px (mask) + moldura (disc desenhado por scan), glow opcional (blur 20), linhas decorativas (`corLinhas`), nome+subtexto com crop por bbox alfa e escala para a zona. Downloads de avatar/fundo por `fetch`+`AbortController` 25s com fallback (avatar cinza / fundo padrão). Sem cache (original também não tinha).
- Contrato: `{ ok, criador:'Tokyo', type:'image|video', mime:'image/webp|image/png', query|nome, buffer }` — **`url` virou `buffer`** (`{ ok:false, msg }` nos erros). Consumidores ajustados com fallback: `datinha.buffer || { url: datinha.url }` (brat ~20219, bratvid ~20277) e `result.buffer || { url: result.url }` (welcome ~1296). Baileys aceita Buffer direto em `sticker`/`image`.
- Comandos cobertos: `!brat` (~20176), `!bratvid`/`!bratvideo` (~20228), welcome card automático do evento de grupo (`createGroupMessage`, `settings.photoType === 'api'`, ~1286). Nota: `'brat'` aparece também como `case 'brat'` no índice; aliases de bratvid preservados.
- Validado: 35/35 (facade, RIFF/WEBP magic, chunk `ANIM`, PNG magic, acentos/emoji/hex, cache hit, concorrência, tmpdir limpo, fallbacks de avatar/fundo, regressão de namespaces + edits/logos, `ps` sem ffmpeg órfão, `node --check` OK). Bugs corrigidos durante teste: rgba negativo em `(hex<<8)|0xff` (cores ≥0x800000) e `%23` prefix.

## FASE 10 — ImageTools migrado (sem VexAPI) ✅ / Auditoria global: VexAPI funcional ZERO
- Arquivo: `dados/src/funcs/utils/imagetools.js` reescrito (mantém `export default {removeBg, upscale}` + named).
- **Removido**: `verificarAPI`, `https`, `fs`(config), `CONFIG_FILE`, `apikey_vex`, `site_vex`, chamadas `/api/ferramentas/{removebg,upscale}` + console.logs de debug. Zero refs VexAPI.
- **removeBg(url)**: implementação local real — flood-fill (BFS) a partir das bordas com color-key: referência = média dos 4 cantos (blocos 8×8), tolerância dist² ≤ 3·32². PNG RGBA, cantos transparentes, sujeito preservado. Guardas: fundo≥98,5% → erro "ocupa a imagem inteira"; ≤0,5% → "não detectado fundo uniforme"; >16MP → rejeita; download `fetch`+AbortController 25s, teto 15MB. **Limitação honesta: não é remoção por IA — funciona em fundos uniformes/similares às bordas; fundos complexos ficam parciais.**
- **upscale(url, scale=2)**: jimp `resize({mode:'bicubicInterpolation'})` — interpolação, **não é AI-upscaling** (documentado no relatório da fase). Scale sanitizado: inteiro 2–4 (fora → erro controlado); dimensão final teto 4096px.
- Contrato: `download` (URL) virou **`buffer`** (`{ ok, status:true, criador:'Tokyo', type:'image', mime:'image/png', scale?, buffer }`); erros `{ok:false,msg}` (upscale agora retorna em vez de throw — comando já trata). Cache preservado (Map, 30min, 1000).
- `index.js` (3 call sites, fallback): removebg/sbg/sfundo usa `bgResult.buffer || fetch(bgResult.download)`; `{image: resultBuffer || {url}}`; upscale `{image: upscaleResult.buffer || {url}}` (corrigido bug pré-existente: comando lia `result.result?.download` inexistente). Import direto linha 589 **inalterado**.
- Validado: 43/43 (facade, PNG magic, canto transparente+centro preservado, fundo 100%/gradiente erro, upscale ×2/×3/×4 dims, scale inválido, URL vazia/inválida/corrompida, concorrência, URL real, cache, regressão namespaces, `node --check` OK).
- **Auditoria global VexAPI**: `grep` em todo `dados/` — **nenhum import de `funcs/API.js` resta** (verificarAPI órfã = CÓDIGO MORTO). Restam: `index.js` (linha 1727 msg + comando `!apikey` 22647 — CONFIGURAÇÃO), `.scripts/config.js` (default+prompt — CONFIGURAÇÃO), `config.json` (`site_vex`/`apikey_vex` — CONFIGURAÇÃO), comentários "sem VexAPI" nos módulos migrados (DOCUMENTAÇÃO). Nada funcional: **todos os módulos estão 100% sem VexAPI**. Remoção de `API.js`/chaves do config fica para tarefa de limpeza separada (não executada nesta fase).

## Formatos de exportação dos módulos (importante para a fachada)
- Named exports (`export { ... }`): tiktok, youtube, igdl, pinterest, canvas, kwai, edits, logos → fachada usa `import * as ns` + `pickNamed()` (filtra `default`/`__esModule`).
- Default objeto (`export default { ... }`): spotify, soundcloud, facebook, imagetools → fachada usa o default diretamente.
- Default função (`export default fn`): lyrics (`getLyrics`), apkmod (`apkMod`), mcplugins (`buscarPlugin`) → fachada cria `callable()` que expõe a função como namespace **e** anexa `.getLyrics`/`.apkMod`/`.buscarPlugin` como propriedade (preserva chamada direta antiga `Lyrics(q)`).

## Dependências da VexAPI — ELIMINADAS
- `funcs/API.js` foi **removido** na limpeza final; `config.json` não tem mais `site_vex`/`apikey_vex`.
- Módulos próprios: `downloads/{spotify,soundcloud,facebook,kwai,apkmod,mcplugins,pinterest,tiktok,igdl,lyrics,youtube,canvas}.js`, `edits/index.js`, `logos/index.js` (jimp + fontes bitmap), `utils/imagetools.js` (jimp local), `utils/search.js`.

## Comandos e fluxos relevantes
- Autodownload por URL: `handleAutoDownload(nazu, from, url, info)` em `index.js` (~linha 1789) detecta domínio e chama `youtube.mp3`, `tiktok.dl`, `igdl.dl`, `kwai.dl`, `facebook.downloadHD`, `pinterest.dl`, `spotify.download`, `soundcloud.download`.
- Imports diretos em `index.js` (não via exports.js): `spotifyModule` (linha 590), `removeBg/upscale` (589), `search/searchNews` (588).
- Comando `!apikey`/`!setkey` em `index.js` (~linha 22635) grava `config.apikey_vex`.
- `dados/src/.scripts/config.js` tem prompt que pede `apikey_vex`.

## Setup do ambiente
- `npm install --legacy-peer-deps` instala deps em `/workspace/project/Lizzy-V4/node_modules`.
- Teste de estrutura da API: criar `.mjs` que importa `api-downloads.js` e `getModules()` de `exports.js`, verifica namespaces/funções e a desestruturação esperada pelo `index.js`.
- Boot real: `node dados/src/connect.js` gera QR Code do WhatsApp (não executar em teste automatizado sem necessidade).

## Migração VexAPI — CONCLUÍDA (fases 2-10) + limpeza final feita ✅
- Todas as 9 migrações feitas: Pinterest, TikTok, Instagram, Lyrics, YouTube, Edits, Logos, Canvas, ImageTools.
- **Limpeza final executada**: removidos `funcs/API.js` (verificarAPI, órfã), chaves `site_vex`/`apikey_vex` de `config.json`, defaults+prompt em `.scripts/config.js`, `const site_vex` e o comando `!apikey`/`!setkey` em `index.js`. Zero referências funcionais restantes (só comentários de documentação). `smm setkey` (menu dono) é outro comando, inalterado. Validado: `node --check` OK, boot de módulos OK, smoke logos/imagetools OK.
