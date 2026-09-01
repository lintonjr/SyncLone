# Spec de provisionamento — Google Cloud

Alvo: colocar o **ManaSync Clone** online no GCP, single-region, com TLS e domínio.
Leia antes: [`../README.md`](../README.md) (arquitetura, restrições §2, mudanças de
código §3).

- **Região de referência:** `southamerica-east1` (São Paulo). Qualquer região com
  Cloud Run + Cloud SQL serve.
- **Runtime de container escolhido:** Cloud Run (serverless, sem cluster para gerir).
  Alternativa GKE Autopilot descrita em §12.
- **Premissa de escala:** 1 instância de backend (restrições §2.1 e §2.2 do README).

---

## 1. Resumo dos recursos

| # | Recurso GCP | Serve para | Obrigatório |
|---|-------------|------------|-------------|
| 1 | Project + APIs habilitadas | base | ✅ |
| 2 | VPC + subnet + Serverless VPC Access connector | Cloud Run → Cloud SQL por IP privado | ✅ |
| 3 | Cloud NAT + Router | saída à internet das instâncias com IP privado | ✅ |
| 4 | Artifact Registry (Docker) | imagens `backend` e `frontend` | ✅ |
| 5 | Secret Manager (`jwt-secret`, `db-password`) | segredos do backend | ✅ |
| 6 | Cloud SQL for MySQL 8 | banco `manasync` | ✅ |
| 7 | Cloud Run **Job** de migração | aplica `01-schema.sql` + `db/migrations/*` | ✅ |
| 8 | Cloud Run **Service** `manasync-backend` | API + SSE | ✅ |
| 9 | Cloud Storage bucket (site) **ou** Cloud Run Service `manasync-frontend` | SPA estática | ✅ (uma das duas) |
| 10 | Serverless NEGs + Backend Services | ligar Cloud Run/bucket ao LB | ✅ |
| 11 | Global External Application Load Balancer + URL map | path routing `/api`,`/uploads`,`/*` | ✅ |
| 12 | Managed SSL Certificate | TLS | ✅ |
| 13 | Cloud DNS managed zone + registros A/AAAA | domínio | ✅ |
| 14 | Service Accounts + IAM bindings | identidade de cada serviço | ✅ |
| 15 | Cloud Storage bucket `uploads` + code change | uploads persistentes | ⚠️ recomendado (§7) |
| 16 | Memorystore for Redis | SSE multi-instância | ⛔ só se escalar (§8) |
| 17 | Cloud Build trigger | CI/CD | ⚠️ recomendado |
| 18 | Cloud Monitoring alert policies + log-based metrics | observabilidade | ⚠️ recomendado |
| 19 | Cloud Armor policy | WAF / rate-limit | ⛔ opcional |

---

## 2. Project e APIs

- **Project:** `manasync-clone-prod` (ou usar um já existente).
- **APIs a habilitar:**
  `run.googleapis.com`, `sqladmin.googleapis.com`, `artifactregistry.googleapis.com`,
  `secretmanager.googleapis.com`, `compute.googleapis.com`, `vpcaccess.googleapis.com`,
  `dns.googleapis.com`, `cloudbuild.googleapis.com`, `monitoring.googleapis.com`,
  `logging.googleapis.com`, `servicenetworking.googleapis.com`,
  `redis.googleapis.com` (só se §8).
- **Billing:** conta de faturamento vinculada.

---

## 3. Rede

| Recurso | Parâmetro | Valor |
|---------|-----------|-------|
| VPC | modo | custom (`auto_create_subnetworks = false`) |
| | nome | `manasync-vpc` |
| Subnet | nome / região | `manasync-subnet` / `southamerica-east1` |
| | range primário | `10.10.0.0/24` |
| Serverless VPC Access connector | nome | `manasync-connector` |
| | range | `10.8.0.0/28` (bloco /28 dedicado, fora da subnet) |
| | instâncias | min 2 / max 3 (`e2-micro`) |
| Private Services Access | range alocado p/ Cloud SQL | `10.20.0.0/24` (peering `servicenetworking`) |
| Cloud Router | nome | `manasync-router` |
| Cloud NAT | nome | `manasync-nat`, alocação de IP automática, todos os ranges da subnet |
| Firewall | `allow-health-checks` | ingress de `130.211.0.0/22`, `35.191.0.0/16` nas portas dos backends |
| | `allow-internal` | ingress dentro de `10.10.0.0/24` |

> Cloud Run usa o **connector** para alcançar o IP privado do Cloud SQL. O egress do
> connector deve ser `private-ranges-only` (padrão) — tráfego público sai pelo NAT.

---

## 4. Artifact Registry

