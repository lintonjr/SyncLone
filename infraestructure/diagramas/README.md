# Diagramas de infraestrutura

Diagramas de arquitetura em formato **draw.io** (`.drawio` = XML do diagrams.net),
um por provedor. Refletem as specs de `../aws/SPEC.md` e `../googlecloud/SPEC.md`.

| Arquivo | Provedor | Topologia desenhada |
|---------|----------|---------------------|
| [`aws.drawio`](aws.drawio) | AWS · `sa-east-1` | CloudFront + S3 (SPA) · ALB · ECS Fargate (backend, 1 task) · RDS MySQL 8 |
| [`gcp.drawio`](gcp.drawio) | Google Cloud · `southamerica-east1` | Global External Application LB · Cloud Storage + CDN (SPA) · Cloud Run (backend, 1 instância) · Cloud SQL MySQL 8 |

## Como abrir

- **Web:** [app.diagrams.net](https://app.diagrams.net) → *File ▸ Open from ▸ Device*
- **Desktop:** [draw.io Desktop](https://github.com/jgraph/drawio-desktop/releases)
- **VS Code:** extensão *Draw.io Integration* (`hediet.vscode-drawio`) — abre o `.drawio` direto no editor

As formas usam as bibliotecas oficiais do próprio draw.io (`mxgraph.aws4.*` e
`mxgraph.gcp2.*`), então não é preciso importar shape library nenhuma.

## Convenções dos dois diagramas

- **Linha cheia + traço grosso** = caminho principal da requisição (browser → LB → backend → banco)
- **Linha tracejada** = relação de suporte (pull de imagem, leitura de secret, logs, CI/CD)
- **Ícone tracejado / semitransparente** = recurso **opcional** (WAF/Cloud Armor, Redis) ou **variante alternativa**
  (frontend como container em vez de bucket estático)
- A caixa amarela no rodapé resume as restrições que a infra precisa respeitar
  (instância única por causa do SSE em memória e dos uploads em disco, timeout de LB
  para SSE, e o job de migração que substitui o `docker-entrypoint-initdb.d`)

Ao mudar uma spec, atualize o diagrama correspondente na mesma alteração.
