# Usar o IP do CELULAR no `!akinator` (Termux) — grátis

O Akinator.com bloqueia o IP do VPS (Cloudflare 403). O IP do seu celular, não.
Este guia faz o bot **sair pela internet do celular** sem pagar proxy.

## O conceito que muda tudo: IP não é proxy

Pegar o seu IP (`curl ifconfig.me`) **não resolve**. IP é um endereço, não um
serviço que repassa conexões. Se você colocar o IP do celular no
`AKINATOR_PROXY`, o VPS vai tentar conectar *naquele endereço na porta 8888* —
e não tem nada escutando lá.

O que serve é o celular **rodar um proxy** (um serviço que aceita conexão e
repassa com o IP do celular). O `tools/proxy-termux.js` faz exatamente isso.

## O segundo problema: a operadora esconde seu IP (CGNAT)

Mesmo rodando o proxy, o VPS **não alcança** o celular: a operadora põe vários
clientes atrás do mesmo IP público (CGNAT), então não há porta exposta para
fora. Por isso o caminho é o inverso:

```
   CELULAR (Termux)                    VPS (bot)
   ├── proxy-termux.js  ──── SSH ─────►  127.0.0.1:8888
   │   (escuta 8888)      túnel          (aponta pro celular)
   └── internet da operadora             └── !akinator sai pelo celular
```

O celular **abre** o túnel (`ssh -R`), então não importa que a operadora esconda
o IP — quem iniciou a conexão foi o celular.

## Passo a passo

### 1. No Termux (celular)

```bash
pkg update && pkg install nodejs openssh -y
mkdir -p ~/lizzy && cd ~/lizzy
# copie o tools/proxy-termux.js do repo para cá (ou cole o conteúdo)
node proxy-termux.js
```

Deve aparecer:

```
[proxy] escutando em http://127.0.0.1:8888
```

Deixe esse terminal aberto.

### 2. No Termux, em OUTRO terminal: abre o túnel para o VPS

```bash
ssh -N -R 8888:127.0.0.1:8888 usuario@SEU_VPS
```

- `-N` = só o túnel, sem shell.
- `-R 8888:127.0.0.1:8888` = "tudo que chegar na porta 8888 do VPS, manda pro
  8888 daqui".

Agora, **no VPS**, este comando deve devolver o IP do celular:

```bash
curl -x http://127.0.0.1:8888 https://api.ipify.org
```

Se voltou o IP do celular, o túnel está de pé.

### 3. No VPS: aponte o bot

No `.env`:

```bash
AKINATOR_MODE=remoto
AKINATOR_PROXY=http://127.0.0.1:8888
```

Reinicie o bot e rode `!akinator status`. Se disser que o Akinator está
respondendo, está funcionando.

## Como conferir que está mesmo passando pelo celular

O proxy loga cada requisição. No Termux você deve ver:

```
[proxy] 14:12:21 CONNECT pt.akinator.com:443 (#1)
[proxy] 14:12:21 CONNECT pt.akinator.com:443 (#2)
```

Se aparecerem essas linhas quando você joga, **o tráfego está saindo pelo
celular**. (Foi exatamente assim que testei aqui.)

## Detalhes que evitam dor de cabeça

**A tela do Termux dorme.** Android mata processos em segundo plano. Rode
`termux-wake-lock` antes de tudo para segurar a CPU acordada:

```bash
termux-wake-lock
node proxy-termux.js
```

**IP de celular (4G/5G) costuma ser mais confiável que Wi-Fi** para esse fim —
é menos compartilhado. Se um não funcionar, teste o outro.

**Limite de banda.** Dependendo do plano, o proxy consome dados do celular.
O `!akinator` gasta muito pouco (respostas de texto, alguns KB por partida),
então não deve pesar.

**Segurança.** O túnel só abre a porta em `127.0.0.1` do VPS, ou seja, não fica
exposto na internet. Ainda assim, ele passa por dentro do SSH: mantenha o SSH
com senha forte ou chave.

**Se o SSH cair**, o proxy fica inalcançável e o bot avisa que o Akinator não
respondeu. Para reiniciar sozinho, use `autossh`:

```bash
pkg install autossh -y
autossh -M 0 -N -o ServerAliveInterval=30 -o ServerAliveCountMax=3 \
  -R 8888:127.0.0.1:8888 usuario@SEU_VPS
```

## Alternativa sem VPS no meio

Se preferir simplicidade, **rode o bot inteiro no celular** (Termux). Aí não
precisa de túnel nem proxy: o bot já sai pelo IP do celular direto. Contra: o
celular precisa ficar ligado e o Baileys (WhatsApp) é mais pesado no Termux.

## Se não funcionar

Vale checar, nesta ordem:

1. `curl -x http://127.0.0.1:8888 https://api.ipify.org` no VPS devolve o IP do
   celular? Se não, o túnel/proxy está errado (não é o Akinator).
2. `!akinator status` diz qual é o motivo exato.
3. Se o IP do celular **também** for bloqueado (raro, mas acontece com IP de
   operadora compartilhado), troque de Wi-Fi/4G ou tente o modo
   `AKINATOR_REMOTO_FALLBACK=local` enquanto isso.