| Parâmetro | Valor |
|-----------|-------|
| Tipo | Docker |
| Nome | `manasync` |
| Região | `southamerica-east1` |
| Imagens | `southamerica-east1-docker.pkg.dev/PROJECT/manasync/backend:<tag>` e `.../frontend:<tag>` |
| Limpeza | política: manter 10 versões mais recentes por imagem, apagar não-tagueadas > 30 d |

Build: `gcloud builds submit` ou Cloud Build trigger (§11). Tag = short SHA do git.

---

## 5. Secret Manager

| Secret | Conteúdo | Consumidor |
|--------|----------|------------|
| `jwt-secret` | 48 bytes aleatórios base64 | backend env `JWT_SECRET` |
| `db-password` | senha do usuário `manasync_app` | backend + job de migração |

- Replicação: automática.
- Acesso: `roles/secretmanager.secretAccessor` para a SA do backend e a SA do job,
  **por secret** (não no projeto).
- Injeção no Cloud Run: `--set-secrets=JWT_SECRET=jwt-secret:latest,DB_PASS=db-password:latest`.

---

## 6. Cloud SQL for MySQL

| Parâmetro | Valor | Observação |
|-----------|-------|------------|
| Engine | MySQL 8.0 | igual ao `mysql:8.0` do compose |
| ID da instância | `manasync-db` | |
| Tier | `db-custom-1-3840` (1 vCPU / 3.75 GB) | sobe depois se precisar |
| Storage | 20 GB SSD, **auto-resize on** | |
| Região / AZ | `southamerica-east1`, single-zone | HA (`REGIONAL`) é opcional, ~2× custo |
| IP público | **desligado** | |
| IP privado | **ligado**, na `manasync-vpc` (via Private Services Access) | |
| Backups automáticos | ligados, janela 03:00–04:00, retenção 7 | |
| Point-in-time recovery | ligado (binlog) | |
| Flags | `default_time_zone = +00:00`, `character_set_server = utf8mb4` | app usa `timezone: '+00:00'` (`db.js:12`) e `utf8mb4` (schema) |
| Maintenance window | domingo 04:00 | |
| Deletion protection | ligado | |
| Database | `manasync` | `CHARSET utf8mb4 COLLATE utf8mb4_unicode_ci` |
| Usuário | `manasync_app` | senha do secret `db-password`; **não** usar `root` |
| Grants | `SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, REFERENCES` no schema `manasync` | `CREATE/ALTER` só porque o job de migração roda DDL; pode revogar depois |

Conexão a partir do Cloud Run: **IP privado direto** (`DB_HOST` = IP privado da
instância) via connector. Alternativa: Cloud SQL Auth Proxy como sidecar — não
necessário com IP privado + connector.

---

## 7. Uploads — Cloud Storage (recomendado)

Sem isto, as imagens de capa somem a cada deploy do backend (restrição §2.1 do README).

| Recurso | Parâmetro | Valor |
|---------|-----------|-------|
| Bucket | nome | `manasync-uploads-<projectnum>` |
| | localização | `southamerica-east1` |
| | uniform bucket-level access | ligado |
| | acesso público | **não** — servir via LB/CDN com backend bucket, ou URLs assinadas |
| | lifecycle | opcional: mover a `NEARLINE` após 90 d |
| IAM | SA do backend | `roles/storage.objectAdmin` **neste bucket** |

**Mudança de código necessária** (`backend/src/routes/events.js`): trocar
`multer.diskStorage` por upload direto ao bucket (`@google-cloud/storage` +
`multer.memoryStorage`) e gerar a URL pública/assinada em vez de `/uploads/<file>`.
O path `/uploads/*` no LB passa a apontar para um **backend bucket** com CDN, ou é
removido.

**Enquanto a mudança não acontece:** manter Cloud Run backend com
`--min-instances=1 --max-instances=1` e um volume. Cloud Run permite montar um
bucket GCS via `--add-volume type=cloud-storage` (gcsfuse) em `/app/uploads` —
funciona sem mudar código, com latência de gravação maior. É a ponte aceitável.

---

## 8. SSE — Memorystore for Redis (só se escalar > 1 instância)

Com `max-instances=1` **não é necessário**. Se um dia precisar de N backends:

| Parâmetro | Valor |
|-----------|-------|
| Tier | Basic (sem réplica) |
| Capacidade | 1 GB |
| Versão | Redis 7.x |
| Rede | `manasync-vpc` (IP privado) |
| Uso | `eventStream.js` publica `broadcast(eventId)` num canal pub/sub; cada instância assina e reenvia aos seus `Response` SSE locais |

---

## 9. Cloud Run — Job de migração

