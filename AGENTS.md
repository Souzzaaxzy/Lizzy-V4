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

## COMANDO "!rajar2" — EXPERIMENTAL: retransmissão pairwise (set/2026) ✅
Objetivo: **observar** se o WhatsApp aceita uma retransmissão pairwise de uma
mensagem de grupo e como o cliente destinatário processa esse payload. NÃO
substitui o `!rajar` — os dois coexistem.

- **Onde vive a API**: na fork (`@itsliaaa/baileys`), commit `3ce1a1e`
  (`feat(experimental): add pairwise group retry research flow`). Arquivo novo
  `lib/Utils/pairwise-experimental.js` e a API
  `relayGroupMessagePairwiseExperimental(groupJid, message, options)` no socket.
  É um wrapper fino sobre o caminho de retry que JÁ existe: `relayMessage` com
  `participant` monta `<message to="<grupo>" participant="<device>">` com
  `<enc type="msg" count="N">` cifrado por `signalRepository.encryptMessage`,
  mais o Sender Key distribution message. **Sem segundo sistema de retry, sem
  segunda arquitetura de Sender Key, sem protobuf novo.**
- **Origem técnica (PoC *Send and Pretend*)**: no PoC
  (`sbaresearch/transcript-consistency`, `code/whatsapp/poc-client`), o modo
  `ByteFlip` corrompe o ciphertext do grupo para os destinatários emitirem
  retry receipts; a resposta de retry é então cifrada pairwise, e o
  `PlaintextModifierCallback` permite trocar o conteúdo para UM destinatário.
  A substituição era a única capacidade que a Baileys não expunha — é o que esta
  API adiciona (`experimentalPayload`). A metade "corromper o ciphertext" NÃO foi
  implementada: na Baileys o retry é dirigido pelos receipts de entrada
  (`handleReceipt → sendMessagesAgain`), então provocá-los é passo operacional,
  não mudança no send path.
- **Desligado por padrão**: o ramo experimental exige a flag
  `experimentalPairwiseRetry: true` **E** um `participant` de dispositivo único.
  Sem a flag nada muda — nem grupos, nem 1:1, nem status, nem o retry normal, nem
  o `recipientMode`. Para remover o recurso basta não passar a flag.
- **Comando** (`index.js`, `case 'rajar2'`): `!rajar2 @alvo [texto]` (também
  aceita responder/citar a mensagem do alvo). **Exclusivo do dono** e só em
  grupo. Sem alvo, o comando **recusa** em vez de adivinhar. Ele monta a
  mensagem com `generateWAMessageFromContent` (pipeline normal) e chama SOMENTE
  `nazu.relayGroupMessagePairwiseExperimental`. Se a fork instalada não expuser a
  função, avisa e não faz mais nada.
- **Menu**: linha `│ 🧪 ${prefix}rajar2 @alvo [texto]` na categoria **🧪 TESTES DE
  PROTEÇÃO (DONO)** do `menudono`, e `'rajar2'` na lista do `blockPv`.
- **LOG** (`[PAIRWISE-EXPERIMENT]`): imprime grupo, participant, device,
  messageId e bytes. Nenhum segredo, chave ou plaintext é registrado.
