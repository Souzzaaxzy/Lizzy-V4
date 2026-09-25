#!/usr/bin/env bash
#
# TUNEL DO PROXY DE CASA -- mantem 24/7 e reconecta sozinho.
#
# O QUE ESTE SCRIPT RESOLVE
# Rodar de casa (PC/Raspberry) e' MUITO melhor que do celular: a maquina nao e'
# morta pelo sistema e aguenta 24/48h. Mas o IP de casa NAO basta:
#   - quase toda internet fixa no Brasil usa CGNAT (Vivo/Claro/TIM/Oi), entao
#     o VPS nao consegue abrir conexao PARA a sua casa;
#   - Vivo ainda bloqueia as portas 80/443/25 em plano residencial.
# Mesmo problema do celular -> mesma solucao: a CASA abre o tunel para o VPS.
#
#   CASA (proxy-termux.js)          VPS (bot)
#   ├── proxy na 8888  ─── SSH ───►  127.0.0.1:8888
#   └── abre o tunel (ssh -R)        └── !akinator sai pelo IP de casa
#
# Uso:
#   ./tools/tunel-casa.sh usuario@SEU_VPS
#   PORTA=8888 ./tools/tunel-casa.sh usuario@SEU_VPS
#
# Para 24/7 de verdade, prefira o systemd (tools/akinator-proxy.service), que
# reinicia sozinho ate' apos reboot. Este script e' o modo manual/portavel.

set -u

VPS="${1:-}"
PORTA="${PORTA:-8888}"
PROXY_PORT="${PROXY_PORT:-$PORTA}"
LOG_DIR="${LOG_DIR:-$HOME/.lizzy}"
mkdir -p "$LOG_DIR"

if [ -z "$VPS" ]; then
  echo "uso: $0 usuario@SEU_VPS" >&2
  exit 2
fi

# Descobre o diretorio deste script para achar o proxy.
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

tem_autossh() { command -v autossh >/dev/null 2>&1; }

iniciar_proxy() {
  # Sobe o proxy local se ainda nao estiver escutando.
  if ! (exec 3<>"/dev/tcp/127.0.0.1/$PROXY_PORT") 2>/dev/null; then
    echo "[casa] subindo o proxy na porta $PROXY_PORT"
    PORT="$PROXY_PORT" nohup node "$DIR/proxy-termux.js" \
      >> "$LOG_DIR/proxy.log" 2>&1 &
    sleep 1
  else
    echo "[casa] proxy ja esta' escutando na porta $PROXY_PORT"
  fi
}

loop_tunel() {
  while true; do
    iniciar_proxy
    echo "[casa] abrindo tunel $PORTA -> 127.0.0.1:$PORTA em $VPS ($(date '+%H:%M:%S'))"
    if tem_autossh; then
      # autossh ja' cuida de reconectar; ServerAlive detecta queda silenciosa.
      autossh -M 0 -N \
        -o ServerAliveInterval=30 -o ServerAliveCountMax=3 \
        -o ExitOnForwardFailure=yes -o StrictHostKeyChecking=accept-new \
        -R "$PORTA:127.0.0.1:$PROXY_PORT" "$VPS"
    else
      ssh -N \
        -o ServerAliveInterval=30 -o ServerAliveCountMax=3 \
        -o ExitOnForwardFailure=yes -o StrictHostKeyChecking=accept-new \
        -R "$PORTA:127.0.0.1:$PROXY_PORT" "$VPS"
    fi
    echo "[casa] tunel caiu ($(date '+%H:%M:%S')); reconectando em 5s"
    sleep 5
  done
}

loop_tunel
