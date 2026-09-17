# Arquitetura AWS — ManaSync

Referência do que **está implementado** em `infra/` (CDK), `backend/`, `db/` e
`scripts/`. Para operar, veja o [RUNBOOK](RUNBOOK.md). Para o porquê de cada decisão
e o histórico, veja o [PLANO-DEPLOY](PLANO-DEPLOY.md).

| | |
|---|---|
| Conta | projeto da nova experiência AWS. O ID **não fica no repositório** (é público): vem de `MANASYNC_CONTA` no `.env` da raiz |
| Região | **`us-east-2`** — todo recurso regional. Única exceção: o certificado do CloudFront, em `us-east-1` |
| Site | `https://app.mercadiastore.online` (subdomínio delegado ao Route 53; a raiz continua na HostGator) |
| IaC | AWS CDK v2 (TypeScript), 5 stacks, `cdk-nag` (AwsSolutions) derrubando o synth em achado não reconhecido |
| Custo estimado | ~US$ 37/mês (seção 11) |

---

## 1. Visão geral

```
                 navegador
                     │ HTTPS (TLS 1.2+, HTTP/2 e 3)
                     ▼
   Route 53 ── app.mercadiastore.online (A/AAAA alias)
                     │
                     ▼
   ┌──────────────────── CloudFront ─────────────────────┐
   │  padrão (*)   → S3 SPA  (OAC)  + Function reescrita  │
   │  /uploads/*   → S3 imagens (OAC), CSP sandbox        │
   │  /api/*       → origin.app.mercadiastore.online:3001 │
   │                 HTTP + header x-origin-verify        │
   └───────────────────────────┬─────────────────────────┘
                               │ só a prefix list do CloudFront entra
   ┌─ VPC us-east-2 ───────────┼─────────────────────────────────────┐
   │  subnets públicas         ▼                                     │
   │   ┌──────────────────────────────┐     ┌────────────────────┐   │
   │   │ ECS Fargate (ARM) — backend  │     │ task de migração   │   │
   │   │ 1 task (2 durante o deploy)  │     │ (avulsa, run-task) │   │
   │   └───────┬──────────────┬───────┘     └─────────┬──────────┘   │
   │           │ 6379 TLS     │ 3306 TLS              │ 3306 TLS     │
   │  subnets  │ isoladas     │                       │              │
   │   ┌───────▼───────────┐ ┌▼────────────────────┐  │              │
   │   │ Valkey Serverless │ │ RDS MySQL 8.4 (TLS) │◄─┘              │
   │   │ 8 (TLS + RBAC)    │ └─────────────────────┘                 │
   │   └───────────────────┘                                         │
   └─────────────────────────────────────────────────────────────────┘

   EventBridge (mudança de task + a cada 1 min) ─► Lambda de DNS ─► Route 53
     mantém origin.app.mercadiastore.online = IPs das tasks saudáveis
```

Não há balanceador nem NAT Gateway: juntos custariam mais que o resto da
infraestrutura. O que os substitui está nas seções 4 e 6.

---

## 2. Stacks

| Stack | Conteúdo | Muda quando |
|---|---|---|
| `ManaSyncRede` | VPC, endpoint S3, security groups, cluster ECS | quase nunca |
| `ManaSyncDados` | RDS, Valkey + usuários, segredos do banco e do Valkey. `terminationProtection` | raramente |
| `ManaSyncMigracao` | imagem `db/`, task definition de migração | a cada migration nova |
| `ManaSyncBorda` | buckets, CloudFront, CloudFront Function, políticas de cabeçalho, segredo de origem, registros A/AAAA | raramente |
| `ManaSyncApp` | imagem `backend/`, serviço, segredo JWT, Lambda de DNS, alarmes | a cada release |

Dependências: Rede → Dados → Migracao; Rede → Borda → App (App também usa Rede e
Dados). Referências entre stacks são `strong` (o CloudFormation impede apagar um
recurso em uso).

