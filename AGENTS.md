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

## COMANDO "!raja" — gerador de teste (EXCLUSIVO DO DONO) ✅
Ferramenta do dono para validar a proteção anti-raja em grupo de teste.

- **Uso**: `!raja <quantidade> <texto>` — ex. `!raja 5 olá, esse é o meu texto`.
- **Restrições**: só o dono (`isOwner`) e só em grupo. Teto rígido de **50**
  mensagens por execução (é ferramenta de teste, não gerador de flood).
  Intervalo de 700 ms entre envios.
- **Formato gerado** (`buildRajaContent()`, `index.js` ~275): espelha a **amostra
  real** capturada pelo `!get`. Bate **11/11 campos**:
  `currencyCodeIso4217: "BRL"`, `amount1000: "0"`, `expiryTimestamp: "0"`,
  `amount: { value: "0", offset: 1000, currencyCode: "BRL" }`, texto em
  `noteMessage.extendedTextMessage.text` (NÃO em `conversation`) e
  `contextInfo` da nota com **apenas `mentionedJid`** — o proto preenche
  `groupMentions: []` e `statusAttributions: []` sozinho.
  **Armadilha conhecida**: NÃO adicionar `forwardingScore`/`isForwarded` na nota.
  A amostra real não tem esses campos (o `!get` mostra "Encaminhada: Não
  detectada"); adicioná-los faz o WhatsApp renderizar como card encaminhado em
  vez de mensagem vazia.
- **ID da mensagem**: `generateRajaMessageId()` → `'3EB0' + 9 bytes hex` = **22
  chars**, que é o formato da amostra real (`3EB0A9C9AFB76E7451EA1D`) e dos
  clientes nativos. Os helpers da Baileys **não servem**: `generateMessageID()`
  dá 40 chars (`3EB0` + 18 bytes hex) e `generateMessageIDV2()` insere um
  marcador `'STARFALL'` no meio.
- **Opções: NÃO EXISTEM MAIS (set/2026).** A forma é **única**:
  `!raja <quantidade> <texto>`. Foram removidas `vo`/`vov2`/`vov2ext`
  (encapsulamento ViewOnce), `secret` (messageContextInfo), `fwd`
  (forwardingScore/isForwarded), `clean` (mensagem "limpante"), `zero`,
  `mencoes=N` e `delay=N`. Um "| algo" digitado agora faz parte do **texto da
  nota** e não altera o proto. Motivo: eram variações de *gerador de flood* e
  não serviam à validação da proteção — a proteção já é testada contra fixtures
  manuais de ViewOnce, sem precisar que o comando saiba gerá-las.
  As opções antigas ficaram mal documentadas no `menudono` (`| clean`, `| zero`);
  as três linhas viraram uma só.
- **Log de diagnóstico** (`logRajaEnvio()`, `index.js` ~299): imprime uma linha
  por envio — `[RAJA] enviado | id=… | bytes=… | mencoes=… | amount1000=… | …`.
  Existe porque "o raja não funcionou" é ambíguo: pode ser falha de relay,
  payload que não é o que o WhatsApp precisa para não renderizar, ou efeito
  dependente do tamanho/população do grupo. Sem registrar o que foi realmente
  enviado não dá para separar os três casos.
- **O QUE NÃO É O DIFERENCIAL (descartado com prova)**: `messageSecret` foi
  testado e **descartado**. O `!get` rodado no raja REAL mostra
  `messageContextInfo: ausente` e `messageSecret: ausente` — o real não carrega
  esse campo. A hipótese veio do código da Baileys (`generateWAMessageContent`
  adiciona `messageSecret` via `shouldIncludeReportingToken()`), mas não se
  aplica aqui. `classifyMessage()` expõe `hasMessageSecret` como sinal de
  anomalia do envelope apenas; **não** use esse campo como assinatura de nada
  (ver "ANÁLISE DA MECÂNICA DO RAJA INVISÍVEL" abaixo — a versão antiga do texto
  dizia que ele era o marcador do raja, o que a amostra real desmentiu).
- **RECURSOS DO RAJA REAL vs GERADO (comparados nos RAWs)**: `currencyCodeIso4217`,
  `amount1000 "0"`, `expiryTimestamp "0"`, `amount {value "0", offset 1000,
  currencyCode BRL}`, texto na NOTA, `mentionedJid`, `groupMentions []`,
  `statusAttributions []`, ID de 22 chars — **todos idênticos**.
  Os campos `endCardTiles: []`/`groupMentions: []`/`statusAttributions: []`
  aparecem no real porque a captura passou por encode/decode do protobuf; o
  objeto local só os ganha ao ser enviado (confirmado com `Message.create` +
  `encode`/`decode`).
- **A ÚNICA DIFERENÇA MEDIDA É O TAMANHO**: o raja real trazia **348 menções**
  (~9 KB de payload) e um texto de ~700 chars; o gerado, num grupo de 4 membros,
  trazia **4 menções** (~332 bytes). É por isso que o efeito não aparecia no
  grupo de teste. **A opção `mencoes=N` que existia para inflar a lista foi
  removida** (set/2026): era ferramenta de flood, não de validação. Num grupo
  pequeno o `!raja` gera um payload pequeno — se o efeito depende do tamanho,
  reproduzir isso exigiria um grupo grande, não uma opção no comando.
- **`!get` ganhou a seção `MESSAGE CONTEXT INFO (envelope)`**: o campo vive no
  TOPO do `Message` (irmão do tipo), por isso não aparecia em nenhuma seção —
  passava batido no RAW. A seção mostra `messageSecret` (bytes/hex/sha256),
  `botMessageSecret`, `deviceListMetadata` e quaisquer outros campos do
  envelope, além de avisar quando o campo aparece junto com um payment sem valor.
  **Correção posterior (set/2026)**: a seção afirmava que `messageSecret` era "a
  assinatura do raja invisível" e que "o cliente real sempre envia". As duas
  coisas são falsas — o raja real medido **não** carrega o campo, e o reporting
  token acompanha quase todo tipo de mensagem. Ver a seção "ANÁLISE DA MECÂNICA
  DO RAJA INVISÍVEL" abaixo.
- **BUG CORRIGIDO no anti-pagamento**: a condição usava
  `type === 'viewOnceMessage*'` **sozinho**, então QUALQUER foto/vídeo de "ver
  uma vez" (normal e legítimo) era tratado como pagamento e **removia o autor
  do grupo** — era o "banindo do nada" relatado. Agora o viewOnce só conta como
  pagamento quando há payment **dentro** dele
  (`classification.isPayment && type === 'viewOnceMessage*'`).
- **`classifyMessage()` desembrulha wrappers**: usa `resolveTypeChain()` antes de
  procurar payment, então o `isPayment`/`amount`/`noteText` funcionam mesmo com
  o raja encapsulado em ViewOnce (antes ficava `isPayment: false` e a proteção
  não pegava).
- **Baileys mod** (`@itsliaaa/baileys@0.3.18-final`): `generateWAMessageContent`
  tem suporte nativo a payment (`utils/messages.js` ~1200, via
  `requestPaymentFrom`), mas ele coloca `contextInfo`/`mentions` no
  `requestPaymentMessage` e não na NOTA — o raja real tem as menções dentro de
  `noteMessage.extendedTextMessage.contextInfo`. Por isso o `!raja` usa
  `generateWAMessageFromContent` + `relayMessage`, que dá controle exato do proto.
- **Menções**: reaproveita o `AllgroupMembers` já resolvido pelo handler (mesmos
  JIDs/LIDs do raja real; numa amostra real eram 348 de um grupo de 354). Nenhuma
  consulta extra ao WhatsApp.
- **Envio**: `generateWAMessageFromContent` uma vez + `relayMessage` por mensagem
  com `messageId` novo (`generateMessageID()`), porque o WhatsApp descarta ID
  repetido — mesma técnica do `!divulgar`.
- **Menu**: categoria própria **🧪 TESTES DE PROTEÇÃO (DONO)** no `menudono`
  (sem duplicar categoria existente).
- **Testes em `tests/defensive-protection.test.js`**: permissão (não-dono
  bloqueado), só em grupo, validação de quantidade/texto, N mensagens no formato
  exato, IDs distintos, teto de 50, o que ele gera é detectado pela própria
  `classifyMessage` e presença no menudono.

## ANÁLISE DA MECÂNICA DO "RAJA" INVISÍVEL (set/2026) — correções de detecção ✅
Investigação pedida pelo dono: *como o "raja" fica invisível, olhando forks da
Baileys e clientes modificados.* Resultado honesto: **a mecânica não vem de
nenhum fork nem de um WhatsApp mod** — é um proto de `requestPaymentMessage`
bem-formado no campo errado. Nenhum fork da Baileys implementa "modo invisível";
os que mexem em payment (`@itsliaaa/baileys`, `Putrazaubdillah/Baileys`,
`rexxzyid/elaina-baileys`, `c4bal/baileys`) só montam o card com valor
**legítimo** (`amount1000: 1000`, `currencyCodeIso4217: 'IDR'`,
`expiryTimestamp: Date.now()`), via `hasNonNullishProperty(message,
'requestPaymentFrom')`. Não existe flag, opção nem wrapper que ligue o estado
invisível.

### Por que a mensagem some (o que É reproduzível)
O texto do "raja" vive em `noteMessage.extendedTextMessage.text`, **nunca** em
`conversation`. Os cards de pagamento daquele proto vêm com `amount1000` e
`amount.value` zerados. O WhatsApp renderiza card de pagamento a partir do
`amount`; com o valor zerado ele não tem o que desenhar e a mensagem fica **sem
conteúdo visível** para quem a recebe. Isso é um **estado do proto**, não um
recurso do cliente — daí ser igualmente reproduzível por Baileys.

Consequência prática: a invisibilidade **não é um interruptor que se liga**. O
que o `!raja` faz é montar o mesmo proto; se ele aparece, a diferença está no
**volume/tamanho**, não numa flag. A amostra real trazia **348 menções** (~9 KB)
de um grupo de 353 membros; o gerado, num grupo de 4, trazia 4 (~332 bytes).

### Correções aplicadas nesta rodada
Dois furos reais de detecção, achados comparando o código com a amostra real:

1. **`amount1000` ausente + `amount.value` zerado passava batido.** A detecção
   só olhava `amount1000`. Quando o campo não vem no proto e só o valor interno
   está zerado, o card também não renderiza — mas `isZero` era `false`.
   Agora `classifyMessage` cobre **os dois caminhos** e expõe qual deles provou o
   zero em `paymentAmount.zeroPath` (`'amount1000'` | `'amount.value'`).
   O fallback é **condicional** de propósito: se `amount1000` veio com valor, ele
   manda — um pagamento legítimo (`amount1000: '1500'`) **não** vira rajada.
2. **Payment encapsulado em ViewOnce escapava do segundo bloco.** Aquele bloco
   testava `info.message.requestPaymentMessage` (caminho cru); com wrapper, o
   payment não está no nível de cima. Trocado por `classification.isRequestPayment`
   + `classification.paymentAmount.isZero` (o `classifyMessage` já desembrulha).

### `messageSecret` NÃO era a assinatura (hipótese corrigida)
A rodada anterior tratou `messageSecret` como "o marcador principal" do raja
invisível. **A amostra real desmente**: o `!get` no raja real mostra
`messageContextInfo: ausente`. Além disso, `shouldIncludeReportingToken()` do
Baileys inclui o campo em quase **todo** tipo de mensagem (só exclui reaction,
encReaction, encEventResponse e pollUpdate), então presença **não identifica
nada** — marcá-la como assinatura classificaria texto e imagem normais como
ameaça. Agora `isInvisiblePayment = isPayment && isZero` (o estado malformado
real) e o `!get` diz explicitamente que o campo, sozinho, não é assinatura.

### O que foi pesquisado e não existe (para não repetir a busca)
- `messageSecret` como assinatura: **descartado** (ver acima).
- Forks da Baileys com "invisible mode": **não existem**; os forks de payment
  montam valor legítimo.
- WhatsApp GB / mods: nenhum ponto de extensão de proto documentado para isso.
- `grep` no RAW real por `requestFrom`: **ausente** no raja capturado.

### Pesquisa adicional (set/2026, 2ª rodada — "ainda não funciona")
Buscas por `requestPaymentMessage` + mensagem invisível/flood, e o guia oficial
de troubleshooting da Baileys, **não trouxeram nenhuma técnica nova**:

- **Não há relato público da receita.** O que existe são bots de flood genéricos
  (`usithadev/whatsapp-flood-bot`, scripts `_flood`/`!flood` por Selenium) que
  mandam **texto normal** N vezes — nada a ver com payment.
- **A Baileys não tem conceito de "invisível".** O guia de troubleshooting trata
  de mensagens que não aparecem por *outras* causas (`issue #1831` "This message
  can't be displayed here" = mensagem que o cliente Web não sabe renderizar;
  `issue #2468` = mensagem de evento de grupo mudou no v7; `issue #832` =
  mensagens aparecendo vazias). Ou seja: "não renderizar" é um **modo de falha
  conhecido e genérico** da renderização, não um recurso.
- Isso **reforça** o diagnóstico: o efeito vem de o proto não ter o que o
  WhatsApp precisa para desenhar o card. Não existe interruptor a ligar.

Consequência prática para quem for testar: como não há receita pública, o teste
tem de ser **empírico no seu ambiente**, e é para isso que serve o log
`[RAJA] enviado` — ele mostra bytes/menções/amount do que saiu, para separar
"falhou o relay" de "saiu mas o cliente renderizou" de "depende do grupo".

### Escopo deliberado
O entregável foi **detecção** (o bot não deixar passar) e **fidelidade do `!get`**
(que o relatório não minta). Não foi feito trabalho para deixar o payload mais
invisível ou mais eficaz: o `!raja` continua o gerador de teste **exclusivo do
dono**, limitado a grupo, com teto rígido de 50 e **forma única** (sem opções —
as variantes de flood foram removidas em set/2026).

### Estado
`classifyMessage()` agora expõe `paymentAmount.zeroPath` e
`paymentAmount.innerValue`; `isInvisiblePayment` passou a significar "payment
sem valor". Testes: 3 novos de regressão (amount1000 ausente + `amount.value`
zerado; ViewOnce com amount ausente; **pagamento legítimo NÃO removido** — roda
com `antirequest: false` para isolar o caminho da rajada). Suítes: **50/50**,
**54/54**, **22/22**.


## RAJA — sistema salvo por grupo (!setmsgraja / !raja / !rajar) + !msghost ✅
Reorganização pedida pelo dono (set/2026). Categoria do menu dono:
**"🧪 TESTES DE PROTEÇÃO (DONO)" → "🫥 MENSAGENS INVISÍVEIS"**.

### Os quatro comandos
| Comando | O que faz |
|---|---|
| `!setmsgraja <qtd> <texto>` | salva quantidade + texto **no grupo** (`groupData.msgraja`) |
| `!raja` | **mostra** o que está salvo (não envia nada) |
| `!rajar` | **dispara** a rajada com o que está salvo |
| `!msghost @alvo [texto]` | apaga a mensagem do comando e envia o texto **só ao alvo**, no privado |

- **Estado POR GRUPO** (`groupData.msgraja`), como o resto dos anti/comandos.
  Salvar no grupo A não vale no B.
- `!raja` e `!rajar` são do **dono** e só funcionam em grupo.
- Teto de **50** mensagens (herdado do raja antigo), avisando quando limita.
- `!rajar` mantém o conteúdo (`buildRajaContent` → `requestPaymentMessage` com
  `amount1000: "0"` e o texto na NOTA) e o transporte **seletivo** (rotação de
  Sender Key só para membros comuns). **Falha fechado** se a fork não expuser a
  rotação: nada é enviado, em vez de vazar para o grupo inteiro.
- `!msghost` substitui o antigo `!rajar4`. Sem texto explícito, usa o salvo.
- **Removidos**: `rajar2`, `rajar3`, `rajar4` (e as APIs experimentais que
  exercitavam), `raja <qtd> <texto>` na forma antiga.
- Menu (`menudono.js`) e `blockPv.js` atualizados para os quatro comandos.

### Testes — `tests/raja-selective.test.js` (23 asserções, 13 testes)
Salvamento por grupo, `!raja` que só mostra, `!rajar` usando o que foi salvo,
teto de 50, isolamento entre grupos, autorização só dos membros comuns (nenhum
admin), conteúdo intacto, messageId único por envio e falha fechada sem a API.

- **Armadilha 1**: o throttle de comandos é por **REMETENTE** (3 por 5s) mas é
  **pulado quando `info.key.fromMe`**. Os testes mandam vários comandos
  seguidos, então precisam rodar como o próprio bot (`fromMe: true`) — com
  remetente comum, do 4º comando em diante a resposta era "calma aí".
- **Armadilha 2**: `persistGroupData()` é **fire-and-forget**
  (`writeJsonFileAsync`). Ler o arquivo do grupo logo depois de `handleMessage`
  mede uma **corrida**: o `!setmsgraja` respondia "salvo" mas o `!raja` seguinte
  ainda lia "nada salvo". O teste espera a escrita.
- **Armadilha 3**: o harness rebaixava quem envia a "membro comum". Como o
  comando agora roda como o **bot**, isso colocava o próprio bot na lista de
  autorizados e media o conjunto errado.

## RAJA / requestPaymentMessage — causa do atraso MEDIDA e proteção ✅
Analisado contra o bot de referência (**Kimori / RAVENA-BOT**, `@whiskeysockets/baileys@7.0.0-rc13`).

### Estrutura do "raja" (amostra real, via `!get`)
```
requestPaymentMessage
  currencyCodeIso4217: "BRL"      amount1000: "0"      expiryTimestamp: "0"
  amount: { value: "0", offset: 1000, currencyCode: "BRL" }
  noteMessage
    extendedTextMessage
      text: "..."                 <- o texto NÃO está em conversation
      contextInfo
        mentionedJid: [ ~348 ]    <- centenas de menções, metade LID metade PN
        forwardingScore: 999, isForwarded: true
```
`!get` já lia esse caminho corretamente (o `noteMessage` estava certo), mas o
**resumo contava 25 em vez de 348**.

### Causa do atraso (COMPROVADA por medição, não hipótese)
1. **`await sleep(1500)` + `await sleep(1000)` no handler de pagamento** (`index.js`, bloco anti-pagamento) e **`await sleep(500)` ×2** no bloco anti-invisível. Medido com CPU profile: **~1000ms de idle** exatos, 52% das amostras.
2. **O `MessageQueue` (connect.js) só avança depois que o LOTE INTEIRO termina** (`await Promise.allSettled(batches)`), com 4 workers / 2 mensagens por lote. Cada raja prendia um slot por ~2,5s.
3. **A fila era um array sem teto** (`this.queue.push`), então o trabalho especial acumulava sem limite.

Medições (handler real + fila real, reproduzindo o formato da amostra):
| rajadas na fila | `!ping` ANTES | `!ping` DEPOIS |
|---|---|---|
| 0 | 118 ms | 115 ms |
| 4 | 1013 ms | 18 ms |
| 16 | 1022 ms | 68 ms |
| 64 | 4169 ms | 138 ms |
| 256 | **13485 ms** | **582 ms** |

Handler de UMA rajada: **1117 ms → ~109 ms**. CPU do parsing com 348 menções é
irrelevante (**0,7 ms** somando `hasTextSignature` + `classifyMessage` +
`safeJsonStringify`), então o problema nunca foi CPU nem serialização — era
**espera bloqueante acumulada na fila**. Zero chamadas `onWhatsApp` por menção
(a Lizzy não resolvia os 348 LIDs), ou seja, a hipótese das "348 resoluções de
LID" **não se confirmou**.

### Correções
- **`index.js`**: `schedulePaymentEnforcement()` e `scheduleInvisibleCleanup()` —
  o mesmo trabalho (fechar grupo → remover → reabrir) roda em segundo plano, com
  fila própria limitada a 4 concorrentes e **1 enforcement por grupo** (evita
  centenas de operações de grupo simultâneas). `drainEnforcementQueue()` +
  `paymentEnforcementLocks`.
- **`index.js`**: early return na rajada já tratada (não segue pelos ~40 blocos
  de filtros com centenas de menções).
- **`index.js`**: detecção por **dois caminhos independentes** — `amount1000`
  zero OU > 50 menções na nota (`classifyMessage`), em vez de depender da string
  `'0'` exata.
- **`connect.js`**: fila com **teto (500)**, contadores `totalDropped`/
  `maxQueueLength`, e **prioridade**: comando (`!ping`, `!menu`...) entra na
  frente das mensagens especiais. `isPriorityMessage()` é O(1) e **explicitamente
  NÃO considera a nota do payment** como comando.
- **`messageInspector.js`**: `classifyMessage()` (classificação barata, sem I/O,
  ~0,002 ms) e `buildMentionsReport()` agora conta TODAS as menções e limita
  apenas a EXIBIÇÃO (`MAX_MENTIONS_DISPLAYED`), com resumo LID×JID e alerta de
  volume. Resumo passou a informar 348 (era 25).

### Referência vs Lizzy
- **Kimori** também gera/consome payment cards (`PaymentCardDiv`), tem
  `extrairTexto` com o caminho `requestPaymentMessage.noteMessage...` (mas na
  **segunda** posição, depois de `sendPaymentMessage`), e reage com "ANTI-FLOOD
  ATIVADO" + remoção imediata — **sem `sleep` bloqueante** no caminho.
- A Lizzy havia adotado a técnica da RAVENA (fechar/remover/reabrir) **somando**
  os sleeps ao caminho crítico, que é onde divergiu.

### Testes: `tests/defensive-protection.test.js` (27 testes / 60 asserções)
Classificação (amount ausente/null/"0"/≠0, nota vs conversation, catálogo,
ViewOnce, custo), raja (handler rápido, enforcement em background, avisos, sem
undefined/null, sem 348 resoluções de LID), mensagens normais (`!ping`, `!menu`,
`!get`, `!testeinvi`, ViewOnce, catálogo, LID) e a fila (prioridade, teto,
`!ping` < 3 s atrás de 256 rajadas). Usa `DATABASE_PATH` temporário — não toca o
banco real.

## COMANDO "!rajar" — mensagem só para membros comuns ✅
Entrega a mensagem apenas aos membros comuns do grupo. NÃO é "manda e apaga", não
é view-once, não é edição, não é exclusão: a restrição está no **TRANSPORTE** —
o material da Sender Key não é distribuído aos admins, então eles não decifram.

- **Onde vive a regra**: na fork (`@itsliaaa/baileys`), commit `3b41788`
  (`feat: add members-only group message transport`). Novo módulo
  `lib/Utils/recipient-selector.js` (`selectGroupRecipients`,
  `resolveGroupRecipients`, `isGroupAdminParticipant`, `GROUP_RECIPIENT_MODES`)
  e novo parâmetro no `relayMessage`/`sendMessage`:
  `recipientMode: 'all' | 'admins-only' | 'members-only'` ou
  `recipientParticipants: [...]`. README da fork documenta em
  "Members-only group message".
- **Como funciona (por que restringir a lista basta)**: o `relayMessage` deriva
  os dispositivos dos **participantes do grupo** e, a partir daí, monta
  SenderKeyDistributionMessage, os nós `<to>`, o `<enc type="skmsg">` e o
  `phash`. `resolveGroupRecipients` substitui a lista ANTES da descoberta de
  dispositivos, então tudo a jusante (SKDM, ciphertext, `phash`) segue o
  subconjunto — não é um filtro aplicado depois que o material já saiu.
  Quando há restrição, os `<enc>` ganham `decrypt-fail="hide"` para o cliente do
  excluído esconder a entrada em vez de mostrar "aguardando mensagem".
- **Admin é pelo metadata, não por heurística**: `admin === 'admin'` (promovido)
  ou `'superadmin'` (criador). Nada de nome/número/posição.
- **Falha segura**: se a restrição não casar ninguém, a fork **lança** e nada é
  enviado — em vez de cair no grupo inteiro (que é exatamente o que não se quer).
- **Comando** (`index.js` ~32166, `case 'rajar'`): `!rajar <texto>` (sem texto,
  frase padrão). Só em grupo. Exige que quem executa seja **membro comum**
  (`isGroupAdmin && !isOwner` → recusa), porque um admin não deveria disparar a
  mensagem que ele mesmo não leria; o dono é a exceção, para validar. Log de uma
  linha (`[RAJAR] enviado | grupo | membros | admins | bytes`) sem nada sensível.
- **Menu**: linha `│ 👥 ${prefix}rajar [texto]` na categoria existente **🧪
  TESTES DE PROTEÇÃO (DONO)** do `menudono`, ao lado do `!raja`. `blockPv.js`
  ganhou `'raja'` e `'rajar'` na lista do `menudono`.
- **LIMITAÇÕES (importante, não vender como o que não é)**: a stanza continua
  endereçada AO GRUPO, então o admin **percebe que houve uma mensagem** (recebe
  a referência); o que ele não consegue é **ler o conteúdo**. O subconjunto é
  resolvido a cada envio a partir do metadata atual (promover alguém a admin
  depois não afeta mensagens já enviadas; membro novo não recebe as antigas).
  Não é barreira de confidencialidade contra o WhatsApp/servidor. Documentado
  também no README da fork.
- **Testes da fork**: `tests/members-only-send.test.js` (8 testes) — roda o
  caminho REAL do `relayMessage` (só o transporte é gravado), monta sessões
  Signal de verdade (chaves geradas, `injectE2ESession`), e **decifra** o que
  cada dispositivo recebeu com as próprias chaves privadas: membro incluído
  recebe a Sender Key e lê a mensagem; o excluído não tem nó `<to>` nenhum.
  Cobre também `admins-only`, lista explícita, mensagem normal (todos) e a
  recusa quando a restrição não casa ninguém. **Verificado: desligando a
  restrição, 6 dos 8 falham.**
- **Testes da Lizzy**: `tests/rajar.test.js` (16 testes / 19 asserções) — função
  pura (membros-only exclui `admin`/`superadmin`, sem heurística de nome,
  admins-only, `null` fora, não-casa-ninguém lança, modo inválido lança), o
  **handler real** (envia com `recipientMode: 'members-only'`, propaga a
  restrição, frase padrão, admin recusado, só em grupo) e menu/`blockPv`.
  **Armadilha**: o `sender` precisa EXISTIR no metadata do grupo (o handler
  decide a permissão comparando com os admins do metadata) — um LID inventado
  passaria como membro comum e o teste de admin mediria a coisa errada.
  **Verificado: removendo o `recipientMode`, 4 dos 16 falham.**

## COMANDOS EXPERIMENTAIS (rajar2 / rajar3 / rajar4) — NÃO DOCUMENTADOS AQUI
A documentação do mecanismo de visibilidade seletiva foi deliberadamente removida
deste arquivo (que é público) a pedido do dono, para não servir de receita a
terceiros. Os comandos continuam no `index.js` e os testes em `tests/rajar*.test.js`.
O detalhamento técnico completo está fora do repositório.

## COMANDOS "!pgpau" / "!pgpeito" / "!pgbunda" (pegar) ✅
- **Sem sistema paralelo**: os três entraram no bloco `case` que JÁ existe para os comandos de interação (`tapa`, `soco`, `beijo`, `siririca`...) em `index.js` (~37067). Herdam de graça: exigência de grupo, `modobrincadeira`, `isModoLite`, leitura do `games.json > games2`, resolução de mídia local/URL, `gifPlayback` e envio via `nazu.sendMessage`.
- **Frases**: constante `FRASES_PEGAR` no topo do `index.js` (module-level, ~linha 149) com **exatamente 2 frases por comando** (as fornecidas, sem alteração). O ramo `else if (FRASES_PEGAR[command])` sorteia uma e troca `@usuario` → `@<executor>` e `@alvo` → `@<alvo>`. Não mistura frases entre comandos.
- **Alvo obrigatório**: `if (FRASES_PEGAR[command] && !menc_os2) return reply('❌ Marque alguém para pegar!...')` — usa o `menc_os2` (menção/citação) que o handler já resolve. Sem `undefined`/`null`/placeholder na resposta.
- **Menções reais**: `mentionsToSend` — nos comandos de pegar envia `[sender, targetUser]` (a frase cita as duas pessoas); nos demais comandos continua `[targetUser]`, comportamento inalterado. O texto usa `@<numero>` para o WhatsApp renderizar a menção.
- **`!setgif`**: os três foram adicionados à `validCommands` existente (~18894), então `!setgif pgpau|pgpeito|pgbunda` grava em `games.json > games2` + `database/gifs/` exatamente como os outros comandos. Nenhum segundo sistema de GIF.
- **`!menubn`**: adicionados na categoria existente **INTERAÇÕES "PICANTES"** (`menus/menubn.js`, que só aparece fora do modo lite) e na lista `menuCommandsMap.menubn.commands` (`utils/blockPv.js`) — mesma categoria, sem duplicar.
- **Testes**: `tests/pg-commands.test.js` — 22 testes / 141 asserções com o handler real: alvo obrigatório, menção de executor e alvo (JID/LID reais), as 2 frases exatas de cada comando, aleatoriedade (80 execuções), GIF via `!setgif`, `!menubn`/categoria, `blockPv`, regressão dos comandos antigos, fora de grupo, e varredura de caracteres estranhos (chinês/cirílico/invisível/homoglifo). O teste usa `DATABASE_PATH` temporário: **não toca** o `dados/database` real. Rodar com `node tests/pg-commands.test.js`.


## COMANDO "!testcall" — notificações de chamada (ago/2026) ✅
Comando de teste, **fora de qualquer menu**, que liga/desliga por grupo o aviso de
chamadas. Só em grupo, exige admin.

- **Uso**: `!testcall` alterna o toggle `groupData.testcall` (persistido no JSON
  do grupo). Com ele ligado, todo evento de chamada daquele grupo é notificado.
- **O que notifica** (`dados/src/utils/callNotifier.js`): entrada de chamada
  (`offer`), chamando, chamada recebida pelo destino, conectando, latência,
  atendida, recusada, encerrada e **chamada perdida** (`timeout`). Os 9 status
  são classificados; qualquer status novo cai num rótulo genérico em vez de sumir.
- **Sem distinção de autor**: qualquer chamada no grupo é notificada igual, de
  quem for — inclusive do próprio bot. Não existe rótulo "saindo do bot" nem
  parâmetro `botJid`; `classifyCallEvent(call)` só olha o status. O nome exibido
  vem de `getName()`, com o número como fallback.
- **Regra de notificação**: `shouldNotifyCall(groupData)` (só com `testcall`
  ligado) + filtro de chat `@g.us`. Grupo desligado não recebe nada; PV é
  ignorado mesmo ligado, porque o toggle é por grupo.
- **Listener**: `attachCallListener()` em `connect.js` (~1884) — só injeta as
  dependências reais (socket, leitura do `groupData`, envio) em
  `callNotifier.attachCallNotifier()`, registrado ao lado do
  `attachMessagesListener()`. **A regra (só grupo + toggle) e o texto vivem no
  `callNotifier.js`**, que segue puro: é isso que permite testar o fluxo inteiro
  sem abrir socket (importar o `connect.js` abre conexão de verdade).
