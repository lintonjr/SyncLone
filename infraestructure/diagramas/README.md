# Diagramas de infraestrutura

Diagramas de arquitetura em formato **draw.io** (`.drawio` = XML do diagrams.net),
um por provedor. Refletem `../aws/SPEC.md` (implementado) e `../googlecloud/SPEC.md` (referência).

| Arquivo | Provedor | Topologia desenhada |
|---------|----------|---------------------|
| [`aws.drawio`](aws.drawio) | AWS · `us-east-2` · **implementado** | CloudFront (SPA, `/api`, `/uploads`) · ECS Fargate ARM em subnet pública (sem ALB, sem NAT) · RDS MySQL 8.4 · Valkey Serverless · Lambda de DNS da origem |
| [`gcp.drawio`](gcp.drawio) | Google Cloud · `southamerica-east1` | Global External Application LB · Cloud Storage + CDN (SPA) · Cloud Run (backend, 1 instância) · Cloud SQL MySQL 8 |

## Como abrir

- **Web:** [app.diagrams.net](https://app.diagrams.net) → *File ▸ Open from ▸ Device*
- **Desktop:** [draw.io Desktop](https://github.com/jgraph/drawio-desktop/releases)
- **VS Code:** extensão *Draw.io Integration* (`hediet.vscode-drawio`) — abre o `.drawio` direto no editor

As formas usam as bibliotecas oficiais do próprio draw.io (`mxgraph.aws4.*` e
`mxgraph.gcp2.*`), então não é preciso importar shape library nenhuma.

## Convenções

- **Linha cheia + traço grosso** = caminho principal da requisição
- **Linha tracejada** = relação de suporte (certificado, DNS, migração, gravação de upload, deploy)
- A caixa amarela no rodapé resume as decisões que o desenho reflete
- `gcp.drawio` ainda usa a convenção antiga (ícone semitransparente = opcional), por ser só referência

Ao mudar a arquitetura, atualize o diagrama na mesma alteração. O `aws.drawio` foi gerado
por script e conferido renderizado (draw.io headless); editar à mão no diagrams.net é normal.