O deploy é **só** por `scripts/deploy.sh`: a migração roda entre as stacks de dados
e a aplicação, o que `cdk deploy --all` não faz.

---

## 3. Borda

### 3.1 CloudFront

| Comportamento | Origem | Cache | Compressão | Cabeçalhos | Extra |
|---|---|---|---|---|---|
| padrão (`*`) | S3 SPA, OAC | padrão | sim | segurança | Function `viewer-request`: URI sem extensão → `/index.html` |
| `/api/*` | `origin.app.mercadiastore.online`, **porta 3001**, HTTP | desligado | **não** (SSE) | segurança | todos os métodos; repassa tudo exceto `Host`; `x-origin-verify`; read/keepalive 60 s |
| `/uploads/*` | S3 imagens, OAC | otimizado | sim | segurança + `Content-Security-Policy: default-src 'none'; sandbox` | — |

- **Cabeçalhos de segurança:** HSTS 1 ano com subdomínios, `nosniff`, `X-Frame-Options: DENY`, `strict-origin-when-cross-origin`.
- **Sem `errorResponses`:** um 403/404 da API chega como ele é; só as rotas da SPA são reescritas, e só no comportamento padrão.
- TLS mínimo `TLSv1.2_2021`, HTTP/2 e HTTP/3, classe de preço completa (bordas da América do Sul).
- Certificado ACM em `us-east-1`, emitido por `scripts/certificado.sh` e importado por ARN (`infra/cdk.json`). Renova sozinho enquanto o CNAME de validação existir.

### 3.2 Buckets

| Bucket | Acesso | Proteção de dados |
|---|---|---|
| SPA (nome gerado) | só CloudFront (OAC), SSL obrigatório, tudo bloqueado ao público | `DESTROY` + auto-delete (reconstruível do git) |
| `manasync-imagens-<CONTA>-us-east-2` | só CloudFront (OAC) para leitura; a task grava e apaga em `uploads/*` | versionado, versões antigas expiram em 90 dias, `RETAIN` |

Publicação da SPA (`scripts/publicar-spa.sh`): bundles com hash `immutable` por 1
ano; `index.html` `no-cache` e enviado por último; demais arquivos 5 min.

### 3.3 DNS

- Hosted zone `app.mercadiastore.online` no Route 53, delegada por 4 registros NS no
  cPanel da HostGator (`scripts/zona.sh`).
- `app.mercadiastore.online` A/AAAA → CloudFront.
- `origin.app.mercadiastore.online` A (TTL 30) → IPs públicos das tasks saudáveis,
  mantido pela Lambda de DNS (seção 5). Não é gerenciado pelo CloudFormation.

---

## 4. Rede

- VPC em 2 AZs, subnets públicas e isoladas, **sem NAT Gateway**.
- Endpoint **gateway** de S3 nas subnets públicas (gratuito).

| Security group | Entrada | Saída |
|---|---|---|
| task | TCP 3001 **só da prefix list** `com.amazonaws.global.cloudfront.origin-facing` | 443 (0.0.0.0/0), 3306 → banco, 6379–6380 → cache |
| migração | nenhuma | 443 (0.0.0.0/0), 3306 → banco |
| banco | 3306 da task e da migração | nenhuma |
| cache | 6379–6380 da task | nenhuma |

A task tem IP público (substitui o NAT). O que a protege:

1. o SG só aceita as bordas do CloudFront;
2. o backend recusa com 403 toda requisição sem o `x-origin-verify` certo — a prefix
   list sozinha deixa passar a distribuição de **qualquer** conta
   (`backend/src/middleware/originVerify.js`);
3. banco e cache em subnets sem rota para a internet.

---

## 5. Aplicação

### 5.1 Task

