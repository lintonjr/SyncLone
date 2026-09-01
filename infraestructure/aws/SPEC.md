# Spec de provisionamento — AWS

Alvo: colocar o **ManaSync Clone** online na AWS, single-region, com TLS e domínio.
Leia antes: [`../README.md`](../README.md) (arquitetura, restrições §2, mudanças de
código §3).

- **Região de referência:** `sa-east-1` (São Paulo). Qualquer região com ECS Fargate
  + RDS MySQL serve.
- **Runtime de container escolhido:** ECS Fargate (sem servidores para gerir, sem
  control plane pago). Alternativas App Runner e EKS em §14.
- **Premissa de escala:** `desiredCount = 1` no serviço de backend (restrições §2.1
  e §2.2 do README).

---

## 1. Resumo dos recursos

| # | Recurso AWS | Serve para | Obrigatório |
|---|-------------|------------|-------------|
| 1 | Conta / OU + IAM base | base | ✅ |
| 2 | VPC + 2 subnets públicas + 2 privadas (2 AZ) | isolamento de rede | ✅ |
| 3 | Internet Gateway + 1 NAT Gateway + route tables | saída das subnets privadas | ✅ |
| 4 | Security Groups (`alb`, `backend`, `frontend`, `rds`) | firewall L4 | ✅ |
| 5 | ECR repos `manasync/backend`, `manasync/frontend` | imagens | ✅ |
| 6 | Secrets Manager (`manasync/jwt`, `manasync/db`) | segredos do backend | ✅ |
| 7 | RDS for MySQL 8 (Single-AZ) | banco `manasync` | ✅ |
| 8 | ECS Cluster (Fargate) | orquestração | ✅ |
| 9 | ECS Task de migração (run-task one-off) | aplica `01-schema.sql` + `db/migrations/*` | ✅ |
| 10 | ECS Service `manasync-backend` + Task Definition | API + SSE | ✅ |
| 11 | S3 bucket (site) + CloudFront **ou** ECS Service `manasync-frontend` | SPA estática | ✅ (uma das duas) |
| 12 | Application Load Balancer + Target Group + Listeners/Rules | path routing `/api`,`/uploads`,`/*` | ✅ |
| 13 | ACM certificate | TLS | ✅ |
| 14 | Route 53 hosted zone + registros alias | domínio | ✅ |
| 15 | IAM roles (`taskExecutionRole`, `taskRole` ×2) | identidade das tasks | ✅ |
| 16 | CloudWatch Log Groups + alarmes | observabilidade | ✅ (logs) / ⚠️ (alarmes) |
| 17 | S3 bucket `uploads` + code change | uploads persistentes | ⚠️ recomendado (§8) |
| 18 | EFS file system + Access Point | uploads sem mudar código (alternativa) | ⚠️ ver §8 |
| 19 | ElastiCache for Redis | SSE multi-instância | ⛔ só se escalar (§9) |
| 20 | ECR lifecycle policy | limpeza de imagens | ⚠️ recomendado |
| 21 | CodePipeline + CodeBuild (ou GitHub Actions + OIDC) | CI/CD | ⚠️ recomendado |
| 22 | AWS WAF v2 Web ACL | proteção L7 / rate-limit | ⛔ opcional |

---

## 2. Conta e base

- Conta dedicada (ou OU `workloads/manasync-prod`).
- Região default `sa-east-1`; ACM para CloudFront (se §11 variante A) precisa de cópia
  do cert em `us-east-1`.
- IAM: sem usuários de longa duração; deploy via role assumida (OIDC do GitHub ou
  CodePipeline service role).

---

## 3. Rede (VPC)

| Recurso | Parâmetro | Valor |
|---------|-----------|-------|
| VPC | CIDR | `10.20.0.0/16` |
| | nome | `manasync-vpc` |
| Subnets públicas | `10.20.0.0/24` (AZ a), `10.20.1.0/24` (AZ b) | ALB, NAT GW |
| Subnets privadas | `10.20.10.0/24` (AZ a), `10.20.11.0/24` (AZ b) | ECS tasks, RDS |
| Internet Gateway | `manasync-igw` | rota `0.0.0.0/0` das públicas |
| NAT Gateway | 1× em subnet pública AZ a (+ EIP) | rota `0.0.0.0/0` das privadas (2 NAT p/ HA = +custo) |
| DB Subnet Group | as 2 subnets privadas | RDS |
| VPC Endpoints (opcional, corta tráfego NAT) | `ecr.api`, `ecr.dkr`, `s3` (gateway), `secretsmanager`, `logs` | pull de imagem e segredos sem sair pra internet |

