#!/usr/bin/env bash
# Hosted zone do site no Route 53 e a delegação a partir da HostGator (D11 = B).
#
#   scripts/zona.sh            cria a zona se faltar, mostra os NS e confere a delegação
#   scripts/zona.sh --gravar   também grava o ID da zona no infra/cdk.json
#
# Idempotente: rodar de novo só mostra o estado. Criar a zona custa US$ 0,50/mês e
# pede confirmação.
set -euo pipefail
# shellcheck source=scripts/aws-env.sh
. "$(dirname "$0")/aws-env.sh"

GRAVAR=0
for arg in "$@"; do
  case "$arg" in
    --gravar) GRAVAR=1 ;;
    *) falha "argumento desconhecido: $arg" ;;
  esac
done

MANASYNC_PULAR_DOCKER=1 preparar_ambiente
DOMINIO="$(contexto_preenchido manasync:domainName 'domínio do site')"
RAIZ_DOMINIO="${DOMINIO#*.}"

info "zona $DOMINIO"
ids="$(aws_ route53 list-hosted-zones-by-name --dns-name "$DOMINIO" \
  --query "HostedZones[?Name=='$DOMINIO.' && Config.PrivateZone==\`false\`].Id" --output text)"
quantas="$(wc -w <<<"$ids")"

if [ "$quantas" -gt 1 ]; then
  falha "há $quantas zonas públicas para $DOMINIO ($ids) — apague as sobrando antes de continuar"
elif [ "$quantas" -eq 0 ]; then
  confirmar "Criar a hosted zone pública $DOMINIO (US\$ 0,50/mês)?" || falha "cancelado"
  ids="$(aws_ route53 create-hosted-zone --name "$DOMINIO" \
    --caller-reference "manasync-$(date +%s)" \
    --hosted-zone-config "Comment=ManaSync: site delegado pela HostGator,PrivateZone=false" \
    --query 'HostedZone.Id' --output text)"
  ok "zona criada: $ids"
else
  ok "zona já existe: $ids"
fi

ID="${ids##*/}"
mapfile -t NS < <(aws_ route53 get-hosted-zone --id "$ID" \
  --query 'DelegationSet.NameServers' --output text | tr '\t' '\n' | sed '/^$/d' | sort)
[ "${#NS[@]}" -eq 4 ] || falha "esperava 4 servidores de nome, veio ${#NS[@]}"

cat >&2 <<EOF

No cPanel da HostGator → Zone Editor de $RAIZ_DOMINIO, crie 4 registros:

  Nome: ${DOMINIO%%."$RAIZ_DOMINIO"}   Tipo: NS   Valor: ${NS[0]}
  Nome: ${DOMINIO%%."$RAIZ_DOMINIO"}   Tipo: NS   Valor: ${NS[1]}
  Nome: ${DOMINIO%%."$RAIZ_DOMINIO"}   Tipo: NS   Valor: ${NS[2]}
  Nome: ${DOMINIO%%."$RAIZ_DOMINIO"}   Tipo: NS   Valor: ${NS[3]}

Nada mais muda na HostGator.

EOF

mapfile -t PUBLICO < <(dig_ +short NS "$DOMINIO" @8.8.8.8 | sed 's/\.$//' | sed '/^$/d' | sort)
if [ "${PUBLICO[*]:-}" = "${NS[*]}" ]; then
  ok "delegação ativa: o DNS público já responde com os servidores da zona"
else
  aviso "delegação ainda não ativa (DNS público: ${PUBLICO[*]:-nenhum}). Pode levar alguns minutos depois de criar os NS."
fi

if [ "$GRAVAR" = "1" ]; then
  gravar_contexto manasync:hostedZoneId "$ID"
fi
