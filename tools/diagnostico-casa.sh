#!/usr/bin/env bash
#
# DIAGNOSTICO DA INTERNET DE CASA -- responde "da' para receber conexao?"
#
# Roda NA MAQUINA DE CASA (PC/Raspberry) e diz:
#   1. qual IP o mundo ve;
#   2. qual IP o seu roteador tem;
#   3. se voce esta em CGNAT (nao da' para abrir porta);
#   4. o que fazer em cada caso.
#
# Uso:
#   ./tools/diagnostico-casa.sh
#   ./tools/diagnostico-casa.sh 8888    # tambem testa a porta 8888

set -u

PORTA_TESTE="${1:-8888}"
VERDE=$'\033[32m'; VERMELHO=$'\033[31m'; AMARELO=$'\033[33m'; RESET=$'\033[0m'

echo "======================================================="
echo " DIAGNOSTICO DE INTERNET -- para o !akinator"
echo "======================================================="
echo

# --- 1) IP publico (o que o mundo ve) ---
echo "1) IP que o mundo ve (seu IP publico):"
IP_PUBLICO="$(curl -s --max-time 12 https://api.ipify.org 2>/dev/null || echo '')"
if [ -z "$IP_PUBLICO" ]; then
  IP_PUBLICO="$(curl -s --max-time 12 https://ifconfig.me 2>/dev/null || echo '')"
fi
if [ -n "$IP_PUBLICO" ]; then
  echo "   ${VERDE}${IP_PUBLICO}${RESET}"
else
  echo "   ${VERMELHO}nao consegui descobrir (sem internet?)${RESET}"
fi
echo

# --- 2) IP do roteador / da interface local ---
echo "2) IP da sua maquina na rede local (o que o roteador te deu):"
IPS_LOCAIS="$(ip -4 addr show 2>/dev/null | awk '/inet /{print $2}' | grep -v '^127\.' || true)"
if [ -z "$IPS_LOCAIS" ]; then
  IPS_LOCAIS="$(ifconfig 2>/dev/null | awk '/inet /{print $2}' | grep -v '^127\.' || true)"
fi
if [ -n "$IPS_LOCAIS" ]; then
  echo "$IPS_LOCAIS" | while read -r ip; do echo "   ${ip}"; done
else
  echo "   nao detectado"
fi
echo

# --- 3) IP da WAN, do ponto de vista do roteador ---
# Esse e' o numero que decide tudo: se for 100.64.x.x a 100.127.x.x, e' CGNAT.
# O painel varia por modelo, entao tentamos varios padroes antes de desistir.
echo "3) IP que o ROTEADOR recebe da operadora (WAN):"

# IP da propria maquina (para nao confundir com o IP da WAN).
MEU_IP_LOCAL="$(echo "$IPS_LOCAIS" | head -1 | cut -d/ -f1)"

ler_painel() {
  local pagina
  pagina="$(curl -s --max-time 10 "$1" 2>/dev/null || true)"
  [ -z "$pagina" ] && return 1
  printf '%s' "$pagina"
}

extrair_ip() {
  # Aceita: label seguido de IP, ou value= de input com nome sugestivo.
  grep -oiE '(wan|internet|external|public)[a-z_ .]{0,25}[^0-9]{0,25}[0-9]{1,3}(\.[0-9]{1,3}){3}' \
    | grep -oE '[0-9]{1,3}(\.[0-9]{1,3}){3}' | head -1
}

IP_WAN=""
for pagina in \
  "http://192.168.100.1/" \
  "http://192.168.100.1/status" \
  "http://192.168.100.1/status.html" \
  "http://192.168.100.1/cgi-bin/status" \
  "http://192.168.100.1/summary.html"; do
  html="$(ler_painel "$pagina")" || continue
  cand="$(printf '%s' "$html" | extrair_ip)"
  if [ -n "$cand" ] && [ "$cand" != "$MEU_IP_LOCAL" ] && [ "$cand" != "127.0.0.1" ]; then
    IP_WAN="$cand"
    break
  fi
done

if [ -n "$IP_WAN" ]; then
  echo "   ${IP_WAN}  (lido do painel do roteador)"
else
  echo "   ${AMARELO}nao consegui ler automaticamente.${RESET}"
  echo "   Abra http://192.168.100.1/ no navegador e procure por"
  echo "   'WAN IP' / 'IP da Internet' / 'Endereco IP'."
  echo
  echo "   Dica: o roteador pede senha. Se nao souber, tente a que esta'"
  echo "   na etiqueta colada nele (admin/admin, admin/senha, etc.)."
fi
echo

# --- veredito sobre CGNAT ---
eh_cgnat() {
  case "$1" in
    100.6[4-9].*|100.[7-9][0-9].*|100.1[0-1][0-9].*|100.12[0-7].*) return 0 ;;
    *) return 1 ;;
  esac
}

echo "======================================================="
if [ -n "$IP_WAN" ] && eh_cgnat "$IP_WAN"; then
  echo "${VERMELHO}VEREDITO: voce esta' em CGNAT${RESET}"
  echo
  echo "O IP do roteador ($IP_WAN) esta' na faixa 100.64.0.0/10, que e'"
  echo "compartilhada entre varios clientes. Voce NAO tem IP publico seu."
  echo
  echo "Consequencia: port forwarding no roteador NAO funciona -- o VPS"
  echo "nao consegue abrir conexao para a sua casa."
  echo
  echo "Solucao (ja' pronta): a CASA abre o tunel para o VPS."
  echo "   ./tools/tunel-casa.sh usuario@SEU_VPS"
  echo "Leia: tools/COMO-USAR-CASA.md"
elif [ -n "$IP_WAN" ] && [ "$IP_WAN" = "$IP_PUBLICO" ]; then
  echo "${VERDE}VEREDITO: IP publico de verdade (sem CGNAT)${RESET}"
  echo
  echo "Sua casa tem IP publico proprio. Ainda assim, o tunel e' recomendado"
  echo "porque: nao exige abrir porta no roteador e e' mais seguro."
  echo "Se quiser testar port forwarding: aponte a porta para a maquina"
  echo "de casa e rode o proxy-termux.js nela."
elif [ -n "$IP_WAN" ]; then
  echo "${AMARELO}VEREDITO: atencao -- IPs diferentes${RESET}"
  echo
  echo "IP do roteador : $IP_WAN"
  echo "IP visto fora  : $IP_PUBLICO"
  echo
  echo "Se forem diferentes, provavelmente ha' NAT duplo ou CGNAT."
  echo "O tunel (tools/tunel-casa.sh) resolve os dois casos."
else
  echo "${AMARELO}NAO DEU PARA DECIDIR${RESET}"
  echo
  echo "Abra http://192.168.100.1/ no navegador e veja o 'WAN IP'."
  echo "Se comecar com 100.64 ate' 100.127 -> CGNAT (use o tunel)."
  echo
  echo "De qualquer forma, o tunel funciona nos dois casos:"
  echo "   ./tools/tunel-casa.sh usuario@SEU_VPS"
fi
echo "======================================================="