### Security Groups

| SG | Ingress | Egress |
|----|---------|--------|
| `sg-alb` | 443 e 80 de `0.0.0.0/0` | tudo |
| `sg-backend` | 3001 de `sg-alb` | tudo (precisa de NAT p/ Secrets Manager/ECR, ou usar VPC endpoints) |
| `sg-frontend` (variante B) | 80 de `sg-alb` | tudo |
| `sg-rds` | 3306 de `sg-backend` (e `sg-migrate`, que pode ser o mesmo `sg-backend`) | — |

---

## 4. ECR

| Parâmetro | Valor |
|-----------|-------|
| Repos | `manasync/backend`, `manasync/frontend` |
| Tag mutability | IMMUTABLE |
| Scan on push | ligado |
| Lifecycle policy | manter últimas 10 imagens tagueadas; expirar untagged > 14 d |
| Tag das imagens | short SHA do git |

---

## 5. Secrets Manager

| Secret | Conteúdo | Consumidor |
|--------|----------|------------|
| `manasync/jwt` | `{ "JWT_SECRET": "<48 bytes base64>" }` | task backend |
| `manasync/db` | `{ "username": "manasync_app", "password": "<gerada>", "host": "...", "port": 3306, "dbname": "manasync" }` | task backend + task migração; pode ser o **managed secret** que o RDS cria |

- Injeção na Task Definition via `secrets: [{ name: JWT_SECRET, valueFrom: <arn>:JWT_SECRET:: }]`.
- Rotation: opcional; se usar o managed secret do RDS, rotation automática disponível.

---

## 6. RDS for MySQL

| Parâmetro | Valor | Observação |
|-----------|-------|------------|
| Engine | MySQL 8.0.x | igual ao `mysql:8.0` do compose |
| Identifier | `manasync-db` | |
| Classe | `db.t4g.small` (2 vCPU / 2 GB, ARM) | `db.t4g.micro` p/ demo; subir se precisar |
| Storage | gp3, 20 GB, autoscaling até 100 GB | |
| Multi-AZ | **não** (Single-AZ) | Multi-AZ ≈ 2× custo, opcional |
| Rede | subnets privadas, **sem** acesso público | `sg-rds` |
| Porta | 3306 | |
| Parameter group (custom) | `time_zone = UTC`, `character_set_server = utf8mb4`, `collation_server = utf8mb4_unicode_ci` | app usa `timezone:'+00:00'` (`db.js:12`) e schema é utf8mb4 |
| Backup | retenção 7 dias, janela 03:00–04:00 UTC | |
| PITR | automático com backup ligado | |
| Deletion protection | ligado | |
| Maintenance window | domingo 04:00–05:00 UTC | |
| Storage encryption | ligado (KMS default) | |
| Initial DB name | `manasync` | |
| Master user | `admin` (só para bootstrap) | criar `manasync_app` no job de migração |
| Usuário de app | `manasync_app` | `GRANT SELECT,INSERT,UPDATE,DELETE,CREATE,ALTER,INDEX,REFERENCES ON manasync.*` — `CREATE/ALTER` só p/ o job de DDL |

Conexão do ECS: `DB_HOST` = endpoint do RDS, resolvido dentro da VPC.

---

## 7. ECS Cluster

| Parâmetro | Valor |
|-----------|-------|
| Nome | `manasync` |
| Capacity providers | `FARGATE`, `FARGATE_SPT` (spot opcional p/ frontend) |
| Container Insights | ligado |

---

## 8. Uploads

Sem isto, as imagens de capa somem a cada deploy do backend (restrição §2.1 do README).

### Opção 1 — S3 + mudança de código (recomendada)

