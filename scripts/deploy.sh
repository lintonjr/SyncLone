#!/usr/bin/env bash
# Deploy do ManaSync na AWS, na ordem que o `cdk deploy --all` não respeita.
#
#   scripts/deploy.sh primeiro   primeira vez (banco vazio)
#   scripts/deploy.sh release    toda release depois
#
# Opções:
#   --sim            não pergunta nada (inclui mudanças de IAM/SG no CDK)
#   --pular-testes   não roda os testes de template do infra/ antes
#
# Pré-requisitos (PLANO §0.4, §0.5): aws login --profile manasync; zona gravada no
# infra/cdk.json (scripts/zona.sh) e certificado no infra/cdk.context.json
# (scripts/certificado.sh, fora do git).
#
# Para no primeiro erro. A migração roda ENTRE as stacks de dados e a aplicação:
# uma aplicação nova nunca sobe sobre um schema velho.
set -euo pipefail
# shellcheck source=scripts/aws-env.sh
. "$(dirname "$0")/aws-env.sh"

MODO="${1:-}"
shift || true
TESTES=1
for arg in "$@"; do
  case "$arg" in
    --sim) export MANASYNC_SIM=1 ;;
    --pular-testes) TESTES=0 ;;
    *) falha "argumento desconhecido: $arg" ;;
  esac
done
case "$MODO" in
  primeiro | release) ;;
  *) falha "uso: scripts/deploy.sh primeiro|release [--sim] [--pular-testes]" ;;
esac

DIR="$(cd "$(dirname "$0")" && pwd)"
MIGRAR="${MANASYNC_MIGRAR:-$DIR/migrar.sh}"
PUBLICAR="${MANASYNC_PUBLICAR:-$DIR/publicar-spa.sh}"

preparar_ambiente
contexto_preenchido manasync:zoneName 'zona do domínio (infra/cdk.json)' >/dev/null
contexto_preenchido manasync:hostedZoneId 'rode scripts/zona.sh --gravar' >/dev/null
contexto_preenchido manasync:certificateArn 'rode scripts/certificado.sh --gravar' >/dev/null

mapfile -t CTX < <(args_cdk)
APROVACAO=()
[ "${MANASYNC_SIM:-0}" = "1" ] && APROVACAO=(--require-approval never)

implantar() {
  info "cdk deploy $*"
  # --exclusively: a ordem é deste script, não do grafo de dependências do CDK.
  cdk_ deploy --exclusively "$@" "${CTX[@]}" "${APROVACAO[@]}"
}

if [ "$TESTES" = "1" ]; then
  info "testes de template e cdk-nag (infra/)"
  (cd "$RAIZ/infra" && npm_ test)
fi

aws_ cloudformation describe-stacks --stack-name CDKToolkit --query 'Stacks[0].StackStatus' --output text >/dev/null 2>&1 ||
  falha "CDK sem bootstrap em $REGIAO_PROJETO — rode: (cd infra && npx cdk bootstrap aws://\$MANASYNC_CONTA/$REGIAO_PROJETO)"

if [ "$MODO" = "primeiro" ]; then
  implantar ManaSyncRede ManaSyncDados ManaSyncMigracao
  "$MIGRAR" --sem-snapshot
  implantar ManaSyncBorda
  "$PUBLICAR"
  implantar ManaSyncApp

  ok "primeiro deploy concluído"
  cat >&2 <<EOF

Agora, nesta ordem:
  1. Confirme a assinatura de alertas que a AWS mandou para $ADMIN_EMAIL.
  2. Crie a sua conta em https://$(contexto manasync:domainName) com $ADMIN_EMAIL
     — ANTES de divulgar o endereço (PLANO §4.3).
  3. scripts/migrar.sh   (promove a sua conta a admin; confira no log)
  4. scripts/fumaca.sh
EOF
else
  implantar ManaSyncRede ManaSyncDados ManaSyncMigracao
  "$MIGRAR"
  implantar ManaSyncBorda
  implantar ManaSyncApp
  "$PUBLICAR"
  ok "release concluída — rode scripts/fumaca.sh"
fi
