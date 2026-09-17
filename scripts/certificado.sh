#!/usr/bin/env bash
# Certificado do CloudFront, em us-east-1 (PLANO §1.2).
#
#   scripts/certificado.sh            emite (ou reaproveita), valida por DNS e espera
#   scripts/certificado.sh --gravar   também grava o ARN no infra/cdk.json
#
# Fora do CDK porque, nesta conta, o CDK não pode criar recurso em us-east-1 — e
# o CloudFront só lê certificado de lá. A renovação é automática enquanto o CNAME
# de validação existir na zona: **nunca apague esse registro**.
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
NOME_ZONA="$(contexto_preenchido manasync:zoneName 'zona do domínio')"
ZONA="$(contexto_preenchido manasync:hostedZoneId 'rode scripts/zona.sh --gravar')"
ACM=(--region us-east-1)

# A validação por DNS só conclui se o DNS público já aponta para ESTA zona. Não
# basta "responder NS": antes da troca, quem responde é a HostGator, e o CNAME
# de validação criado no Route 53 nunca seria visto.
esperados="$(aws_ route53 get-hosted-zone --id "$ZONA" --query 'DelegationSet.NameServers' --output text |
  tr '\t' '\n' | sed '/^$/d' | sort | tr '\n' ' ')"
publicos="$(dig_ +short NS "$NOME_ZONA" @8.8.8.8 | sed 's/\.$//' | sed '/^$/d' | sort | tr '\n' ' ')"
[ -n "$esperados" ] && [ "$publicos" = "$esperados" ] ||
  falha "o DNS público de $NOME_ZONA ainda não aponta para o Route 53 (hoje: ${publicos:-nenhum}) — troque os servidores de nome na HostGator (scripts/zona.sh) e espere"

info "certificado para $DOMINIO (us-east-1)"
ARN="$(aws_ acm list-certificates "${ACM[@]}" --certificate-statuses ISSUED PENDING_VALIDATION \
  --query "CertificateSummaryList[?DomainName=='$DOMINIO'].CertificateArn | [0]" --output text)"

if [ -z "$ARN" ] || [ "$ARN" = "None" ]; then
  ARN="$(aws_ acm request-certificate "${ACM[@]}" --domain-name "$DOMINIO" \
    --validation-method DNS --idempotency-token manasync \
    --tags Key=projeto,Value=manasync --query CertificateArn --output text)"
  ok "solicitado: $ARN"
else
  ok "reaproveitando: $ARN"
fi

# O registro de validação aparece alguns segundos depois da solicitação.
registro=""
for _ in $(seq 1 30); do
  registro="$(aws_ acm describe-certificate "${ACM[@]}" --certificate-arn "$ARN" \
    --query 'Certificate.DomainValidationOptions[0].ResourceRecord.[Name,Value]' --output text)"
  if [ -n "$registro" ] && [ "$registro" != "None" ] && [[ "$registro" != None* ]]; then break; fi
  sleep "${MANASYNC_ESPERA_S:-2}"
done
read -r NOME VALOR <<<"$registro"
[ -n "${VALOR:-}" ] || falha "o ACM não devolveu o registro de validação"

info "CNAME de validação $NOME"
aws_ route53 change-resource-record-sets --hosted-zone-id "$ZONA" --change-batch "$(jq -n \
  --arg n "$NOME" --arg v "$VALOR" '{
    Comment: "ManaSync: validacao ACM do CloudFront (NAO APAGAR: renovacao automatica)",
    Changes: [{ Action: "UPSERT", ResourceRecordSet: { Name: $n, Type: "CNAME", TTL: 300, ResourceRecords: [{ Value: $v }] } }]
  }')" >/dev/null
ok "CNAME gravado na zona $ZONA"

info "esperando a emissão (pode levar alguns minutos)"
aws_ acm wait certificate-validated "${ACM[@]}" --certificate-arn "$ARN" ||
  falha "o certificado não foi validado a tempo; rode de novo em alguns minutos"
ok "certificado emitido"

if [ "$GRAVAR" = "1" ]; then
  gravar_contexto manasync:certificateArn "$ARN"
else
  printf '%s\n' "$ARN"
fi
