#!/usr/bin/env bash
# Hosted zone do domínio inteiro no Route 53 (PLANO D11 = C).
#
#   scripts/zona.sh            cria a zona se faltar, importa os registros da HostGator,
#                              compara Route 53 × HostGator e mostra o estado da delegação
#   scripts/zona.sh --gravar   também grava o ID da zona no infra/cdk.json
#
# Opção: --arquivo <json>  (padrão: infra/dns/registros-hostgator.json)
#
# Por que o domínio inteiro: o editor de zona da HostGator não oferece registro NS,
# então não dá para delegar só o subdomínio do site. O Route 53 passa a responder
# por tudo, com os registros atuais da HostGator copiados — site e e-mail de lá
# continuam funcionando.
#
# A troca dos servidores de nome é manual, no painel da HostGator, e só deve ser
# feita depois de este script dizer que os registros conferem. Criar a zona custa
# US$ 0,50/mês e pede confirmação. Idempotente: rodar de novo reaplica e reconfere.
set -euo pipefail
# shellcheck source=scripts/aws-env.sh
. "$(dirname "$0")/aws-env.sh"

GRAVAR=0
ARQUIVO="$RAIZ/infra/dns/registros-hostgator.json"
while [ $# -gt 0 ]; do
  case "$1" in
    --gravar) GRAVAR=1 ;;
    --arquivo) ARQUIVO="${2:?--arquivo precisa de um caminho}"; shift ;;
    *) falha "argumento desconhecido: $1" ;;
  esac
  shift
done

MANASYNC_PULAR_DOCKER=1 preparar_ambiente
ZONA="$(contexto_preenchido manasync:zoneName 'zona do domínio')"
SITE="$(contexto_preenchido manasync:domainName 'domínio do site')"
DNS_ANTIGO="${MANASYNC_DNS_ANTIGO:-dns3.hostgator.com.br}"
TIPOS='["A","AAAA","CNAME","MX","TXT","CAA","SRV"]'

# --- 1. validar o arquivo antes de tocar na AWS ---------------------------------
[ -f "$ARQUIVO" ] || falha "arquivo de registros não encontrado: $ARQUIVO"
problemas="$(jq -r --arg zona "$ZONA" --arg site "$SITE" --argjson tipos "$TIPOS" '
  if .zona != $zona then "o arquivo é da zona \(.zona), não de \($zona)"
  else
    .registros[] |
    (.nome | ascii_downcase | rtrimstr(".")) as $n |
    if (.tipo | IN($tipos[]) | not) then "\(.nome): tipo \(.tipo) não permitido (NS e SOA são do Route 53)"
    elif ($n != $zona and ($n | endswith("." + $zona) | not)) then "\(.nome): fora da zona \($zona)"
    elif ($n == $site or ($n | endswith("." + $site))) then "\(.nome): é do CDK (site e origem), não deste arquivo"
    elif (.valores | length) == 0 then "\(.nome): sem valores"
    elif ((.ttl | type) != "number" or .ttl < 60) then "\(.nome): TTL inválido"
    else empty end
  end' "$ARQUIVO")"
[ -z "$problemas" ] || falha "registros inválidos em $ARQUIVO:
$problemas"
ok "arquivo de registros válido ($(jq '.registros | length' "$ARQUIVO") registros)"

