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

## Formatos de exportação dos módulos (importante para a fachada)
- Named exports (`export { ... }`): tiktok, youtube, igdl, pinterest, canvas, kwai, edits, logos → fachada usa `import * as ns` + `pickNamed()` (filtra `default`/`__esModule`).
- Default objeto (`export default { ... }`): spotify, soundcloud, facebook, imagetools → fachada usa o default diretamente.
- Default função (`export default fn`): lyrics (`getLyrics`), apkmod (`apkMod`), mcplugins (`buscarPlugin`) → fachada cria `callable()` que expõe a função como namespace **e** anexa `.getLyrics`/`.apkMod`/`.buscarPlugin` como propriedade (preserva chamada direta antiga `Lyrics(q)`).

## Dependências da VexAPI (a substituir nas próximas fases)
- `dados/src/funcs/API.js` → `verificarAPI()` valida `apikey_vex`/`site_vex` em `config.json`.
- Módulos que AINDA usam VexAPI: `downloads/{youtube,lyrics,canvas}.js`, `edits/index.js`, `logos/index.js`, `utils/imagetools.js`.
- Módulos JÁ próprios (não usam VexAPI): `downloads/{spotify,soundcloud,facebook,kwai,apkmod,mcplugins,pinterest,tiktok,igdl}.js`, `utils/search.js`.
- Endpoints VexAPI usados: `/api/pesquisa/{tiktok,youtube,pinterest,letra}`, `/api/pesquisas/pinterest` (typo), `/api/downloads/{tiktok,instagram,youtubemp3,youtubemp4}`, `/api/canvas/{brat,bratvideo,welcome2}`, `/api/edits/{type}`, `/api/logos/{type}`, `/api/ferramentas/{removebg,upscale}`, `/api/verificarkey`.

## Comandos e fluxos relevantes
- Autodownload por URL: `handleAutoDownload(nazu, from, url, info)` em `index.js` (~linha 1789) detecta domínio e chama `youtube.mp3`, `tiktok.dl`, `igdl.dl`, `kwai.dl`, `facebook.downloadHD`, `pinterest.dl`, `spotify.download`, `soundcloud.download`.
- Imports diretos em `index.js` (não via exports.js): `spotifyModule` (linha 590), `removeBg/upscale` (589), `search/searchNews` (588).
- Comando `!apikey`/`!setkey` em `index.js` (~linha 22635) grava `config.apikey_vex`.
- `dados/src/.scripts/config.js` tem prompt que pede `apikey_vex`.

## Setup do ambiente
- `npm install --legacy-peer-deps` instala deps em `/workspace/project/Lizzy-V4/node_modules`.
- Teste de estrutura da API: criar `.mjs` que importa `api-downloads.js` e `getModules()` de `exports.js`, verifica namespaces/funções e a desestruturação esperada pelo `index.js`.
- Boot real: `node dados/src/connect.js` gera QR Code do WhatsApp (não executar em teste automatizado sem necessidade).

## Próxima fase sugerida
- FASE 5: continuar substituindo a VexAPI módulo por módulo, dentro de `api-downloads.js`. Ordem recomendada restante: Lyrics → YouTube → Logos/Edits → Canvas → imagetools (removeBg/upscale). Manter `API.js`/`config.json` legados até o fim da transição. Concluídas: Pinterest (FASE 2), TikTok (FASE 3), Instagram (FASE 4).