| Recurso | Parâmetro |
|---------|-----------|
| Bucket | `manasync-uploads-<accountid>`, região `sa-east-1` |
| Block Public Access | ON (servir via CloudFront OU URL assinada) |
| Versionamento | opcional |
| CORS | permitir `GET` do domínio do site |
| IAM (`taskRole` backend) | `s3:PutObject,GetObject,DeleteObject` em `arn:aws:s3:::manasync-uploads-*/*` |

**Mudança de código** (`backend/src/routes/events.js`): `multer.diskStorage` →
`multer-s3` (ou `@aws-sdk/client-s3` + `memoryStorage`); retornar URL do objeto em
vez de `/uploads/<file>`. O path `/uploads/*` no ALB some ou vira origem do
CloudFront apontando pro bucket.

### Opção 2 — EFS (sem mudar código)

| Recurso | Parâmetro |
|---------|-----------|
| EFS file system | encrypted, throughput `Elastic` (ou Bursting) |
| Mount targets | 1 por AZ privada, `sg` permitindo 2049 de `sg-backend` |
| Access Point | uid/gid `1000`, path `/uploads`, permissão `0755` |
| Task Definition | volume `efs` → mount em `/app/uploads` |

Funciona com N instâncias, mas é I/O compartilhado e custo fixo. Aceitável.

### Ponte mínima (nenhuma das duas)

`desiredCount = 1` + volume efêmero: uploads sobrevivem enquanto a task viver,
somem em cada deploy. Só para demo.

---

## 9. SSE — ElastiCache for Redis (só se escalar > 1 task)

Com `desiredCount = 1` **não é necessário**. Se precisar de N backends:

| Parâmetro | Valor |
|-----------|-------|
| Engine | Redis 7.x (ou Valkey) |
| Node type | `cache.t4g.micro` |
| Réplicas | 0 (1 se quiser HA) |
| Rede | subnets privadas, SG permitindo 6379 de `sg-backend` |
| Uso | `eventStream.js` publica `broadcast(eventId)` num canal pub/sub; cada task assina e reenvia aos seus `Response` SSE locais |

---

## 10. ECS Task de migração

| Parâmetro | Valor |
|-----------|-------|
| Family | `manasync-migrate` |
| Launch | Fargate, subnets privadas, `sg-backend` |
| Imagem | `manasync/backend:<tag>` (ou imagem com cliente `mysql`) |
| Command | script que roda `01-schema.sql` e `db/migrations/*.sql` em ordem |
| Secrets | do secret `manasync/db` |
| Execução | `aws ecs run-task` no primeiro deploy; step do pipeline antes de cada release com migration nova |
| taskRole | `manasync-migrate-task-role` (só leitura do secret) |

> ⚠️ Migrations `001`–`004` fazem `ALTER TABLE ... ADD COLUMN` sem `IF NOT EXISTS` —
> rodar duas vezes falha. Aplicar só uma vez ou adicionar tabela `schema_migrations`.

---

## 11. ECS Service — backend

### Task Definition `manasync-backend`

| Campo | Valor |
|-------|-------|
| Launch type | Fargate |
| CPU / Memória | 512 (.5 vCPU) / 1024 MiB |
| Network mode | `awsvpc` |
| Container `backend` | imagem `…/manasync/backend:<tag>`, porta 3001 |
| Env | `PORT=3001`, `JWT_EXPIRES_IN=7d`, `DB_HOST=<rds-endpoint>`, `DB_PORT=3306`, `DB_USER=manasync_app`, `DB_NAME=manasync`, `CORS_ORIGIN=https://<dominio>` (após código §3.3) |
| Secrets | `JWT_SECRET` ← `manasync/jwt`, `DB_PASS` ← `manasync/db:password::` |
| Volume (opção EFS §8) | `efs` → `/app/uploads` |
| Log driver | `awslogs` → grupo `/ecs/manasync-backend` |
| Health check (container) | `CMD-SHELL, wget -qO- http://localhost:3001/api/health || exit 1`, interval 30s |
| `taskExecutionRole` | pull ECR + ler secrets + escrever logs |
| `taskRole` | `s3:*Object` no bucket de uploads (opção S3) |