# --- 2. zona --------------------------------------------------------------------
info "zona $ZONA"
ids="$(aws_ route53 list-hosted-zones-by-name --dns-name "$ZONA" \
  --query "HostedZones[?Name=='$ZONA.' && Config.PrivateZone==\`false\`].Id" --output text)"
quantas="$(wc -w <<<"$ids")"
if [ "$quantas" -gt 1 ]; then
  falha "há $quantas zonas públicas para $ZONA ($ids) — apague as sobrando antes de continuar"
elif [ "$quantas" -eq 0 ]; then
  confirmar "Criar a hosted zone pública $ZONA (US\$ 0,50/mês)?" || falha "cancelado"
  ids="$(aws_ route53 create-hosted-zone --name "$ZONA" \
    --caller-reference "manasync-$(date +%s)" \
    --hosted-zone-config "Comment=ManaSync: dominio inteiro (registros da HostGator copiados),PrivateZone=false" \
    --query 'HostedZone.Id' --output text)"
  ok "zona criada: $ids"
else
  ok "zona já existe: $ids"
fi
ID="${ids##*/}"

# --- 3. importar os registros ---------------------------------------------------
lote="$(jq -c '{
  Comment: "ManaSync: registros copiados da HostGator (infra/dns/registros-hostgator.json)",
  Changes: [ .registros[] | {
    Action: "UPSERT",
    ResourceRecordSet: {
      Name: .nome, Type: .tipo, TTL: .ttl,
      ResourceRecords: [ .valores[] as $v | { Value: (
        if .tipo == "TXT" and ($v | startswith("\"") | not) then "\"" + $v + "\"" else $v end
      ) } ]
    }
  } ]
}' "$ARQUIVO")"
mudanca="$(aws_ route53 change-resource-record-sets --hosted-zone-id "$ID" --change-batch "$lote" \
  --query 'ChangeInfo.Id' --output text)"
ok "registros aplicados na zona (UPSERT)"
# Sem esperar, a comparação abaixo consulta os servidores do Route 53 antes de eles
# publicarem a mudança (~1 min) e acusa todos os registros como vazios.
info "esperando o Route 53 publicar a mudança nos servidores de nome"
aws_ route53 wait resource-record-sets-changed --id "${mudanca##*/}" ||
  falha "a mudança ${mudanca##*/} não ficou INSYNC a tempo — rode de novo"

mapfile -t NS < <(aws_ route53 get-hosted-zone --id "$ID" \
  --query 'DelegationSet.NameServers' --output text | tr '\t' '\n' | sed '/^$/d' | sort)
[ "${#NS[@]}" -eq 4 ] || falha "esperava 4 servidores de nome, veio ${#NS[@]}"

# --- 4. comparar Route 53 × HostGator, registro a registro ----------------------
normalizar() { sed 's/\.$//' | tr '[:upper:]' '[:lower:]' | sort; }
diferentes=0
faltando=0
info "comparando cada registro: Route 53 (${NS[0]}) × HostGator ($DNS_ANTIGO)"
while IFS=$'\t' read -r nome tipo; do
  novo="$(dig_ +norecurse +short "$tipo" "$nome" "@${NS[0]}" | normalizar)"
  antigo="$(dig_ +norecurse +short "$tipo" "$nome" "@$DNS_ANTIGO" | normalizar)"
  if [ -n "$novo" ] && [ "$novo" = "$antigo" ]; then
    ok "$tipo $nome → $(tr '\n' ' ' <<<"$novo")"
  else
    aviso "DIFERENTE: $tipo $nome — Route 53: [$(tr '\n' ' ' <<<"$novo")] HostGator: [$(tr '\n' ' ' <<<"$antigo")]"
    diferentes=$((diferentes + 1))
    [ -n "$novo" ] || faltando=$((faltando + 1))
  fi
done < <(jq -r '.registros[] | [.nome, .tipo] | @tsv' "$ARQUIVO")

if [ "$GRAVAR" = "1" ]; then
  gravar_contexto manasync:hostedZoneId "$ID"
fi

# --- 5. delegação ---------------------------------------------------------------
mapfile -t PUBLICO < <(dig_ +short NS "$ZONA" @8.8.8.8 | sed 's/\.$//' | sed '/^$/d' | sort)
if [ "${PUBLICO[*]:-}" = "${NS[*]}" ]; then
  # Depois da troca, a fonte da verdade é o arquivo: registro novo (ex.: SPF) só
  # existe no Route 53, então diferença da HostGator é aviso. Sem resposta é erro.
  [ "$faltando" -eq 0 ] || falha "delegação ativa, mas $faltando registro(s) não respondem no Route 53"
  [ "$diferentes" -eq 0 ] || aviso "$diferentes registro(s) diferem da cópia antiga na HostGator (esperado se o arquivo mudou depois da troca)"
  ok "delegação ativa: o Route 53 responde por $ZONA"
  exit 0
fi

if [ "$diferentes" -gt 0 ]; then
  falha "$diferentes registro(s) diferentes — NÃO troque os servidores de nome ainda"
fi

cat >&2 <<EOF

Registros conferidos. Agora troque os servidores de nome do domínio:

  Área do cliente HostGator → Domínios → $ZONA → Servidores DNS (ou "Alterar DNS")
  → usar servidores personalizados, e informe os 4:

    ${NS[0]}
    ${NS[1]}
    ${NS[2]}
    ${NS[3]}

É o menu do DOMÍNIO, não o editor de zona. Depois da troca, a HostGator deixa de
responder pelo domínio: registro novo passa a ser feito em
infra/dns/registros-hostgator.json e aplicado com scripts/zona.sh.

EOF
aviso "delegação ainda não ativa (DNS público: ${PUBLICO[*]:-nenhum}). Rode este script de novo depois da troca."