| | |
|---|---|
| Plataforma | Fargate, ARM64 (Graviton), 0,25 vCPU / 512 MiB |
| Imagem | `backend/Dockerfile` (`node:24-alpine`, inclui o bundle de CAs da RDS) |
| Usuário | `node` (sem root) |
| Disco | raiz somente-leitura; `/tmp` efêmero gravável |
| Health check | `GET http://127.0.0.1:3001/api/health` a cada 30 s, 3 tentativas, início após 30 s |
| `stopTimeout` | 70 s (45 s de atraso + 10 s de fechamento + folga) |
| ECS Exec | desligado; `-c manasync:depuracao=true` liga e desliga o somente-leitura junto |

**Ambiente** (não sensível): `NODE_ENV=production`, `PORT=3001`, `AWS_REGION`,
`TRUST_PROXY=1`, `CORS_ORIGINS=""` (nenhuma origem), `SSE_HEARTBEAT_MS=15000`,
`PRE_STOP_DELAY_MS=45000`, `SHUTDOWN_TIMEOUT_MS=10000`, `DB_HOST`, `DB_PORT`,
`DB_NAME`, `DB_SSL=true`, `DB_SSL_CA_PATH`, `VALKEY_URL=rediss://…`,
`VALKEY_CLUSTER=true`, `VALKEY_USER=manasync-app`, `UPLOADS_BUCKET`.

**Segredos** (Secrets Manager): `DB_USER`/`DB_PASS` (usuário `manasync_app`),
`JWT_SECRET`, `ORIGIN_VERIFY_ATUAL`, `VALKEY_PASS`; `ORIGIN_VERIFY_ANTERIOR` só durante
a rotação (`-c manasync:rotacaoOrigem=true`).

A task **não** recebe a credencial master do banco nem `ADMIN_EMAIL`.

**Papel da task:** `s3:PutObject` e `s3:DeleteObject` em
`arn:aws:s3:::manasync-imagens-<CONTA>-us-east-2/uploads/*`. Nada mais.

### 5.2 Serviço e deploy sem queda

- `desiredCount: 1`, `minHealthyPercent: 100`, `maxHealthyPercent: 200`, circuit breaker com rollback.
- Sequência de um deploy: a task nova sobe e passa no health check → a Lambda a
  publica no DNS → o ECS manda SIGTERM à velha → a Lambda a tira do DNS → a velha
  continua atendendo por 45 s (TTL de 30 s + cache) → fecha streams SSE, Valkey e
  banco → sai. Clientes SSE reconectam na nova, e o Valkey entrega os eventos
  publicados por qualquer task.

### 5.3 Backend em produção (o que a infraestrutura exige dele)

| Mecanismo | Onde |
|---|---|
| `JWT_SECRET` obrigatório, ≥ 32 caracteres | `lib/config.js#jwtSecret` |
| Header de origem, comparação em tempo constante, rotação atual/anterior | `middleware/originVerify.js` |
| CORS vazio = nenhuma origem | `lib/config.js#corsOrigins` |
| TLS verificado com o RDS | `lib/config.js#dbSsl` |
| SSE entre tasks (pub/sub sharded), tipos de aviso numa lista fechada | `services/eventStream.js`, `lib/valkey.js` |
| Rate limit de senha compartilhado e persistente (chave em SHA-256) | `lib/rateLimitStore.js` |
| Uploads: assinatura dos bytes antes de gravar, `IfNoneMatch`, nome uuid | `lib/uploads.js`, `lib/armazenamento.js` |
| Desligamento com atraso e prazo | `lib/desligamento.js` |
| Admin inicial só se não houver admin | `lib/bootstrapAdmin.js` (em produção, pela migração) |

### 5.4 Lambda de DNS

- Node 24, ARM64, 256 MB, 30 s, código em `infra/lambda/dns-updater/src`.
- **Reconcilia** a cada chamada: tasks do serviço `RUNNING` + `HEALTHY` + não sendo
  paradas → IPs públicos → registro A. Conjunto igual não escreve; vazio mantém o
  registro e avisa.
- Gatilhos: *ECS Task State Change* do serviço e agendamento de 1 minuto. Numa task
  recém-subida, espera até 20 s pela saúde.