### Service

| Campo | Valor |
|-------|-------|
| Cluster | `manasync` |
| desiredCount | **1** (restrições §2.1/§2.2). Só subir com Redis + S3. |
| Subnets | privadas | `sg-backend` |
| Assign public IP | não |
| Load balancer | Target Group `tg-backend` (target type `ip`, protocolo HTTP:3001) |
| Health check do TG | path `/api/health`, healthy threshold 2, interval 15s, timeout 5s, matcher 200 |
| **Deregistration delay** | 30s (SSE — não deixar drenar eterno) |
| Deployment | rolling, `minimumHealthyPercent=100`, `maximumPercent=200` (com desiredCount=1 vira 0/1 momentâneo — aceitar breve downtime, ou usar CodeDeploy blue/green) |
| Circuit breaker | ligado, rollback on failure |

---

## 12. Frontend — duas variantes

### Variante A — S3 + CloudFront (recomendada)

| Recurso | Parâmetro |
|---------|-----------|
| Bucket | `manasync-frontend-<accountid>`, Block Public Access ON |
| Conteúdo | saída de `npm run build` (`frontend/dist/frontend/browser/`) |
| CloudFront | Origin = bucket via **OAC** (Origin Access Control) |
| Behaviors | `default (*)` → bucket, SPA; `/api/*` → origem ALB (no-cache, forward all headers, **response buffering off** p/ SSE); `/uploads/*` → ALB **ou** bucket de uploads |
| Custom error response | 403/404 → `/index.html` com 200 (SPA routing) |
| Cache policy | assets com hash: `max-age=31536000, immutable`; `index.html`: no-cache |
| ACM | cert em **`us-east-1`** para o CloudFront |
| WAF | opcional, associar Web ACL |

> Requer mudança de código §3.1 (apiUrl relativo).

### Variante B — ECS Service `manasync-frontend`

| Campo | Valor |
|-------|-------|
| Task | Fargate 256 CPU / 512 MiB, container nginx porta 80 |
| `nginx.conf` | **remover** `location /api/` e `/uploads/` (o ALB roteia); manter `try_files … /index.html` |
| Service | desiredCount 2, subnets privadas, `sg-frontend`, Target Group `tg-frontend` (HTTP:80, health `/`) |
| Autoscaling | target tracking CPU 60% (2→6) |

Variante A é preferível (CDN global, sem task para escalar, mais barata).

---

## 13. Application Load Balancer

| Recurso | Parâmetro |
|---------|-----------|
| Tipo | ALB, internet-facing, subnets públicas, `sg-alb` |
| **Idle timeout** | **3600 s** (SSE) |
| Listener 80 | redirect 301 → HTTPS |
| Listener 443 | cert ACM (`sa-east-1`), policy TLS 1.2+ |
| Regras (prioridade) | 1: `path /api/*` → `tg-backend` · 2: `path /uploads/*` → `tg-backend` (ou bucket via CloudFront) · default → `tg-frontend` (variante B) **ou** fixed-response/redirect se o CloudFront é a porta de entrada (variante A: o ALB só serve `/api` e `/uploads`, CloudFront serve o resto) |
| Target Group `tg-backend` | target `ip`, HTTP 3001, health `/api/health`, stickiness **off** (1 instância) |
| Access logs | para bucket S3 `manasync-alb-logs` |

> Variante A: **CloudFront é o único entrypoint público**. O ALB pode ficar
> internal ou continuar internet-facing mas restrito (SG só libera range do
> CloudFront via prefix list `com.amazonaws.global.cloudfront.origin-facing`).

---

## 14. DNS e TLS

| Recurso | Parâmetro |
|---------|-----------|
| Route 53 hosted zone | `example.com` |
| ACM `sa-east-1` | `manasync.example.com` (+ `www`), validação DNS — usado pelo ALB |
| ACM `us-east-1` | mesmo domínio — usado pelo CloudFront (variante A) |
| Registro alias | `manasync.example.com` → CloudFront (variante A) **ou** ALB (variante B) |
| Registro | `www` → alias para o de cima |

---

## 15. IAM

