# shellcheck shell=bash
# Funções compartilhadas pelos scripts de deploy. Feito para ser carregado com `.`.
#
# Toda ferramenta externa passa por uma variável (MANASYNC_AWS, MANASYNC_CDK, ...):
# é o que deixa os testes (scripts/test/) trocarem a AWS de verdade por um stub
# que responde o combinado e registra cada chamada.

RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
export RAIZ

# Usadas pelos scripts que carregam esta biblioteca (o shellcheck não vê o uso).
# shellcheck disable=SC2034
REGIAO_PROJETO=us-east-2
# shellcheck disable=SC2034
PERFIL_PROJETO=manasync
# Trocáveis nos testes: sem isto eles leriam o cdk.json e o .env de verdade.
CDK_JSON="${MANASYNC_CDK_JSON:-$RAIZ/infra/cdk.json}"
ENV_FILE="${MANASYNC_ENV_FILE:-$RAIZ/.env}"

AWS_BIN="${MANASYNC_AWS:-aws}"
DOCKER_BIN="${MANASYNC_DOCKER:-docker}"
NPM_BIN="${MANASYNC_NPM:-npm}"
DIG_BIN="${MANASYNC_DIG:-dig}"
CURL_BIN="${MANASYNC_CURL:-curl}"

if [ -t 2 ]; then
  _cor() { printf '\033[%sm' "$1"; }
else
  _cor() { :; }
fi

info()  { printf '%s==>%s %s\n' "$(_cor '1;34')" "$(_cor 0)" "$*" >&2; }
ok()    { printf '%s ok%s %s\n' "$(_cor '1;32')" "$(_cor 0)" "$*" >&2; }
aviso() { printf '%s  !%s %s\n' "$(_cor '1;33')" "$(_cor 0)" "$*" >&2; }
falha() { printf '%sERRO%s %s\n' "$(_cor '1;31')" "$(_cor 0)" "$*" >&2; exit 1; }

aws_()    { "$AWS_BIN" "$@"; }
docker_() { "$DOCKER_BIN" "$@"; }
npm_()    { "$NPM_BIN" "$@"; }
dig_()    { "$DIG_BIN" "$@"; }
curl_()   { "$CURL_BIN" "$@"; }

# O CLI do CDK roda de dentro de infra/, onde estão o cdk.json e o node_modules.
cdk_() {
  if [ -n "${MANASYNC_CDK:-}" ]; then
    "$MANASYNC_CDK" "$@"
  else
    (cd "$RAIZ/infra" && npx cdk "$@")
  fi
}

exigir_comando() {
  local cmd
  for cmd in "$@"; do
    command -v "$cmd" >/dev/null 2>&1 || falha "comando '$cmd' não encontrado"
  done
}

# Lê uma chave de contexto do infra/cdk.json.
contexto() {
  jq -r --arg k "$1" '.context[$k] // empty' "$CDK_JSON"
}

# Uma chave de contexto que precisa estar preenchida (não vazia, não TROCAR...).
contexto_preenchido() {
  local valor
  valor="$(contexto "$1")"
  if [ -z "$valor" ] || [[ "$valor" == TROCAR* ]]; then
    falha "infra/cdk.json: '$1' ainda não foi preenchido ($2)"
  fi
  printf '%s' "$valor"
}

# Grava uma chave de contexto no infra/cdk.json, preservando o resto.
gravar_contexto() {
  local chave="$1" valor="$2" tmp
  tmp="$(mktemp)"
  jq --arg k "$chave" --arg v "$valor" '.context[$k] = $v' "$CDK_JSON" >"$tmp"
  mv "$tmp" "$CDK_JSON"
  ok "infra/cdk.json: $chave = $valor"
}

# Output de uma stack do CloudFormation; falha se não existir.
saida_stack() {
  local stack="$1" chave="$2" valor
  valor="$(aws_ cloudformation describe-stacks --stack-name "$stack" \
    --query "Stacks[0].Outputs[?OutputKey=='$chave'].OutputValue | [0]" --output text)" ||
    falha "não foi possível ler a stack $stack (ela já foi implantada?)"
  if [ -z "$valor" ] || [ "$valor" = "None" ]; then
    falha "a stack $stack não tem o output $chave"
  fi
  printf '%s' "$valor"
}

# Pergunta sim/não. Com MANASYNC_SIM=1 responde sim sem perguntar.
confirmar() {
  if [ "${MANASYNC_SIM:-0}" = "1" ]; then return 0; fi
  local resposta
  read -r -p "$1 [s/N] " resposta </dev/tty || return 1
  [[ "$resposta" =~ ^[sS]$ ]]
}

# Lê uma variável do .env da raiz sem executar o arquivo (ele não é código).
valor_do_env() {
  local arquivo="$ENV_FILE"
  [ -f "$arquivo" ] || return 0
  sed -n "s/^[[:space:]]*$1[[:space:]]*=[[:space:]]*//p" "$arquivo" | tail -n1 | tr -d '"'"'"'\r' | xargs
}