- Concorrência: grava com `DELETE` dos valores lidos + `CREATE` no mesmo lote; se outra
  execução mudou o registro, o Route 53 recusa e ela recomeça (até 3 vezes).
- IAM: `ecs:ListTasks`/`DescribeTasks` presos ao cluster; `ec2:DescribeNetworkInterfaces`;
  `route53:ChangeResourceRecordSets` só para `origin.app.mercadiastore.online`, tipo
  `A`, ações `CREATE`/`DELETE`; logs só no próprio log group.

---

## 6. Dados

### 6.1 RDS MySQL

| | |
|---|---|
| Versão | 8.4.10 (atualizações de minor automáticas) |
| Instância | `db.t4g.micro`, Single-AZ, subnet isolada, sem IP público |
| Disco | gp3 20 GB, cresce até 100 GB, cifrado |
| Parâmetros | `require_secure_transport=ON`, `time_zone=UTC`, `utf8mb4_unicode_ci` |
| Backups | 7 dias; janela 06:00–07:00 UTC; manutenção dom 07:00–08:00 UTC |
| Proteção | `deletionProtection`, `RETAIN`, stack com `terminationProtection` |
| Logs | `error` e `slowquery` no CloudWatch, 1 semana |

| Usuário | Quem usa | Permissões |
|---|---|---|
| `manasync_admin` (master) | só a task de migração | todas |
| `manasync_app` | backend | `SELECT, INSERT, UPDATE, DELETE` em `manasync.*`, `REQUIRE SSL`; senha e permissões reescritas a cada migração |

### 6.2 Migrations

Task avulsa (`ManaSyncMigracao`), rodada por `scripts/migrar.sh`:

1. snapshot manual do RDS (`manasync-pre-migracao-<data>`; mantém os 3 mais
   recentes, apaga os demais com mais de 30 dias);
2. runner `db/migrate.js` com a credencial master e TLS: lock nomeado, schema
   consolidado num banco vazio, migrations pendentes uma a uma, recusa arquivo já
   aplicado que mudou e banco com tabelas sem histórico;
3. garante `manasync_app`;
4. promove `ADMIN_EMAIL` a admin **só se não existir admin**;
5. código de saída ≠ 0 para o deploy.

Detalhes: [`db/README.md`](../../db/README.md).

### 6.3 Valkey Serverless

| | |
|---|---|
| Engine | Valkey 8 (responde 8.1), modo cluster, TLS obrigatório |
| Limites | 1 GB de dados, 5000 ECPU/s (teto de gasto) |
| Portas | 6379 (primário) e 6380 (leitura) |
| Uso | pub/sub sharded do SSE (`evento:<id>`) e contador do rate limit (`rl:<sha256>`) |

Usuários (RBAC):

| Usuário | Autenticação | Permissões |
|---|---|---|
| `default` | senha aleatória que ninguém usa | `off -@all` |
| `manasync-app` | senha do Secrets Manager | `on ~rl:* &evento:* -@all +@connection +info +cluster\|info +cluster\|slots +cluster\|shards +ssubscribe +sunsubscribe +spublish +multi +exec +incr +decr +pexpire +pttl +del` |

Cliente: `ioredis` 6.0.0 com `Cluster`, `shardedSubscribers` e `dnsLookup` identidade —
validado contra o ElastiCache real (PLANO §5.2). O engine Valkey recusa usuário sem
senha, e sem `+cluster|info` o cliente desiste sem erro.

---

## 7. Segurança — resumo das camadas

