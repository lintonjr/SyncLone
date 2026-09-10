# Infraestrutura — ManaSync Clone

Specs de provisionamento para colocar o projeto **online** em nuvem pública.
Um documento por provedor:

| Provedor      | Spec                                  | Diagrama (draw.io)                        |
|---------------|---------------------------------------|-------------------------------------------|
| Google Cloud  | [`googlecloud/SPEC.md`](googlecloud/SPEC.md) | [`diagramas/gcp.drawio`](diagramas/gcp.drawio) |
| AWS           | [`aws/SPEC.md`](aws/SPEC.md)           | [`diagramas/aws.drawio`](diagramas/aws.drawio) |

Os diagramas de arquitetura de cada provedor ficam em
[`diagramas/`](diagramas/README.md) — formato draw.io, abrem em app.diagrams.net,
no draw.io Desktop ou na extensão Draw.io Integration do VS Code.

As duas specs entregam a **mesma topologia lógica**; mudam só os serviços gerenciados.
Este README descreve o que é comum: a arquitetura da aplicação, o que ela exige do
ambiente e as mudanças de código que precisam acontecer **antes** de qualquer deploy
em nuvem (hoje o projeto só está pronto para `docker compose` local).

---

## 1. Arquitetura da aplicação (o que existe hoje)

```
                      ┌─────────────────────────────┐
   navegador  ─────►  │  frontend (nginx + Angular)  │   :80
                      │  - serve SPA estática        │
                      │  - proxy /api  → backend     │
                      │  - proxy /uploads → backend  │
                      │  - proxy_buffering off (SSE) │
                      └──────────────┬──────────────┘
                                     │ HTTP
                      ┌──────────────▼──────────────┐
                      │  backend (Node 20 / Express) │   :3001
                      │  - API REST + JWT            │
                      │  - SSE  GET /api/events/:id/stream
                      │  - uploads via multer → disco local (/app/uploads)
                      │  - registry SSE em memória (1 processo)
                      └──────────────┬──────────────┘
                                     │ TCP 3306
                      ┌──────────────▼──────────────┐
                      │  MySQL 8                     │   :3306
                      │  - schema em db/init/01-schema.sql
                      │  - migrations em db/migrations/
                      └─────────────────────────────┘
```

### Componentes e imagens

| Componente | Runtime | Imagem / build | Porta | Estado |
|------------|---------|----------------|-------|--------|
| `frontend` | nginx:alpine | `frontend/Dockerfile` (multi-stage, build Angular → estático) | 80 | stateless |
| `backend`  | node:20-alpine | `backend/Dockerfile` | 3001 | **stateful de fato** (ver §2) |
| `mysql`    | mysql:8.0 | imagem oficial | 3306 | stateful (volume `mysql_data`) |

### Dependências externas

- **Nenhuma.** Não há envio de e-mail (o `POST /api/auth/forgot-password` é stub),
  QR code é gerado no cliente, não há gateway de pagamento, fila, cache Redis nem
  bucket de terceiros. Isso simplifica bastante o provisionamento.

### Variáveis de ambiente do backend

| Variável | Hoje | Em produção |
|----------|------|-------------|
| `PORT` | 3001 | 3001 (ou o que o runtime injetar) |
| `JWT_SECRET` | string fixa no compose | **secret gerenciado**, ≥ 32 bytes aleatórios |
| `JWT_EXPIRES_IN` | `7d` | `7d` |
| `DB_HOST` / `DB_PORT` | `mysql` / 3306 | endpoint do MySQL gerenciado |
| `DB_USER` / `DB_PASS` | `root` / `root123` | usuário dedicado + secret |
| `DB_NAME` | `manasync` | `manasync` |

---

## 2. Restrições que a infra tem que resolver

Estes três pontos são o motivo do backend **não** ser puramente stateless. Cada spec
de provedor tem uma seção dedicada a eles.

### 2.1 Uploads em disco local (`multer.diskStorage`)

`backend/src/routes/events.js` grava as imagens de capa em `../../uploads` no
filesystem do container e as serve via `express.static`. Em nuvem isso quebra assim
que houver **mais de uma instância** ou um **redeploy** (o disco é efêmero).

Opções, por ordem de preferência:

1. **Object storage** (S3 / GCS) — exige mudança de código (trocar `diskStorage`
   por um storage engine de S3/GCS e servir `/uploads` por URL assinada ou CDN).
   Solução correta a médio prazo.
2. **Filesystem de rede compartilhado** (EFS / Filestore) montado em todas as
   instâncias — zero mudança de código, custo fixo mais alto, e ainda é um ponto
   único de I/O.
3. **Instância única** (`max instances = 1`) + volume persistente — aceitável para
   um clone/demo, é o default das specs.

### 2.2 Registry SSE em memória (`backend/src/services/eventStream.js`)

O fan-out de Server-Sent Events usa um `Map` em memória do processo. Se o cliente A
está conectado à instância 1 e o organizador dispara um evento na instância 2, o
cliente A **não** recebe o update.

Opções:

1. **Rodar 1 única instância do backend** (default das specs). Simples, e o
   suficiente para a carga de um clone. Combina bem com 2.1 opção 3.
2. **Redis pub/sub** (Memorystore / ElastiCache) — cada instância publica o
   `broadcast` num canal e todas reenviam para seus próprios clientes SSE. Exige
   mudança de código (~30 linhas). Necessário se for escalar horizontalmente.

### 2.3 Idle timeout do load balancer x SSE

A conexão SSE fica aberta indefinidamente. O backend já manda um heartbeat
`: ping` a cada 25 s (`events.js:152`), então qualquer idle timeout de LB **≥ 30 s**
já segura a conexão. Ainda assim as specs recomendam subir o timeout para
~3600 s e **desligar o response buffering** no LB/CDN para o caminho
`/api/events/*/stream`.

### 2.4 Bootstrap do banco

O truque do `docker-entrypoint-initdb.d` **não existe** em MySQL gerenciado
(Cloud SQL / RDS). O schema (`db/init/01-schema.sql`) e as migrations
(`db/migrations/*.sql`) precisam ser aplicados por um **job de migração**
(Cloud Run Job / ECS task one-off) ou manualmente na primeira subida.

---

## 3. Mudanças de código pré-deploy (bloqueiam o "online")

| # | Arquivo | Mudança | Motivo |
|---|---------|---------|--------|
| 1 | `frontend/src/environments/environment.ts` | `apiUrl` deve virar caminho **relativo** (`/api`) e ter um `environment.prod.ts` com `fileReplacements` no `angular.json` | Hoje está fixo em `http://localhost:3001/api`; em nuvem o browser precisa bater no mesmo domínio, atrás do LB/CDN |
| 2 | `backend/src/routes/events.js` | uploads → object storage **ou** aceitar instância única (§2.1) | disco efêmero |
| 3 | `backend/src/app.js` | `cors` origin fixo em `localhost:4200` → env var `CORS_ORIGIN` (ou remover CORS se tudo for same-origin atrás do LB/CDN) | requests de produção seriam bloqueados |
| 4 | `backend/src/services/eventStream.js` | manter 1 instância **ou** portar para Redis pub/sub (§2.2) | SSE multi-instância |
| 5 | — | criar job/pipeline que roda `01-schema.sql` + `db/migrations/*` (§2.4) | banco gerenciado não roda initdb |
| 6 | `backend/Dockerfile` | adicionar `HEALTHCHECK` batendo em `/api/health` (endpoint já existe em `app.js:13`) | health check do LB / autoscaler |

> Sem #1, #3 e #5 a aplicação **não sobe**. #2 e #4 podem ser adiados aceitando
> a limitação de instância única.

---

## 4. Topologia alvo (comum aos dois provedores)

```
            DNS (zona gerenciada)  ─►  Certificado TLS gerenciado
                        │
                        ▼
        ┌───────────────────────────────┐
        │   HTTPS Load Balancer / CDN    │
        │   path routing:                │
        │     /api/*      → backend      │
        │     /uploads/*  → backend      │
        │     /*          → frontend     │
        └───────┬───────────────┬────────┘
                │               │
        ┌───────▼──────┐  ┌─────▼─────────────┐
        │  frontend    │  │  backend          │
        │  (container  │  │  (container       │
        │   estático   │  │   Node, 1 inst.)  │
        │   OU bucket) │  │                   │
        └──────────────┘  └───────┬───────────┘
                                  │ IP privado (VPC)
                          ┌───────▼───────────┐
                          │  MySQL gerenciado │
                          │  (rede privada)   │
                          └───────────────────┘

   Suporte: registro de imagens · secret manager · logs/métricas ·
            (opcional) object storage p/ uploads · (opcional) Redis p/ SSE
```

O LB assumindo o path routing **substitui o proxy do nginx**. O container `frontend`
pode então virar só um bucket estático + CDN, ou continuar como container nginx
servindo só os arquivos. Cada spec descreve as duas variantes.

---

## 5. Ordem de provisionamento

1. Projeto/conta, APIs/serviços habilitados, IAM base
2. Rede (VPC, subnets, conector serverless / NAT)
3. Registro de imagens + push das imagens `backend` e `frontend`
4. Secret manager (JWT_SECRET, credenciais do banco)
5. MySQL gerenciado (instância + database + usuário)
6. Job de migração → aplica schema e migrations
7. Serviço backend (1 instância, secrets e conexão ao banco)
8. Frontend (bucket+CDN ou serviço de container)
9. Load balancer + regras de path + NEG/target groups
10. Certificado TLS + registros DNS
11. Health checks, alarmes de log/métrica
12. Pipeline de CI/CD (build → push → deploy)

---

## 6. O que está fora de escopo destas specs

- IaC pronto (Terraform/CDK) — as specs listam recurso, parâmetro e sizing;
  a implementação em código fica como passo seguinte.
- HA multi-região / disaster recovery — as specs são single-region com backups.
- WAF / proteção DDoS avançada — anotado como opcional em cada provedor.
