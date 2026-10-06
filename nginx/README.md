# TOPGEAR — config do nginx

Esta pasta tem o que falta para o `!topgear` abrir no aparelho.

## Arquivos

| Arquivo | Para que serve |
|---|---|
| `topgear.conf` | O bloco que você copia para dentro do seu nginx |
| `EXEMPLO-server.conf` | Um mapa mostrando ONDE o bloco entra |

---

## Opção 1 (recomendada) — nginx aponta para o servidor do bot

O bot sobe o jogo na porta **8099**. O nginx repassa a URL pública para ela.

1. Ache o arquivo do nginx que atende o domínio:
   `aleatoryconteudos.com` → normalmente
   `/etc/nginx/sites-available/aleatoryconteudos.com`
   ou `/etc/nginx/conf.d/aleatoryconteudos.com.conf`

2. Abra e procure o `server { ... }` que tem `server_name aleatoryconteudos.com;`

3. Cole o conteúdo de `topgear.conf` **dentro** desse `server { }`,
   junto dos outros `location`. Veja o `EXEMPLO-server.conf`.

4. Recarregue o nginx.

> ⚠️ O `location /topgear/` tem que ficar **antes** do `}` que fecha o `server`.
> Se ficar depois, o nginx quebra.

---

## Opção 2 (mais simples) — sem nginx, sem porta

O jogo é **100% estático** (HTML + JS + WASM). Ele não precisa do bot no ar.

1. Copie os 3 arquivos para a pasta do site que o nginx já serve:
   - `dados/src/topgear/index.html`
   - `dados/src/topgear/app.js`
   - `dados/src/topgear/engine/emulator.wasm`

   para a pasta do domínio (ex.: `/var/www/aleatoryconteudos/topgear/`),
   mantendo a subpasta `engine/`:
   ```
   topgear/
   ├── index.html
   ├── app.js
   └── engine/
       └── emulator.wasm
   ```

2. Pronto. O nginx já serve arquivos estáticos, então
   `https://aleatoryconteudos.com/topgear/index.html` funciona **sem mudar
   nenhuma config**.

> Nesta opção o `TOPGEAR_PORT` do bot não é usado — o `publicUrl` do
> `dados/src/topgear/config.json` continua o mesmo.
