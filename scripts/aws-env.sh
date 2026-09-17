#!/usr/bin/env bash
# Prepara e confere o ambiente de deploy. Carregado pelos outros scripts:
#
#   . scripts/aws-env.sh && preparar_ambiente
#
# Rodado sozinho, só confere e mostra o resumo:
#
#   scripts/aws-env.sh
#
# Tudo que pode fazer um deploy dar errado *antes* de começar é verificado aqui:
# conta, região, login expirado, emulação arm64, versão do Node e o e-mail do dono.
#
# A conta do projeto (MANASYNC_CONTA) e o dono (ADMIN_EMAIL) vêm do .env da raiz,
# fora do git: o repositório é público e não carrega nenhum dos dois.

# shellcheck source=scripts/lib/comum.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib/comum.sh"

preparar_ambiente() {
  exigir_comando jq node

  # Perfil e região do projeto. Outro perfil exportado é recusado, não trocado em
  # silêncio: o `default` desta máquina é outra conta.
  if [ -n "${AWS_PROFILE:-}" ] && [ "$AWS_PROFILE" != "$PERFIL_PROJETO" ]; then
    falha "AWS_PROFILE=$AWS_PROFILE; use AWS_PROFILE=$PERFIL_PROJETO (ou desexporte a variável)"
  fi
  export AWS_PROFILE="$PERFIL_PROJETO"
  export AWS_REGION="$REGIAO_PROJETO"
  export AWS_DEFAULT_REGION="$REGIAO_PROJETO"

  local node_major
  node_major="$(node -p 'process.versions.node.split(".")[0]')"
  [ "$node_major" = "24" ] || falha "Node $node_major em uso; o projeto usa 24 (rode 'nvm use' na raiz)"

  MANASYNC_CONTA="${MANASYNC_CONTA:-$(valor_do_env MANASYNC_CONTA)}"
  [[ "$MANASYNC_CONTA" =~ ^[0-9]{12}$ ]] ||
    falha "MANASYNC_CONTA não definida no .env da raiz (12 dígitos: o ID da conta do projeto em AWS Settings)"
  export MANASYNC_CONTA

  local conta
  if ! conta="$(aws_ sts get-caller-identity --query Account --output text 2>&1)"; then
    falha "credenciais do perfil $PERFIL_PROJETO indisponíveis ou expiradas — rode: aws login --profile $PERFIL_PROJETO ($conta)"
  fi
  [ "$conta" = "$MANASYNC_CONTA" ] || falha "as credenciais são da conta $conta, não da conta do projeto (MANASYNC_CONTA)"

  if [ "${MANASYNC_PULAR_DOCKER:-0}" != "1" ]; then
    # As imagens são linux/arm64 (Fargate Graviton); sem emulação, o build falha
    # no primeiro RUN e só depois de minutos de deploy.
    docker_ buildx ls 2>/dev/null | grep -q 'linux/arm64' ||
      falha "Docker sem emulação arm64 — instale qemu-user-static e binfmt-support (PLANO §0.4)"
  fi

  ADMIN_EMAIL="${ADMIN_EMAIL:-$(valor_do_env ADMIN_EMAIL)}"
  [ -n "$ADMIN_EMAIL" ] || falha "ADMIN_EMAIL não definido (.env da raiz)"
  case "${ADMIN_EMAIL,,}" in
    *@mercadiastore.online | *.mercadiastore.online)
      falha "ADMIN_EMAIL não pode ser do domínio mercadiastore.online (o cadastro não confirma e-mail)" ;;
  esac
  export ADMIN_EMAIL

  ok "conta do projeto conferida, perfil $AWS_PROFILE, região $AWS_REGION, Node $node_major, dono $ADMIN_EMAIL"
}

# Argumentos de contexto que o CDK precisa e que não ficam no cdk.json.
args_cdk() {
  printf '%s\n' -c "manasync:adminEmail=$ADMIN_EMAIL"
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  set -euo pipefail
  preparar_ambiente
fi