| Role | Uso | Políticas |
|------|-----|-----------|
| `manasync-task-execution-role` | ECS puxa imagem, lê secrets, escreve logs | `AmazonECSTaskExecutionRolePolicy` + `secretsmanager:GetSecretValue` nos 2 secrets |
| `manasync-backend-task-role` | app em runtime | `s3:{Put,Get,Delete}Object` no bucket uploads (se opção S3); nada além |
| `manasync-migrate-task-role` | job de migração | `secretsmanager:GetSecretValue` no `manasync/db` |
| `manasync-deploy-role` | CI/CD (OIDC GitHub ou CodePipeline) | `ecr:*` nos repos, `ecs:UpdateService`/`RegisterTaskDefinition`/`RunTask`, `iam:PassRole` das task roles, `s3:Sync` no bucket frontend, `cloudfront:CreateInvalidation` |

---

## 16. CI/CD

GitHub Actions com OIDC (sem chave estática) ou CodePipeline + CodeBuild:

1. build + push `backend` e `frontend` para ECR (tag `$GITHUB_SHA`)
2. `aws ecs run-task manasync-migrate` + wait (se migration nova)
3. registrar nova Task Definition + `aws ecs update-service --force-new-deployment` (backend)
4. Variante A: `aws s3 sync dist/frontend/browser s3://manasync-frontend-… --delete` + `aws cloudfront create-invalidation --paths '/index.html' '/'`
   Variante B: `update-service` do `manasync-frontend`

---

## 17. Observabilidade (CloudWatch)

| Item | Config |
|------|--------|
| Log Groups | `/ecs/manasync-backend`, `/ecs/manasync-frontend`, `/ecs/manasync-migrate` — retenção 30 d |
| Metric filter | padrão de stack trace do handler de erro (`app.js:21`) → métrica custom |
| Alarmes | (a) ALB `HTTPCode_Target_5XX_Count` > 10/5min; (b) ALB `TargetResponseTime` p95 > 2s; (c) ECS backend `RunningTaskCount` < 1; (d) RDS `CPUUtilization` > 80%/10min; (e) RDS `FreeStorageSpace` < 15%; (f) RDS `DatabaseConnections` perto do máximo |
| Route 53 health check | `https://manasync.example.com/api/health`, alarme se unhealthy |
| Container Insights | dashboards de CPU/mem por serviço |
| AWS Budgets | alerta em 50/90/100% do orçamento |

---

## 18. Alternativas de runtime

- **AWS App Runner** — mais simples que ECS (aponta pro ECR, ele gere ALB/scaling/TLS).
  Boa opção; limitação: VPC connector para o RDS, e `min size = 1` para o SSE.
  Menos controle sobre idle timeout.
- **EKS** — Kubernetes gerido. Overhead operacional desproporcional para este projeto.
- **EC2 + docker compose** — a forma mais barata e mais próxima do setup atual: 1
  instância `t4g.small`, o `docker-compose.yml` quase como está, RDS opcional (ou
  MySQL no próprio compose com volume EBS). Sem HA, sem escala, patching manual.
  Serve como MVP.

---

## 19. Estimativa de custo (ordem de grandeza, USD/mês, sa-east-1)

| Recurso | Estimativa |
|---------|------------|
| RDS `db.t4g.small` Single-AZ, 20 GB gp3 | ~35–50 |
| ECS Fargate backend (0.5 vCPU / 1 GB, 24×7) | ~18–25 |
| ECS Fargate frontend (variante B, 2× pequenas) ou S3+CloudFront (variante A) | ~15 / ~1–5 |
| ALB | ~18–22 + LCU |
| NAT Gateway (1×) | ~32 + tráfego |
| CloudFront (variante A, tráfego baixo) | ~1–5 |
| ECR, Secrets Manager, CloudWatch | ~2–5 |
| **Total** | **~110–160** (variante A, 1 NAT) |

Cortes: VPC endpoints no lugar do NAT (~-25 se o tráfego for só AWS APIs);
Fargate Spot no frontend; EC2 single-node (§18) derruba para ~25–40.
Multi-AZ no RDS e 2º NAT somam ~+50–65.