| Parâmetro | Valor |
|-----------|-------|
| Nome | `manasync-migrate` |
| Imagem | `backend:<tag>` (ou imagem dedicada com `mysql` client) |
| Comando | script que roda `01-schema.sql` e cada `db/migrations/*.sql` em ordem (idempotente: schema usa `CREATE TABLE IF NOT EXISTS`; migrations não — controlar com tabela `schema_migrations` ou rodar só uma vez) |
| VPC | connector `manasync-connector`, egress `private-ranges-only` |
| Secrets | `DB_PASS=db-password:latest` |
| Env | `DB_HOST`=IP privado, `DB_USER=manasync_app`, `DB_NAME=manasync` |
| SA | `sa-manasync-migrate` |
| Execução | manual no primeiro deploy; depois, step do pipeline antes de cada release que tenha migration nova |

> ⚠️ As migrations atuais (`001`–`004`) fazem `ALTER TABLE ... ADD COLUMN` sem
> `IF NOT EXISTS`. Rodar duas vezes falha. Ou aplicá-las só uma vez, ou adicionar
> controle de versão de schema.

---

## 10. Cloud Run — Service backend

| Parâmetro | Valor |
|-----------|-------|
| Nome | `manasync-backend` |
| Imagem | `southamerica-east1-docker.pkg.dev/PROJECT/manasync/backend:<tag>` |
| Porta do container | `3001` (env `PORT=3001`; Cloud Run injeta `PORT`, o `app.js` respeita) |
| CPU | 1 vCPU | |
| Memória | 512 MiB |
| **Min instances** | **1** (mantém o `Map` de SSE vivo e evita cold start na conexão stream) |
| **Max instances** | **1** (restrições §2.1/§2.2). Só subir com Redis + object storage. |
| Concurrency | 80 |
| Request timeout | 3600 s (SSE — conexão longa) |
| Execution environment | 2ª geração (necessário se usar volume gcsfuse) |
| VPC connector | `manasync-connector`, egress `private-ranges-only` |
| Ingress | **Internal + Cloud Load Balancing** (só o LB alcança; sem URL pública `run.app`) |
| Secrets | `JWT_SECRET=jwt-secret:latest`, `DB_PASS=db-password:latest` |
| Env vars | `PORT=3001`, `JWT_EXPIRES_IN=7d`, `DB_HOST=<ip-privado-cloudsql>`, `DB_PORT=3306`, `DB_USER=manasync_app`, `DB_NAME=manasync`, `CORS_ORIGIN=https://<dominio>` (após mudança de código §3.3) |
| Volume (ponte, se não migrar uploads) | `--add-volume=name=uploads,type=cloud-storage,bucket=manasync-uploads-...` montado em `/app/uploads` |
| Health check | startup + liveness HTTP `GET /api/health` |
| Service Account | `sa-manasync-backend` (scopes: secret accessor nos 2 secrets, `cloudsql.client`, `storage.objectAdmin` no bucket de uploads) |

---

## 11. Frontend — duas variantes

### Variante A — Cloud Storage + Cloud CDN (recomendada, mais barata)

| Recurso | Parâmetro |
|---------|-----------|
| Bucket | `manasync-frontend-<projectnum>`, região `southamerica-east1`, website mode |
| Conteúdo | saída de `npm run build` (`frontend/dist/frontend/browser/`) |
| Cache | `Cache-Control: public,max-age=31536000,immutable` nos assets com hash; `no-cache` no `index.html` |
| SPA fallback | URL map devolve `/index.html` para 404 (rotas do Angular Router) |
| Backend bucket | com Cloud CDN ligado |

> Requer mudança de código §3.1 (apiUrl relativo) — senão a SPA chama `localhost:3001`.

### Variante B — Cloud Run Service `manasync-frontend`

| Parâmetro | Valor |
|-----------|-------|
| Imagem | `frontend:<tag>` (nginx + estático) |
| `nginx.conf` | **remover** os blocos `location /api/` e `/uploads/` (o LB faz o routing agora); manter só `try_files ... /index.html` |
| CPU / Mem | 1 vCPU / 256 MiB |
| Min / Max instances | 0 / 4 (stateless, pode escalar) |
| Ingress | Internal + Cloud Load Balancing |
| Porta | 80 |

Variante A é preferível: menos custo, CDN nativo, nada para escalar.

---

## 12. Load Balancer (Global External Application LB)