| Ameaça | Controle |
|---|---|
| Acesso direto à task | SG só com a prefix list do CloudFront + header secreto conferido pelo backend |
| Distribuição CloudFront de outra conta | header `x-origin-verify` (o CloudFront sobrescreve o valor enviado pelo visitante) |
| Invasão pela API chegar ao schema | usuário `manasync_app` só com DML; master só na migração |
| Tomada de admin | `ADMIN_EMAIL` só na migração, só promove sem admin existente; e-mail do domínio do site recusado no synth |
| Upload malicioso | assinatura dos bytes, extensão e `Content-Type` detectados, `attachment`, CSP `sandbox` em `/uploads/*` |
| Força bruta de senha | rate limit por IP (/56 em IPv6) + e-mail, compartilhado no Valkey |
| Segredo em texto | todos no Secrets Manager; templates só com `{{resolve:secretsmanager:…}}` |
| Container comprometido | sem root, disco somente-leitura, saída só 443/3306/6379-6380, papel só com Put/Delete em `uploads/*` |
| Apagar dados por engano | RDS com deletion protection e `RETAIN`; bucket de imagens versionado e `RETAIN`; stack de dados com termination protection; referências `strong` |
| Configuração insegura nova | `cdk-nag` derruba o synth; inventário de 25 reconhecimentos aprovados testado |

Decisões conscientes (reconhecidas no `cdk-nag`, com motivo no código): sem Multi-AZ,
sem flow logs, sem Container Insights, sem logs de acesso de S3/CloudFront, sem WAF,
origem HTTP (TLS até a task exigiria ALB), rotação manual de segredos.

---

## 8. Observabilidade

| | |
|---|---|
| Logs | CloudWatch, 1 semana: backend, migração, Lambda de DNS, RDS |
| Alertas | tópico SNS com assinatura por e-mail (`ADMIN_EMAIL`) |

Alarmes:

| Alarme | Condição |
|---|---|
| Sem task rodando | nenhuma amostra de CPU do serviço por 3 min (dado ausente conta como alarme) |
| Banco sem espaço | menos de 2 GB livres |
| CPU do banco | acima de 80% por 15 min |
| Lambda de DNS falhando | qualquer erro em 5 min |

---

## 9. Garantias automatizadas (CI)

| Job | O que prova |
|---|---|
| `backend` | unitários + integração com Valkey 8.1 real |
| `db` | unitários + integração com MySQL 8.4 real |
| `infra` | tipos + 58 testes de template + `cdk-nag` |
| `scripts` | `shellcheck` + 40 testes dos scripts de deploy com stubs |
| `dns-updater` | 23 testes da Lambda |
| `frontend` | formatação, testes, build |

---

## 10. Limitações conhecidas

- Uma task em regime: falha dela derruba o site até o ECS substituí-la (~1 min).
- RDS Single-AZ: manutenção ou falha da AZ tira o banco do ar.
- Deploy sem queda depende de o CloudFront respeitar o TTL do DNS da origem —
  confirmado no checklist de aceite do primeiro deploy (RUNBOOK §3).
- DDL no MySQL não é transacional: migration que falha no meio exige conferir o banco
  (ou restaurar o snapshot).
- Cadastro não confirma e-mail: o dono precisa criar a conta antes de divulgar o site.

Próximos passos naturais: verificação de e-mail, WAF, ALB + subnets privadas (remove a
Lambda de DNS e o IP público), Multi-AZ, deploy pelo GitHub Actions com OIDC.

---

## 11. Custo estimado (US$/mês, tabela pública, 1 task)

| Item | ~ |
|---|---|
| Fargate ARM 0,25 vCPU / 0,5 GB | 7 |
| IPv4 público da task | 3,6 |
| RDS `db.t4g.micro` + 20 GB gp3 | 14 |
| Snapshots manuais | 1 |
| Valkey Serverless (mínimo cobrado) | 6–7 |
| Secrets Manager (6 segredos) | 2,4 |
| Route 53 (zona + consultas) | 1 |
| CloudWatch alarmes (4) | 0,4 |
| CloudFront, S3, logs, Lambda, EventBridge, SNS | ~1 |
| **Total** | **~US$ 37** |

Com o crédito de US$ 100 do plano Free, ~2,5 meses. Mudar para o plano pago antes de
abrir o site ao público.
