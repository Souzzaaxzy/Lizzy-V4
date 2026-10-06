# TOPGEAR — o que fazer (passo a passo)

O código já está no repositório. Falta só **publicar os arquivos do jogo** no
seu domínio `aleatoryconteudos.com`.

## ⚠️ Antes: por que NÃO usar a pasta do site

O site de vocês aplica este CSP (verificado no servidor):

```
script-src 'self' 'sha256-...'   <- sem 'wasm-unsafe-eval'
style-src 'self'                 <- sem 'unsafe-inline'
media-src 'none'
```

Colocar o jogo na **mesma pasta do site** faria o navegador **bloquear o
WebAssembly** (`wasm-unsafe-eval`) e o áudio (`media-src 'none'`).

Por isso o caminho certo é o **nginx com o bloco do `topgear.conf`**: ele serve
os arquivos com os cabeçalhos corretos.

---

## Passo a passo (Opção 1 — nginx)

### 1. Descobrir o arquivo do nginx

Pelo gerenciador de arquivos do host, procure em:

```
/etc/nginx/sites-available/     (procure um com "aleatoryconteudos")
/etc/nginx/conf.d/
/etc/nginx/nginx.conf
```

### 2. Adicionar o bloco

Copie o conteúdo de **`nginx/topgear.conf`** para **dentro** do `server { }`
que tem `server_name aleatoryconteudos.com;`.

Veja **`nginx/EXEMPLO-server.conf`** para um mapa de onde encaixar.

> O `location /topgear/` tem que ficar **antes** do `}` que fecha o `server`.

### 3. Recarregar o nginx

Pelo painel do host (reload/restart do serviço nginx), ou por terminal se tiver:
`sudo nginx -t && sudo systemctl reload nginx`

---

## Passo a passo (Opção 2 — sem nginx)

Se não puder mexer no nginx, copie os arquivos para uma pasta servida:

1. De `dados/src/topgear/` copie para a pasta do site:
   - `index.html`
   - `style.css`
   - `app.js`
   - `engine/emulator.wasm` (mantendo a subpasta `engine/`)

2. Ficaria:
   ```
   <pasta do site>/topgear/
   ├── index.html
   ├── style.css
   ├── app.js
   └── engine/
       └── emulator.wasm
   ```

> Nesta opção o CSP do site pode bloquear o WASM; o canvas e os controles ainda
> aparecem (modo demonstração).

---

## Como testar

1. A URL precisa responder 200:
   `https://aleatoryconteudos.com/topgear/index.html`

2. No grupo (só o dono): `!topgear`

3. Toque no botão **JOGAR** -> abre no webview do WhatsApp.

---

## Depois de funcionar

Me avise que eu testo a URL de fora e confirmo se está servindo certo.