- **Nome do grupo**: `resolveCallGroupName()` (`callNotifier.js`) resolve na
  ordem `groupData.groupName` (persistido pelo `index.js`) → cache `groupMeta` →
  metadata do Baileys. Antes o listener lia `groupData.subject || groupData.name`
  — campos que **não existem** nos JSONs de grupo (que guardam state de
  features), então a linha `• Grupo:` nunca aparecia.
- **`DATABASE_PATH`**: `connect.js` passou a tirar `DATABASE_DIR`/`GRUPOS_DIR`/
  `GLOBAL_BLACKLIST_PATH` de `utils/paths.js` (e `AUTH_DIR` de dentro do
  `DATABASE_DIR`). Antes eram montados com `path.join(__dirname, '..')` fixo, o
  que **ignorava a variável** — sub-bots e testes liam/gravavam sempre o banco do
  bot principal. No mesmo caminho foram corrigidos dois caminhos relativos ao
  CWD (`./database/grupos/...`) e um **import dinâmico quebrado** no
  `messages.delete` (`normalizeGroupId`/`buildGroupFilePath`/`writeJsonFile` não
  existem em `paths.js`).
- **Bug de escrita concorrente (perda de dados)**: `writeJsonFile` e
  `writeJsonFileAsync` usavam **o mesmo** `${filePath}.tmp`. Duas escritas no
  mesmo JSON ao mesmo tempo (ex.: handler de mensagem + `persistGroupData`)
  pisavam uma na outra — a primeira renomeava o `.tmp` e a segunda falhava no
  rename com **ENOENT, perdendo a escrita**. Agora cada escrita usa
  `uniqueTempPath()` com pid+sequência (rename segue atômico: o temp fica no
  mesmo diretório). Teste de regressão valida revertendo o fix.
- **LIMITE TÉCNICO — isto é SINALIZAÇÃO, não chamada.** O Baileys não tem stack
  de mídia (nada de WebRTC/SRTP/codec), então **não existe "entrar na chamada",
  atender, nem tocar áudio**. Só dá para observar o evento e recusar
  (`rejectCall`). A fork adiciona `preacceptCall` (equivale a SIP 180 Ringing,
  **não** é aceite), mas o bot **não usa** — o `!testcall` só observa e informa.
  Qualquer plano de "bot entra na call e toca música" esbarra nisso.
- **Testes**: `tests/testcall.test.js` — 35 testes / 127 asserções. Cobre a
  classificação dos 9 status, o tratamento **igual para qualquer autor**
  (terceiro, bot e LID produzem o mesmo rótulo; o texto nunca diz "saindo" nem
  "bot"), texto sem `undefined`/`null`, entradas inválidas, e o comando (só
  grupo, só admin, alterna e persiste, não-admin não liga, e a **mensagem do
  comando** descreve o comportamento real sem prometer "saindo do bot").
  **Cobertura do listener (seção 3)**: o fluxo real via deps injetadas — filtro
  de chat **antes** de ler o toggle, toggle desligado/ausente, falha de
  `getGroupData`/nomes não derrubando, falha de envio capturada, e os 9 status
  entregues. **Seção 4**: `resolveCallGroupName` (persistido → cache → metadata,
  espaços, inválidos, falha de metadata). **Seção 5**: escritas concorrentes sem
  perda (regressão do `.tmp`).
  **Armadilhas do handler** (descobertas escrevendo estes testes):
  - **não importe `connect.js`** — importá-lo ABRE SOCKET de verdade (gera QR e
    conecta), o que trava a suíte. Por isso o handler recebe as dependências
    por injeção (`attachCallNotifier`) e é exercitado sem import do connect.
  - **throttle de 3 comandos/5s por sender** — usar o mesmo sender em toda a
    suíte faz o 4º responder "Calma aí!". O helper `run()` troca de sender a
    cada 3 usos.
  - **`getCachedGroupMetadata()` cacheia o metadata do grupo** — um participante
    admin inventado por chamada não sobrevive à 2ª chamada (o cache devolve o
    metadata anterior e a resposta é "Você precisa ser adm"). Por isso o grupo
    também é novo a cada teste.


## COMANDO "!get" — reescrito como ferramenta de diagnóstico ✅
- **Novo módulo**: `dados/src/utils/messageInspector.js` (não substitui nenhum sistema de leitura de mensagens; apenas transforma o objeto que o Baileys já entregou em relatório).
- **`index.js` → `case 'get'`** (bloco reescrito): antes só mostrava `Object.keys(quotedMessage)` e mandava o resto pro console. Agora gera o relatório completo e **envia tudo pelo WhatsApp** com prefixo de "ler mais" (`getMenuLerMaisText()`, mesmo sistema dos menus).
- **Alvo**: a mensagem **marcada/citada** — não a mensagem do comando. `extractQuoted()` percorre **qualquer** tipo do proto (não só `extendedTextMessage`), então citação em `imageMessage`, `audioMessage` etc. também é analisada. Sem citação → mantém a recusa original ("Marque uma mensagem").
- **Reaproveita o `messagesCache` existente** (mesmo store do anti-delete) para buscar a mensagem original completa pelo `stanzaId`; o `contextInfo.quotedMessage` às vezes vem sem `mediaKey`/timestamps. Origem declarada no topo: `cache` / `contextInfo` / `self`.
- **Seções do relatório**: IDENTIFICAÇÃO, IDENTIDADE (JID×LID separados), CHAT, CONTEÚDO, VIEW ONCE, PAYMENT, MENTIONS, CONTEXT, MEDIA, MENSAGENS ESPECIAIS, ENVELOPE RECEBIDO, ESTRUTURA DO ALVO, CAMPOS DO PROTO (safe), RAW MESSAGE.
- **Tipo real + cadeia de encapsulamento**: `resolveTypeChain()` detecta `viewOnceMessageV2 -> imageMessage`, `ephemeralMessage -> viewOnceMessageV2 -> videoMessage`, etc. `wrapperChain()` lista só os wrappers.
- **Serialização segura** (`safeJsonStringify`/`toSafeObject`): trata `BigInt` (`"123n"`), Long do protobuf (string exata, sem perder precisão > 2^53), `Buffer`/`Uint8Array` (resumo com bytes + previewHex + sha256), referências circulares, profundidade, `NaN`/`Infinity`, truncamento de strings/arrays/objetos. **Redige** campos com nome de credencial (`apiKey`, `token`, `sessionKey`, `privateKey`, `password`...) em **dois** caminhos: na serialização e em `collectFields` (senão vazavam pela seção CONTEÚDO).
- **PAYMENT**: detecta os 10 tipos de pagamento do proto (`requestPaymentMessage`, `sendPaymentMessage`, `paymentInviteMessage`, ...) + `paymentInfo`/`quotedPaymentInfo` do envelope. `classifyAmount()` diferencia **ausente / null / "0" / ≠ "0"** (Long, BigInt, number e string) — `amount1000 = 0` é reportado como `presente com valor "0"`, nunca como ausente.
- **VIEW ONCE**: versão V1/V2/V2Extension, mensagem interna, thumbnail, mediaKey e MIME de dentro do envelope.
- **JID × LID**: nunca assumidos iguais. Mostra JID, LID, `participantAlt`, `addressingMode`, `recipient`, `senderPn`/`senderLid` (marcados como `<campo inexistente nesta versão do Baileys>` quando ausentes, em vez de ocultados); enriquecido com `getLidFromJidCached` e `nazu.signalRepository.lidMapping.getPNForLID`. LID de chat marcado como "não aplicável" em grupo/newsletter/broadcast.
- **Tipos desconhecidos continuam inspecionados** genericamente (sem "tipo desconhecido"): campos escalares, Long/Buffer e a árvore crua aparecem normalmente.
- **Relatório visível no WhatsApp, não colapsado (ago/2026)**: o `!get` **não usa o prefixo invisível do "ler mais"** (`getMenuLerMaisText()`) — esse prefixo colapsava a mensagem na prévia e escondia justamente os dados que o comando existe para mostrar. A mensagem começa direto em `🔎 *GET MESSAGE*`; o resumo vem primeiro e o detalhamento completo logo abaixo, na mesma mensagem (sem título repetido: a seção interna abre como `*Detalhes completos*`).
- **Entrega íntegra, dividida quando necessário**: `splitTextForWhatsApp()` (no inspector) divide em várias mensagens com `_ (i/n) _`, cortando **sempre em quebra de linha** e medindo **bytes** — nunca parte um caractere multibyte nem trunca campo. Só a primeira parte cita a mensagem marcada e menciona o autor. O fallback de erro também vai pelo WhatsApp (dividido).
- **Log**: uma linha sempre (`[GET] executado | partes=N | bytes=N | alvo=cache|contextInfo|self`); o relatório completo só é impresso no terminal quando `config.debug` está ligado.
- **Sem truncamento artificial**: `MAX_DEPTH` 14, `MAX_ARRAY_ITEMS` 200, `MAX_OBJECT_KEYS` 300, `MAX_STRING_LEN` 4000; `CAMPOS DO PROTO`/`RAW MESSAGE` vão completos (o antigo `truncateJson` de 14k/22k foi removido). Verificado: relatório de 475 KB → 10 mensagens, todas ≤ 65 536 bytes, `campoExtra0`..`campoExtra399` presentes, **zero** logs do `!get` no terminal.
- **Bugs pré-existentes corrigidos no caminho da mensagem** (derrubavam o handler inteiro, não só o `!get`):
  - `index.js`: `JSON.stringify(info.message)` do `isStatusMention` → `hasTextSignature()` (não lança em circular/BigInt);
  - `index.js`: `JSON.parse(JSON.stringify(info))` do `fakeMessage` (PRO) → `cloneMessageSafely()` (`structuredClone` + fallback `toSafeObject`);
  - `connect.js` `logPaymentMessage`: `JSON.stringify(msg)` lançava porque `amount1000`/`expiryTimestamp` são Long → `safeJsonStringify` (e o dump final reaproveita a string).
- **Permissão preservada** (admin/moderador/dono) e demais comandos intactos.
- **Testes**: `tests/get-message-inspector.test.js` — 53 testes / 238 asserções, rodando o **handler real** (`NazuninhaBotExec`) com socket Baileys fake: texto, imagem, vídeo, áudio, documento, sticker (+pack/author), ViewOnce V1/V2/V2Extension, ephemeral→viewOnce→video, citação, menções (+groupMentions/nonJidMentions), grupo, payment, send payment, request payment, amount `"0"` (Long e string), stubType 172, `paymentInfo`, encaminhadas, reação, enquete, voto, contato, localização, live location, botões, lista, interactive, template, protocolMessage (edição/revogação), tipo desconhecido, estrutura hostil (BigInt/circular/NaN/deep), redação de secrets, cache interno, identidade JID×LID, concorrência, throttle e round-trip real de `proto.Message.encode/decode`. Rodar com `node tests/get-message-inspector.test.js`. Inclui testes de divisão: `splitTextForWhatsApp` não perde nem corrompe conteúdo (linhas multibyte, emojis, linha única maior que o limite) e o relatório grande chega dividido sem truncamento.


## CORREÇÃO bratvid (ago/2026) — typewriter em vez de pisca-pisca ✅
- `dados/src/funcs/downloads/canvas.js` → apenas `gerarbratvid` (assinatura/contrato/cache inalterados; `gerarbrat`/`gerarwelcomecard` intactos). `renderTextLayer` ganhou `opts` opcional (`alignX/alignY/y`, defaults idênticos).
- **Antes**: 16 frames com blur oscilando (cosseno) = efeito pisca-pisca. **Agora**: frames revelam o texto **palavra por palavra** (typewriter, teto ~20 passos agrupando palavras), segura a frase completa (~1s) e reinicia em loop (`-loop 0`). Ritmo: 1 palavra por batida → `fps = max(1, round(bpm/60))`.
- Layout estável: alinhamento LEFT/TOP com origem fixa (medida do bloco completo) → palavras já exibidas não se movem.
- **Fit-to-canvas** (bug encontrado nos testes): fonte bitmap 96px não reduz — texto longo era clipado (altura) e palavras com largura de avanço > 460px eram truncadas ("generativa"→"generativ"). Solução: mede palavra mais larga com `measureText` (jimp usa largura de avanço na quebra, NÃO bbox de tinta), renderiza em largura maior sem maxHeight e reduz com `layer.scale()`; `scale = min(1, 460/box.h, 460/box.w, 460/textWidth)`.
- Encoder `libwebp_anim` funde frames idênticos estendendo a duração (n_frames decodificado < frames escritos é normal; duração total preservada). Static ffmpeg (johnvansickle) NÃO tem decoder webp — testes decodificam com Pillow.
- Validado: 43/43 (typewriter crescente sem nunca diminuir, duração/loop preservados, textos longos formam a frase inteira, acentos, cache, welcome/brat estático/facade/regressão, strip visual).

