#!/usr/bin/env bash
# Teste de fumaça do site no ar: as verificações do checklist de aceite (PLANO
# §11.3) que não precisam de navegador nem de login.
#
#   scripts/fumaca.sh
#
# Só lê — não cria dado nenhum. Sai com código ≠ 0 se alguma verificação falhar.
# FUMACA_URL troca o endereço (usado pelos testes); FUMACA_PULAR_ORIGEM=1 pula a
# verificação de acesso direto à task.
set -uo pipefail
# shellcheck source=scripts/lib/comum.sh
. "$(dirname "$0")/lib/comum.sh"
exigir_comando jq

DOMINIO="$(contexto manasync:domainName)"
URL="${FUMACA_URL:-https://$DOMINIO}"
FALHAS=0

checar() { # descrição, condição (0 = passou)
  if [ "$2" = "0" ]; then ok "$1"; else printf 'FALHOU %s\n' "$1" >&2; FALHAS=$((FALHAS + 1)); fi
}

# status, content-type e cabeçalhos de uma URL, sem seguir redirect.
pedir() { # url [args extras do curl]
  local url="$1"; shift
  curl_ -sS -o /dev/null -D - -m 15 "$@" "$url" 2>/dev/null | tr -d '\r'
}
status_de() { sed -n '1s/^HTTP[^ ]* \([0-9]*\).*/\1/p'; }
cabecalho_de() { grep -i "^$1:" | head -n1 | cut -d: -f2- | sed 's/^ *//'; }

info "fumaça em $URL"

r="$(pedir "$URL/api/health")"
checar "API responde /api/health com 200" "$([ "$(status_de <<<"$r")" = 200 ] && echo 0 || echo 1)"

r="$(pedir "$URL/api/health" -H 'x-origin-verify: forjado-pela-fumaca')"
checar "header x-origin-verify forjado é sobrescrito pelo CloudFront (200)" "$([ "$(status_de <<<"$r")" = 200 ] && echo 0 || echo 1)"

r="$(pedir "$URL/event/fumaca-rota-profunda")"
checar "rota profunda da SPA devolve 200 HTML" \
  "$([ "$(status_de <<<"$r")" = 200 ] && [[ "$(cabecalho_de content-type <<<"$r")" == text/html* ]] && echo 0 || echo 1)"

r="$(pedir "$URL/api/events/fumaca-inexistente")"
checar "404 da API chega como 404 JSON, não como HTML" \
  "$([ "$(status_de <<<"$r")" = 404 ] && [[ "$(cabecalho_de content-type <<<"$r")" == application/json* ]] && echo 0 || echo 1)"

r="$(pedir "$URL/uploads/fumaca-inexistente.png")"
st="$(status_de <<<"$r")"
checar "upload inexistente é 403/404 do S3, nunca HTML" \
  "$( { [ "$st" = 403 ] || [ "$st" = 404 ]; } && [[ "$(cabecalho_de content-type <<<"$r")" != text/html* ]] && echo 0 || echo 1)"

r="$(pedir "$URL/")"
checar "HSTS presente" "$([ -n "$(cabecalho_de strict-transport-security <<<"$r")" ] && echo 0 || echo 1)"
checar "nosniff presente" "$([ "$(cabecalho_de x-content-type-options <<<"$r")" = nosniff ] && echo 0 || echo 1)"

r="$(curl_ -sS -N -o /dev/null -D - -m 3 "$URL/api/events/fumaca/stream" 2>/dev/null | tr -d '\r')"
checar "stream SSE abre como text/event-stream" \
  "$([[ "$(cabecalho_de content-type <<<"$r")" == text/event-stream* ]] && echo 0 || echo 1)"

if [ "${FUMACA_PULAR_ORIGEM:-0}" != "1" ]; then
  mapfile -t IPS < <(dig_ +short A "origin.$DOMINIO" | sed '/^$/d')
  checar "origin.$DOMINIO tem ao menos um IP" "$([ "${#IPS[@]}" -ge 1 ] && echo 0 || echo 1)"
  for ip in "${IPS[@]}"; do
    # Da internet, a task não pode responder: o SG só aceita o CloudFront.
    codigo="$(curl_ -s -o /dev/null -w '%{http_code}' -m 5 "http://$ip:3001/api/health" 2>/dev/null)"
    checar "task $ip:3001 inacessível de fora do CloudFront" "$([ "$codigo" = 000 ] && echo 0 || echo 1)"
  done
fi

if [ "$FALHAS" -gt 0 ]; then
  falha "$FALHAS verificação(ões) falharam"
fi
ok "fumaça limpa"
