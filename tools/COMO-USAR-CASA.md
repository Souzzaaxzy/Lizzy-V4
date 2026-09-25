# Usar o IP da INTERNET DE CASA no `!akinator` — 24/7, grátis

Rodar de casa é **muito melhor** que do celular: a máquina não é morta pelo
Android e aguenta 24/48h ligada. Este guia monta isso.

## O detalhe que muda tudo: IP não basta

Você **não pode** só pegar o IP de casa (`curl ifconfig.me`) e colocar no bot.
Dois motivos, medidos na realidade brasileira:

1. **CGNAT é padrão nos planos residenciais.** Vivo, Claro, TIM e Oi usam CGNAT
   (`100.64.0.0/10`). Você não tem IP público seu — centenas de clientes
   compartilham um. Resultado: **o VPS não consegue abrir conexão para a sua
   casa**, e port forwarding no roteador não funciona.
2. **Vivo Fibra bloqueia as portas 80, 443 e 25** em plano residencial.

Então, igual ao celular, a **casa precisa abrir o túnel**:

```
   CASA (proxy)                    VPS (bot)
   ├── proxy-termux.js  ── SSH ──►  127.0.0.1:8888
   │   (escuta 8888)      túnel      (aponta pra casa)
   └── abre a conexão              └── !akinator sai pelo IP de casa
```

Como a casa iniciou a conexão, CGNAT e portas bloqueadas deixam de importar.

## Verificação rápida (faça primeiro)

Na máquina de casa, descubra se está atrás de CGNAT:

```bash
# o IP que o mundo vê
curl -s https://api.ipify.org; echo
# o IP que seu roteador tem
ip -4 addr show | grep inet
```

Se o IP do roteador começar com `100.64.` a `100.127.`, é CGNAT — e o túnel é
**obrigatório**. Se for outro (IP público de verdade), ainda assim o túnel é mais
seguro e você não precisa mexer no roteador.

## Passo a passo

### 1. Na máquina de casa: dependências

```bash
# Debian/Ubuntu/Raspberry Pi OS
sudo apt update && sudo apt install -y nodejs openssh-client autossh
```

Copie para a máquina a pasta `tools/` do repositório (ou só estes arquivos:
`proxy-termux.js` e `tunel-casa.sh`).

### 2. Teste manual (antes de deixar 24/7)

```bash
cd /opt/lizzy   # onde você pôs os arquivos
chmod +x tools/tunel-casa.sh
./tools/tunel-casa.sh usuario@SEU_VPS
```

Deixe rodando e, **no VPS**, confirme que o tráfego sai pelo IP de casa:

```bash
curl -x http://127.0.0.1:8888 https://api.ipify.org; echo
```

Se voltou o IP da sua casa — funcionou. (`Ctrl+C` para parar.)

### 3. Deixar 24/7 de verdade: systemd

O modo manual morre quando você fecha o terminal. Para aguentar 24/48h e voltar
sozinho **até depois de reboot**, use o serviço:

```bash
sudo mkdir -p /opt/lizzy
# copie os tools/ para /opt/lizzy/tools/

sudo cp /opt/lizzy/tools/akinator-proxy.service /etc/systemd/system/
sudo nano /etc/systemd/system/akinator-proxy.service   # ajuste User e usuario@SEU_VPS

sudo systemctl daemon-reload
sudo systemctl enable --now akinator-proxy
```

Confira:

```bash
systemctl status akinator-proxy
journalctl -u akinator-proxy -f
```

O `Restart=always` + `RestartSec=5` faz o systemd religar em segundos se o
túnel cair. E `systemctl enable` garante que sobe no boot.

### 4. No VPS: aponte o bot

No `.env`:

```bash
AKINATOR_MODE=remoto
AKINATOR_PROXY=http://127.0.0.1:8888
```

Reinicie e rode `!akinator status`.

## Por que isso é confiável (ao contrário do celular)

| | Celular (Termux) | Casa (PC/Raspberry) |
|---|---|---|
| Sistema mata o processo? | **sim** (Android agressivo) | não |
| Aguenta 24/48h? | incerto | **sim** |
| Volta após reboot? | precisa Termux:Boot | **sim** (systemd) |
| Reconecta se cair? | manual | **sim** (Restart=always) |
| Consumo | bateria/dados | ~5W (Raspberry) |

## Detalhes importantes

**Chave SSH sem senha** (para o systemd não travar pedindo senha):

```bash
ssh-keygen -t ed25519            # Enter em tudo
ssh-copy-id usuario@SEU_VPS
ssh usuario@SEU_VPS echo ok      # deve entrar sem pedir senha
```

**Se o IP de casa for dinâmico**, não tem problema: o túnel é de *saída*, então
a mudança de IP não quebra nada. Só o IP de saída que o Akinator vê muda — e
isso é aceitável (é IP residencial de qualquer forma).

**Segurança**: o túnel abre a porta apenas em `127.0.0.1` do VPS, não fica
exposta na internet. E é você quem inicia, então não precisa abrir porta em casa.

**Se quiser nem ter VPS no meio**: rode o **bot inteiro** na máquina de casa.
Aí é zero proxy e zero túnel — o bot já sai pelo IP de casa. Só precisa manter a
máquina ligada.

## Diagnóstico, na ordem

1. `curl -x http://127.0.0.1:8888 https://api.ipify.org` no VPS devolve o IP de
   casa? Se não, o problema é o túnel (não o Akinator).
2. `journalctl -u akinator-proxy -n 50` mostra o que aconteceu.
3. `!akinator status` no bot diz o motivo exato.
4. Se o IP de casa **também** for bloqueado (raro), tente
   `AKINATOR_REMOTO_FALLBACK=local` enquanto resolve.
