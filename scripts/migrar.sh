#!/usr/bin/env bash
# Aplica schema e migrations no RDS pela task avulsa (db/, stack ManaSyncMigracao).
#
#   scripts/migrar.sh                 snapshot do RDS + migração
#   scripts/migrar.sh --sem-snapshot  só no primeiro deploy (banco vazio)
#
# Para com código ≠ 0 se a migração falhar, mostrando o log — é o que impede o
# deploy de subir a aplicação sobre um banco pela metade. DDL no MySQL não é
# transacional: o snapshot é a volta (PLANO §11.5).
#
# Também é o passo que promove o primeiro admin (ADMIN_EMAIL): depois do primeiro
# deploy, crie a conta no site e rode este script de novo.
set -euo pipefail
# shellcheck source=scripts/aws-env.sh
. "$(dirname "$0")/aws-env.sh"

SNAPSHOT=1
for arg in "$@"; do
  case "$arg" in
    --sem-snapshot) SNAPSHOT=0 ;;
    *) falha "argumento desconhecido: $arg" ;;
  esac
done

MANASYNC_PULAR_DOCKER=1 preparar_ambiente

PREFIXO_SNAPSHOT=manasync-pre-migracao-
RETENCAO_DIAS=30
MINIMO_MANTIDO=3

INSTANCIA="$(saida_stack ManaSyncDados BancoInstancia)"
TASK_DEF="$(saida_stack ManaSyncMigracao TaskDefArn)"
CLUSTER="$(saida_stack ManaSyncMigracao ClusterArn)"
SG="$(saida_stack ManaSyncMigracao SgMigracao)"
SUBNETS="$(saida_stack ManaSyncMigracao SubnetsPublicas)"
LOGS="$(saida_stack ManaSyncMigracao LogGroup)"

if [ "$SNAPSHOT" = "1" ]; then
  ID_SNAPSHOT="$PREFIXO_SNAPSHOT$(date -u +%Y%m%d-%H%M%S)"
  info "snapshot $ID_SNAPSHOT de $INSTANCIA"
  aws_ rds create-db-snapshot --db-instance-identifier "$INSTANCIA" --db-snapshot-identifier "$ID_SNAPSHOT" \
    --tags Key=projeto,Value=manasync Key=finalidade,Value=pre-migracao >/dev/null
  aws_ rds wait db-snapshot-available --db-snapshot-identifier "$ID_SNAPSHOT" ||
    falha "o snapshot $ID_SNAPSHOT não ficou disponível — migração NÃO executada"
  ok "snapshot disponível"
else
  aviso "sem snapshot (--sem-snapshot): use só com o banco vazio do primeiro deploy"
fi

info "rodando a task de migração"
resposta="$(aws_ ecs run-task --cluster "$CLUSTER" --task-definition "$TASK_DEF" --launch-type FARGATE \
  --started-by manasync-migrar \
  --network-configuration "awsvpcConfiguration={subnets=[$SUBNETS],securityGroups=[$SG],assignPublicIp=ENABLED}" \
  --output json)"
TASK="$(jq -r '.tasks[0].taskArn // empty' <<<"$resposta")"
[ -n "$TASK" ] || falha "a task não iniciou: $(jq -c '.failures' <<<"$resposta")"
ID_TASK="${TASK##*/}"
ok "task $ID_TASK"

aws_ ecs wait tasks-stopped --cluster "$CLUSTER" --tasks "$TASK" ||
  falha "a task $ID_TASK não terminou no prazo do waiter — confira no console antes de continuar"

read -r CODIGO MOTIVO < <(aws_ ecs describe-tasks --cluster "$CLUSTER" --tasks "$TASK" \
  --query 'tasks[0].[containers[0].exitCode, stoppedReason]' --output text)

log_da_task() {
  aws_ logs get-log-events --log-group-name "$LOGS" --log-stream-name "migracao/migracao/$ID_TASK" \
    --start-from-head --query 'events[].message' --output text 2>/dev/null | tr '\t' '\n' | tail -n "$1"
}

if [ "$CODIGO" != "0" ]; then
  aviso "log da migração:"
  log_da_task 40 >&2 || true
  if [ "$SNAPSHOT" = "1" ]; then
    aviso "snapshot para restaurar, se preciso: $ID_SNAPSHOT (PLANO §11.5)"
  fi
  falha "migração falhou (exitCode=$CODIGO, $MOTIVO). O deploy deve parar aqui."
fi
log_da_task 5 >&2 || true
ok "migração concluída"

if [ "$SNAPSHOT" = "1" ]; then
  # Limpa só os snapshots deste script, mais velhos que a retenção, mantendo sempre
  # os mais recentes. Snapshot manual não expira sozinho e custa armazenamento.
  corte="$(date -u -d "-$RETENCAO_DIAS days" +%Y-%m-%dT%H:%M:%S)"
  aws_ rds describe-db-snapshots --db-instance-identifier "$INSTANCIA" --snapshot-type manual --output json |
    jq -r --arg p "$PREFIXO_SNAPSHOT" --arg corte "$corte" --argjson manter "$MINIMO_MANTIDO" '
      [.DBSnapshots[] | select(.DBSnapshotIdentifier | startswith($p))]
      | sort_by(.SnapshotCreateTime) | reverse | .[$manter:]
      | map(select(.SnapshotCreateTime < $corte)) | .[].DBSnapshotIdentifier' |
    while read -r antigo; do
      aws_ rds delete-db-snapshot --db-snapshot-identifier "$antigo" >/dev/null
      ok "snapshot antigo removido: $antigo"
    done
fi
