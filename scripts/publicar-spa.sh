#!/usr/bin/env bash
# Build do Angular e publicação no bucket da SPA (PLANO §6.5).
#
#   scripts/publicar-spa.sh             build + publicação + invalidação
#   scripts/publicar-spa.sh --sem-build publica o dist/ que já existe
#
# Três regras de cache, cada uma pelo que o arquivo é:
#
#   - arquivos com hash no nome (main-ABCD1234.js): imutáveis por um ano — o nome
#     muda quando o conteúdo muda;
#   - index.html: no-cache — é ele que aponta para os bundles novos;
#   - o resto (favicon, assets): 5 minutos.
set -euo pipefail
# shellcheck source=scripts/aws-env.sh
. "$(dirname "$0")/aws-env.sh"

BUILD=1
for arg in "$@"; do
  case "$arg" in
    --sem-build) BUILD=0 ;;
    *) falha "argumento desconhecido: $arg" ;;
  esac
done

MANASYNC_PULAR_DOCKER=1 preparar_ambiente

BUCKET="$(saida_stack ManaSyncBorda BucketSpa)"
DISTRIBUICAO="$(saida_stack ManaSyncBorda DistribuicaoId)"
DIST="${MANASYNC_DIST_SPA:-$RAIZ/frontend/dist/frontend/browser}"

if [ "$BUILD" = "1" ]; then
  info "build do frontend"
  (cd "$RAIZ/frontend" && npm_ ci && npm_ run build)
fi
[ -f "$DIST/index.html" ] || falha "$DIST/index.html não existe — o build rodou?"

HASH=(--include '*-????????.js' --include '*-????????.css' --include '*-????????.mjs')

info "publicando em s3://$BUCKET"
# 1. Tudo menos index.html e os arquivos com hash, com cache curto. `--delete` tira
#    o que saiu do build; os bundles com hash antigos ficam (excluídos do sync), e
#    é bom que fiquem: uma aba aberta com o index.html antigo ainda os pede.
aws_ s3 sync "$DIST" "s3://$BUCKET" --delete --only-show-errors \
  --exclude index.html --exclude '*-????????.js' --exclude '*-????????.css' --exclude '*-????????.mjs' \
  --cache-control 'public, max-age=300'
# 2. Os arquivos com hash, imutáveis.
aws_ s3 sync "$DIST" "s3://$BUCKET" --only-show-errors --exclude '*' "${HASH[@]}" \
  --cache-control 'public, max-age=31536000, immutable'
# 3. index.html por último: só depois de os bundles que ele referencia existirem.
aws_ s3 cp "$DIST/index.html" "s3://$BUCKET/index.html" --only-show-errors \
  --cache-control 'no-cache' --content-type 'text/html; charset=utf-8'
ok "arquivos publicados"

# Toda rota sem extensão vira /index.html na CloudFront Function (antes do cache),
# então invalidar /index.html cobre a SPA inteira.
# As páginas estáticas (/presentation, /docs) têm index.html próprio, fora da
# reescrita da SPA: entram aqui para não ficarem até 5 min com a versão antiga.
aws_ cloudfront create-invalidation --distribution-id "$DISTRIBUICAO" \
  --paths '/index.html' '/' '/presentation*' '/docs*' >/dev/null
ok "invalidação criada na distribuição $DISTRIBUICAO"