- **Testes da Lizzy**: `tests/rajar2.test.js` (8 testes / 16 asserções) — chama a
  API experimental com o alvo certo (menção e citação), NÃO passa pelo
  `sendMessage` normal, recusa fora de grupo / sem alvo / não-dono, avisa quando
  a fork não expõe a API, e confirma que o `!rajar` **continua** com
  `recipientMode: 'members-only'`. **Armadilha**: o `key` precisa de `participant`
  — sem ele o handler nem chega ao `switch` (retorna antes por "sender não
  identificado"). **Verificado: trocando a chamada experimental por um
  `sendMessage` comum, 5 dos 8 falham.**
- **Estado honesto**: os testes provam o **stanza pairwise** e a **decifragem pelo
  dispositivo alvo** com chaves reais (na fork). O comportamento do cliente real
  e a aceitação pelo servidor do WhatsApp **não** foram validados (sem conta
  pareada neste ambiente).

## COMANDO "!rajar3" — EXPERIMENTO: members-only de verdade (set/2026) ⚠️ NAO ISOLA
Objetivo: enviar uma **mensagem NOVA de grupo** com `recipientMode: 'members-only'`
pelo fluxo normal (sem pairwise retry) e **medir** o que isso realmente esconde.
NÃO altera o `!rajar` nem o `!rajar2`.

- **Comando** (`index.js`, `case 'rajar3'`): `!rajar3 [texto]` (padrão
  `[TESTE MEMBERS_ONLY] mensagem experimental`). **Exclusivo do dono** e só em
  grupo. Chama `nazu.sendMessage(from, { text }, { recipientMode: 'members-only' })`
  — o fluxo normal. Não usa `relayGroupMessagePairwiseExperimental`.
- **Log** (`[MEMBERS-ONLY]`): grupo, modo, nº de membros comuns, nº de admins,
  total de participantes e bytes. Sem chaves, sem plaintext de terceiros.
- **Menu**: `│ 👥 ${prefix}rajar3 [texto]` na categoria **🧪 TESTES DE PROTEÇÃO
  (DONO)** do `menudono`, e `'rajar3'` no `blockPv`.
- **RESULTADO MEDIDO (importante)**: na fork, `tests/members-only-leak.test.js`
  (commit `d42af75`) prova que **um admin excluído CONSEGUE decifrar** a mensagem
  `members-only` quando já recebeu a Sender Key numa mensagem normal anterior.
  Motivo: a Sender Key é **reusada** entre envios (`GroupSessionBuilder.create()`
  só gera chave se o registro estiver vazio; `GroupCipher.encrypt()` continua a
  MESMA cadeia). A restrição corta a **nova distribuição**, não a decifragem.
  Mesmo id de Sender Key nos dois envios; o admin decifra o ciphertext restrito.
  Isolamento real só ocorre para quem **nunca** recebeu a chave (entrou depois, ou
  o primeiro envio do grupo já foi restrito). A fork também mostra que **rotacionar
  a Sender Key** (limpar `sender-key` **e** `sender-key-memory`) antes do envio
  restrito BLOQUEIA o admin (id diferente).
- **Implicação para o `!rajar`**: a afirmação de que "os admins não decifram" só
  é verdadeira para admins que nunca viram uma mensagem normal da Sender Key
  naquele grupo. Em uso real, quem já participou do grupo normalmente tem a
  chave — então o `!rajar` **não** produz mensagem invisível para admins.
- **Testes da Lizzy**: `tests/rajar3.test.js` (8 testes / 14 asserções) — envia
  com `recipientMode: 'members-only'` e o texto pedido, NÃO chama a API
  experimental nem usa `participant` de retry, frase padrão, recusa fora de
  grupo / não-dono, informa contagens e a limitação, e confirma que `!rajar` e
  `!rajar2` seguem intactos. **Verificado: removendo o `recipientMode`, 4 dos 8
  falham.**

## COMANDO "!rajar4" — EXPERIMENTO: rotação seletiva de Sender Key (set/2026)
Objetivo: cifrar uma mensagem NOVA de grupo com uma **Sender Key NOVA (B)** e
distribuir B **somente** aos autorizados, de forma que quem só tem a chave
antiga (A) não consiga decifrar. NÃO altera `!rajar`, `!rajar2` nem `!rajar3`.

- **Onde vive a API**: na fork (`@itsliaaa/baileys`), commit `b0479f2`
  (`experimental: sender key rotation selective distribution`). Módulo novo
  `lib/Utils/sender-key-rotation.js` e a API
  `relayGroupMessageWithSenderKeyRotation(groupJid, message, { allowedParticipants, messageId })`.
- **Como funciona**: reaproveita o `relayMessage`. A flag faz o send path
  **acrescentar um novo Sender Key state** antes de cifrar e estreitar o fan-out
  para `allowedParticipants`. Como `GroupCipher.encrypt()` usa o estado mais
  recente, o `skmsg` passa a ser da chave nova, e o SKDM distribuído é o
  correspondente. Continua mensagem normal de grupo: `to='<grupo>'`, sem
  `participant`, sem `count`, sem `sendMessagesAgain`, sem pairwise retry.
- **Por que acrescentar e não substituir** (`SenderKeyRecord`): `setSenderKeyState()`
  faz `senderKeyStates.length = 0` e quebraria quem ainda tem a chave antiga;
  `addSenderKeyState()` só preenche a chave de assinatura **pública** (formato de
  estado aprendido via SKDM recebido). Por isso o experimento faz
  `senderKeyStates.push(new SenderKeyState(id, 0, chainKey, keyPair))` — o estado
  velho continua disponível para decifrar. `getSenderKeyState()` sem id devolve o
  **último** estado, que é o que o `encrypt()` usa.
- **Comando** (`index.js`, `case 'rajar4'`): `!rajar4 @alvo [texto]` (aceita
  citação). **Exclusivo do dono** e só em grupo; **alvo obrigatório** — sem alvo
  recusa em vez de adivinhar. Autoriza **somente o alvo** (`allowedParticipants:
  [alvo]`); nenhum admin entra.
- **Rollback**: se o envio falhar depois da rotação, a fork remove o estado
  acrescentado (`signalRepository.rollbackSenderKeyRotation`), para o grupo não
  ficar com uma chave que ninguém recebeu.
- **Menu**: `│ 🔑 ${prefix}rajar4 @alvo [texto]` na categoria **🧪 TESTES DE
  PROTEÇÃO (DONO)**; `'rajar4'` no `blockPv`.
- **Log** (`[SENDER-KEY-ROTATION]`): grupo, autorizados, alvo, messageId, bytes.
  Sem chaves, sem chain key, sem signing key, sem plaintext.
- **RESULTADO MEDIDO (fork, `b0479f2`)**:
  - `tests/sender-key-rotation.test.js` (5 testes, isolado): um record mantém A e
    B simultaneamente, com **ids, chain keys e signing keys diferentes**;
    `encrypt()` escolhe o mais recente; um device que só tem A **não decifra** o
    cifrado de B; duas mensagens com B usam o **mesmo id** e a cadeia avança.
  - `tests/sender-key-rotation-send.test.js` (5 testes, caminho real de envio):
    só os autorizados são endereçados (inclusive **todos os devices** do membro
    multi-device); os membros decifram e os admins — que só têm A — falham com
    `No session found to decrypt message`. Evidência: admins com
    `senderKeyIds: [500148101]` (só A); membros com `[A, B]`.
  - **Mutações caçadas**: pular a rotação → 2 dos 5 falham; ignorar o
    subconjunto (distribuir B para o grupo) → 2 dos 5 falham.
- **RESULTADO NO WHATSAPP REAL (set/2026): ❌ FALHOU NA 1ª TENTATIVA — duas causas
  encontradas e corrigidas.** O teste real mostrou a mensagem visível para TODOS.
  Causa 1: a chave rotacionada ficava **ativa** no grupo (corrigido: rotação por
  mensagem, com reversão após cifrar). Causa 2 (a decisiva): o **retry
  reentrega o conteúdo** — `sendMessagesAgain → relayMessage({ participant })`
  reenvia a mensagem **cifrada pairwise para o dispositivo que pediu**, então o
  excluído lia o texto. É o "pairwise E2EE fallback" do PoC *Send and Pretend*.
  Corrigido com o equivalente do `PreRetryCallback`: mensagens rotacionadas
  entram num `suppressedRetryRegistry` (TTL 10 min, por socket) e o gate de
  retry **não responde** para elas (fork `d13e7cc`).
- **O log `autorizados=1` enganava**: era a contagem **do argumento passado pelo
  comando**, não do wire. Na stanza, o endereçamento é `to="<grupo>"`, sem
  `participant`/`recipient` — o servidor continua entregando a **todos**. A
  diferença é só quantos nós `<to>` levam a Sender Key.
- **O que isso produz (a semântica pedida)**: o excluído **recebe o stanza**
  (então sabe que a mensagem existe e consegue citá-la/marcá-la), mas **não
  consegue decifrar** e **não consegue mais pedir pelo retry**. O
  `decrypt-fail="hide"` no `<enc type="skmsg">` é o que instrui o cliente a
  esconder a entrada em vez de mostrar erro.
- **AINDA NÃO VALIDADO EM APARELHO REAL**: se o cliente, ao receber uma mensagem
  que não decifra com `decrypt-fail="hide"`, fica **silencioso** (o desejado) ou
  mostra **placeholder/erro**. Isso é comportamento do cliente e decide o
  resultado. Testar de novo com `!rajar4 @alvo texto` e observar admins.
- **Lição de teste (importante para não repetir)**: o harness **precisa** passar
  `maxMsgRetryCount`, senão `willSendMessageAgain` vira `retryCount < undefined`
  → sempre false, e o teste de retry **passa sem provar nada**. O teste novo
  agora também verifica que o retry de uma mensagem **normal** é respondido
  (1 stanza), garantindo que a supressão é escopada e não um mute geral.
- **Camadas, sem confundir**: `recipientMode`/`recipientParticipants`,
  `sender-key-memory`, SKDM e criptografia de Sender Key são **do lado do
  cliente**; o `participant` só vale em retry; a **única** coisa que o servidor
  obedece é o `to` (JID do grupo). Limitar uma camada não limita as outras.
- **Testes da Lizzy**: `tests/rajar4.test.js` (13 testes / 27 asserções) — chama
  só a API de rotação com o alvo autorizado, não usa pairwise nem
  `recipientMode`, autoriza apenas o alvo (nunca admin), citação, regras de
  grupo/dono/alvo, aviso de fork incompatível, e confirma que `!rajar`,
  `!rajar2` e `!rajar3` seguem intactos. **Verificado: trocando a rotação por um
  `sendMessage` comum, 7 dos 13 falham.**



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

## Comandos e fluxos relevantes
- Autodownload por URL: `handleAutoDownload(nazu, from, url, info)` em `index.js` (~linha 1789) detecta domínio e chama `youtube.mp3`, `tiktok.dl`, `igdl.dl`, `kwai.dl`, `facebook.downloadHD`, `pinterest.dl`, `spotify.download`, `soundcloud.download`.
- Imports diretos em `index.js` (não via exports.js): `spotifyModule` (linha 590), `removeBg/upscale` (589), `search/searchNews` (588).
- Comando `!apikey`/`!setkey` em `index.js` (~linha 22635) grava `config.apikey_vex`.
- `dados/src/.scripts/config.js` tem prompt que pede `apikey_vex`.

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
