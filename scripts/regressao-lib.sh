# Helpers da regressão: asserção, autenticação e atalhos de curl.
# Carregado por scripts/regressao.sh.

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
code() { curl -s -o /dev/null -w '%{http_code}' "$@"; }
body() { curl -s "$@"; }