| Recurso | Parâmetro |
|---------|-----------|
| IP | endereço IPv4 global estático `manasync-ip` (+ IPv6 opcional) |
| Frontend | HTTPS :443, HTTP :80 → redirect 301 para HTTPS |
| Certificado | Google-managed SSL cert para `manasync.example.com` (e `www`) |
| **NEG backend** | Serverless NEG → Cloud Run `manasync-backend` |
| **NEG frontend** | Serverless NEG → Cloud Run `manasync-frontend` **ou** backend bucket (variante A) |
| Backend service `api` | NEG backend; timeout **3600 s**; Cloud CDN **off**; logging on |
| Backend service `web` | NEG/bucket frontend; Cloud CDN **on** |
| URL map | host `manasync.example.com`: <br>• `/api/*` → `api` <br>• `/uploads/*` → `api` (ou → bucket `uploads` se §7 feito) <br>• `/*` → `web` |
| Response buffering | manter desligado para `/api/*` (SSE) — LB de aplicação já faz streaming; não habilitar Cloud CDN nesse backend service |
| (opcional) Cloud Armor | policy anexada ao backend service `api`: rate-limit por IP, regras OWASP |

---

## 13. DNS e TLS

| Recurso | Parâmetro |
|---------|-----------|
| Cloud DNS managed zone | `example-com`, domínio `example.com` |
| Registro | `manasync.example.com` A → IP global do LB (AAAA se IPv6) |
| Registro | `www.manasync.example.com` CNAME → `manasync.example.com` |
| Cert manager | Google-managed cert provisiona sozinho após DNS propagar (pode levar ~30–60 min) |

---

## 14. IAM — Service Accounts

| SA | Papéis | Recurso alvo |
|----|--------|--------------|
| `sa-manasync-backend` | `secretmanager.secretAccessor` (×2 secrets), `cloudsql.client`, `storage.objectAdmin` | secrets, projeto (cloudsql), bucket uploads |
| `sa-manasync-migrate` | `secretmanager.secretAccessor` (db-password), `cloudsql.client` | secret, projeto |
| `sa-manasync-frontend` | nenhum extra (só serve estático) | — |
| `sa-cloudbuild` (deploy) | `run.admin`, `artifactregistry.writer`, `iam.serviceAccountUser`, `run.jobs` executor | projeto |

Sem chaves de SA em arquivo — Cloud Run e Cloud Build usam identidade de workload.

---

## 15. CI/CD — Cloud Build

`cloudbuild.yaml` na raiz, trigger no push para `master`:

1. `docker build` backend e frontend → tag = `$SHORT_SHA`
2. `docker push` para Artifact Registry
3. `gcloud run jobs execute manasync-migrate --wait` (se houver migration nova)
4. `gcloud run deploy manasync-backend --image ...:$SHORT_SHA`
5. Variante A: `gsutil rsync -d dist/frontend/browser gs://manasync-frontend-...` + invalidar cache do CDN
   Variante B: `gcloud run deploy manasync-frontend --image ...:$SHORT_SHA`

---

## 16. Observabilidade

| Item | Config |
|------|--------|
| Logs | Cloud Run e LB já mandam para Cloud Logging |
| Métrica | log-based metric para `stack trace` do handler de erro (`app.js:21`) |
| Alertas | (a) 5xx do backend service > 2% em 5 min; (b) latência p95 `/api` > 2 s; (c) CPU Cloud SQL > 80% por 10 min; (d) disco Cloud SQL > 85%; (e) uptime check HTTPS em `https://manasync.example.com/api/health` |
| Uptime check | global, intervalo 60 s, no path `/api/health` |
| Budget | alerta de billing em 50/90/100% do orçamento mensal |

---

## 17. Alternativa: GKE Autopilot

Se preferir Kubernetes: cluster Autopilot regional, `Deployment` backend
(`replicas: 1`), `Deployment` frontend, `Service` + `Ingress` (GCE) com
`ManagedCertificate` e `FrontendConfig` (redirect HTTP→HTTPS). Uploads via PVC
(Filestore CSI) ou GCS. Mais controle, mais overhead operacional — não recomendado
para o tamanho deste projeto.

---

## 18. Estimativa de custo (ordem de grandeza, USD/mês, sa-east1)

| Recurso | Estimativa |
|---------|------------|
| Cloud SQL `db-custom-1-3840`, 20 GB, single-zone | ~45–60 |
| Cloud Run backend (1 inst. sempre on, 1vCPU/512Mi) | ~15–25 |
| Cloud Run frontend (variante B) ou bucket+CDN (variante A) | ~1–5 |
| Load Balancer (forwarding rule + tráfego baixo) | ~18–25 |
| Serverless VPC connector (2× e2-micro) | ~9 |
| Cloud NAT | ~1–3 + tráfego |
| Artifact Registry, Secret Manager, logs | ~1–3 |
| **Total** | **~90–130** |

HA no Cloud SQL (`REGIONAL`) e Memorystore somam ~+50–70 se ativados.