## CORREÇÃO YouTube (2026-08, definitiva v3) — EJS + JS runtime no yt-dlp ✅
- **Causa raiz do "Sign in to confirm you're not a bot"** no `client=mweb` (e web) era a ausência de **runtime JS + solver de desafios (EJS)** no extractor do YouTube moderno: sem eles, o yt-dlp devolve formatos vazios/sem assinaturas em IPs flagged. Correção em `youtube.js`: **removido `--user-agent` global** (UA Android forçado causava web/mweb serem vistos como bot), **adicionado `--js-runtimes node:<process.execPath>`** (zero dependência nova — Node já é o runtime do bot) **+ `--remote-components ejs:github`** (solver EJS oficial, cache local). Nova ordem de clientes`: `web_safari → mweb → web → android_vr → android` (baseada no PO Token Guide oficial, yt-dlp 2026.08): sem PO token, `web_safari` fornece HLS (m3u8) sem exigir GVS e é o menos bloqueado em IPs de datacenter; `mweb` é o client recomendado pelo próprio yt-dlp quando os defaults falham; `web` usa EJS (n-challenge); `android_vr` não exige PO (mas não baixa "made for kids"); `android` exige GVS/player PO agora e fica como último fallback (com PO opcional**. `ios`/`tv`/`tv_embedded` removidos: exigem cookies de conta ou PO GVS e falham com page reload). Backoff maior em bloqueio(8s); `Sign in to confirm you're not a bot` agora é mapeado como bloqueio controlado. Validado no sandbox com yt-dlp 2026.08.19 + ffmpeg 7.0.2: `!play` mp3 (rick astley → 3.25 MB) e mp4 (→ 11.28 MB) baixaram com `web_safari` no primeiro client;.
- Env vars novas: `YTDLP_JS_RUNTIME`, `YTDLP_REMOTE_COMPONENTS` (padrão ejs:github), `YTDLP_PO_TOKEN` (opcional, só se admin usar provider real — nunca fixo), documentadas no `.env.example`. Cookies continuam via `YTDLP_COOKIES_FILE`; `.gitignore` ganhou `cookies.txt`/`*.cookies.txt`/`youtube-cookies.txt`. Validado: 4/4 clientes gerando MP3 válido (pipeline completo via `youtube.mp3()` em Node: busca, URL direta, youtu.be,, mp4,, inválida→erro controlado,, timeout→limpeza,, downloads simultâneos,, zero lixo em /tmp/yt-*).. Em IP datacenter do sandbox, 403 no CDN pode ocorrer (tratado como bloqueio temporário com backoff — em VPS/residencial o fluxo é estável.,

## CORREÇÃO YouTube (ago/2026, definitiva) — download via yt-dlp local ✅
- `dados/src/funcs/downloads/youtube.js`: **todo o downloader Innertube foi removido** (`INNERTUBE_KEY`, `PLAYER_CLIENTS`, `requestPlayer`, `getPlayer`, `resolveVideo`, `youtubei/v1/player`, `adaptiveFormats`, `downloadToBuffer`, fallback Android/iOS/VR). Downloads agora são feitos pelo **executável yt-dlp no próprio servidor** via `spawn()` com argumentos separados (sem concatenação de string, sem API externa).
- **Resolução do yt-dlp** (`checkYtDlp`, sucesso cacheado, falha re-testada): `YTDLP_PATH` → `yt-dlp` no PATH → `python3 -m yt_dlp` → `python -m yt_dlp`. Ausente → `{ok:false,msg:'yt-dlp não está instalado no servidor...'}` (não derruba o bot). **Instalação (sem root/sudo)**: `python3 -m pip install -U yt-dlp` (cai em `~/.local/bin`) ou binário oficial do GitHub. `FFmpeg` checado via `FFMPEG_PATH || 'ffmpeg'` (`checkFfmpeg`); ausente → erro controlado. `FFMPEG_PATH` customizado é repassado ao yt-dlp via `--ffmpeg-location`.
- **Fluxo**: search continua `yt-search` (inalterado). mp3: `yt-dlp --no-playlist -f bestaudio/best -x --audio-format mp3 --audio-quality {br}K --max-filesize 256M -o <tmp>/audio.%(ext)s --print-json <url>` — yt-dlp baixa e chama o FFmpeg; `--print-json` devolve título/thumbnail (fallback: `i.ytimg.com/vi/{id}/hqdefault.jpg`). mp4: `-f bv*[height<=Q]+ba/b[height<=Q]/b --merge-output-format mp4 --remux-video mp4`. Buffer lido do arquivo após `stat` (teto `MAX_BYTES=256MB`, rejeita vazio). Tempdir `mkdtemp` (`yt-*`) sempre removido em `finally` (sucesso/erro/timeout). Timeout real: `YTDLP_TIMEOUT_MS` (padrão 180s) com `SIGKILL` no **grupo de processos** (`detached:true` + `kill(-pid)`) — sem órfãos de ffmpeg. Erros do stderr mapeados (`Vídeo indisponível`, `restrição de idade`, `bloqueou temporariamente`, etc.); stderr bruto vai para `console.error`, nunca stack trace ao usuário. `safeFilename` reforçado (sem `/ \ ..` controles, preserva acentos, teto 80 chars).
- **Contrato preservado**: `export { search, mp3, mp4 }` + `ytmp3`/`ytmp4`; retornos idênticos (`search → {ok,data:{videoId,...}}`, `mp3/mp4 → {ok,buffer,title,thumbnail,filename}`). Fachada/`exports.js` **sem mudança**.
- **index.js (!play/!ytmp3, ~19201)**: bug `videoInfo.data.id` → **`videoInfo.data.videoId`** corrigido; ambos os fluxos (link e busca) agora logam `dlRes.msg` no console, mostram a msg real ao usuário e validam `Buffer.isBuffer && length>0` antes de enviar (`{audio:buffer,mimetype:'audio/mpeg'}` inalterado). Regra `seconds > 1800` preservada. Envio WhatsApp inalterado.
- **Sem dependência Node nova** (package.json inalterado). Requisitos de sistema: yt-dlp + ffmpeg.
- Testado no sandbox: search real ok; pipeline completo (spawn→arquivo→stat→Buffer→limpeza) validado com mock de yt-dlp (mp3 ID3, mp4 ftyp, 10 cenários: URL inválida, erros mapeados, >256MB, sem arquivo, timeout 2s sem órfão, yt-dlp/ffmpeg ausentes, fallback python3, bitrate/qualidade inválidos); regressão de namespaces + logos ok. **IP de datacenter do sandbox é hard-flag pelo YouTube** (todos os clients → "not a bot"/403 no CDN googlevideo — ambiental; em VPS/residencial o yt-dlp baixa normalmente). Pré-existente não corrigido (fora de escopo): `playvid` caption usa `data.author.name` mas `author` é string.
- **Diagnóstico de bloqueio por IP** (2026-09**: `youtube.js` agora detecta o IP público do servidor (`getPublicIp()`, via `api.ipify.org`, cache de sucesso, falha re-testa) e: (a) loga `ip <ip>` na config de diagnóstico; (b) quando o download falha com bloqueio (403/429/not-a-bot), as mensagens `mp3`/`mp4` incluem `🌐 IP do servidor: <ip>` + dicas: cookies (`YTDLP_COOKIES_FILE`) ou PO Token (`YTDLP_PO_TOKEN`) — ajudando o admin a ver se o bloqueio é ambiental (IP de datacenter/VPS).

## Formatos de exportação dos módulos (importante para a fachada)
- Named exports (`export { ... }`): tiktok, youtube, igdl, pinterest, canvas, kwai, edits, logos → fachada usa `import * as ns` + `pickNamed()` (filtra `default`/`__esModule`).
- Default objeto (`export default { ... }`): spotify, soundcloud, facebook, imagetools → fachada usa o default diretamente.
- Default função (`export default fn`): lyrics (`getLyrics`), apkmod (`apkMod`), mcplugins (`buscarPlugin`) → fachada cria `callable()` que expõe a função como namespace **e** anexa `.getLyrics`/`.apkMod`/`.buscarPlugin` como propriedade (preserva chamada direta antiga `Lyrics(q)`).

## Baileys: a fork é a dependência do bot
- `package.json`: `"@itsliaaa/baileys": "github:Souzzaaxzy/baileys"` — a fork
  **é** a lib do bot, fixada no commit `453ccf7` pelo `package-lock.json`.
- A fork traz a API de sinalização de call: `CallStatus` (9 estados),
  `isMissedCall`, `isCallEnded`, `CALL_OFFER_EVICTED_STATUSES` e
  `preacceptCall` (SIP 180 Ringing; **não** é aceite, a lib não carrega mídia).
  Também corrige um `TypeError` do `getCallStatusFromNode` em node sem `attrs`.
- **`callNotifier.js` mantém fallback local de `CallStatus`/`isMissedCall`**
  (`Baileys.CallStatus || {...}`) de propósito: importar com nome direto
  (`import { CallStatus }`) é erro fatal de resolução ESM e derrubaria o boot
  inteiro numa versão anterior à fork. Com a fork instalada o fallback não é usado.
- **`yarn.lock` estava apontando para o pacote npm** (`@itsliaaa/baileys@0.3.18-final`
  do registry), então um `yarn install` traria a versão **antiga**, sem
  `CallStatus`/`preacceptCall` — incoerente com o `package.json`. A entrada agora
  aponta para a fork (mesmo commit do `package-lock.json`).

## Dependências da VexAPI — ELIMINADAS
- `funcs/API.js` foi **removido** na limpeza final; `config.json` não tem mais `site_vex`/`apikey_vex`.
- Módulos próprios: `downloads/{spotify,soundcloud,facebook,kwai,apkmod,mcplugins,pinterest,tiktok,igdl,lyrics,youtube,canvas}.js`, `edits/index.js`, `logos/index.js` (jimp + fontes bitmap), `utils/imagetools.js` (jimp local), `utils/search.js`.

## COMANDO `!statusgrupo` — Group Status NATIVO no próprio grupo ✅
- **O que faz**: publica um **Group Status nativo** (recurso "status do grupo" do
  WhatsApp) dentro do grupo atual. **NÃO** vai para `status@broadcast`, **NÃO**
  vira status pessoal da conta, **NÃO** é mensagem comum.
- **A FORK JÁ SUPORTAVA — nada de implementação paralela.** Antes de escrever
  qualquer coisa foi auditada: a fork tem suporte nativo e **documentado**
  (`README.md`, seção "Group Status"): basta passar **`groupStatus: true`** no
  `sendMessage`. Internamente (`lib/Utils/messages.js` ~1311):
  1. marca `contextInfo.isGroupStatus = true`;
  2. encapsula a mensagem em **`groupStatusMessageV2`**;
  e em `lib/Socket/messages-send.js` (~511) adiciona o atributo
  **`is_group_status='true'`** na stanza — que é o que o WhatsApp usa para
  reconhecer como status de grupo. O `messageSecret` é gerado automaticamente
  (`randomBytes(32)` via `shouldIncludeReportingToken`).
  **Nem a fork nem o `WAProto` precisaram ser alterados.** Nenhum commit na fork.
- **Comando**: `!statusgrupo` (alias `!grupostatus`). **NÃO** usei `!statusgp`
  como alias: esse nome **já existia** e é OUTRO comando (relatório de status do
  grupo, em `menumemb`). Como o `switch` pega o primeiro match, o alias seria
  enganoso — o `!statusgp` continua sendo o relatório.
- **PERMISSÃO: só administração.** Usa o `isGroupAdmin` que já existe (agrega
  admin do grupo, dono, subdono e moderadores autorizados) — nenhum sistema de
  permissão paralelo. A checagem vem **antes de qualquer I/O**, então um membro
  comum não dispara download de mídia. Mensagem: *"Apenas administradores podem
  publicar status no grupo."*
- **MENU**: aparece no **`menuadm`** (seção "GESTÃO DO GRUPO"), e **não** no
  `menumemb` — coerente com a restrição.
- **Conteúdo aceito**: texto (`!statusgrupo Bom dia!`), mídia respondida
  (imagem/vídeo/áudio) com ou sem legenda (`!statusgrupo Minha legenda`). A
  legenda é o texto cru depois do comando — não é interpretada como outro
  comando, e acentos/emojis passam intactos.
- **Reaproveitamento**: `resolveMedia()` (`utils/viewOnce.js`) para achar a mídia
  respondida — inclusive view once/efêmera — e `getFileBuffer()` para baixar
  **uma vez** (mesmo `downloadContentFromMessage`/`mediaKey` dos outros
  comandos). Sem sistema paralelo de mídia, parser, permissão ou conexão.
- **Áudio**: o protocolo aceita (validado: vira `audioMessage` dentro do
  `groupStatusMessageV2`) — implementado.
- **Erros**: fora de grupo, sem conteúdo, mídia não baixável, mídia sem
  `mediaKey`, falha no relay, tipo não suportado (documento). Nunca expõe stack
  trace; o detalhe vai para o console.
- **`describeMediaError`** ganhou os casos `ECONNREFUSED`/`fetch failed` (falha de
  conexão) e `empty media key` (dados incompletos da mídia) — sem isso o usuário
  recebia um genérico "não foi possível baixar" sem causa.
- **Testes**: `tests/statusgrupo.test.js` — **32 testes / 90 asserções** (o total
  subiu com a seção 9 de repostagem; ver "REPOSTAGEM do Group Status" abaixo). O
  teste **não se contenta** em ver "enviou algo": pega o conteúdo que o comando
  montou e passa pelo caminho REAL da fork (`generateWAMessageContent`),
  conferindo que vira `groupStatusMessageV2`, com `isGroupStatus: true`,
  `messageSecret` presente e destino `@g.us` (e nunca `status@broadcast`). Mídia
  de teste é **cifrada de verdade** (hkdf + AES-256-CBC) e servida por HTTP
  local. Cobre texto/imagem/vídeo/áudio/legenda/view once, erros, regressão
  (mensagem normal não ganha `groupStatus`), **permissão** (membro comum barrado
  antes de baixar mídia; admin e alias), **menu** (presente no `menuadm`, ausente
  no `menumemb`) e **repostagem** (a permissão chega no payload). Verificado
  removendo o `groupStatus: true`: **21 asserções falham**; removendo a checagem
  de admin: **7 falham**; revertendo o `canBeReshared`: **6 falham**.
- **Armadilha dos testes**: o metadata do grupo é **cacheado por grupo** (TTL
  10s), então o admin precisa estar no metadata E o sender precisa ser coerente
  entre chamadas do mesmo grupo. Para o teste de status consecutivos usa-se o
  mesmo admin; para os demais, um grupo novo a cada execução.
- **Validação real com o WhatsApp (NÃO feita)**: exige conta pareada e grupo de
  teste; o ambiente aqui não tem sessão. Fica pendente para o dono confirmar no
  cliente oficial. O que está provado por teste é o payload/stanza corretos.

## REPOSTAGEM do Group Status (`canBeReshared`) — fork + Lizzy ✅
- **Pergunta do dono**: "nativo direto do status do grupo a opção de repostar,
  sem postar em nenhum outro contato, tem como?" → **sim**, via flag de payload.
- **Descoberta que mudou o diagnóstico**: o botão de repostar/compartilhar
  **não** depende das configurações de privacidade da conta ("Allow Sharing"). O
  cliente lê a permissão do **próprio payload**
  (`contextInfo.featureEligibilities.canBeReshared`). Status postado por
  biblioteca não mostrava o botão porque esse campo simplesmente não ia na
  mensagem. Referência: `WhiskeySockets/Baileys#2633` (issue [DOCS] Broadcast &
  Stories — exemplos de audio/video/caption/reshare).
- **Fork (lado da biblioteca) — commit `09d78f4`** (`lib/Utils/messages.js`, ~21
  linhas): novo flag booleano opcional `canBeReshared`, no **mesmo padrão do
  `groupStatus`** já existente. Quando ligado, mescla
  `contextInfo.featureEligibilities.canBeReshared = true` (preservando
  `contextInfo`/`featureEligibilities` já existentes) e apaga a flag da entrada
  (`delete message.canBeReshared`), para não vazar campo desconhecido no proto.
  README da fork ganhou a seção "Reshare (`canBeReshared`)" + entrada no índice.
- **Fork — armadilha que já derrubou um diagnóstico errado**:
  `generateWAMessageContent` **MUTA o objeto de entrada** (`delete
  message.groupStatus` / `delete message.canBeReshared`). Reusar o mesmo objeto
  entre chamadas faz o teste mentir (parecia que o `groupStatusMessageV2` havia
  sumido). Cada caso de teste usa **objeto fresco**.
- **Fork — testes**: `tests/reshare.test.js` (16 testes / 4 suítes): marca a
  permissão, não mexe sem a flag, consome a flag da entrada, respeita `false`,
  preserva `contextInfo`/`featureEligibilities` existentes, convive com
  `groupStatus`/`spoiler`/`viewOnce`/`quoted`, vale para texto/imagem/vídeo/áudio
  e a regressão de mensagem normal. Rodar com `node --test
  tests/reshare.test.js`. Verificado desligando o suporte: **12 falham**.
- **Lizzy (lado do bot)**: `dados/src/index.js` (~28033) — o `!statusgrupo`
  passou a montar `{ groupStatus: true, canBeReshared: true }`. Nada mais mudou:
  mesmo caminho de mídia, mesma permissão de admin, mesmo menu. O botão é do
  WhatsApp; o bot só **declara a permissão**.
- **Dependência fixada**: `package-lock.json` + `yarn.lock` apontam para o commit
  `09d78f495d2bc90d59258a53c29d7ee12faa1ee3` da fork (antes `453ccf7`). **Só trocar
  o lock NÃO bastava** — o install era pulado por comparar versão e não commit;
  ver "BUG DO INSTALADOR" abaixo.
- **Testes da Lizzy**: `tests/statusgrupo.test.js` — **32 testes / 95 asserções**.
  O helper `payloadDoContent` passou a capturar o contextInfo de status; a seção
  9 cobre a permissão e o contexto completo (ver "REPOSTAGEM do Group Status —
  `contextInfo` completo" abaixo). Verificado revertendo o payload: **13
  asserções falham**.
- **Limitação conhecida (lado WhatsApp, não da lib/fork)**: status de **áudio**
  (`ptt`) não oferece repostar independentemente da flag. Documentado no README
  da fork.
- **Validação real com o WhatsApp (NÃO feita)**: o ambiente não tem sessão
  pareada. Só o payload/stanza estão provados por teste; o dono precisa confirmar
  o botão no cliente oficial.

## COMANDO `!enqueteimg` — enquete com IMAGENS nas opções (experimental) ⚠️
- **O que faz**: publica uma enquete nativa do WhatsApp cujas **opções são
  imagens**. Comando `!enqueteimg` (alias `!pollimg`), só em grupo, só admin —
  mesma permissão do `!enquete`.
- **Formato**: `!enqueteimg PERGUNTA|1|2|3`. Os números são a posição da imagem
  na **sequência de anexos**; a ordem digitada é a ordem das opções (`|3|1|2`
  não é reordenado).
- **Proto real (descoberto, não suposto)**: o campo é
  `Message.pollCreationOptionImageMessage` — **campo 90, tag 722**, tipo
  `FutureProofMessage` (que só carrega `message`). O formato no fio é:
  - **pai**: `pollCreationMessageV3` com `pollContentType: IMAGE` (enum
    `Message.PollContentType.IMAGE = 2`) e, por opção, `optionName` +
    `optionHash`;
  - **filhos**: cada imagem vai **dentro do envelope
    `pollCreationOptionImageMessage`** (`{ pollCreationOptionImageMessage: {
    message: <imageMessage> } }`) e associada ao pai via
    `messageContextInfo.messageAssociation = { parentMessageKey,
    associationType: MEDIA_POLL (7) }`.
- **BUG CORRIGIDO (sintoma real: "enviou as 3 fotos em sequência, não criou a
  enquete")**: a primeira versão mandava os filhos como `imageMessage` **cru**,
  só com a associação. **Não basta.** O cliente só trata um filho como IMAGEM DE
  OPÇÃO quando ele vem dentro do envelope `pollCreationOptionImageMessage` — que
  é justamente o campo que dá nome ao recurso. Sem o envelope, a associação é
  ignorada e as imagens chegam como fotos soltas. Segundo erro no mesmo caminho:
  o nó `<meta polltype="creation">` era adicionado só para `poll`; o `imagePoll`
  não entrava no ramo, então a stanza não ia marcada como criação de enquete.
  Ambos corrigidos em `0f4099a`.
- **`optionHash`** = `hex(sha256( hex(sha256(optionName)) + base64(fileSha256) ))`
  — o `fileSha256` é o da imagem **daquela** opção. Fórmula tirada do cliente
  (`WAWebPollOptionHashUtils.generatePollOptionHash`) e reimplementada em
  `generatePollOptionHash`.
- **Onde vêm as imagens**: o WhatsApp **não** entrega várias imagens numa
  mensagem só. A coleta usa o `messagesCache` que o bot já mantém — nenhum
  sistema paralelo de mídia. Módulo: `dados/src/utils/pollImages.js` (puro,
  testável). Dois caminhos:
  1. **ÁLBUM** (o fluxo normal do usuário: selecionar as imagens e digitar o
     comando na legenda). O WhatsApp manda um pai (`albumMessage`, **sem campo
     de legenda**) + **um filho por imagem**, em mensagens separadas com ~1,5s
     entre elas. A legenda vai em UM dos filhos. **Quando o handler roda nesse
     filho, os irmãos ainda não chegaram** — por isso `waitForAlbumChildren()`
     espera: o total vem do próprio pai (`albumMessage.expectedImageCount`),
     então para de esperar no momento certo (e tem timeout de 6s).
  2. **Imagens em sequência** (enviadas antes do comando): mesma janela de 2 min,
     mesmo autor, **ordem de chegada** (o Map preserva a inserção).
  Imagem **respondida** tem prioridade (1 imagem só).
- **ARMADILHA que custou uma rodada de debug**: a própria mensagem do comando
  **não** pode entrar como atalho de "imagem". Quando o comando vai na legenda
  de um álbum, a mensagem é só o PRIMEIRO filho — usar "a imagem da própria
  mensagem" devolvia 1 imagem e ignorava o resto do álbum. O atalho foi removido.
- **ARMADILHA 2**: o filtro de tempo usava `ts > now`, ou seja, descartava
  imagem com timestamp **à frente** do relógio local — jogava fora o álbum
  inteiro quando os filhos vinham com timestamp adiantado. Agora usa diferença
  absoluta (`Math.abs(now - ts) > windowMs`).
- **ARMADILHA 3 (crash silencioso, achada no aparelho)**: `getFileBuffer` não
  tinha timeout, e `getHttpStream` **descartava** `options.signal` — então um
  `AbortController` do chamador não fazia efeito nenhum. Se o servidor de mídia
  aceita a conexão e nunca responde, o fetch fica pendurado **para sempre**: o
  handler daquela mensagem nunca termina e o comando parece "morto", enquanto
  os outros comandos seguem funcionando (o processo está vivo). Corrigido nos
  dois lados: `getHttpStream` repassa `signal` (fork `f1db0c5`) e o
  `getFileBuffer` usa `AbortController` de 30s (`options.timeoutMs` ajusta).
- **Nome das opções**: o protocolo exige `optionName` (o hash depende dele) e a
  enquete com imagens não tem onde digitar texto por imagem — então geramos
  `Opção 1`, `Opção 2`... via `buildOptionName`.
- **Validações**: pergunta vazia, menos de 2 índices, índice não numérico,
  índice `0`/negativo, **índice duplicado** (cada opção precisa de imagem
  diferente), acima do máximo (12), índice inexistente, nenhuma imagem recente,
  download falhou, buffer vazio. Todas com mensagem amigável, sem stack trace.
- **Fork**: `imagePoll` em `lib/Utils/messages.js` (reusa
  `prepareWAMessageMedia` — mesmo pipeline de criptografia/thumbnail/upload/cache;
  nada é enviado duas vezes) e o relay dos filhos em
  `lib/Socket/messages-send.js`, espelhando o bloco do álbum. As imagens
  preparadas são passadas ao `sendMessage` por um holder compartilhado.
- **Dependência**: `package-lock.json`/`yarn.lock` fixados em
  `f1db0c5ef4397ae2d83a26c02a820dcf49a6128d` da fork (image poll proto support +
  envelope dos filhos + `signal` no fetch de mídia). **Não esquecer**: só trocar
  o lock não basta — ver "BUG DO INSTALADOR" (o `!atualizar` já corrigido
  resolve).
- **Testes**: `tests/enqueteimg.test.js` (54 testes / 113 asserções — parser,
  coleta, **álbum com filhos chegando em partes**, resolução, comando real com
  socket falso) e `tests/enqueteimg-integration.test.js` (5 testes / 29
  asserções — o payload do comando pelo caminho real da fork, com encode/decode,
  incluindo o envelope). Fork: `tests/image-poll.test.js`,
  `tests/image-poll-send.test.js` e `tests/media-fetch-signal.test.js`.
  Verificado trocando o `imagePoll` por uma enquete de texto: **10 asserções
  falham**; removendo o envelope `pollCreationOptionImageMessage`: **2 testes
  falham**; removendo o `signal` do fetch: o teste **não termina** (trava).
- **Não quebra o existente**: `!enquete`/`!poll` (texto) intactos, quiz intacto,
  envio normal de imagens intacto, votação intacta. Verificado por teste.
- **Status**: **NÃO DOCUMENTADO no README da fork de propósito** — falta
  validar em aparelho real antes de apresentar como suporte oficial.

## BUG DO INSTALADOR — fork de git ficava no commit ANTIGO (raiz do "repostar não apareceu") ✅
- **Sintoma**: o dono reportou que, depois de tudo, o status do grupo **ainda não
  mostrava a opção de repostar**.
- **Causa raiz (MEDIDA, não hipótese)**: `config.js` e `.scripts/update.js`
  decidiam se rodavam `npm install` olhando só a lista `problems` do
  `npm ls --all`. **`npm ls` compara VERSÃO, não commit** — e a fork do Baileys
  mantém `0.3.18-final` entre commits. Então trocar o commit no
  `package-lock.json` (para pegar o `canBeReshared`) **não gerava nenhum
  `problem`**: a árvore parecia saudável, o install era pulado e a fork
  continuava no commit **ANTIGO** (`453ccf7`, sem o flag). O bot já estava
  atualizado no GitHub, mas o código da fork em execução era o velho.
- **Prova**: com a fork antiga instalada, `generateWAMessageContent(..., {
  groupStatus: true, canBeReshared: true })` produz `featureEligibilities: null`
  — o flag é **silenciosamente ignorado** (a lib não reclama). Com a nova,
  `canBeReshared: true`. Também medido: lock no commit novo + node_modules no
  antigo → `problems` só com o peer opcional `sharp`, `treeOk = true` → install
  pulado.
- **Correção**: novo módulo **`dados/src/.scripts/git-drift.js`** —
  `gitDependencyDrift(raiz)` compara o commit pedido pelo `package-lock.json`
  com o do `node_modules/.package-lock.json` (que é a fonte da verdade do npm).
  Se divergirem, retorna `{ esperado, instalado }` e o install é forçado.
  Sem dados confiáveis dos dois lados devolve `null` (não força reinstalação à
  toa). Usado pelos **dois** scripts, para não divergir.
- **Mensagens**: `config.js` avisa "Dependência de git em commit desatualizado"
  + os dois commits; `update.js` loga o mesmo e o `!atualizar` mostra
  *"Atualizando a fork do Baileys para o commit correto..."* no WhatsApp.
- **Testes**: `tests/installer-git-drift.test.js` — 6 testes / 12 asserções:
  detecta a divergência (o bug real), **não** trata commit igual como deriva
  (install segue idempotente), lockfile ilegível/sem `node_modules` não vira
  falsa reinstalação, e os dois scripts realmente usam o módulo. Verificado
  desligando a detecção: **3 falham**.
- **Armadilha**: enquanto o commit instalado for o antigo, **nenhum** teste de
  payload passa a valer — por isso este teste é a primeira linha de defesa.
  Quem já está travado precisa de **um** `npm install` manual (ou `!atualizar`
  depois deste fix) para sair do commit velho.

## REPOSTAGEM do Group Status — `contextInfo` completo ✅
- **O comando não manda mais só um booleano.** `!statusgrupo` passou a montar:
  ```js
  const statusContent = {
    groupStatus: true,
    contextInfo: {
      featureEligibilities: { canBeReshared: true, canReceiveMultiReact: true },
      statusSourceType: 4,                 // TEXT
      statusAttributions: [{ type: 10 }],  // STATUS_CLOSE_SHARING
      statusAudienceMetadata: { audienceType: 1 } // CLOSE_FRIENDS
    }
  };
  ```
- **Por quê**: o único conjunto de campos que as implementações de Group Status
  em uso de fato enviam é esse (`featureEligibilities` +
  `statusSourceType`/`statusAttributions`/`statusAudienceMetadata`), não o flag
  isolado. Comparado em 3 bots independentes que publicam status de grupo
  ("gstatus"/"tagsw"/"group-upswgc") — o bloco é idêntico entre eles.
- A fork **mescla** `contextInfo` antes de encapsular em `groupStatusMessageV2`,
  então o bloco chega ao payload interno (confirmado por encode/decode real).
- **Enums**: `proto.ContextInfo.StatusSourceType.TEXT` (4),
  `proto.StatusAttribution.Type.STATUS_CLOSE_SHARING` (10),
  `proto.ContextInfo.StatusAudienceMetadata.AudienceType.CLOSE_FRIENDS` (1).
- **Armadilha de teste descoberta aqui**: o objeto do protobuf guarda o **número**
  do enum; é o `toJSON()` que resolve o nome. Comparar com a string
  (`'STATUS_CLOSE_SHARING'`) falha — compare com
  `proto.StatusAttribution.Type.STATUS_CLOSE_SHARING`.
- **Testes**: `tests/statusgrupo.test.js` — 32 testes / 95 asserções. A seção 9
  cobre texto/imagem/vídeo/legenda, o contexto completo (e não só o booleano),
  a sobrevivência ao `encode`/`decode` real do proto e a regressão de mensagem
  comum. Verificado revertendo para `{ groupStatus: true }`: **13 asserções
  falham**.
- **O que ainda NÃO está provado**: o botão aparecer no aparelho. Reshare é
  também condicionado a *AB props* do cliente
  (`wa_web_status_resharer_flow_enabled` & cia.) e à preferência de privacidade
  de quem posta — coisa que biblioteca nenhuma controla. Se o botão não aparecer
  nem com o payload correto, o limite é da plataforma, não do bot.

## `!statusgrupo` — ÁUDIO + publicação só-respondendo (set/2026) ✅
Três mudanças pedidas pelo dono: (1) aceitar **áudio**; (2) o status vir **só da
mensagem respondida** (mídia com/sem legenda, ou texto); (3) o **comando nunca
ir para o status**.

- **BUG 1 — o comando ia junto no payload.** O bloco enviava
  `nazu.sendMessage(from, statusContent, { quoted: info })`. O `quoted` injeta
  `contextInfo.quotedMessage` **dentro** da mensagem interna do status
  (`lib/Utils/messages.js` ~1514). Confirmado no payload: o
  `groupStatusMessageV2.audioMessage.contextInfo.quotedMessage` carregava
  `{"extendedTextMessage":{"text":"!statusgrupo minha legenda"}}`. Correção:
  **removido o `quoted: info`** do envio. Nada da mensagem do comando aparece no
  status.
- **BUG 2 — o comando podia virar conteúdo.** O `resolveMedia([quoted, info.message])`
  tinha `info.message` como fallback; e o `else if (legendaStatus)` publicava o
  texto digitado como status de texto mesmo **sem responder nada**. Agora o alvo
  é **só** o citado: `extractQuoted(info.message)` → `resolveMedia([quotedStatus])`.
  Com mídia suportada, a legenda é `legendaStatus || legenda do anexo`; sem
  mídia, o texto é `legendaStatus || texto da mensagem respondida`. Sem nada
  disso → mensagem de uso.
- **ÁUDIO**: entrou em `TIPOS_STATUS = ['image','video','audio']` com
  `ptt: false` (áudio de status não é nota de voz) e **`seconds` repassado** do
  proto original quando existe — sem isso a fork tenta calcular com FFmpeg e,
  sem FFmpeg no servidor, o `seconds` fica indefinido. O **mimetype original é
  preservado** (`audio/ogg; codecs=opus` veio intacto no encode/decode real).
- **`viewOnce.js` ganhou dois helpers reutilizáveis** (sem Baileys, testáveis):
  `extractQuoted(content)` — acha o `contextInfo.quotedMessage` **em qualquer
  tipo** (texto, imagem, áudio) e desce wrappers (efêmera), onde antes o código
  lia só `extendedTextMessage`; `extractText(content)` — texto de `conversation`,
  `extendedTextMessage.text` ou legenda de mídia, descascando viewOnce/efêmera.
- **Mídia NÃO suportada (documento/figurinha)**: **não** publica a legenda dela
  como texto (seria enganoso — um documento viraria status de texto). Cai na
  mensagem de uso, mesmo com legenda.
- **Limite do WhatsApp (lado plataforma, não do bot)**: status de áudio com
  `ptt: true` não oferece repostar; por isso `ptt: false`. Documentado no README
  da fork.
- **Testes**: `tests/statusgrupo.test.js` — **46 testes / 128 asserções**. Seções
  novas: áudio (buffer, `ptt: false`, `mimetype`, `encode/decode` real, reshare),
  "só responde" (o comando não vira conteúdo nem citação, `quotedMessage`
  ausente, texto respondido vira status, legenda do anexo, prioridade do texto do
  comando, view once) e os não-suportados. `tests/viewonce-v2.test.js` ganhou
  testes diretos de `extractQuoted`/`extractText` (18 testes / 77 asserções).
  Validado: 46/46, 18/18 e regressão verde (get-message-inspector, pg-commands,
  testcall, antimidia, defensive-protection, enqueteimg, relationships-multi,
  blacklist-number, gifsbn-media, cmd-suggest). `node --check` e boot OK.
- **Não validado em aparelho real** (sem sessão pareada): o áudio **tocar** e o
  botão de repostar aparecer. O que está provado por teste é o payload/stanza.

## CORREÇÃO do áudio do `!statusgrupo` — transcodificar para OGG/Opus (set/2026) ✅
- **Sintoma relatado**: o áudio publicado no status aparecia como "áudio não
  disponível" no cliente.
- **Causa**: o comando enviava os **bytes originais** com o mimetype de origem
  (`mp3`, `m4a`, `webm`...). O status do WhatsApp exige **OGG com codec Opus,
  mono, 48 kHz**; qualquer outro formato não renderiza. Reenviar o original
  "funcionava" (o envio não dava erro) mas o destinatário não conseguia ouvir.
- **Correção**: novo módulo **`dados/src/utils/oggOpus.js`** —
  `toOggOpus(buffer)` transcodifica sempre com o **FFmpeg do sistema**
  (`FFMPEG_PATH` ou `ffmpeg`), parâmetros fixos:
  `-vn -c:a libopus -b:a 64k -ar 48000 -ac 1 -avoid_negative_ts make_zero -f ogg`.
  `-vn` descarta faixa de vídeo (um mp4 baixado pode ter imagem). `spawn` com
  args separados (sem shell), timeout 60s com `SIGKILL` no **grupo de processos**
  (`detached` + `kill(-pid)`) e `mkdtemp` sempre removido em `finally`.
- **`ptt`**: passou de `false` para **`true`**. Estava errado — status de áudio
  É nota de voz; `ptt: true` é o que a fork usa para tratar como áudio de status
  (waveform/background) e o que o cliente renderiza.
- **`backgroundArgb: 0xFF000000`** adicionado (fundo do cartão de voz, mesma cor
  que o status de voz usa). Verificado por medição: a fork só aplica
  `backgroundColor` quando `ptt === true`.
- **`mimetype`**: agora fixo em `audio/ogg; codecs=opus` para áudio (não mais o
  mimetype da origem). Imagem/vídeo seguem preservando o original.
- **Erro controlado**: sem FFmpeg no servidor → mensagem específica
  (*"o FFmpeg não está instalado no servidor"*); áudio inválido → *"Não consegui
  converter esse áudio"*. Nunca publica lixo nem vaza stack trace.
- **Testes**: `tests/statusgrupo.test.js` — **49 testes / 143 asserções**. A
  seção de áudio agora usa **áudio de verdade gerado pelo FFmpeg** (`sine` via
  lavfi): publica OGG, **converte MP3 → OGG/Opus** (o caso que não renderizava),
  valida o header `OggS` no buffer enviado (prova que NÃO são os bytes
  originais), `ptt: true`, `backgroundArgb`, `encode/decode` real do proto e
  áudio inválido → erro controlado. Teste direto do helper (`toOggOpus`) inclui
  verificação de `OpusHead`/`OpusTags` na saída.
- **PRÉ-REQUISITO**: FFmpeg instalado no servidor (o bot já exige em
  `config.js`/`update.js`). Sem ele, texto/imagem/vídeo seguem funcionando e só
  o áudio dá erro claro.
- **ARMADILHA DOS TESTES**: a suíte agora depende de FFmpeg real no PATH; sem
  ele, os testes de áudio falham por falta do binário (não por bug do comando).
  Rodar com o ffmpeg disponível (ex.: `FFMPEG_PATH` apontando para um estático).
- **Falha PRÉ-EXISTENTE observada (não é desta mudança)**: em
  `tests/viewonce-v2.test.js`, o teste *"!s não deixa arquivo temporário para
  trás"* falha **quando o FFmpeg está presente no PATH** — confirmado rodando o
  baseline sem as mudanças do áudio (mesmo 76/77). Com o PATH sem ffmpeg, passa
  77/77. Não foi corrigido aqui por estar fora do escopo do pedido.

## COMANDO `!d` reescrito + MINI SISTEMA de apagar GROUP STATUS (set/2026) ✅
- **Case trocada** por um bloco novo (pedido do dono): a permissão virou
  `if (!isGroupAdmin && !isPremium)`, o alvo é resolvido por
  `extendedTextMessage.contextInfo.stanzaId || viewOnceMessage.contextInfo.stanzaId || info.key.id`,
  e o fluxo de **pagamento** (editar mensagem vazia + apagar original + apagar
  editada) ficou idêntico ao enviado. **Nomes novos no escopo do switch**
  (`stanzaId`, `quotedMessage`, `citouStatus`, `idEhStatusPublicado`,
  `statusPointer`): conferido que não há uso anterior no mesmo switch — sem TDZ.
- **Problema que o mini sistema resolve**: o `!d` normal **não apagava** o
  status do grupo. Dois motivos, medidos no payload: (1) o `!d` comum monta a
  key como mensagem de TERCEIRO (`fromMe: false` + `participant`), enquanto um
  status publicado pelo bot é `fromMe: true`; (2) o status é uma stanza especial
  (`is_group_status='true'`), então a revogação precisa sair no **mesmo formato**.
- **Módulo novo** `dados/src/utils/groupStatus.js` (puro, sem Baileys):
  - `isGroupStatusContent(content)` — reconhece `groupStatusMessageV2`/
    `groupStatusMessage`/`contextInfo.isGroupStatus`, descascando wrappers;
  - `buildGroupStatusRevokePayloads(key)` — devolve **duas** tentativas: a
    revogação encapsulada como status (`{ groupStatus: true, delete }`, que leva
    `is_group_status='true'`) e a simples como rede de segurança;
  - registro em memória por chat (`rememberPublishedGroupStatus`,
    `isPublishedGroupStatus`, `getLastPublishedGroupStatus`,
    `forgetPublishedGroupStatus`, `clearPublishedGroupStatuses`), TTL 12h, teto
    de 50 por chat.
- **`!statusgrupo` alimenta o registro**: ao publicar, guarda
  `statusEnviado.key.id`. É o que permite apagar depois sem depender de citar a
  mensagem (o cliente não entrega o status como citável de forma confiável).
- **Como o `!d` decide**: se o citado é status (`isGroupStatusContent`) OU o ID
  citado está no registro → revoga ESSE id. Se o `!d` veio **sem alvo** e há
  status publicado no grupo → cai no **último** do registro (antes respondia só
  "Marque uma mensagem" e nada era apagado). Então apaga também a mensagem do
  comando.
- **Testes**: `tests/delete-status.test.js` — **11 testes / 55 asserções**:
  helpers puros (reconhecimento, ordem dos payloads, registro), `!d` sem alvo →
  último status, `!d` citando status, formato da revogação, apagar comando,
  barrado para não-admin, e a **regressão** dos fluxos antigos (mensagem de
  terceiro com `fromMe:false`+participant, pagamento com edição, sem alvo e sem
  status). Validado: 11/11 + regressão verde (statusgrupo 46/46, viewonce-v2,
  get-message-inspector, antimidia, pg-commands, testcall, blacklist-number,
  defensive-protection). `node --check` e boot OK.
- **Créditos no `!statusgrupo`**: comentário `Comando desenvolvido por 𝐊𝐚𝐧𝐧𝐨𝐧.`
  no início da case.
- **ARMADILHA (custou uma rodada)**: editar o `index.js` com Python usando
  `open(..., encoding='utf-8')` + `readlines/writelines` **corrompeu o arquivo
  inteiro** (todo acento virou mojibake — lido como cp1251). A solução foi
  sempre `open(path, 'rb')` → `.decode('utf-8')` → operar em `str` → gravar com
  `.encode('utf-8')`, e conferir com `b.count(b'\xd0\x93\xc2\xa9') == 0`.

## GERENCIAMENTO do Plugin Fantasma — `!ghostcmd` / `!addghostcmd` / `!delghostcmd` ✅
Sistema pequeno, **exclusivo do dono**, para administrar a distribuição do plugin
remoto. Só isso: nada de marketplace, registry, dashboard ou permissões novas.

### Módulos
- **`dados/src/antifantasma/keys.js`** — registro das keys. Formato em disco:
  `{ version, nextId, keys: [{ id, key, owner, status, createdAt }] }`.
  - `id` numérico sequencial **persistido** (`nextId`): revogar **não** libera o
    número, então nunca existe reuso de id.
  - `criarKey({ owner })`, `revogarPorId(id)`, `listarKeys()`, `buscarPorId(id)`,
    `estatisticas()`, `mascararKey(key)` e `validarKey(key, { botId })`.
  - **Migra o formato antigo** (mapa key→registro, sem id) ao ler — quem já tinha
    keys não perde nada.
  - Escrita atômica (tmp único + rename), como no resto do projeto.
- **`dados/src/antifantasma/health.js`** — `verificarSaude(baseUrl)` bate no
  `/api/antifantasma/health` (GET, sem key, sem contexto). Diferencia
  **online** / **offline** (sem resposta/timeout) / **erro** (respondeu errado) e
  confere que é o nosso plugin (`plugin === 'antifantasma'`), para não confundir
  outro serviço na mesma porta.
- **`api.js`** ganhou o endpoint `/api/antifantasma/health` (não expõe keys,
  donos nem contagem) e passou a **repassar `botId`** para a validação.

### 1 key = 1 usuário (validado no servidor)
`validarKey` recebe `{ botId }` e confere que ele é o **dono registrado** da key.
Se não for → `dono_diferente` → **403**, e o núcleo **não executa**. Mesmo que o
usuário B descubra a key do A, não passa. A comparação tolera as formas
JID/LID/número (`mesmoUsuario`). O adaptador manda esse valor no campo `BOT_ID`.

### Comandos (`index.js`, logo antes do `default:`)
Todos usam `canUseOwnerCmd` — **nenhum sistema de permissão novo**.
- **`!ghostcmd`** — painel: `Servidor ONLINE/OFFLINE/ERRO`, `API
  FUNCIONAL/INDISPONÍVEL`, lista de keys (`#N`, `@dono`, `🟢 ATIVA`/`🔴
  REVOGADA`) e a contagem (total/ativas/revogadas). **Nunca mostra a key
  inteira** (só o painel por número/dono/status).
- **`!addghostcmd`** — exige responder a mensagem do destinatário (reusa o
  `menc_os2` do handler). Cria a key vinculada, gera o id, e envia **tutorial +
  o arquivo** `antifantasma.js` como documento. O arquivo sai **já configurado**
  (URL detectada + key + botId). O tutorial explica pasta, import, case,
  ativar/desativar e deixa explícito que **o nome da case é livre**.
  Se o envio do arquivo falhar, avisa que a entrega **não** foi concluída.
- **`!delghostcmd <número>`** — revoga (muda status, **não apaga**). Responde
  `revogada com sucesso` / `já está revogada` / `não encontrada`.
- **`!delghostcmd alt`** — apaga **TODAS** as keys (ativas e revogadas), via
  `apagarTodas()`. **O contador `nextId` NÃO volta**: se a #5 existiu, a próxima
  key criada será #6 mesmo após a limpeza total — a regra "não reutilizar
  número" sobrevive ao cenário mais destrutivo. Responde quantas removeu e qual
  será a próxima. Sem nada para apagar, informa `Removidas: 0`.

### Menu
Categoria **👻 PLUGIN FANTASMA** no `menudono` (adicionada, sem substituir
nenhuma existente).

### Segurança
- O painel **não** expõe a key inteira; `mascararKey` existe para log/exibição
  (`MTX-GH••••C3D4`).
- Nenhum log imprime a key crua.
- O arquivo entregue é o **adaptador** — nunca o `core.js`. Testado: o adaptador
  não contém `selectiveDistribution`/`undecryptableGroupMessage`/`normalizeContext`
  nem referencia `core.js`.

### Code block nativo ("black box") no tutorial + blindagem do cliente (set/2026) ✅
- **O tutorial do `!addghostcmd` mantém o TEXTO normal** e usa a code box nativa
  da fork (`richResponseMessage`) **apenas nos trechos de código**. A forma
  correta é `richResponse: [{ text }, { code: [{ codeContent, highlightType }],
  language }, ...]` — texto e código intercalados na ordem do tutorial:
  ```
  [TEXTO]  📥 2. Como importar
  [CODE ]  const antiFantasma = require('./antifantasma');
  [TEXTO]  ⚙️ 4. Adicionar a case
  [CODE ]  case 'antifantasma': { ... }
  [TEXTO]  ⚠️ E no handler de mensagens
  [CODE ]  await antiFantasma.executar({ sock, msg, reply });
  [TEXTO]  🟢 5. Ativar / desativar
  [CODE ]  case 'afon': ...
  [CODE ]  case 'afoff': ...
  ```
  O tutorial sai em **dois envios**: (1) texto com cabeçalho + KEY (o `@menção`
  precisa de mensagem de texto) e (2) o `richResponse` com texto+código. Se a lib
  não suportar, cai para texto simples.
- **Os exemplos usam `antifantasma` / `afon` / `afoff`** (como no código da
  própria Lizzy), refletindo a chamada real do adaptador.
- **Blindagem do adaptador** (ele roda no handler do bot do usuário, onde uma
  exceção pode quebrar o processamento dele): `executar` envolve TODO o corpo num
  try/catch e devolve `{ok:false, motivo:'excecao', detalhe}` — nunca lança.
  Testado com **17 entradas hostis**: nenhuma derruba.
- **Cache da consulta de administração** (15s, por grupo+autor): sem ele, CADA
  mensagem faria consulta de metadata ao WhatsApp — pesa em grupo movimentado.
  Testado: 5 mensagens = 1 consulta. Também trata `sock.groupMetadata` ausente
  ou que lança.
- **Armadilha nos testes**: o cache é por (grupo, autor), então dois testes com o
  MESMO grupo recebem o resultado do primeiro — o teste de "autor admin" precisou
  de grupo próprio. E os helpers precisam **achatar** `richResponse`
  (`sub.text` + `sub.code[].codeContent`), senão o teste não enxerga o tutorial.

### COMANDO `!seturlghost` + URL no log de boot (set/2026) ✅
Pedido do dono: *"vou adicionar a url manualmente, quero mais um comando
!seturlghost, e também quero que nas logs do bot quando ele inicia tenha um
campo mostrando a url do servidor"*.

**Novo módulo `dados/src/antifantasma/urlManual.js`** — persistência da URL
gravada à mão, em `dados/database/antifantasma/publicUrl.json` (separado das
keys: é configuração do servidor, não credencial). Escrita atômica com tmp
único, como o resto do projeto. `normalizarUrl`, `gravarUrlManual`,
`lerUrlManual`, `limparUrlManual`, `temUrlManual`.

**Precedência da URL** (do maior para o menor):
1. **URL gravada com `!seturlghost`** ← NOVO
2. `ANTIFANTASMA_PUBLIC_URL` / `PUBLIC_URL`
3. detecção automática (runtime/Render/Railway/Pterodactyl/...)

O comando **ganha** da variável de ambiente de propósito: quem acabou de digitar
a URL espera que ela valha, sem mexer no painel. Implementado via
`opts.urlManual` em `detectarUrlPublica`/`endpointAntiFantasma`/`resumoParaLog`
— o módulo `publicUrl.js` continua **puro** (recebe o valor, não lê disco), o
que preserva os 27 testes existentes sem alterá-los.

**Normalização** (cobre o que o WhatsApp manda): sem esquema → `https`;
`http://` em host **público** vira `https` (a KEY não pode trafegar em claro) e
só `localhost`/`127.0.0.1` mantêm http; tira barra final, espaços e os `<>` de
link; preserva porta. Recusa: host sem ponto (`abc`), host só de pontuação
(`.`/`https://.`), esquema perigoso (`javascript:`/`ftp://`), injeção de comando
com `\n`, e qualquer coisa > 500 chars. Testado com 26 entradas reais — 12
aceitas, 14 recusadas.

**Comando `!seturlghost`** (`index.js`, logo antes do `default:`), exclusivo do
dono (`canUseOwnerCmd`, sem sistema de permissão novo):
- `!seturlghost <url>` — grava e confirma com o endpoint resultante;
- `!seturlghost` (ou `ver`/`status`) — mostra endpoint em uso + **origem**;
- `!seturlghost limpar` (ou `reset`/`apagar`/`remover`) — volta à detecção.
- Menu: linha na categoria **👻 PLUGIN FANTASMA** do `menudono`, e
  `'seturlghost'` na lista do `menudono` em `blockPv.js` (junto com
  `ghostcmd`/`addghostcmd`/`delghostcmd`, que faltavam nessa lista).

**LOG DE BOOT — agora SEMPRE mostra a URL.** `resumoParaLog` ganhou
`opts.sempre` e o campo **`Origem`**:
```
🔐 AntiFantasma (plugin remoto)
   URL pública: https://meuservidor.com
   Origem:      gravada com !seturlghost
   Porta da API: 12000
   Endpoint:    https://meuservidor.com/api/antifantasma/exec
```
Antes, um bot **sem** URL detectada não imprimia nada (o bloco era omitido) —
ou seja, quem mais precisava da informação era quem não a via. Agora
`start.js` passa `sempre: true` e, quando não há URL, o log diz *"não
detectada"* e aponta o `!seturlghost`.

**Integrações**: `start.js` (boot), `api.js` (log ao subir a API),
`!ghostcmd` (seção *URL DO SERVIDOR* com endpoint + origem),
`!addghostcmd` (o arquivo entregue passa a apontar para a URL manual) e o
diagnóstico do `ghostDiagUrl` (primeira linha é a URL gravada).

**Testes**: `tests/seturlghost.test.js` — **13 testes / 87 asserções**, rodando
o **handler real** com socket falso: normalização/validação, robustez com 26
entradas, persistência em disco, precedência, `resumoParaLog` (origem + sempre),
os três modos do comando, NÃO-dono barrado, `!addghostcmd` entregando o arquivo
com a URL manual, `!ghostcmd` e menu/blockPv.
**Armadilha**: importar o `index.js` deixa timers/handles abertos — sem
`process.exit(0)` no fim, a suíte fica pendurada (todos os testes passam, mas o
processo nunca encerra).
**Ajuste de teste antigo**: `tests/public-url.test.js` esperava a mensagem
`ANTIFANTASMA_PUBLIC_URL` no log sem URL; a expectativa virou `seturlghost`,
que é o caminho que o log passou a indicar (a variável continua valendo).

**Suítes**: seturlghost 13/87, public-url 27/27, ghost-manager 37/154,
antifantasma-plugin 21/154, usuario 40/40, entrega 19/19, e2e 22/22,
instalacao-limpa 20/20, autossuficiente 14/14, esm 10/10, cjs 5/5, + 23 de
regressão.

### LEVAR PARA OUTRO BOT — só o arquivo, nada do projeto (set/2026) ✅
Pedido do dono: *"passar o comando de antifantasma para outro bot sem ele
precisar dos arquivos diversos que realmente executa"*. Ou seja: o outro bot
recebe **um arquivo** e mais nada; a lógica continua no servidor.

**Já era assim — e agora está provado.** O entregável depende **apenas de
módulos nativos do Node** (`node:http`/`node:https`); não referencia
`core.js`/`api.js`/`keys.js`/`health.js`/`utils/` em lugar nenhum.
- **`tests/antifantasma-autossuficiente.test.js` (14)** — análise estática
  (todo `require` do CÓDIGO é nativo; a análise ignora comentários, senão a
  própria documentação do arquivo dava falso positivo) **+ runtime**: copia
  **só** `antifantasma.cjs` para uma pasta limpa, confirma que há **1 arquivo
  na pasta**, que `core.js` **não existe** ali, e roda ativar → ataque
  (fecha/bani/reabre) até o fim.
- O que fica no **cliente**: observar as mensagens, relatar os sinais crus e
  executar os nomes de ação autorizados. O que fica no **servidor**: a
  classificação do ataque, as guardas e a decisão. Nenhum "arquivo diverso"
  viaja junto.

**Nomes de variável não são obstáculo**: a CASE usa `isGroup`,
`isGroupAdmin`, `isBotAdmin`, `reply`, `nazu`, `from`, `info` — **exatamente os
mesmos** da case que o dono já tinha no outro bot (comparado com a que ele
mandou). Por isso funcionou no bot dele sem renomear nada.

**A KEY é o único ponto preso ao servidor**: ela fica registrada no servidor
que a gerou (`keys.json`). Arquivo gerado por **outro** servidor → `inexistente`
→ "KEY inválida" (agora com o motivo logado). Leads a duas regras práticas,
documentadas no `LEIA-ME`:
1. gerar o arquivo pelo `!addghostcmd` **do servidor que vai atender**,
   respondendo a uma mensagem **do número do outro bot** (é o `BOT_ID`);
2. se o bot de destino já tinha arquivo antigo, ele precisa ser **substituído**
   — o antigo carrega o `require` que quebra em ESM.

**Limite honesto**: o formato do payload (contexto) é o mesmo que a API da
Lizzy espera. Se o outro bot for baseado numa lib/versão com nomes muito
diferentes de `nazu`/`groupMetadata`/`sendMessage`, a CASE precisa de ajuste —
mas o arquivo continua igual.

**Suítes**: plugin 21/154, usuario 40/40, entrega 19/19, e2e 22/22,
instalacao-limpa 20/20, **autossuficiente 14/14**, esm-replica 10/10,
cjs-replica 5/5, ghost-manager 37/154.

**NOMENCLATURA CORRIGIDA (set/2026)**: o entregável volta a se chamar
**`antifantasma.cjs`** — o plugin é **AntiFantasma**, não "antiinvisível". O
`.cjs` fica (é o que permite carregar em bot ESM *e* CommonJS). A variável na
CASE é `antiFantasma` e o arquivo do adaptador é
`dados/src/antifantasma-cliente/antifantasma.cjs`.

### VERIFICAÇÃO COMPLETA — 3 causas reais do "ainda não funciona" (set/2026) ✅
O dono reportou que **no bot de destino não funcionava**, com este log:
`erro: '❌ KEY do AntiFantasma inválida ou revogada.'` — e a pergunta "descubra
por que ainda não está funcionando". Três causas, todas medidas:

**1. `require` puro quebra em bot ESM (CAUSA PRINCIPAL).**
A própria Lizzy tem `"type": "module"` e **não** define `require` (não importa
`createRequire`; o único `require` do arquivo era o da CASE). Num bot ESM, a
CASE caía em `ReferenceError: require is not defined` → `catch` → **"Ocorreu um
erro 💔"**. O módulo nunca carregava, `iniciar()` nunca rodava.
- Meus testes anteriores carregavam o adaptador via `.cjs` (**CommonJS**), onde
  `require` existe — eram **mais permissivos que a realidade**. Por isso passavam
  enquanto o bot real quebrava. Este foi o erro de método que escondeu o bug.
- **Matriz medida** (ESM×CJS × extensão × forma de carregar): a única combinação
  que funciona nos DOIS tipos de bot é **`.cjs` + checar `typeof require`**:
  `require()` num ESM = `ReferenceError`; `import()` de um `.js` com conteúdo
  CommonJS dentro de ESM = `module is not defined in ES module scope`; um `.cjs`
  carrega nos dois.
- **Correção**: entregável renomeado para **`antifantasma.cjs`** (funciona em
  ESM e CJS) e a CASE passou a carregar com
  `typeof require === 'function' ? require('./antifantasma.cjs') : (await import('./antifantasma.cjs')).default`.
  `iniciar(nazu)` virou condicional (`typeof nazu !== 'undefined'`).

**2. `iniciar` exigia `sock.ev`.** Se o bot expuser o emitter direto (`sock.on`),
o `iniciar` recusava com `socket_sem_ev` e a proteção não ligava. Agora aceita
`sock.ev` **ou** o próprio socket como emitter.

**3. Auto-ligação (rede de segurança para ESM).** No ESM a CASE não pode chamar
`iniciar` (o `require` estoura antes). O listener agora chama `autoIniciar(evento)`
e descobre o socket pelo próprio evento (`evento.sock || evento.socket ||
evento.nazu`), ligando a escuta sozinho. Assim a proteção não depende de o bot
expor o socket com um nome fixo. Sem socket reconhecível, desiste em silêncio.

**4. "KEY inválida" escondia quatro causas.** `validarKey` retorna
`ausente`/`inexistente`/`revogada`/`dono_diferente`, mas a API descartava o
motivo e o cliente mostava sempre o mesmo texto — indiagnosticável no campo.
Agora a API devolve `reason` (rótulo curto, sem key/dono/núcleo) e o **cliente
loga o motivo com explicação** no terminal. Reproduzido com o cliente real:
`inexistente` = "key gerada em OUTRA Lizzy, ou o registro de keys foi
apagado/reiniciado" (o caso mais comum); `dono_diferente` = BOT_ID de outro
número; `revogada` = revogada pelo dono. **Importante**: `keys.json` é
**gitignored**, então ele sobrevive a `git pull`, mas **não** a um redeploy limpo
/ troca de host — nesse caso todas as keys ficam `inexistente` e é preciso
regerar.

**Testes novos**:
- `tests/antifantasma-esm-replica.test.js` (10) — réplica fiel de bot **ESM**
  com os nomes reais da Lizzy + a CASE literal do `index.js`; asserções da causa
  raiz (a CASE testa `typeof require`, tem o caminho ESM, **não** usa `.js`).
- `tests/antifantasma-cjs-replica.test.js` (5) — o mesmo para bot **CommonJS**.
- `antifantasma-plugin` ganhou o teste do **motivo do 403** (os 4 valores) e a
  permissão da chave `reason` no teste de vazamento.

**Suítes**: plugin 21/154, usuario 40/40, entrega 19/19, e2e 22/22,
instalacao-limpa 20/20, esm-replica 10/10, cjs-replica 5/5, ghost-manager
37/154.

### PROTEÇÃO CONTÍNUA — correção do modelo CASE↔executor (set/2026) ✅
O pedido do dono: o plugin deveria funcionar como **funcionalidade nativa**,
com o usuário só colocando o arquivo em `src/` e a CASE no `index.js` — **sem**
editar handler nem registrar listener. Correção do sistema existente (nada de
recriar API/core/keys).

**Quatro defeitos medidos antes de mexer** (cada um com prova, não hipótese):
1. `iniciar(sock)` **ignorava o socket**: recebia o parâmetro e não anexava
   listener nenhum (`ev.on` chamado **0** vezes). Ou seja, a proteção contínua
   não existia.
2. A CASE tinha o `require` **fora** dela (no topo do bloco) — contra a regra
   de manter o carregamento dentro da case.
3. A CASE **não chamava `iniciar()`**; o tutorial mandava o usuário "chamar
   `executar` a cada mensagem recebida" — exatamente a edição manual proibida.
4. O entregável se chamava `antifantasma.js`, não `antifantasma.cjs`.

**Correções** (arquitetura e contrato preservados):
- **Novo entregável `dados/src/antifantasma-cliente/antifantasma.cjs`**: mesma
  observação/execução de antes, **mais** a proteção contínua que faltava.
  `iniciar(sock)` agora anexa `messages.upsert` **no próprio `sock.ev`** (é onde
  o bot já registra os listeners dele — `nazu.ev.on`, confirmado no `index.js`).
  É idempotente (troca de socket/reconexão não duplica) e tem `parar()`.
  O listener é **aditivo**: não substitui nem interfere no handler do usuário.
- **Estado POR GRUPO**: `ativar(grupo)`/`desativar(grupo)`/`estaAtivo(grupo)`.
  Ligar no Grupo A não liga no B. Sem grupo, mantém o comportamento global
  (compatível com quem chama sem argumento). **Não** foi criado outro banco: o
  estado vive no módulo, como antes.
- **CASE**: `require('./antifantasma')` **dentro** da case + `iniciar(nazu)`;
  alterna por grupo (`estaAtivo(from)`). O `catch` continua respondendo erro.
- **Tutorial** (`!addghostcmd`): passos 1-6 (colocar arquivo → copiar CASE →
  colar → reiniciar → `!antifantasma` liga → de novo desliga), **sem** a etapa
  de editar handler. Arquivo entregue e legenda renomeados para
  `antifantasma.cjs`. `LEIA-ME.md` reescrito para o mesmo fluxo.
- **API/core/keys/health intocados.** Nenhuma decisão foi para o cliente: o
  adaptador segue só relatando sinais e executando `actions[]`.

**Novo teste `tests/antifantasma-instalacao-limpa.test.js` (20 asserções)** — é
o critério definitivo: extrai a CASE **literalmente** do `index.js`, monta um
bot que só tem o arquivo + a CASE (socket sem `sendMessage`, **nenhuma** chamada
manual, **nenhum** listener à mão) e percorre ativar → ataque (fecha/bani/reabre)
→ normal (nada) → desativar (para) → permissões → estado por grupo. **Verificado
neutralizando o `sock.ev.on` do `iniciar`: 5 asserções falham** — o teste mede o
comportamento real, não a aparência.

**Armadilha do dublê**: o socket de teste precisa de `.ev` (o Baileys expõe o
EventEmitter ali). Sem isso o `iniciar` recusa corretamente com `socket_sem_ev`
e o teste mediria errado. E `new Function` com a case precisa de uma quebra de
linha antes do `}` do switch, senão o comentário final da CASE engole o
fechamento e dá `SyntaxError`.

**Suítes**: antifantasma-plugin 20/146, usuario 40/40, entrega 19/19,
instalacao-limpa 20/20, e2e 22/22, ghost-manager 37/154, + 21 suítes de
regressão verdes. `statusgrupo` falha por **falta de ffmpeg no sandbox** —
**pré-existente, comprovado** rodando-a com `git stash` (mesma falha sem as
mudanças).

### BLOCO FINAL do tutorial: código COMPLETO e autossuficiente (set/2026) ✅
- **Pedido do dono**: o último trecho do tutorial devia ser *"o código exato que
  ele possa usar, já contendo todas as const, ligado no arquivo, tudo"* — o
  usuário só teria de colocar a pasta em `src/` e colar a case no `Index.js`.
- **`CASE_COMPLETA`** (`index.js` ~39703) deixou de ser só a `case`: agora é o
  **bloco inteiro**, com cabeçalho, o `const antiFantasma =
  require('./antifantasma');` **e** a `case 'antifantasma'` logo abaixo.
- **Fidelidade à case do usuário**: a lógica é a dele (checagens
  `isGroup`/`isGroupAdmin`/`isBotAdmin`, alternar liga/desliga, o mesmo
  `textoFantasma` e o mesmo envio via `nazu.sendMessage(from, { text, quoted })`),
  com **uma** troca obrigatória: o estado sai do `groupData.antiinvi` e passa a
  ser `antiFantasma.estaAtivo()/ativar()/desativar()` (é o plugin). O
  `newsletterCtxInvi` do original **não** foi para o exemplo (contexto de
  encaminhamento de newsletter é enfeite do bot dele, não do comando).
- **Texto que antecede** agora diz que é o **código completo** (com require e
  URL) e não só "uma case".
- **Armadilha do template literal**: o bloco vive dentro de uma template string
  do `index.js`; por isso backticks literais vão **escapados** (`` \` ``) e as
  quebras de linha *internas* do JS gerado saem como `\\n` — conferido avaliando
  o literal de verdade (`node /tmp/case_block.js`), não só olhando a fonte.
- **Teste**: `tests/ghost-manager.test.js` — a asserção nova fatia o texto a
  partir de *"100% feita e funcional"* e exige `require('./antifantasma')` +
  `case 'antifantasma'` + `ativar()`/`desativar()` nesse trecho final, e que ele
  **não escreva** mais em `groupData.antiinvi =`. 37 testes / 152 asserções;
  regressão `antifantasma-entrega` (17/17) e `antifantasma-plugin` (20/20) ok.

### BUG: "testei com outro bot real e não fez nada" (set/2026) ✅ CORRIGIDO
Relato do dono: o plugin foi instalado numa bot real, chegou um ataque e **nada
aconteceu**. Reproduzi a chamada EXATA do tutorial e confirmei: retornava
`{ok:false}` sem tocar no socket. Eram **quatro** problemas em série:

1. **A INTERFACE NÃO BATIA (a causa principal).** O tutorial manda o usuário
   escrever `executar({ sock, msg, args, reply })`, mas o adaptador só lia
   `params.grupo` / `params.autor` / `params.contexto`. Com `msg`, `grupo` ficava
   `undefined` → retornava cedo. **O usuário seguia o tutorial ao pé da letra e
   não acontecia nada.** Agora o adaptador **extrai tudo do `msg`** (JID do
   grupo, autor, sinais) e aceita as duas formas.

2. **`botIsAdmin` nunca era enviado.** O núcleo exige esse sinal como guarda;
   sem ele, jamais agiria — mesmo com o contexto correto. Agora o adaptador
   **consulta o metadata do grupo** (`sock.groupMetadata`) e descobre sozinho se
   o bot é admin e se o autor é privilegiado. É consulta ao WhatsApp, não regra
   do produto: o critério continua no servidor.

3. **O núcleo e o adaptador falavam nomes diferentes.** O adaptador observava
   `temMensagem`/`temStub`/`pagamento`, mas o núcleo só entendia
   `undecryptableGroupMessage`/`zeroValuePayment`. Agora `normalizeContext`
   aceita as duas formas e faz a leitura do pagamento **no servidor** (o
   adaptador relata o valor cru; quem julga é o núcleo).

4. **O tutorial enganava sobre o uso.** Dizia só "adicione a case", mas uma case
   só roda quando alguém digita o comando — o plugin precisa ver **as
   mensagens**. Adicionado aviso explícito + exemplo de chamada por mensagem.

**Prova**: a chamada idêntica à do tutorial agora devolve
`{ok:true, acoes:['close_group','ban_user','open_group']}` e executa
`announcement`, `remove` e `not_announcement` no socket.

**Testes ajustados**: as checagens de vazamento proibiam os *nomes dos campos*
(`selectiveDistribution` etc.). Mas o adaptador **precisa** relatar os sinais —
é o trabalho dele. A checagem correta é pela **decisão**: `normalizeContext`,
`decidir(`, `ataqueSeletivo`, `ja_punido` e combinações de sinais
(`selectiveDistribution &&`). Assim o teste mede o que importa: o cliente
observa, o servidor decide.

### Teste do LADO DO USUÁRIO (set/2026) ✅
Dois testes validam a ponta do usuário, com o servidor REAL (nada da Lizzy é
substituído — só o socket do WhatsApp e o host/porta viram locais):

- **`tests/antifantasma-usuario.test.js` (40 asserções)** — simula a bot do
  usuário: importa o arquivo do jeito que o tutorial ensina, cria as **cases
  personalizadas** (`afon`/`afoff`/`afstatus`/`antifantasma` — nomes livres) e
  percorre o fluxo: desativado não chama a API; ativa; mensagem normal não gera
  ação; **ataque fecha/bani/reabre**; admin não é punido; desativa; **key
  revogada recusada**; **key de outro dono recusada**; API fora do ar tratada;
  chamada sem `sock` não quebra.
- **`tests/antifantasma-entrega.test.js` (17 asserções)** — a diferença
  importante: o arquivo sai do **`!addghostcmd` rodando de verdade no handler**
  (não é montado à mão). Confere que a entrega vem **configurada** (URL real, KEY
  e BOT_ID preenchidos, sem placeholder), que o **tutorial** tem import/case/
  ativar/desativar e deixa claro que o nome é livre, e então **instala esse
  arquivo e roda** — fechando a cadeia `comando → arquivo → bot do usuário → API`.
- Verificado também o health pela **URL pública real**:
  `{"ok":true,"tipo":"online","versao":"1"}`.

### Numeração das keys: sem buracos (set/2026) ✅
Relato do dono: *"apaguei a key 1 e gero uma nova ela fica como 2"* — e o mesmo
acontecia no `alt`. Reproduzido: apagar/revogar a #1 e criar outra dava #2.

**Causa**: o `id` era um **contador persistido** (`nextId`) que só subia. Uma vez
usado, o número nunca voltava — então a numeração ficava com buracos depois de
qualquer remoção.

**Correção**: o `id` passou a ser a **posição na lista** (1..N), recalculada em
`renumerar()` a cada leitura. Consequências:
- apagar a #1 e criar outra → a nova é **#1** de novo;
- `alt` (`apagarTodas`) → a próxima criada é **#1**;
- `!delghostcmd <n>` **revoga** (não remove): o registro fica no lugar com status
  `revoked` e **a numeração não abre buraco** — a lista continua 1,2,3 e a
  próxima criada é a seguinte;
- **arquivos antigos se consertam sozinhos**: um JSON que ficou com ids 5 e 9
  (do contador) é renumerado para 1 e 2 na primeira leitura, preservando keys,
  donos e status.

O teste que exigia "não reutilizar números" foi **substituído** pelo novo
contrato (o comportamento antigo é justamente o bug relatado).

### Testes — `tests/ghost-manager.test.js` (37 testes / 147 asserções)
Registro (numeração sem buraco, renumeração de arquivo antigo, duplo revogar, inexistente,
estatísticas, dono obrigatório, máscara), **persistência** (relê do disco com
`version`/status), **1 key = 1 usuário** (dono passa, outro é recusado
com 403 pelo `processarRequisicao`, JID e número equivalentes), **health** (online,
offline, erro, serviço diferente, e que `/health` não aceita POST com contexto —
ou seja, não dispara ação real), **arquivo** (é o adaptador e não o núcleo),
**handler real** (comum bloqueado nos três; painel com status/keys/contagem;
key não aparece inteira; add sem alvo pede resposta; add cria 1 key com id
sequencial vinculada ao usuário, envia tutorial e arquivo configurado; duas keys
para dois usuários sem compartilhamento; del revoga/avisa/inexistente/sem
número) e **menudono**.
- **Armadilha**: o handler normaliza a identidade do alvo para **LID**
  (`...@lid`), então o teste não pode procurar a key pelo JID literal — compara
  pelo número (`split('@')[0]`).
- **Armadilha 2**: procurar a key pelo dono pegava a key **antiga** de outro
  teste (mesmo número). O correto é rastrear o **id novo** (`proximoId` antes da
  chamada).

## 🚨 "ATIVEI O ANTIFANTASMA E NÃO BANE" — CAUSA RAIZ ENCONTRADA (set/2026) ✅
O plugin estava **quebrado em produção** e os testes não pegavam. Cinco defeitos,
todos medidos executando o adaptador REAL contra a API REAL.

### 1) A forma do sinal de distribuição seletiva (CAUSA PRINCIPAL)
O adaptador testava:
```js
selectiveDistribution: m.selectiveDistribution === true,   // SEMPRE false
```
Mas o fork do Baileys atribui um **RELATÓRIO (objeto)**, nunca `true`:
```js
// node_modules/@itsliaaa/baileys/lib/Utils/decode-wa-message.js
fullMessage.selectiveDistribution = report;  // { kind, messageId, groupJid, author, encType, decryptFail, ... }
```
`grep "selectiveDistribution = true"` no fork → **nenhuma ocorrência**; os dois
únicos pontos que o leem (`messages-recv.js`) usam teste de veracidade.

Resultado medido com o adaptador antigo:
```
CONTEXTO ENVIADO: { ..., "selectiveDistribution": false, "temStub": true, "botIsAdmin": true }
RESULTADO: {"ok":true,"acoes":[]}
CHAMADAS NO SOCK: (NENHUMA)
```
O núcleo exige `selectiveDistribution && undecryptableGroupMessage`; com o
primeiro sempre falso, **o ataque nunca era classificado** (`sem_ataque`).
Corrigido para aceitar presença (`!= null`, cobre também um `true` de outra
implementação). Com a correção: `["close_group","ban_user","open_group"]`.

**Por que os testes não pegaram**: eles forneciam `selectiveDistribution: true`
— forma que **só existia nos testes**. Mesmo erro de método do bug do `require`
em ESM. **Todos os literais foram trocados pela forma real do fork** (objeto com
`kind: 'selective-distribution'`), em 5 suítes. Verificado que os testes novos
**reprovam** o adaptador antigo: **39 ok | 10 falhas**.

### 2) Rajada repetia o ciclo inteiro
O núcleo tem a guarda `alreadyPunished`, mas o adaptador **nunca enviava o
campo** — cada mensagem da rajada era um caso novo. Medido: **3 mensagens = 3
ciclos** fechar/banir/reabrir. Agora o adaptador mantém a marca por grupo+autor
(`PUNISH_WINDOW_MS = 8s`, espelhando a `GHOST_PUNISH_WINDOW_MS` da Lizzy) e a
informa ao servidor; quem decide continua sendo o núcleo. Só marca quando um
`ban_user` **realmente saiu** (socket recusou → tenta de novo). Medido depois:
**0 ciclos extras**.

### 3) `botIsAdmin` indefinido quando o metadata usa LID
`consultarAdministracao` comparava o bot com `sock.user.id` (PN) **ou** o LID,
via `||` — então um metadata que lista o bot só por LID, sem `phoneNumber`,
não casava: `botIsAdmin` saía `undefined`, o núcleo recusava com `bot_sem_poder`
e **nada acontecia, sem aviso**. Agora PN e LID viram um conjunto e o resultado
é **booleano definido** (JSON não transporta `undefined`). Quando o bot não é
achado na lista, sai **um aviso no terminal** (uma vez por processo) com as
identidades tentadas — o "ativei mas não bane" passa a ser diagnosticável.

### 4) Pagamento zerado encapsulado em view once
O raja chega envolvido (`viewOnceMessageV2`/`viewOnceMessage`/…). Sem
desembrulhar, o adaptador não enxergava a nota e o motivo `pagamento_zerado`
era inalcançável pelo cliente. Agora `desembrulharConteudo()` percorre os
invólucros (teto de 4 saltos) antes de relatar o valor cru.

### 5) Falha de ação engolida em silêncio
O `catch {}` do laço de ações virou `console.error` com o nome da ação: a
sequência continua (o grupo não fica fechado por um erro no meio), mas a razão
aparece no terminal do usuário.

### Cobertura nova (`tests/antifantasma-usuario.test.js`: 49 asserções)
Forma real do fork atravessando adaptador → API → núcleo; rajada com UM ciclo;
bot achado pelo LID quando o socket expõe o PN; pagamento zerado em view once.
**Suítes**: usuario 49/49, anti-seletiva 32/32, instalacao-limpa 20/20,
autossuficiente 14/14, esm-replica 10/10, cjs-replica 5/5, plugin 21/154,
entrega 19/19, ghost-manager 37/154, seturlghost 13/87, public-url 27/27,
defensive-protection 54/180.

## PLUGIN REMOTO "!antifantasma" — núcleo privado no servidor, adaptador no cliente ✅
Pedido do dono: um plugin remoto em que o **código real** do AntiFantasma fica no
servidor da Lizzy e o usuário recebe **só um adaptador**. O usuário personaliza
livremente a case e os comandos de ligar/desligar no `Index.js` dele.

### Estrutura
- **Servidor (privado, na Lizzy)** — `dados/src/antifantasma/`:
  - `core.js` — o **núcleo real**: guardas, classificação do ataque e a decisão
    das ações. Puro (sem I/O), testável direto. **Nunca é servido nem entregue.**
  - `api.js` — servidor HTTP (`node:http` nativo, **zero dependência nova**):
    valida a KEY, chama o núcleo e devolve **só a ação abstrata**. Persiste as
    KEYs em `dados/database/antifantasma/keys.json` (escrita atômica com tmp
    único). Tem `criarKey()`, `revogarKey()`, `validarKey()` e
    `processarRequisicao()` (testável sem abrir porta).
- **Cliente (entregável)** — `dados/src/antifantasma-cliente/antifantasma.cjs` (era `antifantasma.js`, renomeado na correção de proteção contínua):
  o **único** arquivo entregue ao usuário. CommonJS (`require('./antifantasma')`,
  como o pedido especifica), com estado local e as funções públicas.

### Vocabulário de ações (o cliente só EXECUTA, não decide)
`close_group` → `groupSettingUpdate(g, 'announcement')`
`ban_user`     → `groupParticipantsUpdate(g, [a], 'remove')`
`open_group`  → `groupSettingUpdate(g, 'not_announcement')`
A ordem (fechar → banir → reabrir) e o **quando** de cada uma ficam no `core.js`.

### Interface pública que o usuário vê
`executar({ sock, grupo, autor, contexto, reply })`, `ativar()`, `desativar()`,
`estaAtivo()` e `iniciar(sock)`. Os **nomes das cases são escolha do usuário** —
o plugin não impõe nenhum (`afon`/`afoff`/`seguranca`/qualquer coisa). O texto
das respostas também é livre.

### Separação de responsabilidades (o ponto central)
- **KEY** → autoriza o acesso à API. `validarKey` roda **no servidor**; nunca há
  `if (authorized)` no cliente, porque o usuário tem o próprio adaptador e
  poderia burlá-lo. KEY ausente/inexistente/de outro plugin/revogada → **403** e
  o **núcleo não executa**.
- **ativar/desativar** → controle **local**, do usuário. Desativado, o adaptador
  **nem faz a chamada** (testado).
- A KEY **não** liga/desliga o plugin — são eixos independentes, como pedido.

### Regra de ouro: a API nunca devolve código
A resposta carrega apenas `{ success, action, actions, notice }` — nada de
`code`, função, algoritmo, caminho de arquivo ou stack. Nenhum endpoint serve o
núcleo: `/core.js`, `/api/antifantasma/source`, `/api/antifantasma/code` e
afins respondem **404** (testado por HTTP real). Só existe
`POST /api/antifantasma/exec`.

### Integração no bot
`connect.js` sobe a API **só quando `ANTIFANTASMA_PORT` está definida**, dentro de
try/catch — sem a env, nada muda e nenhuma porta abre. Env documentada no
`.env.example`.

### Detecção automática da URL HTTPS (set/2026) ✅
O administrador **não precisa** descobrir/digitar a URL pública: o bot detecta o
domínio da plataforma sozinho.

#### Mapeamento PORTA → subdomínio (medido e comprovado)
Neste runtime as variáveis `WORKER_1=12000` e `WORKER_2=12001` são **portas
publicadas**, e cada uma responde num subdomínio próprio:

```
12000 -> https://work-1-<host>
12001 -> https://work-2-<host>
```

**Comprovado empiricamente**: subi um servidor na 12000 e `https://work-1-<host>/`
devolveu **200** com o corpo do servidor; derrubando o servidor, voltou **502**
(ou seja: o proxy→porta existe e é específico daquela porta). Portas fora dessa
lista **não têm subdomínio** — nelas a única URL válida é a base do runtime.

**Por isso a detecção sabe a PORTA.** Sem essa ligação, uma API ouvindo na 12001
seria anunciada com a URL da 12000, e o adaptador do usuário falaria com o
serviço errado.

- `portasPublicadas(env)` → `[12000, 12001]` (lê `WORKER_1`/`WORKER_2`)
- `escolherPorta(env)` → `ANTIFANTASMA_PORT` se definida; senão a **primeira porta
  publicada**. É a escolha que faz o "detectar sozinho" funcionar de verdade:
  nelas existe subdomínio HTTPS alcançável de fora.
- `detectarUrlPublica(env, { porta })` → resolve o subdomínio daquela porta.
- `portaEmUso()` (na `api.js`) → a porta REAL em que o servidor subiu. O
  `!ghostcmd` e o `!addghostcmd` usam ela (não a env), para não montar a URL da
  porta errada. É zerada quando o servidor fecha.

#### Resultado: tudo automático, ponta a ponta
- `connect.js` chama `iniciarApi()` **sem argumento** → a API escolhe a porta
  publicada sozinha e detecta a URL correspondente.
- `!addghostcmd` entrega o `antifantasma.js` **já preenchido** com a URL real
  (`work-1`), a key e o botId — verificado: `API_URL` saiu com `work-1-<host>`,
  sem o placeholder `api.exemplo.com`.
- Health respondido pela URL pública real: `{"ok":true,"tipo":"online"}`.
- Boot real mostra:
  ```
  [ANTIFANTASMA] API ouvindo na porta 12000
  🔐 AntiFantasma (plugin remoto)
     URL pública: https://work-1-<host>
     Porta da API: 12000
     Endpoint:    https://work-1-<host>/api/antifantasma/exec
  ```
- `ANTIFANTASMA_PORT` continua sendo o override — se definida, ganha (e a URL
  passa a ser a base, já que a porta deixa de ser uma das publicadas).

#### Suporte a Pterodactyl / Bronxys (set/2026) ✅
O host do dono é **Bronxys, que usa Pterodactyl**. O diagnóstico do próprio
comando mostrou o ambiente:

```
RUNTIME_URL: ausente      RUNTIME_ID: ausente
HOSTNAME: 7e9f4503-...    (UUID do container — não tem domínio)
Portas publicadas: nenhuma
```

**Por que nenhuma detecção anterior funcionava**: o Pterodactyl é
arquiteturalmente diferente das outras plataformas — ele **não publica domínio**.
Entrega apenas a alocação (`SERVER_IP` + `SERVER_PORT`), sem TLS. Não há
`RUNTIME_URL`, `WORKER_*`, nem hostname com domínio. Não era caso de "definir a
env": era plataforma não suportada.

**Implementado** (`urlDoPterodactyl`):
- Monta `http://<SERVER_IP>:<SERVER_PORT>` — o endereço real da alocação.
- **Exige os dois dados.** Só o IP não basta: sem a porta a URL não leva a lugar
  nenhum, e inventar porta daria endereço errado → devolve `null`.
- Porta **80** dispensa sufixo; porta **443** pressupõe TLS, então o esquema é
  `https` (usar `http` falaria com um listener TLS e morreria).
- **Não passa por `normalizar()`** de propósito: aquela função força `https` em
  host público, o que quebraria o acesso (não há TLS nessa porta).
- `escolherPorta` reconhece `SERVER_PORT` — é exatamente onde a API deve ouvir,
  já que a porta é publicada pelo painel.
- **Precedência**: Pterodactyl vem **antes** do runtime. Se o runtime ganhasse
  primeiro, a porta do painel acabaria colada numa URL `https://<runtime>` —
  endereço inexistente (bug pego em teste).
- `ANTIFANTASMA_PUBLIC_URL` continua vencendo tudo, para quem tem domínio próprio
  com TLS.

**Diagnóstico** agora lista também `SERVER_IP` e `SERVER_PORT`.

Testes: `public-url` **27/27** (novos: IP+porta, porta 80/443, exige os dois
dados, valores inválidos, `escolherPorta`, override, e a precedência sem mistura).

#### Correção: "não consegui detectar a URL pública" (set/2026) ✅
Sintoma relatado pelo dono no uso real. Duas causas, ambas corrigidas:

1. **A detecção dependia só de `RUNTIME_URL`.** Se essa variável não estiver no
   ambiente do bot, a URL saía `null` e o comando recusava. Agora o host é
   reconstruído por **três caminhos**, em ordem:
   - `RUNTIME_URL` (caminho direto);
   - `RUNTIME_ID` → `<id>.prod-runtime.all-hands.dev`;
   - `HOSTNAME` → `runtime-<id>-<hash>-<sufixo>` → `<id>.prod-runtime.all-hands.dev`
     (verificado: neste ambiente `HOSTNAME` e `RUNTIME_URL` dão o mesmo id).
   `HOSTNAME` fora do padrão **não** inventa host (devolve `null`), para não
   gerar URL falsa.

2. **Com a API caída, a URL perdia o subdomínio.** `ghostPortaAtiva()` usava
   `portaEmUso() || ANTIFANTASMA_PORT` e, sem a env, virava `0` → a detecção
   caía na **base** (sem `work-1`), que não é alcançável de fora. Agora, quando
   não há porta em uso, o fallback é `escolherPorta()` — a **porta publicada** do
   runtime. Assim o endereço entregue ao usuário continua sendo o `work-1`.

**Mensagem de erro agora diagnostica**: quando ainda assim não der para detectar,
o comando lista o que o bot **enxerga** (`RUNTIME_URL`/`RUNTIME_ID`/`HOSTNAME`
presentes ou ausentes, portas publicadas, porta em uso) — sem expor nada
sensível. Isso separa "falta definir a env" de "ambiente sem domínio".

Testes: `public-url` **22/22** (novos: fallback por `RUNTIME_ID`/`HOSTNAME`,
`HOSTNAME` fora do padrão → `null`, e a URL mantendo o subdomínio com a API
caída).

#### Demais fontes (inalterado)

- Módulo novo **`dados/src/utils/publicUrl.js`** (puro: recebe o `env` por
  parâmetro, então cada plataforma é testável sem tocar no processo):
  `detectarUrlPublica()`, `portaConfigurada()`, `endpointAntiFantasma()` e
  `resumoParaLog()`.
- **Fontes consultadas** (a primeira que existir vence):
  `ANTIFANTASMA_PUBLIC_URL` / `PUBLIC_URL` (override do admin) → `RUNTIME_URL`
  (**este ambiente**, já vem com esquema) → Render → Railway → Vercel → Koyeb →
  Fly → Heroku → Azure → Codespaces → `PUBLIC_HOSTNAME`/`DOMAIN`.
- **Normalização**: sem esquema assume `https://`; **`http://` em host público
  vira `https://`** (a KEY não pode trafegar em claro); `http://` é mantido só em
  `localhost`/`127.0.0.1` para desenvolvimento; barra final removida para não
  gerar `//` no endpoint.
- **Log no início do bot** (`dados/src/.scripts/start.js`, logo após o IP do
  servidor, então aparece também a cada reset):
  ```
  🔐 AntiFantasma (plugin remoto)
     URL pública: https://<host detectado>
     Porta da API: 8080
     Endpoint:    https://<host>/api/antifantasma/exec
  ```
  O log só aparece quando há algo a mostrar (URL detectada **ou** porta
  configurada) — num bot que não usa a API, o boot não ganha ruído. Quando não
  detecta, orienta a definir `ANTIFANTASMA_PUBLIC_URL`.
- `iniciarApi()` também loga a URL/endpoint ao subir. `endpointPublico()` expõe o
  valor para quem quiser consumir.
- Nada disso é específico do AntiFantasma: serve para qualquer endpoint público.

### Testes — `tests/antifantasma-plugin.test.js` (20 testes / 143 asserções)
Núcleo (as 3 ações; guardas: não-grupo, mensagem própria, bot sem poder, autor
desconhecido/privilegiado/whitelisted/já punido; os dois sinais exigidos juntos
para não dar falso positivo; entrada inválida não quebra), API (KEY válida/
inválida/ausente/revogada/de outro plugin; não executa o núcleo sem KEY válida;
sem ataque devolve sucesso sem ação) e **o teste de vazamento**: varre as
respostas e o HTTP real proibindo `function`, `=>`, `require(`, `core.js`,
`dados/`, `selectiveDistribution`, `decidir(`, `stack` etc. — e confirma que o
arquivo entregue **não contém** nenhum critério de decisão.
- **Bug corrigido durante os testes**: `iniciarApi(0)` retornava `null` porque a
  checagem era por falsy (`!port`) — e `0` é porta efêmera **válida**. Agora a
  checagem distingue "sem argumento" (exige env válida) de "argumento 0" (porta
  efêmera, usada nos testes).
- **Armadilha do entregável**: o repo é ESM (`"type": "module"`), então
  `module.exports` num `.js` lança. O adaptador é CommonJS porque é o que o
  `require()` do bot do usuário espera; no teste ele é materializado como `.cjs`.
  Se o bot do usuário for ESM, o arquivo só precisa ser renomeado para `.cjs`.
- **Armadilha de versão**: `dist/` está no `.gitignore`, então o entregável
  ficaria fora do git. Ele mora em `dados/src/antifantasma-cliente/`.

### Escopo deliberadamente pequeno
Nada de marketplace, catálogo, registry, heartbeat, sistema genérico de
permissões, loja ou dashboard. Só o AntiFantasma: `core.js` + `api.js` no
servidor, `antifantasma.js` no cliente.

## COMANDO `!antimidia` (era `!antifoton`) — apaga foto E vídeo ✅
- **O que faz**: apaga fotos e vídeos **normais** enviados por quem não é
  admin/dono. **Visualização única é isenta de propósito** — o objetivo é
  justamente forçar o envio como view once.
- **Renomeado**: `!antifoton` → `!antimidia` (com `!antimidias` como alias).
  O nome antigo **continua funcionando** para não quebrar o hábito nem scripts.
- **BUG CORRIGIDO na detecção**: a condição checava `type === 'imageMessage'`
  (só foto). Agora cobre `isImage || isVideo`. Detalhe que exigiu cuidado: a
  checagem de view once usa o **envelope cru** (`info.message`) via
  `isViewOnce()`, porque `type` de um view once também é
  `'imageMessage'`/`'videoMessage'` — se filtrasse por `type`, o comando
  apagaria justamente o que ele existe para permitir.
- **Retrocompatibilidade da flag salva**: grupos que já tinham ligado o recurso
  guardaram `antifoton: true` no JSON. O código lê
  `groupData.antimidia ?? groupData.antifoton`, e o comando grava na chave nova
  e **apaga a antiga** (para não sobrar valor velho que o fallback leria).
  O painel de antis (`!configs`) também consulta a chave legada — sem isso um
  grupo configurado antes apareceria como desativado.
- **Onde mexe**: `index.js` (flag `isAntiMidia`, bloco de apagar, `case` do
  comando, lista do painel) e `menus/menuadm.js`.
- **Testes**: `tests/antimidia.test.js` — 14 testes / 29 asserções: toggle e
  persistência, só grupo/só admin, alias antigo, flag antiga ainda ativa, foto e
  **vídeo** apagados, view once (foto e vídeo) preservado, admin/dono
  preservados, texto intacto, desligado/sem config não apaga, menu e painel.
  Verificado revertendo a detecção para só-imagem: o teste de vídeo falha.
- **Armadilha dos testes**: o `sender` precisa **existir no metadata do grupo**
  (senão o handler nega por não ser admin) e o metadata é **cacheado por grupo**
  (TTL 10s) — usar o mesmo ADMIN_LID com grupo novo a cada execução.

## VISUALIZAÇÃO de mídia encapsulada (View Once / efêmera) ✅
- **Sintoma**: comandos como `!s`, `!pv` e `!revelar` enviavam a mídia, mas ao
  carregar o WhatsApp mostrava **"não foi possível baixar a mídia"** (ou o
  comando dizia que não havia mídia).
- **Eram DOIS bugs distintos:**
  1. **Caminho errado do ViewOnceV2.** A mídia vive em
     `viewOnceMessageV2.message.imageMessage`. Vários comandos liam
     `viewOnceMessageV2.imageMessage` — **faltando `.message`** — e nunca
     achavam nada (`viewOnceMessageV2.imageMessage` é `undefined`). O `!pv`
     tinha esse bug em imagem e vídeo, e sempre caía no "Não foi possível obter
     a mídia".
  2. **Enviar a URL do CDN em vez do buffer.** O que está na URL do WhatsApp é
     conteúdo **cifrado**. Ao receber `{ image: { url } }`, o Baileys faz um
     fetch cru (`getStream` → `remote`) e reenvia aqueles bytes como se fossem a
     mídia: o destinatário recebia um arquivo ilegível. Era o `!revelar`, que
     fazia `px.image = { url: px.url }` e mandava isso. O certo é baixar aqui
     com `getFileBuffer` (que usa `downloadContentFromMessage` com a `mediaKey`)
     e enviar o **buffer já descriptografado**.
- **Módulo**: `dados/src/utils/viewOnce.js` — resolvedor puro (sem Baileys, dá
  para testar sem socket):
  - `extractMedia(content)` / `resolveMedia([...])`: descascam **qualquer**
    cadeia de encapsulamento, em qualquer profundidade;
  - `isViewOnce()`, `mediaTypeLabel()`, `describeMediaError()`.
- **Armadilha da detecção de wrapper**: `viewOnceMessageV2` e
  `viewOnceMessageV2Extension` **não terminam em "Message"** (terminam em "V2" /
  "V2Extension"). Uma detecção por sufixo `*Message` os ignoraria — foi uma
  versão inicial do próprio resolvedor que caiu nisso. Hoje a escolha da chave é
  por **lista explícita em ordem de prioridade** (mídia → wrappers → conversa →
  fallback genérico). A ordem importa: `messageContextInfo` acompanha quase toda
  mensagem e também contém "Message" no nome.
- **Formas cobertas**: mídia direta, `viewOnceMessage` (V1),
  `viewOnceMessageV2`, `viewOnceMessageV2Extension`, `ephemeralMessage` (grupo
  com mensagens temporárias) — inclusive **aninhado**
  (`ephemeral > viewOnceV2 > mídia`) —, `documentWithCaptionMessage`,
  `ptvMessage` (nota de vídeo) e `stickerMessage`/`audioMessage`/`documentMessage`.
- **Comandos corrigidos**: `!revelar` (passou a baixar e enviar buffer),
  `!pv` (passou a resolver certo e ganhou documento/`ptv`),
  `!s`/`!st`/`!sticker` e `!st2`/`!sticker2`/`!s2` (usavam a cadeia na mão), e o
  `getMediaInfo` compartilhado (que não enxergava V2Extension nem efêmera).
- **Vazamento de temporários corrigido (achado pelos testes do `!s`)**:
  `dados/src/funcs/utils/sticker.js` removia o arquivo de entrada
  (`database/tmp/...`) só no caminho feliz. Se o ffmpeg falhasse — ou **não
  estivesse instalado** — o órfão ficava para sempre, um por tentativa. Agora o
  corpo da conversão fica dentro de `try { ... } finally { unlink }`.
- **Testes**: `tests/viewonce-v2.test.js` — 16 testes / 59 asserções. O teste
  **não se contenta em ver "enviou algo"**: ele **cifra uma mídia de verdade**
  (hkdf + AES-256-CBC, o mesmo formato do WhatsApp), serve por HTTP local e
  confere que o comando entrega o **buffer original descriptografado**. Cobre o
  resolvedor (12 formas de encapsulamento), `!revelar` (V1/V2/V2Extension/
  efêmera), `!s`, `!pv` e o vazamento de temporários.
  Verificado revertendo os fixes: **11 asserções falham** com o comportamento
  antigo (URL cifrada e caminho sem `.message`), e o teste de temporários
  detecta o vazamento (1 → 2 arquivos).

## VARIÁVEL `{cmdSm}` — comando mais parecido (!configcmdnotfound) ✅
- **O que é**: nova variável da mensagem de comando não encontrado. Mostra o
  **comando mais parecido** com o que o usuário digitou — ex.: `!pingg` sugere
  `!ping`. Mesmo padrão das outras (`{command}`, `{prefix}`, `{user}`,
  `{botName}`, `{userName}`).
- **Uso**: `!configcmdnotfound set O comando {command} não existe! Você quis
  dizer {cmdSm}?` → o que o usuário vê é *"O comando pingg não existe! Você quis
  dizer !ping?"*.
- **Sem sugestão razoável, cai no menu** (`{prefix}menu`) — a variável nunca fica
  vazia nem deixa o texto com buraco (ex.: "Você quis dizer ?").
- **Módulo**: `dados/src/utils/commandSuggest.js` — `getAllBotCommands()`,
  `levenshtein()`, `findClosestCommand()`, `buildCmdNotFoundExtras()`.
- **De onde vem a lista de comandos**: do **próprio `index.js`**, pelos
  `case '...':` do switch principal, que ficam com **6 espaços de indentação**.
  Isso exclui os subcomandos (ex.: `set`/`style`/`preview` do
  `configcmdnotfound`), que têm indentação maior — sem esse filtro, digitar
  `!set` sugeriria `set` como comando válido, e não é. ~1841 comandos, lidos uma
  vez e cacheados (o arquivo tem ~1.9 MB).
- **Critério da sugestão**: prefere o comando que **contém** o texto digitado
  (ou é contido por ele); depois decide por distância de Levenshtein, com teto
  proporcional ao tamanho da palavra. Empate desempata pelo nome mais curto.
  Entrada sem nada parecido devolve `null` (→ menu).
- **Ponto de integração**: no `default:` do switch (comando não encontrado), as
  variáveis extras entram via `...buildCmdNotFoundExtras(commandName,
  groupPrefix)`. O `preview` usa o mesmo helper (com `exemplo`), então a
  pré-visualização mostra a variável resolvida de verdade.
- **Whitelist**: `validateMessageTemplate` (em `utils/database.js`) precisa
  aceitar `{cmdSm}`, senão o `!configcmdnotfound set` **rejeita** o template e a
  mensagem cai no fallback. Também foi adicionada aos defaults de
  `loadCmdNotFoundConfig` e ao `reset`.
- **Armadilha dos testes**: o handler limita **3 comandos/5s por sender**.
  Enviar vários comandos errados com o mesmo sender faz o 4º responder
  *"Calma aí!"* e o teste mede a coisa errada — o helper `enviar()` troca de
  sender a cada chamada (mesma armadilha do `!testcall`).
- **Testes**: `tests/cmd-suggest.test.js` — 21 testes / 68 asserções: helper
  (erro de digitação, lixo sem sugestão, entrada vazia, normalização,
  subcomando excluído, cache, Levenshtein), template (aceita `{cmdSm}`, rejeita
  variável inventada, substituição) e o **fluxo real** pelo handler (sugestão
  aparece, cai no menu sem sugestão, convive com as outras variáveis, mensagem
  antiga sem `{cmdSm}` continua igual). Verificado removendo `{cmdSm}` da
  whitelist: **6 asserções falham**.

## MÍDIAS dos comandos de brincadeira — pasta `dados/src/gifsbn/` ✅
- **Pasta**: `dados/src/gifsbn/` (criada; tem `.gitkeep`). É onde ficam TODAS as
  mídias (GIF/vídeo/imagem) dos comandos de brincadeira.
- **Duas formas de definir a mídia de um comando:**
  1. `!setgif <comando>` (respondendo uma mídia) — grava
     `gifsbn/<comando>.<ext>` e registra `./gifsbn/<comando>.<ext>` no
     `games.json` (`games2`).
  2. **Arquivo solto na pasta** com o nome do comando — ex.: `gifsbn/tapar.gif`
     faz o `!tapar` usar aquele arquivo, **sem rodar nenhum comando**. É o
     requisito que motivou a mudança.
- **Prioridade**: o arquivo solto **vence** o `games.json`. Trocar o arquivo na
  pasta é suficiente para trocar a mídia do comando.
- **Extensões aceitas** (ordem de busca em `MEDIA_EXTS`): `gif, mp4, webm, mov,
  jpg, jpeg, png, webp`. GIF primeiro por ser o uso mais comum. Vídeo recebe
  `gifPlayback: true`; imagem vai como imagem.
- **Módulo**: `dados/src/funcs/utils/gifsbn.js` — `findGifsbnMedia`,
  `buildMediaFromFile`, `saveGifsbnMedia`, `resolveBrincadeiraMedia`,
  `resolveMediaUrl`. O `index.js` só chama; a regra fica no módulo (testável).
- **`saveGifsbnMedia` apaga outras extensões do mesmo comando** antes de gravar.
  Sem isso, um `tapar.gif` antigo continuaria na pasta e, como o arquivo solto
  tem prioridade, venceria o `tapar.mp4` recém-definido pelo `!setgif`.
- **Caminho no `games.json`**: é relativo à pasta `dados/src`
  (`./gifsbn/<cmd>.<ext>`). Quem resolve é `resolveMediaUrl(url, __dirname)`, que
  trata qualquer caminho `./` como relativo a `dados/src` — por isso os caminhos
  antigos (`./midias/...`, `./database/gifs/...`) **continuam funcionando**
  (retrocompatível com quem já tem mídia registrada).
- **Consumidores ajustados**: comandos de brincadeira (`games2[command]`),
  surubão (`games2['surubao']`) e compatibilidade (`games2['compatibilidade']`).
  Os demais leitores de `games.json` (`games`, `ranks`) não usam a pasta.
- **Bug pré-existente visto de passagem (NÃO corrigido)**: em
  `index.js`, `gamesData.games2['compatibilidade', 'rankputo', 'rankputa',
  'rankpauzudo', 'rankbucetuda']` — o operador vírgula faz isso ser avaliado
  como só `games2['rankbucetuda']`, então o fallback do games.json para
  `compatibilidade` nunca acha a mídia de `compatibilidade`. O caminho novo
  (arquivo `gifsbn/compatibilidade.gif`) funciona; o antigo segue sem efeito.
- **Testes**: `tests/gifsbn-media.test.js` — 16 testes / 61 asserções: helper
  (extensões, prioridade, troca de extensão, caminho relativo, nome perigoso
  `../` e extensão inválida), **handler real** enviando `gifsbn/tapar.gif` e
  `gifsbn/beijo.jpg` sem passar pelo `!setgif`, fallback para texto quando não há
  mídia, e verificação da ligação do `!setgif`. Verificado revertendo: sem o
  fallback, **5 asserções falham** nos testes do requisito.

## BLACKLIST por número (!addblacklist / !delblacklist / !listblacklist) ✅
- **BUG CORRIGIDO**: `!addblacklist 5511999999999` não salvava nada — respondia
  a mensagem de uso. Em grupo, **`participant.id` é o LID**
  (ex.: `111000000000001@lid`) e o **número real fica em `phoneNumber`** (às
  vezes `pn`). A busca era `p.id === "<numero>@s.whatsapp.net"`, que **nunca
  casa**, então `targetUsers` ficava vazio e o comando caía no early-return.
  A menção sempre funcionou (o `menc_os2` já vem como LID).
- **Helper**: `findParticipantByNumber(participants, number)` em
  `utils/helpers.js` — compara **só os dígitos** de `id`, `lid`, `phoneNumber` e
  `pn`, aceitando JID, LID, `:device`, número cru e formatado
  (`+55 11 99999-9999`). Usar esse helper sempre que precisar casar
  número ↔ participante de grupo (o padrão certo já existia solto no
  `index.js` ~28458, que considera `id`/`lid`/`phoneNumber`).
- **`addblacklist`**: se o número está no grupo, salva pelo **LID** (chave usada
  no resto do sistema); se não está, salva o JID do número (vale se a pessoa
  entrar depois).
- **`delblacklist`**: resolve o número para **todos** os candidatos (LID + JID)
  e os trata como **uma pessoa só** — se a entrada existia como LID, remover por
  número não deve também reportar "não estava" pelo JID. As menções foram
  normalizadas para `[[id]]` para casar com esse formato agrupado.
- **Armadilha do nome**: `!blacklist` é **alias de `!addblacklist`**; a listagem
  é `!listblacklist` (`menus/menuadm.js`: `addblacklist`, `delblacklist`,
  `listblacklist`).
- **Armadilha dos testes**: `getCachedGroupMetadata()` cacheia o metadata por
  grupo com **TTL de 10s**. Reusar o mesmo grupo entre comandos devolve o admin
  anterior e o comando responde *"Você precisa ser admin"* — por isso cada
  comando precisa de um **grupo novo** (mesma armadilha já documentada no
  `!testcall`).
- **Testes**: `tests/blacklist-number.test.js` — 12 testes / 38 asserções,
  handler real com socket falso (participants com `id`=LID + `phoneNumber`):
  helper, add por número (dentro/fora do grupo), com motivo, del por número
  (entrada como LID, como JID, e as duas juntas), listagem e regressão de
  menção. Verificado revertendo o fix: **11 asserções falham**.

## COMANDOS `!dono` e `!criador` — catálogo (foto real) + card de perfil comercial ✅
Pedido do dono: substituir o `!dono` por **um catálogo único com a foto real do
dono** seguido do **card de perfil comercial** do número setado em `numerodono`.
Ordem explícita: **catálogo primeiro, card abaixo**. Depois o mesmo layout foi
pedido para o `!criador`.

### Helper compartilhado (os dois comandos)
`enviarCardsDoPerfil(sock, chatId, { numero, nome, lid, bioFallback, cargo, tag })`
(idle no fim do `index.js`, ao lado de `sendInteractiveMessage`) monta e envia os
dois cards. **Os dois comandos chamam o mesmo helper** — o formato vive num lugar
só, então a próxima mudança de layout vale para ambos sem risco de divergirem
(antes seriam ~90 linhas duplicadas).

O que muda por comando são os parâmetros:
- `!dono`: `cargo: 'Dono do bot'`, bio padrão `👑 Dono do <bot>…`, `tag: 'DONO'`.
- `!criador`: `cargo: 'Criador do bot'`, bio padrão `👨‍💻 Criador do <bot>…`,
  `tag: 'CRIADOR'`.

Cada um mantém o **texto de fallback** próprio (`DONO DO BOT` / `CRIADOR`): se
nem o catálogo nem o card saírem, o texto de sempre é enviado — o comando nunca
fica mudo.

### A foto é do DONO REAL, sempre atual
`nazu.profilePictureUrl(jid, 'image')` é chamado **na hora de cada comando** —
nada é gravado em disco nem cacheado. Se o perfil troca a foto, o próximo `!dono`
já traz a nova. Testado: trocar a URL entre chamadas muda a imagem do catálogo.

O JID é resolvido por `numerodono` (`<numero>@s.whatsapp.net`) e, se a config
tiver `lidowner`, as duas formas são tentadas — o dono pode estar endereçado por
LID.

### Robustez
- **Sem foto** (privacidade/"não tem foto") → o catálogo é omitido e o card sai
  normalmente: o comando **não fica mudo**.
- **Socket sem suporte** a catálogo/card → cai no **texto de sempre**
  (`DONO DO BOT` / `CRIADOR`), preservando o comportamento antigo como fallback.
- Falha de um dos envios vai para o log com `[DONO]`/`[CRIADOR] ...` (não engole em silêncio).

### Formato FINAL das duas mensagens (set/2026) ✅
Depois de mais uma rodada no aparelho, o formato ficou assim:

1. **Catálogo = card "compartilhado do perfil"**: a foto do dono com **um único
   botão "Ver"**, e **sem nenhum texto** (sem caption/footer/title). Vai como
   `interactiveMessage` com cabeçalho de imagem e botão **`cta_catalog`**.
   - **Armadilha medida**: `productMessage` com `catalog` (+ `product`) **não
     renderiza** para número comum — o app responde *"atualize o WhatsApp"*. O
     cartão de catálogo do WhatsApp exige **conta Business com catálogo no
     Commerce Manager**; sem isso nenhum payload de catálogo aparece. O caminho
     `interactiveMessage` + `cta_catalog` funciona sem essa exigência.
   - **Armadilha do texto vazio**: remover o `caption` **quebra** o card! É o
     `caption` que faz a fork criar o `header`; sem ele cai em
     `Object.assign(undefined, m)` → `Cannot convert undefined or null to
     object` e o catálogo nem é montado (o `try/catch` engolia). Medido:
     `{image, nativeFlow}` → ERRO; `{image, title, footer, nativeFlow}` → ERRO;
     `{image, caption: '', nativeFlow}` → OK. Por isso vai `caption: ''` (vazio
     de propósito: cria o header e não mostra texto).
2. **Card de perfil comercial** com nome, bio e "Conversar"/"Ver empresa". Os
   botões e o bloco de perfil saem dos campos do **vCard**:
   - `ORG` → "Ver empresa"
   - `TITLE` → cargo
   - `NOTE` → a **bio**
   - `waid` → faz o app reconhecer o número como conta WhatsApp e oferecer
     "Conversar"; sem ele vira *"Convidar para o WhatsApp"*.
   - `N`/`FN`/`URL` também vão.

   **A bio agora é o RECADO real do dono**, lido com `fetchStatus`, com queda
   para um texto montado quando ele não tem recado.
   - **Bug corrigido**: `fetchStatus` devolve uma **LISTA**
     (`[{ id, status, setAt }]`), não um objeto — ler `res?.status` no array dava
     sempre `undefined` e a bio real nunca apareceria.

   **Limite honesto**: "Ver empresa" só aparece se o número do dono for **conta
   Business**. Em conta pessoal, o botão não é oferecido por mais que o vCard
   tenha `ORG` — quem decide é o cliente do WhatsApp, não o payload.

**Sem `quoted`**: as duas mensagens saem soltas no grupo (o terceiro argumento do
`sendMessage` é omitido).

**Armadilha de edição**: o bloco vive dentro de um `switch` de 36k linhas. Numa
substituição por intervalo de linhas eu removi sem perceber (a) o `catch` do
card e (b) o bloco de fallback, e ainda troquei `nomedono` por `nomedo`
(`ReferenceError` só visível em runtime). Desde então: `node --check` **e** rodar
o teste do comando depois de qualquer splice.

### Testes — `tests/dono-perfil.test.js` (34 asserções)
Roda o **handler real** com socket falso: ordem catálogo→card, imagem + botão "Ver",
foto atual do dono, troca de foto reflete no catálogo (sem cache),
`businessOwnerJid`, vCard bem formado com `waid`/telefone, título/displayName =
nome do dono, ausência de foto ainda manda o card (e não o texto) e fallback de
texto quando nada sai.
- **Cego de propósito corrigido (seção 7)**: os primeiros testes usam socket
  **falso**, então provavam apenas a FORMA que o comando monta. Eles passavam
  **até com uma fork sem `catalog`** — mediam menos que o problema real. A seção
  7 leva o payload pelo `generateWAMessageContent` da fork instalada (com um JPEG
  local, porque o caminho novo lê a imagem) e exige `productMessage` com
  `catalog` + `contactMessage`. **Verificado**: com a fork antiga a suíte falha
  (`Invalid media type`); com a nova, 23/23.
- **Armadilha**: o handler tem **throttle de comandos por remetente** (3 por 5s).
  Reusar o mesmo autor entre cenários fazia o teste cair no anti-flood e medir a
  mensagem "calma aí" em vez do `!dono` — cada cenário usa um remetente próprio.
- **Armadilha 2**: a config vem de `CONFIG_FILE` (respeita `CONFIG_PATH` em
  `utils/paths.js`), não de `DATABASE_PATH`; sem setar `CONFIG_PATH` o handler lê
  a config real e o teste mede outra coisa.

### Suporte na fork (`Souzzaaxzy/baileys`, commit `aee4b24`)
O card de catálogo e o MPM exigiam suporte que **não existia**: `prepareProductMessage`
ignorava `catalog` e não havia ramo para o multi-produto. A fork ganhou
(`feat(business): Business Profile + Catálogo Business`):
- `ProductMessage.catalog` (`CatalogSnapshot`) montado no send path;
- MPM via `productList` → `listMessage` com `listType = PRODUCT_LIST` +
  `productListInfo` (no fio **não existe** `ProductListMessage`);
- `Utils/business.js` exportado na raiz + `getBusinessProfileV2`;
- suíte da fork: 123 testes / 0 falhas.

**Dependência**: o `package-lock.json` foi apontado para o commit novo
(`git+ssh://...#aee4b24`). Um `npm install` sem isso instala o commit antigo e o
`catalog` não funciona — foi o primeiro obstáculo.

### Suporte na fork — ROTAÇÃO: ROLLBACK EM FALHA + CONCORRÊNCIA (`commit 8d69c3b`) ✅
Auditoria do `!rajar` pedida pelo dono. Dois achados **medidos**, não hipótese:

1. **O rollback só rodava no caminho de SUCESSO.** Se a criptografia ou a
   distribuição falhasse (o que acontece **depois** de a rotação já ter anexado
   um estado), o estado rotacionado ficava **ATIVO**: o grupo continuaria
   cifrando com uma chave que só o subconjunto autorizado recebeu, e o
   `sender-key-memory` diria que os outros já a têm — então ninguém mais
   receberia o SKDM novo. **O grupo inteiro ficaria ilegível, exceto o alvo.**
   - **Medição**: com `encryptGroupMessage` forçado a lançar, o código ANTIGO
     fazia **ZERO rollbacks** e o estado rotacionado permanecia no store; com o
     fix, faz **exatamente UM** rollback e o estado base é restaurado.
   - **Correção**: a janela `rotate → encrypt → distribute → rollback` foi
     envolvida em **`try/finally`**, então o rollback roda no sucesso, no erro,
     na exceção, no timeout e na falha de transporte.
   - O `catch` do wrapper continua cobrindo o caso em que o bloco interno nem
     começou; os testes **contam chamadas** e provam que só um dos dois dispara
     (sem `pop()` duplo — que removeria o estado base).
2. **Concorrência**: as rotações do mesmo grupo agora são serializadas por um
   `makeKeyedMutex` (chave = grupo), para as janelas não se sobreporem. Uma
   sobreposição faria os dois `pop()` removerem o estado errado. Grupos
   diferentes seguem em paralelo, e um envio normal compartilha o mesmo mutex
   (não cifra com chave temporária).
   - **Escopo honesto**: NÃO consegui reproduzir um overlap no harness mesmo
     sem o mutex — os `await` da janela são, na sua maioria, nível microtask com
     sessões stubadas (em produção o `assertSessions` faz I/O real). O mutex é
     **defensivo**; o teste que o guarda (`does NOT let two rotation WINDOWS
     overlap`) é um **guarda de regressão**, não uma prova de falha.

**Testes novos na fork** (commit `8d69c3b`):
- `tests/sender-key-rotation-state-integrity.test.js` (**12**): rollback em falha
  de criptografia e de distribuição, **exatamente um** rollback, baseline
  preservado, envio normal depois de uma rotação falha, SKDM/sender-key id
  **distintos por mensagem**, e as invariantes de janela/no-overlap.
- `tests/sender-key-rotation-burst.test.js` (**6**): rajadas de **1/5/10/25/50**
  com **sessões Signal reais e decifragem real**. Mede: cada membro decifra cada
  mensagem protegida **pelo SKDM daquela mensagem**, o admin decifra **zero**,
  cada mensagem usa **seu próprio** sender-key id, e mensagens normais continuam
  decifrando na alternância `protegida → normal → protegida → normal`.
- Suíte completa da fork: **160/160**.

**Medições** (loopback local; limitam o custo da ROTAÇÃO, não a rede):

| rajada | stanzas | ids únicos | admin decifra | tempo | média/msg |
|---|---|---|---|---|---|
| 1 | 1 | 1 | 0 | 16,8 ms | 16,8 ms |
| 5 | 5 | 5 | 0 | 44,1 ms | 8,8 ms |
| 10 | 10 | 10 | 0 | 96,3 ms | 9,6 ms |
| 25 | 25 | 25 | 0 | 280,4 ms | 11,2 ms |
| 50 | 50 | 50 | 0 | 514,1 ms | 10,3 ms |

**Dependência**: `package-lock.json`/`yarn.lock` passaram a apontar para
`8d69c3bf56a78f9a8c668978e02f1113e28d2124`.

### Suporte na fork — CARROSSEL COM VÍDEO (`commit d3692c7`) ✅
O carrossel (`cards`) da fork só aceitava **imagem/produto** de forma confiável:
o vídeo ou estourava, ou era descartado em silêncio. Quatro correções, em
`lib/Utils/messages.js` (commit `d3692c7`,
`feat(carousel): support video cards (and fix 3 broken card paths)`):

1. **Vídeo com `ptv: true`** era recusado com *"Invalid media type for carousel
   card"*. O pipeline de mídia devolve `ptvMessage`, que
   `hasValidCarouselHeader` não conhecia. Novo helper **`resolveCarouselHeader`**
   (exportado) mapeia `ptvMessage` → `videoMessage`.
2. **Card de mídia SEM `caption`** estourava *"Cannot convert undefined or null
   to object"* no `Object.assign(carouselCard.header, ...)`: o header só era
   criado dentro do `if (caption)`. Agora o header é criado **sempre** que a
   mídia é válida (com ou sem legenda).
3. **Card sem `nativeFlow`** estourava *"Cannot read properties of undefined
   (reading 'buttons')"* em `prepareNativeFlowButtons`. Campo ausente agora é
   simplesmente "sem botões".
4. **Card com mídia e `text`** (em vez de `caption`) **perdia a mídia**: o ramo
   do `text` nem olhava o header. Agora anexa a mídia válida também.

- Carrossel **misto** (imagem + vídeo + imagem) preserva a mídia de cada card na
  ordem original. `gifPlayback`, `seconds`, `thumbnail`, `title` e `subtitle`
  são preservados nos cards de vídeo. `carouselCardType`/`messageVersion`
  continuam como antes (`UNKNOWN`/`1`).
- **Testes na fork**: `tests/carousel-video.test.js` — **19 testes**, rodando o
  caminho REAL (`generateWAMessageContent` + upload instrumentado) e conferindo
  o proto montado (inclusive `encode`/`decode`). **Baseline (código antigo):
  14 dos 19 falham**; com as correções, 19/19. Suíte completa da fork:
  **142/142**.
- **README da fork**: nova seção `#### 🎬 Carousel with Media (Image & Video)`
  (exemplo de card de vídeo, carrossel misto, opções por card `gifPlayback`/
  `ptv`/`seconds`/`thumbnail`/`title`/`subtitle` e a nota de que `caption` e
  `text` são equivalentes, e que card sem `nativeFlow` é válido). Entrou no
  Table of Contents e na seção "Messages Handling & Compatibility".
- **Nada disso exige mudança no `index.js`** da Lizzy: o comando `!pinterest`
  que monta `cards` continua igual; para usar vídeo, basta um card com
  `video: { url }` (a interface é a mesma do resto da lib).
- **Dependência**: o `package-lock.json`/`yarn.lock` passaram a apontar para
  `d3692c7ec2fa4a1fd28fdbc0cee0525b488476da`. Sem o commit novo, card de vídeo
  sem `caption`, com `ptv` ou sem `nativeFlow` quebra/desaparece.

## RELACIONAMENTOS múltiplos (!trisal / !quadrisal / !relacionamento) ✅
- Módulo: `dados/src/funcs/utils/relationships.js` (`RelationshipManager`).
  Comandos em `index.js` (~35523 trisal, ~35568 quadrisal, ~35613
  terminartrisal/terminarquadrisal, ~35653 relacionamento).
- **Aceitação (já funcionava)**: `createGroupRequest` guarda o pedido em
  `pendingGroupRequests` (por grupo) e cada alvo responde "sim". O
  relacionamento só é criado quando **todos** aceitam; um "não" cancela tudo.
- **BUG CORRIGIDO — `!relacionamento` não mostrava os parceiros.** A cadeia era:
  1. em multi, `getActivePairForUser().partnerId` era
     `otherUsers.join(',')` → **`"b@lid,c@lid"`, que não é um JID**;
  2. o handler passava isso como `userTwo` para `getRelationshipSummary`, que
     resolve o par pela **chave de duas pessoas** (`_getPairKey`);
  3. o trisal é gravado sob `"groupId::a::b::c"`, então a chave nunca casava e a
     resposta era *"Nenhum relacionamento ativo registrado entre essas pessoas"*.
  Correções: `partnerId` voltou a ser **um JID único** (o primeiro dos demais) e
  a lista completa ficou em `allPartners`; novo `_findRelationshipBetween()`
  acha o par 1-1 **ou** o múltiplo que contém as duas pessoas; novo
  `getRelationshipSummaryForUser()` (usado por `!relacionamento` sem menção) e
  `_buildSummaryMessage()` lista **todos** os participantes do trisal/quadrisal.
- **Isolamento por grupo**: `_createGroupRelationship` **não gravava
  `pair.groupId`** (só dentro de `stages`), então `getActivePairForUser(user,
  groupId)` casava direto e um trisal de **outro grupo** vazava. Agora
  `pair.groupId` é gravado e o escopo é respeitado em
  `getActivePairForUser`, `_findRelationshipBetween` e `getRelationshipSummary`.
- **Terminar/traição em multi**: `endRelationship` e `getBetrayalHistory` também
  usavam `_getPairKey` (quebravam em multi) — passaram a usar
  `_findRelationshipBetween`. `createBetrayalRequest` agora compara o alvo com
  **todos** os parceiros (`allPartners`): "trair" com membro do próprio
  trisal/quadrisal não é traição.
- `getActivePairForUser` tinha **duas definições** (a segunda sombreava a
  primeira); a duplicata foi removida.
- **Testes**: `tests/relationships-multi.test.js` — 16 testes / 59 asserções,
  rodando o **handler real** com socket falso: pedido, validações, aceite
  parcial/total, recusa, exibição dos 3/4 parceiros, isolamento entre grupos,
  término, traição e regressão do 1-1. **Armadilha**: em grupo, as menções
  chegam como **LID** (é o que o handler compara com o `sender`, também LID) —
  o fake que manda JID em `mentionedJid` faz tudo não casar.
  Verificado revertendo os fixes: **19 asserções falham** com o código antigo.

### O QUE A ACTION REALMENTE É (pesquisa + testes locais, set/2026) ✅
Pesquisa na internet + testes locais (`tests/testverify-what-it-does.test.js`,
**18 asserções**). A conclusão muda o entendimento do recurso.

**Há DOIS sistemas de "verified" no WhatsApp, e a action NÃO é o selo:**

| | **Selo** (OBA / Meta Verified) | **Esta action** |
|---|---|---|
| Domínio | business | E2E / identidade |
| Campos | `verifiedName`, `vnameCert`, `vlevel` | `verifiedIdentityKey`, `actionSeq` |
| Como se obtém | **verificação de negócio pela Meta** (documentação pública: exige notabilidade, 3–5 matérias de imprensa) | troca de chaves / key transparency |
| Escopo | a **conta** | a **conversa** |
| Identifica uma chave? | **não** | **sim** (`verifiedIdentityKey`) |
| Tem sequência de mudança? | **não** | **sim** (`actionSeq`) |

**Evidência local que sustenta isso** (não é opinião):
- `proto.BizIdentityInfo` (o selo) tem `vlevel`/`vnameCert` e **não** tem
  `verifiedIdentityKey` nem `actionSeq` — logo o selo não é uma mudança de chave;
- `MarkAsVerifiedAction` tem `userJidString` + `verifiedIdentityKey` + `actionSeq`
  — identifica **pessoa + chave + mudança**, que é a assinatura de verificação de
  identidade E2E;
- os campos da action **não** incluem `verifiedName`/`vnameCert` (o que o selo
  exigiria), e nenhum campo é de negócio.

**Pistas de nome (as mais fortes):** o bundle do WhatsApp Web tem
`PrefilledButtonType.VERIFIED_STATE_NON_ADMIN` e `VERIFIED_STATE_ADMIN` — "estado
de verificação da **conversa**". E existe o campo `identityVerification` em
`Conversation` (domínio de App State / metadata). Nada disso é selo de perfil.

**Corroboração externa (documentação pública):**
- **Key Transparency / AKD** (Meta, 2023): o cliente **verifica
  automaticamente** que a **identity key** do contato bate com o diretório
  auditável. A "tela de verificação" passa a mostrar o resultado **sozinha**.
  Isso explica exatamente um `verified` sobre **identidade**, com
  `verifiedIdentityKey` e uma **sequência** (`actionSeq`) de mudanças.
- O **selo** (OBA / Meta Verified) é outra coisa: verificação de negócio,
  concedida pela Meta — e **nenhum** campo da action expressa isso.

**DUAS conclusões práticas, e ambas importam:**

1. **É uma ação de ENTRADA (servidor → cliente).** No bundle do WhatsApp Web as
   **3 ocorrências** de `markAsVerifiedAction` são **só o schema**; não há
   **nenhum consumidor** (`markAsVerifiedAction(` = 0, `chat.markAsVerifiedAction`
   = 0). Quem processa é o **recebimento**. Não é uma ação que o cliente
   *origina* — então enviá-la de um bot não tem efeito esperado, porque a
   verificação é do **provedor** (a Meta consulta o AKD e notifica o cliente).
2. **Por isso o comando não pode "dar" verificação.** Um bot não verifica a
   chave de um contato *para o contato* — quem faz isso é o AKD do servidor.

**Estado:** o comando `!testverify` foi **REMOVIDO** (ver a nota de remoção
abaixo). O que a pesquisa acrescenta é o **mecanismo**: é verificação de
identidade E2E/key-transparency, e é **inbound** — por isso enviar do bot não tem
efeito esperado, e não faz sentido manter um comando que só confirma que a
stanza saiu. Não vou afirmar efeito sem medição em cliente real.

## COMANDO `!testverify` — REMOVIDO (set/2026) ❌
O comando existiu como **instrumento de observação** da `MarkAsVerifiedAction` e
foi **removido** quando a investigação concluiu o que a action é (ver
"O QUE A ACTION REALMENTE É", acima).

**Por que foi removido:** a action é **inbound** (servidor → cliente) e não tem
consumidor no cliente oficial para o caso de envio (as 3 ocorrências no bundle
do WhatsApp Web são só o schema; **0 usos**). Ou seja: enviá-la de um bot não
tem efeito esperado — a verificação de identidade é feita pelo **provedor**
(AKD/key transparency da Meta). Manter um comando que só confirma "a stanza
saiu" não agrega.

**O que ficou:**
- a **recepção** na fork (`lib/Utils/process-message.js`, case do tipo 36)
  continua: se uma action dessas **chegar**, ela é capturada e reportada via
  `chats.update` — isso é útil e não depende do comando.
- o **helper de envio** da fork (`lib/Utils/mark-as-verified.js`) continua
  disponível como API experimental, para quem quiser reproduzir o experimento
  por conta própria.
- `tests/testverify-what-it-does.test.js` (**18 asserções**) continua e **não
  depende do comando** — ele mede os FATOS do schema (os dois sistemas de
  verified, os campos, o caminho de entrega).

**Removido neste repositório:** a `case 'testverify'` (`index.js`), a categoria
**🧪 TESTES EXPERIMENTAIS** do `menudono` e `tests/testverify.test.js`.
Verificado: `grep testverify` em `dados/` → **0 ocorrências**.

## CLASSIFICAÇÃO CENTRAL do AntiFantasma (`classifyMessage.category`) ✅
O AntiFantasma decidia "é fantasma?" com um `if` solto lendo `info.message`.
Isso escondia dois problemas:

1. **O sinal está no `info`, não em `info.message`.** A fork anexa
   `selectiveDistribution` ao `fullMessage`, que **é** o `info` (o
   WebMessageInfo) — e numa mensagem fantasma `info.message` é `undefined` (o
   payload não decifrou). Ler só `info.message` **nunca** acharia nada.
2. O critério ficava espalhado, sem um ponto único para ajustar.

**Agora `classifyMessage` aceita DOIS níveis** — o conteúdo (`info.message`,
uso original) e o `info` inteiro — resolve qual é o conteúdo real e expõe uma
**categoria única**:

| Categoria | Quando |
|---|---|
| `PAYMENT_ZERO` | pagamento com valor zerado (`amount1000` ou `amount.value`) |
| `PROTECTED_DECRYPT_FAILURE` | sinal de distribuição seletiva **sem** payload decifrável |
| `PROTECTED_SELECTIVE` | sinal presente **e** havia conteúdo decifrado |
| `NORMAL` | todo o resto |

- **Compatibilidade**: `protectedSelective` é o MESMO booleano que o handler já
  lia de `info.selectiveDistribution` (aceita o **relatório**/objeto da fork e o
  booleano `true`), então nada que dependa dele quebra.
- O sinal é procurado **no `info` E no conteúdo**, então nenhum chamador precisa
  saber onde ele está.
- `hasDecryptedContent` olha o **conteúdo declarado**, não o objeto caído como
  fallback: sem isso "tem conteúdo" seria sempre verdadeiro e a
  `PROTECTED_DECRYPT_FAILURE` nunca seria classificada (bug encontrado pelo
  próprio teste).
- **Nunca deixa buraco**: entrada inválida (`null`/`undefined`/string/array)
  devolve `NORMAL` com todos os sinais em `false` — `undefined` faria o handler
  tratar lixo como ameaça.
- **`isProtectedSelective(info)`** (`index.js`, ao lado de
  `wasGhostPunished`) consome a classificação central, com fallback para a
  leitura antiga. Entrada inesperada → `false` (**não pune** na dúvida).

**Testes**: `tests/antifantasma-classificacao.test.js` — **18 asserções**:
categorias, localização do sinal (inclusive o teste que documenta que ler só
`info.message` não acharia), forma antiga (`true`), precedência de
`PAYMENT_ZERO`, pagamento legítimo (1500) que **não** vira ataque, e robustez
com lixo. Regressões: `anti-seletiva` **32/32**, `get-message-inspector`
**54/269**.

## COMANDO `!me` — perfil completo no novo layout (set/2026) ✅
- **Pedido do dono**: o `!me` deixou de ser "meu status" e passou a mostrar o
  **perfil** (nome, número, bio, tipo de conta, cargo) + **atividade** (no grupo
  e global). Aliases: `!me` e `!getperfil` (mesma case; `!perfil` continua sendo
  o OUTRO comando de RPG, não foi tocado).
- **Layout exato** (o que o dono pediu): cabeçalho `╭━━━〔 👤 PERFIL 〕━━━⬣`,
  os cinco campos (`📛 Nome`/`📱 Número`/`📝 Bio`/`⭐ Status`/`🏢 Conta`),
  `╭━━〔 📊 ATIVIDADE 〕` com os blocos `📌 Neste Grupo` e `🌐 Todos os Grupos`
  (mensagens/comandos/figurinhas), fechamento `╰━━━━━━━━━━━━━━━━⬣` e rodapé
  `${nomebot}  By  👑 ${nomedono}`.
- **Alvo** (o mesmo critério do trecho que o dono mandou): menção →
  número digitado → mensagem respondida → o próprio usuário. Ou seja, dá para
  consultar o perfil de um terceiro. Número fora de 10–15 dígitos e número
  inexistente (`onWhatsApp`) recusam com mensagem clara.
- **De onde vem cada campo**:
  - **Nome** — contatos da sessão (`nazu.store.contacts.notify/verifiedName`) →
    `participant.name/notify` do metadata → `pushName` (só do próprio usuário) →
    `+número`. **Nunca** devolve JID, LID nem número cru como nome (`isUsefulName`).
  - **Número** — PN do metadata (`phoneNumber`), senão o número digitado; alvo
    só-LID sem PN no metadata tenta `signalRepository.lidMapping.getPNForLID`.
  - **Bio** — o RECADO real via `fetchStatus` (**lista** `[{ id, status, setAt }]`,
    não objeto) → `Sem bio disponível`.
  - **Conta** — IQ público `w:biz` por `getBusinessProfileV2` (ou
    `getBusinessProfile` como fallback): perfil presente → `Business`, senão
    `Pessoal`.
  - **Status/cargo** — Dono (números/LID do config) → Subdono (`isSubdono`) →
    Admin (metadata ou `groupAdmins`) → Premium (`premiumListaZinha`; ela é
    chaveada por `from` **e** por usuário) → Membro.
- **Atividade casa por qualquer identidade do alvo** (LID, JID ou número):
  `matchesTarget` usa `idsMatch`, porque o contador pode estar gravado por JID e
  o alvo chegar por LID. O global varre todos os JSONs de `GRUPOS_DIR`.
- **`safeQuery` no topo da case**: foto/meta/número/bio/conta passam por um
  teto de tempo (Promise.race). Um servidor que aceita a conexão e não responde
  não pendura mais o handler — mesma armadilha documentada no `!enqueteimg`.
  Socket sem `fetchStatus`/`getBusinessProfileV2` (fork anterior) não quebra:
  cai no padrão.
- **Contrato preservado**: mesmo envio (`nazu.sendMessage(from, { text,
  contextInfo: newsletter })`), mesmo bloco de erro. Nada de sistema paralelo.
- **Testes**: `tests/me-profile.test.js` — **44 asserções**, rodando o **handler
  real** com socket falso: layout campo a campo, alvo por menção/resposta/número
  (e o número de quem digitou NÃO vaza), nome nunca sendo JID/LID/número,
  bio (recado/padrão/exceção), Business vs Pessoal (+exceção), cargos, atividade
  no grupo e global (isolando os arquivos com `limparGrupos()`), contador por
  JID casando com alvo em LID, zeros em vez de `undefined`/`NaN`, o alias
  `!getperfil` e socket sem os métodos de perfil.
  **Armadilha**: o throttle é por REMETENTE (3 comandos por 5s) — a suíte usa um
  remetente novo por chamada (`nextSender()`), senão do 4º comando em diante a
  resposta é "Calma aí!" e o teste mede a coisa errada.

## COMANDO `!pin` — aviso de busca que é apagado (set/2026) ✅
- Ao executar, manda **`🔎 Pesquisando Pin...`** (respondendo o comando) e
  **apaga essa mensagem** assim que o resultado chega — **inclusive no erro**
  (o `deleteSearchMsg()` roda no `catch` antes de repropagar). Só então envia o
  carrossel normal (ou a recusa).
- O aviso fica em `searchMsg` e é apagado por `nazu.sendMessage(from, { delete:
  searchMsg.key })` — a mesma técnica do `!play` (~19607) e do `/raja`.
- Guarda: se `sendMessage` do aviso falhar, o comando ainda tenta o carrossel.

## COMANDO `!tiktok` — carrossel de 5 vídeos na busca (set/2026) ✅
Pedido do dono: na **busca**, mandar `🔎 Procurando vídeos...`, apagar e enviar
um **carrossel com até 5 vídeos** encontrados — só isso.

- **Fluxo** (`index.js` ~20348, cases `tiktok`, `ttk`, `tkk`, `tiktoks`,
  `tiktoksearch`, `tiktokaudio`, `tiktokvideo`):
  1. reage 🔍 no comando;
  2. envia o aviso (`Procurando vídeo...` no link / `Procurando vídeos...` na
     busca — singular e plural para não mentir);
  3. resolve `tiktok.dl(q)` ou `tiktok.search(q)`;
  4. **apaga o aviso** (também no caminho de exceção);
  5. **busca** → monta o carrossel; **link** → mantém o download de sempre.
- **`tiktok.search` agora devolve até 5 vídeos** (`SEARCH_MAX_RESULTS`), não 3.
  Um card de carrossel **só aceita imagem/vídeo/produto**, então a busca
  **descarta slideshows de imagem** (`media.type === 'video'` obrigatório) e
  URLs mortas — por isso o card nunca fica inválido.
  - **Orçamento de tempo** (`SEARCH_BUDGET_MS = 25s`): as resoluções no tikwm são
    em série (respeitando o ~1 req/s do agregador), então a busca sempre termina,
    mesmo com muitos candidatos ruins.
  - **Cache de busca com TTL maior** (`SEARCH_CACHE_TTL = 6h`, contra 1h do
    `dl`): cada busca custa várias chamadas ao tikwm. `getCached` passou a
    aceitar `ttl` por chave.
- **Cards**: `{ video: { url }, caption: "N. título", title: "🎬 Vídeo N",
  subtitle: <autor>, footer: '🎵 TikTok', nativeFlow: [] }`. A busca usa a URL
  `play` (sem marca d'água) que o tikwm devolve — a mesma dos vídeos do fluxo
  antigo. `caption`/`title` existem porque o card precisa de um campo de texto.
- **Erros**: sem termo mantém a mensagem de uso (não manda aviso); nenhum vídeo
  → `❌ Nenhum vídeo encontrado. 😕` (sem carrossel vazio). Tudo com `try/await`
  em vez do `.then()` de antes — o handler não retorna mais antes da hora.
- **Dependência de fork**: o carrossel de vídeo exige o commit `d3692c7` da fork
  (ver "Suporte na fork — CARROSSEL COM VÍDEO"). Com o commit antigo, card de
  vídeo sem `caption`/com `ptv`/sem `nativeFlow` quebrava.
- **Testes**: `tests/pin-tiktok-carousel.test.js` — **40 asserções** rodando o
  **handler real** com `fetch` controlado (Bing e tikwm respondem roteiro
  local; nada de rede real). Cobre aviso enviado/apagado (sucesso e erro), ordem
  aviso→carrossel, 5 cards de vídeo, slideshow descartado, links `.mp4`, busca
  vazia, fluxo de link preservado (1 vídeo, sem carrossel) e a mensagem de uso.
  **Baseline (código antigo): 29 das 40 falham.**
- **Validação do payload**: a mesma forma de card passada pelo
  `generateWAMessageContent` da fork instalada vira **5 cards de vídeo** no
  proto (`header.videoMessage` + `hasMediaAttachment`), sobrevivendo ao
  `encode`/`decode`.
- **PENDENTE (não validado em aparelho real)**: o carrossel de vídeos
  *renderizar* no cliente. O que está provado é o payload/stanza.

## Comandos e fluxos relevantes
- Autodownload por URL: `handleAutoDownload(nazu, from, url, info)` em `index.js` (~linha 1789) detecta domínio e chama `youtube.mp3`, `tiktok.dl`, `igdl.dl`, `kwai.dl`, `facebook.downloadHD`, `pinterest.dl`, `spotify.download`, `soundcloud.download`.
- Imports diretos em `index.js` (não via exports.js): `spotifyModule` (linha 590), `removeBg/upscale` (589), `search/searchNews` (588).
- Comando `!apikey`/`!setkey` em `index.js` (~linha 22635) grava `config.apikey_vex`.
- `dados/src/.scripts/config.js` tem prompt que pede `apikey_vex`.

## BOOT mostra a fork do Baileys REALMENTE instalada ✅
- **Problema**: o boot anunciava uma biblioteca que **não era mais a que estava
  rodando**. Não havia nenhuma linha fixa "errada" no código — o header do
  `npm start` nunca mostrava a lib (só nome do bot e versão). Faltava a informação.
- **Correção**: novo módulo **`dados/src/utils/baileysInfo.js`** —
  `getWhatsAppLibrary(root?)` lê a fork **instalada** e monta o rótulo:
  - `package.json` do pacote → **nome** e **versão**
    (`@souzzaaxzy/baileys` / `0.3.18-final`);
  - `node_modules/.package-lock.json` → **commit** (única fonte da verdade do
    npm; a versão é a mesma em vários commits, então só o commit identifica a
    revisão);
  - `parseResolved()` extrai `owner/repo` e o commit de
    `git+ssh://git@github.com/Souzzaaxzy/baileys.git#<sha>`.
- **Header do boot** (`start.js` → `displayHeader`): ganhou a linha
  ```
  🧩 Baileys: @souzzaaxzy/baileys 0.3.18-final (Souzzaaxzy/baileys@d3692c7)
  ```
  O `commit` é exibido **curto (7 chars)** só para leitura; o valor completo
  continua disponível em `info.commit` (o `gitDependencyDrift` compara 40 chars —
  hash curto geraria falso drift; por isso não se guarda o curto).
- **Por que ler em vez de fixar a string**: como o rótulo vem do que está
  instalado, trocar o commit no lockfile + reinstalar **já muda o boot**, sem
  editar código. Era exatamente o defeito relatado ("mostra a última que eu
  usava") — uma string fixa voltaria a envelhecer na próxima troca.
- **Robustez**: o módulo é puro (só lê arquivos) e **nunca lança** — sem
  `node_modules`, `package.json` corrompido, sem lockfile ou pacote sem
  `name`/`version`, devolve um rótulo válido (`versão desconhecida`,
  `commit: null`) em vez de buraco ou `undefined`. A chamada no `start.js` está
  em `try/catch`: informação de boot nunca impede o boot.
- **Testes**: `tests/baileys-boot-info.test.js` — **26 asserções**: leitura
  completa, commit completo vs curto, commits diferentes → labels diferentes,
  mesma versão em commits diferentes não confunde, e os casos degenerados
  (sem pacote/corrompido/sem lock/sem campos) sem `undefined|null|NaN`; mais a
  checagem de que o `start.js` usa a função e **não** tem biblioteca antiga fixa.
  Verificado: o boot real imprime a linha com o commit `d3692c7`.

## INSTALAÇÃO — EALLOWGIT no `npm install` (npm ≥ 11.10) ✅
- **Sintoma**: a primeira instalação morre com
  `npm error code EALLOWGIT` / *"Fetching packages of type 'git' have been
  disabled"* / `Refusing to fetch "@itsliaaa/baileys@git+ssh://..."`.
- **Causa**: o bot depende da fork via git (`"@itsliaaa/baileys":
  "github:Souzzaaxzy/baileys"`). No **npm 11.10** entrou a opção `allow-git` e
  no **npm 12 o padrão virou `none`** — git por dependência passou a ser
  bloqueado por segurança (o `.npmrc` do pacote git pode trocar o binário do
  git). Não é bug do bot nem da fork.
- **Correção**: `allow-git=all` no `.npmrc` do projeto (rastreado; o `.npmrc`
  do projeto tem precedência sobre user/global). Também passou a ir na linha de
  comando nos três scripts de install (`config.js`, `start.js`, `update.js`),
  para o caso de o install rodar sem o `.npmrc` da raiz.
- **TEM que ser `all`, não `root`**: o npm **11.12.x tem bug conhecido**
  (`npm/cli#9189`) em que `allow-git=root` não libera **nem a dependência git de
  raiz** e o install falha igual. Medido:

  | npm | `allow-git=root` | `allow-git=all` |
  |---|---|---|
  | 9.9.4 | OK | OK |
  | 10.9.8 | OK | OK |
  | **11.12.1** | **FALHA (EALLOWGIT)** | OK |
  | 12.0.2 | OK | OK |

  Versões anteriores ao npm 11.10 simplesmente ignoram a chave/flag.
- **Não precisa de git instalado nem de chave SSH**: o npm baixa o commit via
  `codeload.github.com` (HTTPS). Verificado com o `git` fora do `PATH`.
  O `git+ssh://` que aparece no `package-lock.json` é só o formato de registro
  da URL resolvida; a coleta é HTTPS.
- Validado: primeira instalação do zero (clone sem `node_modules`, cache npm
  limpo) com npm **12.0.2** e `npm ci`, e o baileys instalado tem
  `CallStatus`/`preacceptCall` (fork certa). As suítes rodam nessa instalação.

## !atualizar — git pull abortado por mudança local no banco ✅
- **Sintoma**: `!atualizar` falha sempre com
  `error: Your local changes to the following files would be overwritten by
  merge: dados/database/global.json` / `Please commit your changes or stash
  them before you merge. Aborting`.
- **Causa**: o bot grava o estado dele dentro de `dados/database` (economia,
  contadores, grupos) enquanto roda. Vários desses arquivos estão **rastreados
  no git**, então o arquivo está sempre "modificado" na árvore de trabalho.
  Quando o commit que vem do GitHub mexe no **mesmo** arquivo, o merge aborta.
  Reproduzido: commit do upstream que altera `global.json`.
- **Pior**: isso é uma **contradição do repositório** — o `.gitignore` manda
  ignorar `dados/database/**/*.json`, mas **49 desses arquivos foram
  commitados** antes (e `.gitignore` não afeta arquivo já rastreado). Por isso
  o estado de runtime fica "sujo" indefinidamente.
- **Correção no `update.js`**: antes do pull, o script copia para um diretório
  temporário todos os arquivos alterados de `dados/database`; se o pull falhar,
  tenta de novo liberando (`git checkout -- dados/database`) **só** esses
  arquivos; e por fim devolve o estado copiado. Código e configs locais nunca
  são tocados. Validado em 4 cenários: upstream mexendo no mesmo arquivo, só no
  código, na mesma linha, e até no caso em que o upstream **destrackeia** o
  arquivo (o mais difícil — deixava conflito `modify/delete`).
- **Armadilha do parser**: `git status --porcelain` devolve `"XY caminho"`. O
  corte dos 3 primeiros chars tem de vir **antes** do `trim()` — o trim come o
  espaço inicial e desloca o caminho (`ados/database/...`). Foi um bug real na
  primeira versão desta correção, pego pelos testes.
- **Desbloqueio para quem já está travado** (o `update.js` antigo não se
  corrige sozinho, porque é justamente ele que falha): com o bot parado, na
  raiz do projeto —

  ```bash
  cp -r dados/database /tmp/backup-database   # 1. guarda o estado
  git checkout -- dados/database              # 2. libera os arquivos de dados
  git pull                                    # 3. baixa a correção
  cp -r /tmp/backup-database/. dados/database/ # 4. devolve o estado
  ```

  **Não use `git stash pop`** aqui: ele deixa marcadores de conflito
  (`<<<<<<<`) dentro do JSON quando o mesmo arquivo mudou dos dois lados,
  corrompendo o arquivo. O fluxo acima foi validado e mantém o JSON válido.
- **Pendência conhecida (não feita)**: destrackear os 49 arquivos
  (`git rm --cached`) resolveria a causa raiz, mas na transição gera conflito
  `modify/delete` para quem já roda o bot. Precisa de uma migração cuidadosa.
- **ALERTA de segurança**: `dados/database/dono/ff_credentials_br.json` tem
  **109 pares uid+password** e está commitado — e o repositório é **público**.
  Essas credenciais estão expostas no GitHub e devem ser rotacionadas.

### `package-lock.json` também travava o pull (set/2026) ✅ CORRIGIDO
Sintoma relatado: *"de novo aquele erro de não aparecer no bot depois do push"*.
Desta vez a causa era diferente (não era `dados/database`) e **foi eu que
introduzi**:

1. Apontei a fork no `package-lock.json` para o commit novo, mas usei o hash
   **curto** (`aee4b24`). O npm **expande** para o SHA completo ao escrever o
   lock, então o arquivo ficava "modificado" na árvore do bot.
2. Como meus commits mexiam no **mesmo** arquivo, o `git pull` abortava:
   ```
   error: Your local changes to the following files would be overwritten by
   merge: package-lock.json
   Aborting
   ```
3. O fallback `tentarPullPreservandoEstado()` só liberava `dados/database` —
   **nunca** o lockfile. Então o retry falhava igual e o bot ficava **travado**,
   sem pegar nenhum commit novo.

Reproduzido localmente com um remote de teste (bot 1 commit atrás + lock sujo):
`git pull` aborta; o fallback antigo repete o erro; com
`git checkout -- package-lock.json` o pull completa (fast-forward).

**Correções**:
- `package-lock.json` passou a usar o **hash completo**
  (`aee4b2451ef1e2394085e890b00d82c6df372209`). **Regra**: sempre hash completo
  de 40 chars em dependência git — hash curto gera **falso drift** no
  `gitDependencyDrift` (compara strings: `aee4b24` != `aee4b24<40>`), fazendo o
  `!atualizar` reinstalar a cada execução.
- `update.js`: o fallback agora também solta o lockfile
  (`git checkout -- package-lock.json`) antes do retry. O lockfile é artefato de
  instalação — o conteúdo real vem do `package.json` e é recriado no
  `npm install` da sequência.
- Verificado que, com o hash completo, `npm install` deixa o lock
  **byte-idêntico** ao commitado (md5 igual antes/depois) — não fica mais sujo.

**Desbloqueio imediato** (o `update.js` do bot ainda é o antigo, que não se
corrige sozinho): com o bot parado, na raiz do projeto —

```bash
git checkout -- package-lock.json   # libera o lockfile
git pull                            # baixa este fix
npm install --allow-git=all         # sincroniza a fork
```

Depois disso o `!atualizar` volta a funcionar sozinho.

## INSTALAÇÃO — árvore de dependências parcial ✅
- **Sintoma**: o bot quebra no boot com
  `ERR_MODULE_NOT_FOUND: Cannot find package '.../node_modules/pngjs/lib/png.js'
  imported from '.../node_modules/@jimp/js-png/dist/esm/index.js'`.
  Pode ser qualquer dependência **transitiva** faltando, não só o pngjs.
- **Causa**: o instalador (`config.js`) decidia pular o install com
  **`npm ls --depth=0`**. Esse comando devolve **exit 0 mesmo com uma
  dependência transitiva obrigatória ausente** — verificado removendo
  `node_modules/pngjs` (dep de `@jimp/js-png`): `npm ls --depth=0` → exit 0.
  Ou seja: `node_modules` ficava pela metade (install interrompido antes do
  `EALLOWGIT` ser corrigido, disco cheio, `^C` no meio) e o instalador
  respondia *"Dependências já estão instaladas"*, seguindo em frente.
- **Correção**: validar a árvore com **`npm ls --all --json`** e olhar a lista
  `problems`, **ignorando o peer opcional `sharp@*`** (não é instalado de
  propósito e faria uma árvore saudável parecer quebrada — `npm ls --all` sai
  com exit 1 até numa árvore íntegra por causa dele). Aplicado em
  `config.js` e `update.js`; quando há faltando, imprime quais e reinstala.
- **Detalhe do `update.js`**: o `execAsync` de lá usa `execFile` e só anexava
  `stderr` ao erro — precisou passar a anexar `stdout` também, porque
  `npm ls --all` sai com exit 1 quando há problemas mas ainda imprime o JSON.
- Não é bug do código do bot nem dos pacotes: os tarballs de `pngjs` 3/6/7 no
  registry estão íntegros, e o `package-lock.json`/`yarn.lock` já declaram
  `pngjs` como dep de `@jimp/js-png`.
- Validado nos dois sentidos: árvore quebrada → detecta, mostra os faltantes e
  reinstala (jimp volta a carregar); árvore saudável → *"já estão instaladas"*
  e não reinstala (idempotente).

## Setup do ambiente
- `npm install --legacy-peer-deps` instala deps em `/workspace/project/Lizzy-V4/node_modules`.
- Teste de estrutura da API: criar `.mjs` que importa `api-downloads.js` e `getModules()` de `exports.js`, verifica namespaces/funções e a desestruturação esperada pelo `index.js`.
- Boot real: `node dados/src/connect.js` gera QR Code do WhatsApp (não executar em teste automatizado sem necessidade).

## Migração VexAPI — CONCLUÍDA (fases 2-10) + limpeza final feita ✅
- Todas as 9 migrações feitas: Pinterest, TikTok, Instagram, Lyrics, YouTube, Edits, Logos, Canvas, ImageTools.
- **Limpeza final executada**: removidos `funcs/API.js` (verificarAPI, órfã), chaves `site_vex`/`apikey_vex` de `config.json`, defaults+prompt em `.scripts/config.js`, `const site_vex` e o comando `!apikey`/`!setkey` em `index.js`. Zero referências funcionais restantes (só comentários de documentação). `smm setkey` (menu dono) é outro comando, inalterado. Validado: `node --check` OK, boot de módulos OK, smoke logos/imagetools OK.

## !atualizar — instalação automática de dependências (ago/2026) ✅
- `dados/src/.scripts/update.js` (chamado pelo `!atualizar`/`!update`/`!atualizarbot`, index.js ~16446): após `git pull`, agora **instala o que falta automaticamente** em vez de só baixar o código. Ordem: `git pull` → deps Node → FFmpeg → yt-dlp.
- **Deps Node**: roda `npm ls --depth=0`; se houver pacote faltando ou `node_modules` ausente → `npm install --legacy-peer-deps` (fallback `npm install`). Se tudo íntegro → pula (idempotente, não reinstala desnecessariamente).
- **yt-dlp** (requisito do YouTube local): checa `yt-dlp` no PATH → `python3 -m yt_dlp` → `python -m yt_dlp`; ausente → `python3|python -m pip install -U yt-dlp` com fallback `--user` (sem root/sudo). Falha na instalação **não aborta** a atualização — só loga aviso com o comando manual. Timeout 300s no pip, 600s no npm.
- **FFmpeg**: só checagem (exige pacote de sistema ou `FFMPEG_PATH`). Ausente → aviso (não aborta). `update.js` usa `execFile` com args separados (sem concatenação).
- **Mensagens do !atualizar** (index.js ~16485): mapa `updateMessages` ganhou triggers das novas etapas (`Dependências já atualizadas`, `Instalando yt-dlp`, `yt-dlp instalado/encontrado/ausente`, `FFmpeg encontrado/não encontrado`) — o usuário vê o progresso no WhatsApp.
- `.scripts/config.js`: `DEPENDENCIES_CONFIG` ganhou entrada `yt-dlp` (check `yt-dlp --version || python3 -m yt_dlp --version`, install via pip por SO — termux/win/linux/mac), seguindo o padrão existente do Git/Yarn/FFmpeg.
- Validado: repo git de teste (instala pacote faltando, instala yt-dlp via pip, 2ª run pula tudo), projeto real (deps completos → pula npm; PATH restrito → falha controlada), `node --check` OK.

## COMANDO `!tema` — REMOVIDO (set/2026) ❌
O laboratório de chat theme / wallpaper foi **removido** a pedido do dono, depois
de cumprir o objetivo. Ficou como **conhecimento**, não como comando.

### O que foi removido
- **Bot**: `case 'tema'` no `index.js`, o import de `chatThemeLab.js`, o módulo
  `dados/src/utils/chatThemeLab.js`, `tests/chat-theme-lab.test.js` e `'tema'` da
  lista do `menudono` em `blockPv.js`. `grep` confirma **zero** referências.
- **Fork** (commit `ef49852`): `lib/Utils/chat-theme.js`, a fachada
  `sendChatTheme` e seu import, o re-export em `lib/Utils/index.js`, o `case`
  observacional de `CHAT_THEME_SETTING` no `process-message.js`, o script
  `scripts/add-chat-animated-wallpaper.js`, os dois testes (15+18) e a seção do
  README + entrada do TOC.

### O WAProto foi REVERTIDO ao estado GERADO
O delta experimental (`ChatAnimatedWallpaper`, variante 14) foi descartado.
O que **permanece** é o schema original: `ChatThemeSetting` campos 1/2/3 e as
variantes 10..13, e `ProtocolMessage.chatThemeSetting` (campo 30) — nada disso
foi criado por nós.

### Por que foi removido (o que a investigação concluiu)
1. **É PESSOAL.** O tema de conversa do WhatsApp só aparece para quem escolheu;
   a documentação pública (WABetaInfo) é explícita: *"not shared with other
   participants... limited to the device of the person who sets it"*.
2. **O direcionamento é INBOUND.** Enviar `ChatThemeSetting` não aplica nada —
   nem em quem recebe, nem em quem manda. Quem aplica é o próprio app, local.
3. **O WhatsApp está construindo um "theme sync"** (beta fechado) justamente
   para compartilhar tema — prova de que esse caminho não faz isso hoje.
4. **Os IDs são opacos.** `colorSchemeId`, `stockImageId` e `animatedWallpaperId`
   são `string` sem enum no proto; não existe lista pública. Só `solidColor`
   aceita valor controlado (cores literais ARGB de 8 dígitos).
Classificação final medida no aparelho: **ACEITO E IGNORADO**.

### Conhecimento que fica (para não repetir a busca)
- O tema viaja como `ProtocolMessage` type 34 / `chatThemeSetting` campo 30 —
  **não** é propriedade de mensagem comum, **não** é App State.
- Existe também `SyncActionValue.SettingsSyncAction.chatThemeId` +
  `colorSchemeId` (App State, coleção `settings`): é aí que o tema do próprio
  usuário é gravado. O `processSyncAction` do Baileys **não** trata
  `settingsSyncAction`, então o bot ignora o tema por completo.
- O `encode` gerado usa `hasOwnProperty`, não o getter do oneof: setar dois
  membros do wallpaper escreve **os dois** no wire.

Suíte da fork após a remoção: **190/190** (223 menos os 33 testes de tema).
## CORREÇÃO DEFINITIVA DO SISTEMA DE ATUALIZAÇÃO (set/2026) ✅
Substituído o `git pull` (merge) por **sincronização determinística**. O
sintoma relatado era o bot ficar **um commit atrasado para sempre**:

```
fork:  A → B → C → D
bot :  A → B → C        (!atualizar não chegava em D)
```

### Por que o pull antigo falhava (medido, não hipótese)
O bot tem estado local estruturalmente sujo: ele grava sozinho em
`dados/database` (economia, grupos, contadores) e o `npm install` reescreve o
`package-lock.json`. `git pull` faz **merge** — e o merge podia concluir "sem
erro" deixando a árvore num estado que **não** é o `origin/main`; a rodada
seguinte partia desse estado intermediário, e o atraso se perpetuava. O
fallback antigo (`git checkout --` em arquivos e novo pull) também era merge,
então reproduzia o problema.

### Contrato novo
**`HEAD === origin/main`**, comparado por **SHA completo**. E a sincronização é
`git reset --hard origin/main` (sem merge). O estado do bot é preservado pelo
**backup do database**, não pelo merge.

### Módulos novos (nenhum sistema paralelo: `update.js` foi reescrito em cima deles)
- **`dados/src/.scripts/git-sync.js`** — `validarGit`, `identificarOrigem`
  (valida o owner/repo do remote), `fetchRemoto`, `lerEstado`, `nomeDoCommit`,
  `sincronizarComRemoto`, `sincronizarCodigo`. O `spawn` do git é **injetável**,
  então os cenários de falha são testáveis sem repositório real.
- **`dados/src/.scripts/database-backup.js`** — `criarBackupDatabase`,
  `validarBackupDatabase`, `restaurarBackupDatabase`,
  `validarRestauracaoDatabase`, `descartarBackupDatabase`.
- `git-drift.js` **preservado** (é a única checagem que pega a fork no commit
  errado, já que a versão `0.3.18-final` é a mesma entre commits).

### Backup RECURSIVO (não pela lista do `git status`)
O backup copia **`dados/database` inteiro**, recursivamente — rastreados, não
rastreados, novos, modificados e **ignorados** (o `.gitignore` esconde muito
arquivo ali, e um backup por `git status` os perderia). É criado e validado
**antes de qualquer operação destrutiva**; se falhar, **aborta sem reset**
(etapa `BACKUP`). O restore é por sobrescrita, sem apagar o diretório, para não
remover arquivo criado durante a atualização. O backup só é descartado depois de
restore + validação de SHA.

### Etapas de erro (substituem o inútil "código: 1")
`GIT` · `REMOTE` · `BACKUP` · `FETCH` · `SINCRONIZAÇÃO` · `RESTORE` ·
`DEPENDÊNCIAS` · `BAILEYS` · `VALIDAÇÃO` — a UI mostra **qual** etapa falhou.

### SHA x interface
O SHA é usado **só internamente** (comparação + linhas `[UPDATE]` de
diagnóstico). A interface recebe **nome** de commit (`git log -1 --pretty=%s`),
via linhas estruturadas `UI:<tipo>:<json>`. O comando mostra:
```
╭━━〔 🔄 ATUALIZAÇÃO 〕━━⬣
┃ 📦 Repositório: Souzzaaxzy/baileys
┃ 🌿 Branch: main
┃ 🔹 Atual:  <título do commit local>
┃ 🔹 Remoto: <título do commit remoto>
┃ ⏳ Sincronizando...
╰━━━━━━━━━━━━━━━━━━━━━━⬣
```
e, no fim, `✅ ATUALIZADO` com `Status: 100% sincronizado` + database preservado.
`LIZZY_UPDATE_REMOTE`/`LIZZY_UPDATE_BRANCH` permitem fork/host próprio.

### Bugs pré-existentes corrigidos no caminho
1. **`extrairRepo`** — o regex antigo devolvia `github.com/Souzzaaxzy/baileys`
   (com o host), então a validação de origem **recusaria um remote correto**.
   Agora pega os dois últimos segmentos de caminho (`owner/repo`).
2. **Validação de remote apontava para o repo errado** — o `update.js`
   passava `REPO_FORK` (a dependência), mas quem está clonado é o **bot**
   (`REPO_BOT`). Corrigido (foi o que o e2e pegou).
3. **`node_modules` obrigatório sempre** — o npm **não cria** o diretório quando
   não há dependências, então um projeto sem deps dava falso "npm install
   falhou". Agora só cobra o diretório se o `package.json` declarar dependência.

### Testes
- **`tests/update-sync.test.js` — 19 testes / 65 asserções** (git fake com
  estado): TESTE 1 (já atualizado, zero reset), 2 (um commit atrasado), 3 (vários
  atrasados A→D), 6 (falha no backup → zero reset), 9 (falha no fetch → etapa
  FETCH), 10 (reset sem efeito → falha VALIDAÇÃO, nunca "100% sincronizado"),
  11 (título do commit, nunca SHA), 21 (**o bug relatado**: pushes sucessivos
  B/C/D cada um alcançado), mais git ausente, remote inesperado/aceito, backup
  completo recursivo, restore byte a byte, arquivo não rastreado preservado.
- **E2E com repositório git REAL** (script em `/tmp`, não versionado): repo
  atrasado 3 commits + database sujo (`global.json` modificado, `nao-rastreado.json`
  novo) + `package-lock.json` sujo → `EXIT=0`, `HEAD === origin/main`,
  `DB IDENTICO` (md5 igual) e interface com nomes de commit.
- **Prova no clone do repo REAL** (`Souzzaaxzy/Lizzy-V4`, 3 commits atrás,
  `node_modules` removido): 62 arquivos de database preservados byte a byte,
  HEAD foi de `8303b21` para `418e203` = `origin/main`. Rodado de novo já
  sincronizado → `jaAtualizado: true`, sem reset.
- Regressão verde: testcall, cmd-suggest, me-profile, seturlghost,
  blacklist-number, chat-theme-lab, installer-git-drift, baileys-boot-info.

### O que NÃO mudou (de propósito)
`git-drift.js`, `npm install` (`--legacy-peer-deps`/`--allow-git=all`), FFmpeg,
yt-dlp, pausa do `messageQueue`, `!atualizar` como dono-only e reinício após
sucesso. Nenhum segundo sistema de update; `update.js` é o mesmo arquivo.

## SISTEMA DE PLUGIN do AntiFantasma — REMOVIDO (set/2026) ❌
O **sistema de plugin** (o AntiFantasma remoto) foi removido por completo a
pedido do dono. O **anti do próprio bot** (`!antifantasma` / `antiinvi`) **não
foi tocado** — continua exatamente como estava.

### O que foi removido (plugin)
- **Módulos**: `dados/src/antifantasma/` inteiro (`core.js`, `api.js`,
  `keys.js`, `health.js`, `urlManual.js`) e `dados/src/antifantasma-cliente/`
  (`antifantasma.cjs`, `LEIA-ME.md`).
- **`dados/src/utils/publicUrl.js`** — existia só para montar o endpoint do
  plugin (`endpointAntiFantasma`), mais nada.
- **Comandos** (`index.js`): `!ghostcmd` (painel/status/keys), `!addghostcmd`
  (gerar key + entregar o adaptador), `!delghostcmd` (revogar / `alt`),
  `!seturlghost` (URL manual), o bloco de helpers do plugin e os 5 imports.
- **Boot**: a subida da API em `connect.js` (`iniciarApi()`) e o log da URL
  pública no `start.js`.
- **Menu/blockPv**: a categoria **👻 PLUGIN FANTASMA** do `menudono` e as
  entradas `ghostcmd`/`addghostcmd`/`delghostcmd`/`seturlghost` do `blockPv`.
- **Env**: `ANTIFANTASMA_PORT` e `ANTIFANTASMA_PUBLIC_URL` do `.env.example`.
- **Testes**: 11 suítes do plugin (`antifantasma-plugin`, `-entrega`, `-e2e`,
  `-usuario`, `-autossuficiente`, `-esm-replica`, `-cjs-replica`,
  `-instalacao-limpa`, `ghost-manager`, `seturlghost`, `public-url`).

### O que NÃO foi tocado (o anti do bot)
`groupData.antiinvi` (toggle do `!antifantasma` in-bot), `isProtectedSelective`,
`classifyMessage` (`utils/messageInspector.js`), os blocos anti-rajada e
anti-distribuição-seletiva do handler, e `tests/antifantasma-classificacao.test.js`.
Verificado por `grep`: **zero** referências a `ghostcmd`/`seturlghost`/
`antifantasma/` restam. O bot carrega (`INDEX CARREGA OK`).

### Nota
A separação confirma que o anti verdadeiro sempre viveu no bot — o plugin era
só a **distribuição** dele para outras bots (core no servidor + adaptador no
cliente). Remover o plugin não enfraquece a proteção local.

## MELHORIA DO ANTI — corroboração de rotação + pontuação por evidências (set/2026) ✅
Endurecimento do anti pedido pelo dono, **medindo o falso positivo antes de
ligar**. Entrega em dois lados: fork (sinais novos no transporte) + bot
(pontuação, fixtures e corpus de sósias). **A decisão de produção NÃO mudou** —
ver "O que ainda não está ligado".

### O problema que isto resolve
Uma mensagem de grupo que não decifra tem DUAS causas que produzem o **mesmo
erro**, e o ciphertext sozinho não as separa:

1. **este dispositivo entrou tarde / perdeu a Sender Key** — o remetente não fez
   nada de errado;
2. **o remetente ROTACIONOU a chave e distribuiu só a um subconjunto** — este
   dispositivo foi deixado de fora de propósito.

O `decrypt-fail="hide"` ajuda, mas é **ligado pelo remetente** e também aparece
em fluxo benigno (o `rereg_recovery_request` do próprio WhatsApp carrega o
atributo e ainda **decifra com sucesso**). Ele prova intenção no máximo; não
corrobora nada.

### FORK — commit `71748ac` (204/204 na suíte)
1. **`lib/Utils/skdm-rotation-index.js`** — índice de SenderKeyDistributionMessage
   visto na recepção. Um SKDM fresco do **mesmo autor** no **mesmo grupo** é
   exatamente o que separa (2) de (1): quem entrou tarde **não** recebe SKDM de
   um grupo onde já está; uma rotação **recebe**. Limitado (1 entrada por
   grupo+autor, teto de 512, poda preguiçosa) e com relógio injetável.
2. **Report enriquecido** (`selective-distribution-detector.js`): `hasPhash`
   (a stanza rotacionada **não** carrega phash — já provado num teste da fork),
   `density` + `groupDeviceCount` (subconjunto = densidade baixa) e
   `skdmRecentMs` (a corroboração do item 1).
3. **`pairwiseGroupPayload`** — stanza de **grupo** com enc **pareado**
   (`type=msg`/`pkmsg`): é o transporte do retry, por onde o conteúdo chega a
   quem foi excluído. É flag, não prova (retry também acontece por motivo
   benigno).
- `isSelectiveDistributionFailure` **inalterado** — continua exigindo os três
  sinais, então o gate **não** ficou mais frouxo. Os campos novos são aditivos e
  vêm `null` quando não há report.

### BOT — pontuação, fixtures e sósias
- **`dados/src/utils/ghostDetection.js`** — soma de evidências em vez de gate
  booleano único. Pesos: `phashAusente` 3, `densidadeBaixa` 3, `skdmFresco` 4,
  `payloadPareado` 2, `decryptFailHide` 2, `rajadaPaymentZerado` 6,
  `mencaoEmMassa` 3, `stubCiphertext` 1, `mensagemVazia` 1. Limiar de punição 6,
  de observação 3.
- **DOIS CAMINHOS, de propósito**: o ataque de **conteúdo** (payment zerado +
  texto na nota) pune pela própria assinatura — é o que a produção já fazia. O
  ataque de **transporte** exige um sinal **estrutural** (phash/densidade/SKDM),
  e é isso que impede punir o `rereg` e o "entrei tarde".
- **`classifyMessage`** passou a expor `reportHasPhash`, `reportDensity`,
  `reportSkdmRecentMs` e `pairwiseGroupPayload` (aditivo; `null` sem report —
  nunca inventa evidência).
- **`tests/helpers/ghost-fixtures.js`** — gerador **offline**: monta os corpos em
  memória, **nada é enviado**, nenhum socket abre. Além dos ataques, gera os
  **SÓSIAS** (payment legítimo, view-once real, stub de quem entrou tarde, SKDM
  de `rereg_recovery`, fan-out normal com phash, texto, catálogo).
- **`tests/ghost-detection.test.js`** — **24 testes / 81 asserções**.
  Placar do corpus: **precisão 100%, recall 100%, ZERO falso positivo**.

### O que ainda NÃO está ligado (de propósito)
A pontuação roda no handler apenas como **observação** — ela loga
`[GHOST-SCORE] acao=… score=… motivo=…` e **não** substitui o gate atual. Motivo:
a punição **remove o membro e fecha o grupo**, e não tem desfazer; ligar uma
pontuação nova sem medição de campo é exatamente como nasceu o bug "banindo do
nada". Com o log rodando em grupo real, o dono mede o falso positivo e a virada
passa a ser uma linha (`ghostDetection.decidir(...)` no lugar do gate).

### Aviso
`tests/defensive-protection.test.js` falha (48 asserts) — **pré-existente**,
comprovado com `git worktree` no commit anterior. Não tem relação com isto.

## `!get` — ANÁLISE FORENSE DE MENSAGEM INVISÍVEL (set/2026) ✅
Nova categoria do `!get`: **"🕵️ ANÁLISE DE MENSAGEM INVISÍVEL"**. Ela **não**
procura um campo chamado "invisible" — ela monta, a partir do que é realmente
observável no objeto que o Baileys entregou, um conjunto de **características** e
decide pela **correlação** entre elas.

### Arquivos
- **`dados/src/utils/invisibleAnalyzer.js`** (novo, ~1250 linhas) — o **motor**.
  Puro: sem rede, disco, socket ou credenciais. Recebe o `WebMessageInfo` e
  devolve um resultado estruturado.
- **`dados/src/utils/messageInspector.js`** — ganhou o import do motor e uma
  **seção adicional** no fim de `buildMessageReport` (o relatório antigo continua
  inteiro). `buildMessageReport` agora devolve também `forense`.
- **`dados/src/index.js`** (`case 'get'` ~29265) — passa `forenseDebug` para o
  `extra` (ativado por `!get debug`/`full`/`verbose`) e loga **uma linha**:
  `[INVISIBLE-ANALYZER] get | classificacao=… | compat=… | indicadores=…`.
- **`tests/invisible-analyzer.test.js`** (novo) — **49 testes / 390 asserções**.

### Separação de camadas (o pedido central)
```
mensagem → analyzeInvisibleMessage() → resultado estruturado → formatador
```
O motor nunca formata; o formatador (`formatInvisibleSection` /
`formatInvisibleResumo`) consome o resultado. É isso que permite reusar o mesmo
resultado no anti, em logs, em comandos de debug e em testes.

### Detectores (cada responsabilidade isolada)
`analisarKey`, `analisarLid`, `analisarDistribuicao`, `analisarDescriptografia`,
`analisarSenderKey`, `analisarPagamento`, `analisarContexto`, `analisarCitacao`,
`analisarWrappers`, `analisarStub`, `analisarProtocolo`,
`analisarCamposDesconhecidos` e `correlacionar` (CorrelationEngine).

### Catálogo de indicadores (19) e pesos
| ID | Nome | Cat. | Sev. | Peso |
|---|---|---|---|---|
| INV-001 | Distribuição seletiva registrada | distribuição | alta | 5 |
| INV-002 | `decrypt-fail="hide"` presente | criptografia | média | 2 |
| INV-003 | Stanza rotacionada sem phash | distribuição | alta | 3 |
| INV-004 | Densidade de destinatários baixa | distribuição | alta | 3 |
| INV-005 | SenderKeyDistributionMessage fresco | criptografia | alta | 4 |
| INV-006 | Payload pareado em stanza de grupo | distribuição | média | 2 |
| INV-007 | Pagamento sem valor (com nota) | payment | alta | 6 |
| INV-008 | Nota de pagamento com texto | payment | baixa | 0 (informativo) |
| INV-009 | Menções em massa na nota | dispersão | média | 3 |
| INV-010 | Stub CIPHERTEXT (sem payload) | criptografia | baixa | 1 |
| INV-011 | Endereçamento por LID | addressing | baixa | 0 (informativo) |
| INV-012 | LID inconsistente no endereçamento | addressing | média | 2 |
| INV-013 | Encapsulamento aninhado | estrutura | baixa | 1 |
| INV-014 | Citação sem stanzaId | contexto | média | 2 |
| INV-015 | Campos desconhecidos no proto | estrutura | baixa | 1 |
| INV-016 | Mensagem de sistema/protocolo | sistema | baixa | 0 (informativo) |
| INV-017 | Contexto de encaminhamento na nota | contexto | média | 2 |
| INV-018 | SKDM observado no conteúdo | criptografia | baixa | 0 (informativo) |
| INV-019 | Card de pagamento zerado **sem** nota | payment | média | 2 |

Os pesos refletem **evidência técnica**, não arbitrariedade: sinais estruturais
(fora do controle do remetente) valem mais que os ambíguos.

### Classificação
`NORMAL` · `ATÍPICA` · `SUSPEITA` · `FORTEMENTE COMPATÍVEL` · `INCONCLUSIVA`.
Duas **assinaturas** sustentam "fortemente compatível" por si:
- **conteúdo**: pagamento zerado **com** texto na nota (a rajada);
- **transporte**: report de distribuição seletiva **+** falha de decifragem **+**
  corroboração **estrutural** (phash ausente / densidade baixa / SKDM fresco).

Qualquer evidência estrutural sozinha já eleva a forte. O **stub CIPHERTEXT
isolado** (sem report) vira **INCONCLUSIVA** — é o mesmo estado de quem entrou
tarde ou perdeu a Sender Key.

### Índice de compatibilidade
Escala **relativa** 0-99 (assinatura → 90+; sinais ambíguos → teto de 79; normal
→ 0). O relatório diz explicitamente que **não é probabilidade estatística**.
Nunca existe "100% invisível" nem "% de certeza".

### Regras contra falso positivo (o risco real)
- `@lid`, pagamento, `noteMessage`, `decrypt-fail` e inclusive
  `selectiveDistribution` **não** classificam sozinhos. O fan-out normal (phash
  presente + densidade cheia) produz report mas **seletiva = false**; e a
  assinatura de transporte exige o sinal estrutural.
- `mencaoEmMassa` só conta junto de nota de pagamento zerado.
- Campos de tipos sem mapa conhecido **não** entram na varredura de "campos
  desconhecidos" (senão o proto variaria e tudo viraria desconhecido).
- Material criptográfico nunca é exposto (só presença/digest/contagem).
- Toda ausência é reportada como **"NÃO DISPONÍVEL"**, nunca inventada.

### Limitações honestas (documentadas na própria seção)
- O `<enc type="skmsg">` cru **não existe** nesta camada: a fork o resolve no
  `decode-wa-message.js`. O que se vê é a consequência
  (`info.selectiveDistribution`). Por isso **nenhum sistema paralelo de captura
  foi criado**.
- Reuso de ID só é detectável com um `Set` de IDs já vistos; sem ele, `null`.
- Campos de versões mais novas do proto aparecem como "campos desconhecidos".
- `device`, `agent`, `to`, `from`, `status` **não existem** nesta versão da fork
  (a `MessageKey` real tem `remoteJid`/`fromMe`/`id`/`participant` + os campos de
  addressing que a fork anexa); a seção MESSAGE KEY diz isso.

### Modos
- `!get` → relatório completo com a seção forense.
- `!get debug` (ou `full`/`verbose`) → acrescenta a camada de depuração.
- `formatInvisibleResumo` existe para um bloco curto (não ligado ao comando por
  padrão, mas exportado para reuso).

### Testes — `tests/invisible-analyzer.test.js` (49 testes / 390 asserções)
Cobre a matriz A-J: A (texto/mídia/áudio/figurinha/citação/menções/view-once/
efêmera/encaminhada/edição/SKDM/payment legítimo/payment zero sem nota/nota com
valor/só LID/catálogo/sistema/revogação/erro 1a1/fan-out normal), B (raja e raja
em view-once), C (parcialmente semelhantes), D (LID), E/F (payment/note),
G (distribuição seletiva), H (falha de descriptografia), I (Sender Key/skmsg),
J (combinação). Mais: robustez a entrada inválida, não vazamento de segredos,
formatação, e **integração com o handler real** (seção forense presente, resumo,
relatório grande dividido, `!get debug`, recusa original preservada).
**Placar: zero falso positivo, zero falso negativo.**
Validadas também as regressões: `get-message-inspector` **54/269**,
`antifantasma-classificacao` **18/18**, `ghost-detection` **24/81**,
`anti-seletiva` **32/32**, `viewonce-v2` **18/77**, `cmd-suggest` **21/68**,
`testcall` **35/127**, `blacklist-number` **12/38**, `antimidia` **14/29**,
`gifsbn-media` **16/61**, `delete-status` **11/55**.

### Amostra real `sendPaymentMessage` (set/2026) + 3 correções ✅
GET real do dono: `sendPaymentMessage` citado, ID `..._L0`, nota com `"."` +
zero-width, 6 menções, `transactionData` opaco. **Classificação: ATÍPICA** (o
comportamento correto — não é o raja). A investigação achou **3 defeitos** no
analisador e 2 campos que faltavam no `!get`.

1. **A `justificativa` do pagamento mentia para `sendPaymentMessage`.**
   O tipo `sendPaymentMessage` **não carrega `amount`** (quem carrega é o
   `requestPaymentMessage`), então dizer "card com valor presente — não é o
   estado malformado" era falso: não havia valor nenhum para avaliar. Agora a
   justificativa é condicional ao tipo e diz que o zero **não se aplica** ali.
2. **O `contextInfo` da NOTA não era encontrado.** A busca seguia só a cadeia de
   wrappers (`viewOnce → …`), mas num `sendPaymentMessage` o `contextInfo` mora em
   `noteMessage.extendedTextMessage`. O `!get` mostrava as menções e ao mesmo
   tempo dizia `ContextInfo: Não`. Novo helper `encontrarContextInfo(raiz, depth)`
   faz busca limitada na árvore e devolve o **caminho**; `analisarContexto`,
   `analisarCitacao` e `contextoBruto` passaram a usá-lo.
3. **O `transactionData` ia para o WhatsApp como centenas de bytes.** Ele não é
   lixo: decodificado é um **objeto Java serializado** (`AC ED 00 05`), com
   `BigDecimal` e strings UTF-16LE — o **id da própria mensagem**, o **jid do
   grupo**, `UNSET` e `X.0x9`. Nada de chave/credencial. `describeTransactionData`
   substitui o despejo por: tamanho, formato, strings legíveis, classes
   referenciadas e a ressalva de que o binário restante não é interpretado.

**Dois indicadores novos** (o analisador estava cego para os dois):
- **`INV-020` — nota com texto sem conteúdo visível** (peso 2, severidade média).
  Cobre `.` + 9 zero-widths. **Ambíguo por desenho**: várias ferramentas usam
  caracteres invisíveis para "campo vazio", então o peso **só conta quando já
  existe outro indicador na mesma mensagem** (`indicadores.length > 0`). A
  medição é factual: `invisiveis` (contagem) e `semConteudoVisivel`
  (tudo invisível **ou** padding ≥ 3 invisíveis e ≥ 50% do texto).
- **`INV-021` — ID com sufixo de fonte/histórico** (`<id>_L0`, peso 1, baixa).
  Não é o formato de envio direto dos clientes (`3EB0…`); pode indicar
  histórico/relay. Ambíguo, não é prova.

**Placar da amostra:** 4/100, ATÍPICA, `detected: false`, indicadores com peso =
`INV-021`. Com `INV-020` somando (2) + `INV-021` (1) = 3 → ainda ATÍPICA, **não**
SUSPEITA. Nenhum falso positivo.

**Testes**: `tests/invisible-analyzer.test.js` foi de 49 → **53 testes / 419
asserções** (novos: a amostra real ponta a ponta, zero-width sozinho não pontua,
`_L0` não é confundido com ID livre, `transactionData` decodificado).
Regressões re-verificadas: `get-message-inspector` 54/269, `antifantasma-classificacao`
18/18, `ghost-detection` 24/81. `defensive-protection` continua **24 falhas
PRÉ-EXISTENTES** (reproduzidas com `git worktree` no commit anterior — todas em
`!raja`, sem relação).

### Par raja × normal do MESMO grupo + `requestMessageKey` ausente (set/2026) ✅
O dono mandou o **par que faltava**: o raja e uma mensagem normal, ambas no
**mesmo grupo** (`120363432070074647@g.us`). A comparação revelou o que separa os
dois — e um campo que o analisador não olhava.

#### O que separa (medido, lado a lado)
| | normal | raja |
|---|---|---|
| tipo | `conversation` | `sendPaymentMessage` |
| ID | `A5584E336949912391505C34BCD82100` | `A7E2D294EC0FD01967CCAE5DDF28C0048_L0` |
| ID — base / total | 32 hex / 32 | 33 hex / 36 |
| sufixo | **nenhum** | **`_L0`** |
| nota | — | `.` + 7 zero-width |
| author LID | `23734744260711@lid` (remetente) | `132161176899607@lid` (terceiro) |
| classificação | NORMAL, 0/100 | SUSPEITA, 26/100 |

O **sufixo `_L0` aparece só no raja** — a mensagem normal do mesmo grupo tem ID
hex puro. É a evidência mais limpa que temos: **não é artefato do grupo**.

#### A descoberta: `requestMessageKey` AUSENTE
O proto `SendPaymentMessage` tem **4 campos** (`noteMessage`, `requestMessageKey`,
`background`, `transactionData`). Verificado no `.d.ts` da fork instalada:
`requestMessageKey` é o **ponteiro para o pedido que este envio responde**.

Os dois rajas carregam **só** `noteMessage` + `transactionData`:
- **sem `requestMessageKey`** → o card não responde a pedido nenhum;
- e o tipo **não carrega `amount`** → não há valor em lugar nenhum.

Ou seja: é um **card de pagamento estruturalmente incompleto** — um envelope de
pagamento com nota invisível e sem lastro. **Não é** a assinatura clássica do
raja (`requestPaymentMessage` + `amount` zero), mas é uma variante dela.

#### `INV-022` — sendPaymentMessage sem referência ao pedido
Peso **3**, severidade **média** — *média de propósito*, com a justificativa
registrada no próprio indicador: o campo existe no proto, mas **não temos amostra
benignа confirmada** que prove que todo `sendPaymentMessage` legítimo o carrega.
Então isto **corrobora, não prova**. A seção PAYMENT agora mostra
`requestMessageKey: AUSENTE`.

#### Placar e honestidade
O raja passou de **ATÍPICA 13/100** para **SUSPEITA 26/100** (3 indicadores com
peso: `INV-022` 3 + `INV-020` 2 + `INV-021` 1). **Não** vira FORTEMENTE
COMPATÍVEL — e isso é correto: falta a assinatura (zero + `amount`), que este
tipo não tem.

**Pendência honesta que fica registrada:** o `transactionData` (1024 bytes, Java
serializado) **não é decodificado até o fim**. Ele contém um `BigDecimal` cujo
valor não conseguimos extrair (o XOR de 0x00 quebra nas regiões de
comprimento). Se aquele `BigDecimal` for `0`, fechamos a assinatura de valor zero
também nesse tipo. Fica como próximo passo, não como afirmação.

**Testes**: 53 → **54 testes / 431 asserções** (novos: a amostra `sendPaymentMessage`
agora SUSPEITA com `requestMessageKey` ausente, e o **par raja×normal do mesmo
grupo** provando que o ID distingue). Regressões: `get-message-inspector` 54/269,
`antifantasma-classificacao` 18/18, `ghost-detection` 24/81, `anti-seletiva` 32/32.

## 🚨 O TIPO WAS: `!rajar` mandava `requestPaymentMessage`, o raja REAL é `sendPaymentMessage` ✅
O dono corrigiu o rumo: *"payment não é a mensagem invisível — olhe o `!rajar` e
compare"*. A comparação derrubou a premissa em que o analisador (e o próprio
`!rajar`) se apoiavam desde o começo.

### O que o `!rajar` mandava (`buildRajaContent`, `index.js` ~382)
```js
requestPaymentMessage: {
  currencyCodeIso4217: 'BRL', amount1000: '0', expiryTimestamp: '0',
  noteMessage: { extendedTextMessage: { text, contextInfo: { mentionedJid } } },
  amount: { value: '0', offset: 1000, currencyCode: 'BRL' },
}
```
### O que o raja REAL é (medido nos 3 GOTs do dono)
```js
sendPaymentMessage: {
  noteMessage: { extendedTextMessage: { text: ".<7x U+200B>", contextInfo: { mentionedJid: [6] } } },
  transactionData: "<1024B, Java serializado>",
}
```

**É outro TIPO.** O `amount1000: '0'`/`amount.value: '0'` que fundamentava todo o
detector **não existe no raja real** — é uma assinatura que nunca esteve lá.
Isso explica por que o `!rajar` nunca reproduzia o efeito e por que a detecção
não pegava.

### A assinatura real (confirmada por encode)
`SendPaymentMessage` (`WAProto`) tem **4 campos**: `noteMessage`,
`requestMessageKey`, `background`, `transactionData`. O raja carrega **2**:
- **`noteMessage`** — com o texto **invisível** (`.` + zero-width);
- **`transactionData`** — 1024 B; contém `BigDecimal` + o **id da própria
  mensagem** + o **jid do grupo** (não é chave/credencial).

E **não** carrega `requestMessageKey` (o ponteiro para o pedido) nem `amount`.
Ou seja: é um **envelope de pagamento VAZIO** — o tipo é de um envio de pagamento,
não tem valor para desenhar, e a única coisa com conteúdo é a nota — escondida.

### O `!rajar` NÃO foi alterado (era só análise)
**Decisão do dono, respeitada:** o `!rajar` devia ser **apenas analisado**, não
modificado — a tarefa era mexer só no `!get`. Numa rodada intermediária eu cheguei
a trocar `buildRajaContent` para `sendPaymentMessage`; isso foi **revertido**
(`git checkout` do commit anterior) e o comando permanece exatamente como estava
(`requestPaymentMessage` + `amount1000: "0"`).

O que **fica registrado como conhecimento** (medido, não aplicado):
- o `!rajar` monta `requestPaymentMessage`, mas o raja REAL é
  `sendPaymentMessage` — **são tipos diferentes**;
- confirmado por `generateWAMessageFromContent` + encode: um payload
  `sendPaymentMessage` sai no wire como `sendPaymentMessage`, **sem precisar de
  mudança na fork** (se algum dia se quiser alinhar o comando);
- o `logRajaEnvio` do comando continua lendo `requestPaymentMessage.amount1000`
  (coerente com o payload que ele realmente envia).

### Análise: nova assinatura `INV-023`
- **`INV-023` — Envelope de pagamento com texto invisível** (peso 6, **alta**):
  `sendPaymentMessage` cuja nota só tem texto invisível. É a assinatura medida do
  raja real — o `!get` a reconhece independentemente do que o `!rajar` monta.
- `INV-020` (nota sem conteúdo visível) agora **só vale fora do
  `sendPaymentMessage`** — senão duplicaria a assinatura.
- Nova assinatura entra em `correlation.assinaturaEnvelopeVazio`, exibida na
  conclusão como **"Envelope vazio: Sim"**.

### Placar
| | antes | agora |
|---|---|---|
| raja real | ATÍPICA 13/100 | **FORTEMENTE COMPATÍVEL 44/100** |
| normal (`conversation: ok`) | NORMAL 0/100 | NORMAL 0/100 |

Indicadores do raja: `INV-023` (6) + `INV-022` (3) + `INV-021` (1) = **10**, e a
assinatura dispara → FORTE. O que o `!rajar` envia com **texto visível** →
`assinaturaEnvelopeVazio: false` → não vira forte (correto: a invisibilidade vem
do texto, não do transporte).

### Lição (registrada para não repetir)
Duas rodadas de análise foram construídas sobre a premissa
"requestPaymentMessage + amount 0", documentada no AGENTS.md como a "amostra
real". **A premissa nunca esteve certa.** O que a corrigiu foi o dono mandar o
**par raja × normal** *e* apontar o `!rajar`: sem a comparação do tipo, o
`amount1000: "0"` parecia evidência convincente.

**Testes**: 55 testes / 441 asserções (`invisible-analyzer`), incluindo o formato
`sendPaymentMessage` e o par raja×normal — **nenhum teste do `!rajar` foi
alterado**. `tests/raja-selective.test.js` continua **23/0** no estado original.
Regressões: `get-message-inspector` 54/269, `antifantasma-classificacao` 18/18,
`ghost-detection` 24/81, `anti-seletiva` 32/32. `rajar.test.js` (6 falhas) e
`defensive-protection.test.js` (24) continuam **pré-existentes** — verificados na
baseline.

### Escopo final desta rodada (o que mudou de fato)
Só o **`!get`** foi tocado: `dados/src/utils/invisibleAnalyzer.js` (motor forense)
e `dados/src/utils/messageInspector.js` (formatação da seção) + os testes do
`!get`. O `dados/src/index.js` foi **revertido** ao estado anterior — o `!rajar`
(`buildRajaContent`/`logRajaEnvio`) está exatamente como estava.


## `!get` — 2 bugs de RELATÓRIO medidos em amostras reais (set/2026) ✅
Amostras do dono mostraram dois números/valores que **pareciam prova** e não eram.
Nenhum toca no `!rajar`/anti — só o relatório do `!get`.

### BUG 1 — espaço comum contava como "invisível" (`103 invisível(is)`)
Num `requestPaymentMessage` com um **aviso normal de 635 chars**, o relatório
dizia `nota com 639 chars, 103 invisível(is)`. Não havia **nenhum** carácter
invisível: os 103 eram **espaços comuns**. Causa: o contador usava a classe `\s`.

Consequência prática: o número parecia evidência de manipulação de texto e não
significava nada. Corrigido com `INVISIVEL_RE`, que lista **apenas** o que
realmente não é desenhado — zero-width (`U+200B..U+200F`), marcas de formatação
(`U+202A..U+202E`, `U+2060..U+2064`, `U+2066..U+2069`), hífen suave (`U+00AD`),
BOM (`U+FEFF`), seletores de variação (`U+FE00..U+FE0F`) e fillers
(`U+034F`, `U+115F`, `U+1160`, `U+17B4`, `U+17B5`, `U+180E`, `U+3164`, `U+FFA0`).
**Espaço comum NÃO entra.**

`textoSemConteudoVisivel` (o que promove a assinatura `INV-023`) continua usando
a classe ampla (`\s` + invisíveis), porque ali o critério é correto: "não há nada
desenhado". O que mudou foi só a **contagem** exibida.

### BUG 2 — Long do protobuf aparecia como `0n`
`amount1000: 0n` / `amount.value: 0n`. O Long do protobufjs vira **BigInt** e o
`safeValue` fazia `` `${v}n` `` — o `n` é **sintaxe de literal BigInt**, não parte
do valor. Agora `v.toString()`. Regressão coberta (inclusive que `0n` continua
sendo zero para a detecção).

### O que NÃO foi feito (fora de escopo — reportado ao dono)
O dono relatou que o **anti** não pega o raja `sendPaymentMessage`. Diagnóstico
medido, **não corrigido** (mexe em `index.js`, que a tarefa restringe ao `!get`):

```
classifyMessage(sendPaymentMessage):
  isPayment      : true
  paymentAmount  : { isZero: false, present: false, zeroPath: null }
  --> isRajaBurst        : false   <-- gate do anti
  --> isBurstByAmount    : false
```
O gate do anti é `classification.isPayment && classification.paymentAmount.isZero`
(`index.js` ~3385/3464). Como o `sendPaymentMessage` **não carrega `amount`**, o
zero nunca é provado e o gate **é falso por construção** — nenhum
`sendPaymentMessage` passa, por mais invisível que seja a nota. O `!get` detecta
porque usa a assinatura `INV-023` (tipo + nota invisível), que **não** depende de
`amount`.

**Testes**: 57 testes / 450 asserções (2 regressões novas: espaço não conta,
`0n` não aparece). Regressões todas verdes: `get-message-inspector` 54/269,
`raja-selective` 23/0, `antifantasma-classificacao` 18/18,
`ghost-detection` 24/81, `anti-seletiva` 32/32.

## `!get` — `transactionData` decodificado: timestamp em ms + BigDecimal 0 (set/2026) ✅
3ª amostra do dono (`AE043D49…_L0`), mesmo formato `sendPaymentMessage`. A
decodificação do `transactionData` avançou: agora extrai **dois campos com
leitura verificada**, em vez de só listar strings.

### O que o `transactionData` é (formato medido)
Registro BinFmt com blocos aninhados. Estrutura confirmada nas 3 amostras:

```
offset   0  preâmbulo (04 00 00 00 … + máscara ff…)
offset  16  uint32 len + "XXX" (UTF-16LE)
offset  48  uint32 len + "<id>_L0"        <- id da PRÓPRIA mensagem
offset 144  uint32 len + "<grupo>@g.us"   <- jid do grupo
offset 200  uint64 LE                      <- TIMESTAMP EM MS
offset 212  uint32 len + "UNSET"
offset 256  uint32 len + "X.0x9"
offset 380  AC ED 00 05  (BigDecimal, 1º bloco Java)
offset 728  AC ED 00 05  (BigDecimal, 2º bloco Java)
```

**Campo novo: timestamp em milissegundos.** Nas 3 amostras o valor termina em
`000` — ou seja, é **segundos × 1000**:

| amostra | ts do tx | ts da mensagem (envelope) | Δ |
|---|---|---|---|
| `ADBA604E` | 1790101849000 | 1790108013 | 6164 s |
| `A7E2D294` | 1790101848000 | 1790105873 | 4025 s |
| `AE043D49` | 1790109070000 | 1790109509 | 439 s |

### `BigDecimal` = zero (medição, não suposição)
Os dois blocos Java são `java.math.BigDecimal` com `intVal` do tipo
`java.math.BigInteger`. O `BigInteger` serializa a **magnitude** como `byte[]`
(`75 72 00 02 5b 42` + `78 70` + length). Nas 3 amostras o **length é 0** →
magnitude vazia → **BigInteger zero**. O `BigDecimal` que o `sendPaymentMessage`
carrega é **0**.

### O que o `!get` passou a mostrar
```
🧪 *transactionData (decodificado)*
• tamanho decodificado: N byte(s)
• formato: objeto Java serializado (AC ED 00 05) em N bloco(s)
• strings legíveis: `AE043D49..._L0`, `120363432070074647@g.us`, `UNSET`, `X.0x9`, `java.math.BigDecimal`
• timestamps em ms encontrados: offset 200 → 1790109070000 (2026-09-22T20:31:10.000Z)
• BigDecimal.class: 2 ocorrência(s) — intVal com magnitude vazia (BigInteger 0)
• classes referenciadas: ...
```
Nada além disso é interpretado — o que não tem leitura verificada continua
declarado como não interpretado (sem adivinhar semântica).

### Leitura dos 3 rajas (todos coerentes)
- **`requestPaymentMessage`** (amostra 1 de outra rodada): card zerado + nota com
  texto real → **FORTEMENTE COMPATÍVEL 92/100** (assinatura de CONTEÚDO).
- **`sendPaymentMessage`** (3 amostras): envelope de pagamento sem `amount` e com
  `requestMessageKey` ausente, nota invisível, `transactionData` com timestamp e
  BigDecimal 0 → **FORTEMENTE COMPATÍVEL 44/100** (assinatura de ENVELOPE VAZIO,
  `INV-023`).

**Testes**: 58 testes / 455 asserções (nova regressão: timestamp em ms e
BigDecimal 0 extraídos do `transactionData`). Regressões verdes:
`get-message-inspector` 54/269, `raja-selective` 23/0,
`antifantasma-classificacao` 18/18, `ghost-detection` 24/81,
`anti-seletiva` 32/32. Escopo: só o `!get` (`messageInspector` +
`invisibleAnalyzer` + testes) — `index.js` intocado.

## COMANDO `!midiaprefix` — unificou `fotoprefix` + `videoprefix` + `msgprefix` ✅
Pedido do dono: juntar os três num comando só, aceitando **foto, vídeo, GIF e
texto**, e adicionar a variável **`#numerodele#`**. O nome novo é
**`!midiaprefix`**.

### Um comando, quatro entradas
O bloco antigo (duas cases quase idênticas + uma terceira para texto) virou
**uma** case com aliases:

```js
case 'midiaprefix':
case 'fotoprefix':   // aliases preservados
case 'videoprefix':
case 'gifprefix':
case 'msgprefix':
```
Ou seja: **os nomes antigos continuam funcionando** (ninguém que já usa precisa
mudar), mas há **uma** implementação.

### Detecção de mídia (um helper)
`acharMidia()` varre as 16 posições possíveis (mensagem enviada ou marcada ×
`image`/`video`/`sticker`/`document` × view-once V1/V2) e devolve
`{ midia, tipo }`. O tipo sai do **mimetype**, não do nome do campo:
- `image/gif`, `image/webp` ou `isAnimated` → **`gif`**;
- `image/*` → `image`; `video/*` → `video`;
- `document*` decide por mimetype (documento que é imagem/vídeo conta).

### GIF → MP4 (módulo novo `utils/gifMedia.js`)
**O WhatsApp não reproduz GIF como GIF.** O que ele anima é um **MP4** enviado
com **`gifPlayback: true`**. Então o GIF marcado é:
1. baixado (mesmo `getFileBuffer` de sempre — sem sistema paralelo de mídia);
2. **convertido para MP4** por `converterGifParaMp4` (FFmpeg do sistema,
   `libx264` + `yuv420p` + `faststart`, `scale=trunc(iw/2)*2` para dimensão par,
   `-an` porque GIF não tem áudio);
3. salvo como `prefix_media.mp4` e marcado **`isGif: true`**.

O `gifPlayback` é ligado no **envio** quando `isGif` é true — assim o destino vê
um GIF animado, não um vídeo comum. O módulo é isolado e só fala com o FFmpeg
(args fixos, sem entrada do usuário → sem injeção), com teto de 60s, SIGKILL no
grupo de processos e `tmp` sempre limpo.

### `#numerodele#` e `#prefixo#`
Ambas resolvidas nos **dois** caminhos (texto salvo e legenda da mídia):
`#prefixo#` → prefixo do grupo; `#numerodele#` → `@<número>` + menção real.

### Resposta ao "prefixo" — os dois gatilhos unificados
Havia **dois** consumidores (o "prefixo" solto e o handler de comandos) que
faziam coisas diferentes. Agora ambos chamam **`responderPrefixo()`**:
- **mídia + texto** → envia a mídia com o texto como **legenda**;
- **só texto** → envia o texto;
- **só mídia** → mídia com legenda padrão;
- **nada** → o prefixo simples.

### `off` remove TUDO
`!midiaprefix off` remove a mídia **e** o texto (antes eram dois comandos para
isso). Se não há nada, avisa em vez de fingir sucesso.

### Persistência
`prefixMedia.json` ganhou **`isGif`** (`setPrefixMedia(path, type, isGif)` e
`getPrefixMediaIsGif()`), inicializado no default, zerado no `removePrefixMedia`.
`msgprefix.json` continua sendo o texto — **um arquivo por responsabilidade**,
nenhum banco novo.

### Menu e help
`menudono`: `📸 midiaprefix` (e o `💬 msgprefix` foi removido, junto do
`🎥 videoprefix`). O help do prefixo virou **"Mídia / Mensagem de Prefixo"**
descrevendo o comando unificado.

### Testes — `tests/midiaprefix.test.js` (19 testes / 57 asserções)
Roda o **handler real** com socket falso, `DATABASE_PATH`/`CONFIG_PATH`
temporários, e **mídia cifrada de verdade** (hkdf + AES-256-CBC) servida por HTTP
local — o `getFileBuffer` percorre o download real. Cobre: texto com
`#prefixo#`/`#numerodele#`, imagem (e que o arquivo salvo é o **JPEG
descriptografado**), vídeo, GIF (convertido — o teste confere o magic `ftyp` do
MP4, ou seja, que **não** são os bytes do GIF), WebP animado, `off`, aliases
antigos, os três modos da resposta ao "prefixo", `gifPlayback`, permissão, menu e
help.
**O teste guarda e restaura os `prefix_media.*` versionados** — o comando APAGA a
mídia anterior ao salvar, e sem isso ele sujaria a árvore de trabalho (foi um bug
real encontrado ao rodar: o teste chegou a remover o `prefix_media.jpg` do repo).

**Armadilhas encontradas escrevendo os testes:**
1. **`directPath` no proto faz a fork montar `https://`** e ignorar a `url`
   (`messages-media.js` ~475). Com um servidor HTTP local, o fetch morria com
   `SSL ... wrong version number`. O fixture **não** leva `directPath`.
2. **Mídia enviada como a própria mensagem**: o comando tem de estar na
   `caption` **dentro** do objeto de mídia (`imageMessage.caption`), não no topo
   — é de lá que o `getMessageText` lê.
3. **`isPrefixMediaEnabled()` devolve `null`** (é `data.mediaPath && ...`), não
   `false` — asserção por truthiness.
4. **`isOwner` inclui `info.key.fromMe`**: nos testes de permissão o comando
   precisa ir com `fromMe: false`, senão o remetente já conta como dono.

Regressões verdes: `get-message-inspector` 54/269, `raja-selective` 23/0,
`antifantasma-classificacao` 18/18, `ghost-detection` 24/81, `anti-seletiva` 32/32,
`viewonce-v2` 18/77, `cmd-suggest` 21/68, `testcall` 35/127,
`blacklist-number` 12/38, `antimidia` 14/29, `gifsbn-media` 16/61,
`delete-status` 11/55, `me-profile` 44/44.
**Pré-requisito**: FFmpeg no servidor para o caminho de GIF (os testes de GIF são
pulados sem ele, com aviso — o sandbox não tem).
