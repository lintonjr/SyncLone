# shellcheck shell=bash
# Helpers da regressão: asserção, autenticação e atalhos de curl.
# Carregado por scripts/regressao.sh (não tem shebang de propósito: é fonte,
# não executável).

API=http://localhost:3001/api
PASS=0; FAIL=0
jqp() { python3 -c "import sys,json;d=json.load(sys.stdin);print($1)"; }
ok()   { PASS=$((PASS+1)); printf '  \033[32mPASS\033[0m %s\n' "$1"; }
bad()  { FAIL=$((FAIL+1)); printf '  \033[31mFALHA\033[0m %s — %s\n' "$1" "$2"; }
chk()  { if [ "$2" = "$3" ]; then ok "$1"; else bad "$1" "esperado [$3], veio [$2]"; fi; }
reg()  { curl -s -X POST $API/auth/register -H 'Content-Type: application/json' \
         -d "{\"display_name\":\"$1\",\"email\":\"$2\",\"password\":\"Senha12345\"}" >/dev/null; }
tok()  { curl -s -X POST $API/auth/login -H 'Content-Type: application/json' \
         -d "{\"email\":\"$1\",\"password\":\"Senha12345\"}" | jqp 'd["token"]'; }
mkorg(){ reg "$2" "$1"; docker compose exec -T mysql mysql -uroot -proot123 manasync \
         -e "UPDATE users SET role='organizer' WHERE email='$1';" 2>/dev/null; tok "$1"; }
# Espera uma condição valer, em vez de dormir um tempo fixo.
#
#   espere 10 "o stream conectou" '[ -s "$SP/sse.txt" ]'
#
# Dormir um tempo fixo é apostar na velocidade da máquina: passa na de quem
# escreveu e vira intermitência num runner compartilhado, que é mais lento e
# varia de execução para execução. Pior, falha como se fosse defeito do produto,
# e suíte intermitente ensina a ignorar vermelho — o que é pior do que não ter
# suíte. Aqui o passo é curto (pronto em 50 ms segue em 50 ms) e estourar o teto
# vira FALHA dizendo o que se esperava, não um `chk` enigmático logo adiante.
espere() {
  local teto="$1" oque="$2" cond="$3" fim
  fim=$(( $(date +%s) + teto ))
  until eval "$cond" >/dev/null 2>&1; do
    if [ "$(date +%s)" -ge "$fim" ]; then bad "$oque" "não aconteceu em ${teto}s"; return 1; fi
    sleep 0.05
  done
  return 0
}

code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }
body() { curl -s "$@"; }
