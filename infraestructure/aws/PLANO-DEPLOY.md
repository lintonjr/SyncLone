# Plano de deploy na AWS — ManaSync

> **Status: implementado (PRs 1–11).** Nada implantado na AWS ainda — o próximo passo
> é o primeiro deploy.
>
> - Operar: **[RUNBOOK.md](RUNBOOK.md)** · Arquitetura: **[SPEC.md](SPEC.md)**
> - Este documento é o **histórico das decisões**: o que se planejou, o que se descobriu
>   (spikes, testes) e onde a implementação se afastou do plano (marcado com ✅ e
>   "Implementado no PR N" em cada seção). Em caso de divergência, vale o código e a SPEC.
>
> Site: `app.mercadiastore.online` (D11 = B). Região: `us-east-2`.
>
> **ID da conta fora do repositório** (público): onde este histórico mostra `<CONTA>`,
> o valor real está em `MANASYNC_CONTA` no `.env` da raiz. Por isso o `cdk.context.json`
> também saiu do git (as chaves de lookup levam o ID) — diferente do que diz a §4.8.

---

## 0. Ponto de partida

### 0.1 Fatos verificados

| Item | Estado | Como foi verificado |
|---|---|---|
| Conta | a mesma do projeto na AWS Settings (ID em `MANASYNC_CONTA`, fora do git) | confirmado pelo dono |
| Região do projeto | **`us-east-2`** | confirmado pelo dono |
| SCP de projeto nas credenciais `manasync` | **não está agindo**: conta fora de organização, `describe-vpcs` liberado nas 17 regiões, leitura de contato liberada | `organizations describe-organization`, sondagem por região |
| Consequência | O plano **segue as regras de projeto mesmo assim** (tudo em `us-east-2`; em `us-east-1` só ACM do CloudFront). Se o SCP passar a valer, nada quebra | decisão |
| Plano da conta | FREE, US$ 100 de crédito, expira 16/03/2027 | `freetier get-account-plan-state` |
| Serviços usados | todos na lista do plano Free | doc "Supported AWS services" |
| Recursos existentes | nenhum (só o meio de pagamento) | tagging API + CloudFormation em todas as regiões |
| CDK bootstrap | **feito** em `us-east-2` (`CDKToolkit`, versão 32, 16/09/2026). Execução do CloudFormation com `AdministratorAccess` (padrão) | `describe-stacks CDKToolkit` |
| CDK com as credenciais `login_session` | **funciona** (lookup de contexto executado numa cópia do `infra/`) | `cdk ls` no scratchpad |
| Máquina de deploy | **x86_64**, Docker 29.8; emulação arm64 **instalada e persistente** (`qemu-user-static` + `binfmt-support`) | `uname -m`, `docker buildx ls`, `systemctl is-enabled binfmt-support` |
| MySQL `us-east-2` | 8.4.x até 8.4.11; `db.t4g.micro` com 8.4.10 disponível | `describe-orderable-db-instance-options` |
| Prefix list CloudFront `us-east-2` | `pl-b6a144df` | `describe-managed-prefix-lists` |
| Lambda `nodejs20.x` | descontinuado 30/04/2026; criação bloqueada 01/02/2027 | doc Lambda runtimes |
| Angular 21 | aceita Node `>=24` | `@angular/core` `engines` |
| `ioredis` 6.0.0 + Valkey Serverless | **validado de ponta a ponta** (spike, 11/11): TLS + RBAC, `SSUBSCRIBE`/`SPUBLISH` em 12 canais (≤ 2 ms), rate limit, permissões negadas, reassinatura após reconexão | spike 5.2 |
| Valkey Serverless (`majorEngineVersion: '8'`) | responde **Valkey 8.1**, `redis_mode:cluster`, um shard (slots 0–16383), primário 6379 e leitura 6380 | `INFO server`, `CLUSTER SLOTS` |
| ElastiCache, usuário Valkey | **não aceita** `no-password-required` | erro no 1º deploy do spike |
| ElastiCache Serverless, falha de autenticação | **fecha a conexão** (`Connection is closed`), sem `NOAUTH`/`WRONGPASS` | spike |
| ElastiCache Serverless, `KEYS` | comando **inexistente** (`unknown command`) | spike |
| `express-rate-limit` 8.7 | tem `passOnStoreError` | tipos do pacote |
| CloudFront, header customizado de origem | **sobrescreve** header de mesmo nome vindo do visitante | doc "Add custom headers to origin requests" |
| ECS Exec | **incompatível** com `readonlyRootFilesystem` | re:Post Knowledge Center |
| Evento "ECS Task State Change" | **não traz** o status de saúde; mudança de saúde não gera evento | doc "Amazon ECS task state change events" |
| Backend faz DDL em runtime? | não | `grep` em `backend/src` |
| `~/.aws/config` perfil `manasync` | `region = us-east-2`; `aws login` refeito nessa região | `sts get-caller-identity` |

### 0.2 Decisões (fechadas)

| # | Decisão | Escolha |
|---|---|---|
| D1 | Domínio | `app.mercadiastore.online` (subdomínio de `mercadiastore.online`) |
| D11 | DNS do domínio (hoje na HostGator) | **B**: só `app.mercadiastore.online` delegado ao Route 53; HostGator intocada |
| D2 | Plano da conta | Free durante a construção; **Paid antes de abrir ao público** (seção 12) |
| D3 | Deploy sem queda | DNS com vários IPs + Lambda (sem ALB) |
| D4 | Autenticação no Valkey | usuário com senha (RBAC), `default` desligado |
| D5 | Migrations | task ECS avulsa, antes do deploy da aplicação |
| D6 | Node | 24 LTS |
| D7 | Publicação do SPA | script `s3 sync` |
| D8 | Imagens ARM numa máquina x86 | emulação QEMU (`binfmt`) no Docker local (0.4) |
| D9 | ECS Exec × filesystem somente-leitura | somente-leitura por padrão; **modo depuração** por contexto liga o Exec e desliga o read-only (4.6) |
| D10 | Cliente Valkey | `ioredis` 6 com `Cluster` e `shardedSubscribers: true` |

### 0.3 Rastreabilidade

| # | Problema | Gravidade | Onde |
|---|---|---|---|
| a | `JWT_SECRET` não injetado | bloqueia | 4.1 |
| b | MySQL 8.0.40 inexistente; 8.0 em Extended Support | bloqueia | 3.1 |
| c | Schema/migrations não aplicados | bloqueia | 3.2 |
| d | Região fixa `us-east-1` | bloqueia | 1.1 |
| e | `x-origin-verify` não conferido | segurança alta | 4.2 |
| f | App usa credencial master | segurança alta | 3.3 |
| g | Segredo de origem visível (na config da distribuição, não no template) | baixa | 4.2.4 |
| h | `errorResponses` quebram erros da API | funcional | 6.4 |
| i | CloudFront lê S3, backend grava em disco | funcional | 6.1–6.3 |
| j | Valkey sem uso | custo | 5 |
| k | Node 20 fora de suporte | manutenção | 2 |
| N1 | Tomada de admin via `ADMIN_EMAIL=admin@dominio` | **crítica** | 4.3 |
| N2 | CORS vazio cai no padrão de dev em produção | média | 4.4 |
| N3 | Tipo do upload confiado ao cliente | média | 4.5 |
| N4 | Container root e com disco gravável | média | 4.6 |
| N5 | Saída do SG da task liberada | baixa | 4.7 |
| N6 | `grantReadWrite` no bucket inteiro | baixa | 6.3 |
| N7 | IAM da Lambda de DNS amplo | baixa | 7.3 |
| N8 | SPA nunca é publicado | bloqueia | 6.5 |
| N9 | Certificado do CloudFront em `us-east-1` | bloqueia | 1.2 |
| N10 | Rate limit só em memória | média | 5.4 |
| N11 | Deploy derruba o site; Lambda grava 1 IP | disponibilidade | 7 |
| N12 | Sem orçamento/alertas | custo | 0.4, 8.3 |
| N13 | Documentação desatualizada | docs | 10 |
| N14 | Perfil do CLI na região errada | operacional | 0.4 |
| **N15** | **Origem da API sem `httpPort`: CloudFront conecta na porta 80, container escuta na 3001** | **bloqueia** | 6.4 |
| **N16** | **Build `linux/arm64` falha numa máquina x86 sem QEMU** | **bloqueia** | 0.4 |
| **N17** | **ECS Exec não funciona com filesystem somente-leitura** | conflito de plano | 4.6 |
| **N18** | **Saúde da task não gera evento: Lambda publicaria IP de task ainda não saudável** | disponibilidade | 7.1 |
| **N19** | **`compress: true` (padrão) em `/api/*` arrisca bufferizar o SSE** | funcional | 6.4 |
| **N20** | **Migração usaria o SG da task (acesso ao cache e saída ampla sem necessidade)** | baixa | 3.2 |

### 0.4 Preparação da máquina e da conta (manual, uma vez)

| # | Passo | Por quê |
|---|---|---|
| 1 | ✅ `~/.aws/config`, perfil `manasync`: `region = us-east-2` (backup em `~/.aws/config.bak-20260916`) | N14: comandos sem `--region` caem na região errada |
| 2 | `aws login --profile manasync` **depois do item 1** e antes de cada sessão de deploy | A sessão do `aws login` fica **presa à região em que foi emitida**: a de `us-east-1` não renova com o perfil em `us-east-2` (`CreateOAuth2Token … invalid, expired, revoked, or malformed`). Também expira; deploy completo leva ~40 min |
| 3 | ✅ `sudo apt install qemu-user-static binfmt-support` (registro `qemu-aarch64` persistente, serviço habilitado no boot); build arm64 do backend validado (~20 s) | N16. `scripts/aws-env.sh` confere antes de cada deploy |
| 4 | Criar **budget** mensal de US$ 40 no Billing and Cost Management, alertas 50/80/100% para o seu e-mail | N12 |
| 5 | Conferir `ADMIN_EMAIL` no `.env` da raiz | 4.3 |
| 6 | Node 24 local (`nvm install 24`) | Fase 2 |

**Alternativa ao item 3** (registrada, não escolhida): Fargate `X86_64`. Dispensa
QEMU, mas custa ~20% a mais na task. O build emulado só é mais lento (poucos
minutos): o backend não tem dependência nativa.

### 0.5 Domínio `mercadiastore.online`

**Estado atual (DNS público, 16/09/2026):**

| Registro | Valor | Significa |
|---|---|---|
| NS | `dns3.hostgator.com.br`, `dns4.hostgator.com.br` | DNS gerenciado pela HostGator |
| A (raiz) | `162.240.81.81` | hospedagem HostGator |
| `www` | CNAME para a raiz | idem |
| MX | `0 mercadiastore.online` | e-mail do cPanel na HostGator |
| `mail`, `ftp` | apontam para a raiz | serviços do cPanel |
| TXT, CAA, AAAA | nenhum | sem SPF/DKIM/DMARC configurados |

`app.mercadiastore.online` está em `manasync:domainName` no `cdk.json`.

**Por que o Route 53 é necessário:** o CloudFront na **raiz** do domínio exige
registro ALIAS, que o DNS da HostGator não oferece; e a Lambda de DNS (7.1) grava
`origin.app.mercadiastore.online` pela API do Route 53.

**Decisão D11 — escolhida: B** (16/09/2026):

| Opção | Site em | O que acontece com a HostGator | Quando escolher |
|---|---|---|---|
| **A** — zona inteira no Route 53 | `mercadiastore.online` e `www` | hospedagem e e-mail do cPanel **param**, a menos que os registros MX/`mail` sejam recriados no Route 53 | a HostGator não é usada para nada (ou só o e-mail, recriando o MX) |
| **B** — só um subdomínio no Route 53 | `app.mercadiastore.online` | nada muda; na HostGator só se criam 4 registros NS para `app` | a HostGator hospeda algo em uso |

Com B, `manasync:domainName` vira `app.mercadiastore.online`; o `www` sai do
certificado e da distribuição, e o `origin` vira `origin.app.mercadiastore.online`.

**Passos (opção B):**
1. Criar a hosted zone `app.mercadiastore.online`: `aws route53 create-hosted-zone
   --name app.mercadiastore.online --caller-reference manasync-$(date +%s)`.
   US$ 0,50/mês.
2. **No cPanel da HostGator** (Zone Editor de `mercadiastore.online`): criar 4
   registros `NS` com nome `app`, um para cada servidor `awsdns` que a zona nova
   devolveu. Nada mais muda lá.
3. Esperar a delegação: `dig NS app.mercadiastore.online` devolve os servidores
   `awsdns`.
4. Emitir o certificado (1.2).
5. Preencher `manasync:hostedZoneId` e `manasync:certificateArn` no `cdk.json`.

Até lá, as fases 1 a 9 podem ser **implementadas e testadas** com
`cdk synth` usando contexto fictício, sem deploy.

---

## 1. Região e certificado

### 1.1 Região (d)

- `infra/lib/config.ts`: `REGIAO` vem do contexto `manasync:region`. `loadConfig`
  **recusa** qualquer valor ≠ `us-east-2`.
- `bin/manasync.ts`: `env = { account: CDK_DEFAULT_ACCOUNT, region: config.region }`.
  O synth falha se `CDK_DEFAULT_ACCOUNT` ≠ `<CONTA>` (evita deploy na conta do
  perfil `default`, que é outra).
- Reescrever os comentários sobre `us-east-1`/`sa-east-1`: o motivo agora é a
  região do projeto.

### 1.2 Certificado (N9)

Nenhuma forma automática do CDK serve sem criar recursos proibidos em `us-east-1`
(stack/bootstrap lá, ou `crossRegionReferences`, que cria Lambda e SSM lá).

```bash
ARN=$(aws acm request-certificate --region us-east-1 \
  --domain-name app.mercadiastore.online \
  --validation-method DNS --query CertificateArn --output text)
aws acm describe-certificate --region us-east-1 --certificate-arn "$ARN" \
  --query 'Certificate.DomainValidationOptions[].ResourceRecord'
# criar os CNAMEs devolvidos na hosted zone (route53 change-resource-record-sets)
aws acm wait certificate-validated --region us-east-1 --certificate-arn "$ARN"
```

- `scripts/certificado.sh` faz os três passos, incluindo o CNAME.
- `edge-stack.ts`: `acm.Certificate.fromCertificateArn`.
- `loadConfig` valida que o ARN é `arn:aws:acm:us-east-1:<CONTA>:…`.
- Renovação automática enquanto o CNAME existir. **Nunca apagar.**

### 1.3 Bootstrap

`cdk bootstrap aws://<CONTA>/us-east-2`, só nessa região. **✅ Feito em
16/09/2026** (PR 3); o passo 2 de 11.2 vira só uma conferência.

**Ponto a revisitar:** o bootstrap padrão dá ao CloudFormation `AdministratorAccess`
para executar deploys. Com um operador só, é aceitável. Se entrar mais alguém com
permissão de `cdk deploy`, refazer com `--cloudformation-execution-policies`
restrita aos serviços do projeto (EC2, ECS, RDS, ElastiCache, S3, CloudFront,
Route 53, Lambda, Secrets Manager, Logs, IAM de papéis de serviço).

**Pronto quando:** `cdk synth --strict` passa, e nos templates `us-east-1` aparece
apenas no ARN do certificado.

---

## 2. Node 24 (k)

| Arquivo | Mudança |
|---|---|
| `backend/Dockerfile` | `node:24-alpine` |
| `frontend/Dockerfile` | `node:24-alpine` no build |
| `db/Dockerfile` (novo) | `node:24-alpine` |
| `.github/workflows/ci.yml` | `node-version: '24'` nos jobs; novo job `infra` (8.5) |
| `infra/lib/app-stack.ts` | Lambda `NODEJS_24_X` |
| `infra/package.json` | `@types/node ^24`; `tsx` no lugar de `ts-node` (`cdk.json` → `npx tsx bin/manasync.ts`) |
| `backend`, `frontend`, `infra`, `db` `package.json` | `"engines": { "node": ">=24" }` |
| raiz | `.nvmrc` = `24` |

**Pronto quando:** backend `npm ci && npm test`, frontend `npm ci && npm test && npm
run build`, infra `npx tsc --noEmit` passam em Node 24; CI verde.

---

## 3. Banco de dados

### 3.1 MySQL 8.4 (b)

- `data-stack.ts`: `MysqlEngineVersion.VER_8_4_10` no engine e no parameter group.
  `autoMinorVersionUpgrade: true` (padrão) leva a 8.4.11+.
- Janelas fixas: backup 06:00–07:00 UTC, manutenção domingo 07:00–08:00 UTC
  (madrugada no Brasil, fora de torneio).
- `terminationProtection: true` em `ManaSyncDados`.
- Parâmetros atuais valem em 8.4.
- **Local:** `docker-compose.yml` → `mysql:8.4`.
  1. `docker compose exec mysql mysqldump -uroot -proot123 --databases manasync > backup-local.sql`
  2. subir com 8.4 (upgrade in-place do volume, suportado entre LTS);
  3. se falhar: apagar volume, subir, restaurar o dump;
  4. ✅ **verificado no PR 4:** o `mysql2` autentica com `caching_sha2_password` no
     MySQL 8.4.11 **sem TLS** (usuário criado pelo runner, container local). O
     compose não precisa de `--mysql-native-password`.
  5. **Não feito no PR 4, de propósito:** a troca do compose mexe no volume de dados
     local e fica para quando o dono quiser, com o dump do passo 1.

### 3.2 Migrations (c, D5, N20)

**✅ Implementado no PR 4:** `db/migrate.js`, `db/src/{config,plano,executar}.js`,
`db/Dockerfile`, `db/.dockerignore`, `db/README.md`, `db/test/` (28 unitários + 7
cenários de integração, validados em MySQL 8.4.11 e 8.0.46; imagem arm64 e CLI
testados de ponta a ponta). Diferenças em relação ao texto abaixo:
`schema_migrations` tem a coluna `modo` (`aplicada`/`baseline`); variáveis
`DB_ADMIN_USER`/`DB_ADMIN_PASS` (master) e `APP_DB_USER`/`APP_DB_PASS`; banco com
tabelas e sem histórico é **recusado** (exige `baseline`); job `db` no CI com
**service container `mysql:8.4`** rodando unitários + os 7 cenários de integração
(`MIGRATE_IT_OBRIGATORIO=true`: sem banco configurado, falha em vez de pular).

Runner:
1. Conexão master, TLS verificado (mesmo bundle da RDS), `multipleStatements`
   só aqui.
2. `GET_LOCK('manasync_migrate', 60)`; sem lock → sai com erro.
3. Cria `schema_migrations(version PK, checksum, applied_at)`.
4. Sem tabela `users` → aplica `init/01-schema.sql` e registra 001–015 como
   baseline.
5. Com tabela → aplica pendentes em ordem, registra SHA-256; checksum divergente
   de uma já aplicada → **erro**.
6. Garante `manasync_app` (3.3).
7. Admin inicial (4.3).
8. `RELEASE_LOCK`, sai 0. Qualquer erro → sai ≠ 0.

`node migrate.js baseline`: só marca 001–015 (banco local existente).

**Infra:**
- `NetworkStack`: recebe o **cluster ECS** (sem custo; nada implantado ainda, então
  mover não substitui recurso) e um **`sgMigracao`** (sem entrada; saída 443 e 3306
  para `sgBanco`). `sgBanco` aceita 3306 de `sgTask` e `sgMigracao`.
- Nova `ManaSyncMigracao`: `DockerImageAsset` de `db/` (arm64, `NetworkMode.HOST`),
  task definition Fargate ARM 256/512, log group de 1 semana, segredos master e
  app, `ADMIN_EMAIL` do contexto. Outputs: ARN da task definition, subnets
  públicas, `sgMigracao`, cluster.

**`scripts/migrar.sh`:**
1. Snapshot manual do RDS (`manasync-pre-migracao-<data>`), com espera até
   `available`.
2. `aws ecs run-task` (Fargate, subnet pública, IP público, `sgMigracao`).
3. `aws ecs wait tasks-stopped`.
4. `exitCode` ≠ 0 → imprime as últimas linhas do log e **aborta**.
5. Apaga snapshots manuais com mais de 30 dias (custo de storage).

### 3.3 Usuário de aplicação (f)

- `DataStack`: `SegredoAppBanco`, JSON gerado `{username: "manasync_app", password}`,
  sem pontuação problemática para SQL (`excludeCharacters: "'\"\\/@ "`).
- Runner: `CREATE USER IF NOT EXISTS … REQUIRE SSL`, `ALTER USER … IDENTIFIED BY`
  (rotação), **`REVOKE ALL PRIVILEGES, GRANT OPTION`** (tira o que foi concedido à
  mão) e `GRANT SELECT, INSERT, UPDATE, DELETE ON manasync.*`. ✅ PR 4.
- Limitação conhecida: com permissão no banco inteiro, o usuário de app também pode
  escrever em `schema_migrations`. Isolar exigiria um schema separado para o
  histórico; não compensa agora.
- `AppStack`: `DB_USER`/`DB_PASS` do `SegredoAppBanco`. A task do serviço **não**
  lê o segredo master.

**Pronto quando:** `SELECT CURRENT_USER()` pela app = `manasync_app@%`; `DROP TABLE`
com esse usuário é negado.

---

## 4. Segurança

### 4.1 JWT (a)

- `AppStack`: `SegredoJwt` gerado (64 caracteres, sem pontuação) → `JWT_SECRET`.
- `lib/config.js`: `jwtSecret()`; em `NODE_ENV=production`, ausente ou < 32
  caracteres → **processo não sobe**. Usado em `routes/auth.js`,
  `middleware/auth.js`, `middleware/optionalAuth.js`.
- Testes em `test/config.test.js`.
- Rotação invalida sessões (tokens de 7 dias). Documentado.

### 4.2 Header de origem (e)

**4.2.1** `backend/src/middleware/originVerify.js`
- Ativo se `ORIGIN_VERIFY_ATUAL` existir.
- Antes das rotas; `/api/health` isento (health check vem de dentro do container).
- Compara SHA-256 de ambos com `crypto.timingSafeEqual`, contra `ATUAL` e
  `ANTERIOR` (se não vazio).
- Falha → `403` genérico; log com IP e path, **sem** o valor recebido.
- Testes: sem header, errado, atual, anterior, health isento, desativado sem env.

**4.2.2** `SegredoOrigem` vira JSON `{atual, anterior}`; CloudFront usa
`secretValueFromJson('atual')`.

**4.2.3 Rotação:** (1) `anterior ← atual`, gerar novo `atual`; (2) forçar novo deploy
da App; (3) deploy da Borda; (4) `anterior ← ""` e novo deploy da App.

**4.2.4 (g)** O template guarda só a referência `{{resolve:secretsmanager:…}}`. O
valor aparece em `cloudfront:GetDistributionConfig`, o que é inerente ao
mecanismo. Só o comentário em `edge-stack.ts` muda.

**4.2.5** Header forjado pelo visitante é sobrescrito pelo CloudFront (verificado
na documentação). Teste de fumaça em 11.3.

### 4.3 Admin (N1)

1. `ADMIN_EMAIL` sai da task do serviço. Vai só para a task de migração, lido do
   `.env` da raiz pelos scripts (`-c manasync:adminEmail=…`). O synth **falha** se
   estiver vazio ou terminar em `mercadiastore.online` (raiz ou qualquer subdomínio).
2. Promoção só se `COUNT(*) WHERE role='admin'` = 0.
3. `bootstrapAdmin` continua no `app.listen`, mas só age com `ADMIN_EMAIL`
   definido. **Não** dá para decidir por `NODE_ENV`: a imagem define
   `NODE_ENV=production` também no `docker compose` local. A garantia de produção
   é a task do serviço não receber `ADMIN_EMAIL` (teste do CDK, 4.8). *(Ajustado na
   implementação do PR 2.)*
4. Primeiro deploy: você cria a conta **antes** de divulgar o endereço; migração de
   novo promove (11.2).
5. Testes: promove sem admin; não promove com admin; e-mail inexistente não faz nada.

### 4.4 CORS (N2)

`corsOrigins()`: produção + vazio → `false` (nenhuma origem). Fora de produção,
padrão de dev. Teste atualizado.

### 4.5 Assinatura dos uploads (N3)

`detectarTipoImagem(buffer)`: PNG `89 50 4E 47 0D 0A 1A 0A`; JPEG `FF D8 FF`; GIF
`GIF87a`/`GIF89a`; WebP `RIFF`+4 bytes+`WEBP`. Tipo e extensão vêm dos bytes;
divergência do `mimetype` declarado → 400. Vale para disco e S3. Testes com
arquivos reais e HTML renomeado.

### 4.6 Container (N4, N17, D9)

- `backend/Dockerfile`: `USER node`; `mkdir uploads` com `chown node` (usado só no
  modo disco local).
- `db/Dockerfile`: `USER node`.
- Contexto `manasync:depuracao` (padrão `false`):

| | `false` (padrão) | `true` |
|---|---|---|
| `readonlyRootFilesystem` | `true` | `false` |
| `enableExecuteCommand` | `false` | `true` |

  Ligar: `cdk deploy ManaSyncApp -c manasync:depuracao=true` (substitui a task).
  Desligar do mesmo jeito ao terminar.
- Com read-only, montar um volume efêmero em `/tmp` (o Node e bibliotecas podem
  precisar dele).

### 4.7 Rede (N5)

- VPC: endpoint **gateway** S3 (gratuito) nas tabelas de rota públicas.
- `sgTask`: `allowAllOutbound: false`; saída 443 para `0.0.0.0/0` (ECR, Secrets
  Manager, Logs, S3), 3306 para `sgBanco`, 6379 para `sgCache`.
- `sgCache`: entrada 6379 e 6380 só de `sgTask`.
- Entrada da task: só prefix list do CloudFront, porta 3001.

### 4.8 Verificação automática

- `cdk-nag` (`AwsSolutionsChecks`) no synth; supressões com justificativa escrita
  (sem Multi-AZ, sem NAT, subnet pública por custo…).
- `infra/test/*.test.ts` (Jest + `Template.fromStack`, sem credenciais):
  - SG da task só aceita a prefix list na 3001;
  - RDS `PubliclyAccessible=false`, `StorageEncrypted=true`, `DeletionProtection=true`;
  - buckets com Block Public Access e `enforceSSL`;
  - origem da API com `HTTPPort: 3001` e header `x-origin-verify`;
  - `/api/*` com `Compress: false` e sem cache;
  - distribuição **sem** `CustomErrorResponses`;
  - task sem `ADMIN_EMAIL`, com `JWT_SECRET`, `DB_USER` do segredo de app;
  - Valkey com `UserGroupId`;
  - nenhum `AWS::Lambda::Function` com runtime ≠ `nodejs24.x` escrito por nós.
- `cdk.context.json` commitado.

---

## 5. Valkey (j, N10, D4, D10)

### 5.1 Função

| Uso | Resolve |
|---|---|
| Fan-out do SSE | eventos chegam a clientes em qualquer task |
| Store do rate limit | limite compartilhado e sobrevive a deploy |
| Consequência | 2 tasks durante o deploy → sem queda (7) |

### 5.2 Spike (primeira coisa da fase, ~1 h, ~US$ 0,10)

Pasta descartável fora do repositório. Stack CDK mínima `ManaSyncSpikeValkey` na
VPC padrão: cache serverless com RBAC + task Fargate rodando um script `ioredis`.
Exige o bootstrap (1.3) e o QEMU (0.4 #3) **antes** do spike. O bootstrap não
depende do domínio e custa centavos (bucket e repositório vazios).

**✅ Executado em 16/09/2026 — 11/11 verificações, `ioredis` 6.0.0 confirmado (D10).**

| # | Verificação | Resultado |
|---|---|---|
| 1a | sem credencial é recusado | ✅ conexão fechada pelo servidor |
| 1b | senha errada é recusada | ✅ conexão fechada pelo servidor |
| 1c | TLS + usuário/senha, modo cluster | ✅ `PONG`, Valkey 8.1 |
| 2 | `SSUBSCRIBE`/`SPUBLISH`, 12 canais em slots diferentes | ✅ 12/12, latência máx. 2 ms |
| 3 | `MULTI INCR` + `PEXPIRE NX` + `PTTL`, `DECR`, `DEL` | ✅ `NX` não renova a janela na 2ª chamada |
| 4a–e | `SET` fora de `rl:*`, `GET`, `SPUBLISH` fora de `evento:*`, `FLUSHALL`, `KEYS` | ✅ `NOPERM` (e `KEYS` nem existe) |
| 5 | assinatura sharded volta após reconexão | ✅ (queda simulada no cliente: `disconnect(true)`; `CLIENT KILL` exigiria permissão que o usuário não tem) |

**O que as 5 execuções ensinaram** (entra no PR 5 e no PR 9):

1. **Usuário `default` precisa de senha.** O engine Valkey recusa
   `no-password-required`. Solução validada: senha aleatória própria, que ninguém
   usa, com `off -@all`.
2. **`+cluster|info` é obrigatório.** O `Cluster` do ioredis faz *ready check* com
   `CLUSTER INFO`; sem a permissão, recebe `NOPERM` e **desiste em silêncio**
   (`None of startup nodes is available`, sem evento `node error`). Achado com
   `DEBUG=ioredis:cluster*`.
3. **Falha de autenticação = conexão fechada.** Não chega `WRONGPASS`. O backend
   precisa logar "conexão recusada pelo Valkey — conferir `VALKEY_USER`/`VALKEY_PASS`"
   quando a conexão fecha logo após conectar, senão uma senha errada parece
   problema de rede.
4. O endpoint único serve primário (6379) e leitura (6380). Sem `scaleReads`, o
   cliente usa só o primário: é o que queremos (pub/sub e escrita).

Stack destruída; imagens do ECR do bootstrap apagadas. Código do spike ficou no
scratchpad da sessão (descartável); o essencial está nesta seção e em 5.3/5.5.

### 5.3 SSE

**✅ Implementado no PR 5** (`lib/valkey.js`, `services/eventStream.js` como fábrica,
`lib/config.js#valkeyConfig`). Validado: 36 testes unitários, 4 cenários de
integração contra Valkey 8.1.10 real e `app.js` em dois processos (entrega entre
tasks, injeção descartada, desassinatura, desligamento sem conexões penduradas).
Acréscimos em relação ao texto abaixo: `kind` só `update`/`deleted` (lista fechada,
impede injeção de linhas no stream); `VALKEY_CLUSTER=true` exige `rediss://`; senha
na URL é recusada; `ioredis` fixo em 6.0.0.

`backend/src/lib/valkey.js`
- Sem `VALKEY_URL` → desligado; comportamento de hoje.
- `VALKEY_CLUSTER=true` → opções **validadas no spike**:
  ```js
  new Cluster([{ host, port }], {
    dnsLookup: (endereco, cb) => cb(null, endereco), // TLS: certificado é do nome
    redisOptions: { tls: { servername: host }, username, password, connectTimeout: 5000 },
    shardedSubscribers: true,
    slotsRefreshTimeout: 5000,
    clusterRetryStrategy: (n) => Math.min(n * 200, 2000),
  });
  ```
  Mantém `enableReadyCheck` (padrão) — por isso `+cluster|info` na permissão.
- Escutar `node error` e logar; conexão fechada logo após conectar → log explícito
  de credencial (lição 3 do spike).
- Caso contrário → `new Redis(url)` (local).
- Conexões separadas: comandos e assinatura.
- `ID_DA_TASK` = `crypto.randomUUID()` no boot.

`backend/src/services/eventStream.js`
- `broadcast`: entrega local na hora + `spublish('evento:<id>', JSON {origem, kind})`.
- Primeiro assinante local → `ssubscribe`; último sai → `sunsubscribe`.
- Recebe mensagem com `origem` = própria → ignora.
- Chamadas atuais (19 em `events.js`) inalteradas.
- `closeAll()` também encerra as conexões Valkey (`quit` com timeout).

Degradação: Valkey fora → entrega local continua, erro logado com limite de
frequência. `/api/health` **não** consulta Valkey.

Testes: unitários com cliente falso (sem rede); integração local contra
`valkey/valkey` do compose, com dois processos.

### 5.4 Rate limit

**✅ Implementado no PR 5** (`lib/rateLimitStore.js`), incluindo o caso do `DECR` em
chave expirada (apaga em vez de deixar -1 sem prazo) e teste com o
`express-rate-limit` real: 11ª tentativa → 429, limite somado entre duas instâncias.

`backend/src/lib/rateLimitStore.js` (contrato `express-rate-limit` v8):
- chave `rl:` + SHA-256(`ip:email`);
- `increment`: `MULTI INCR / PEXPIRE windowMs NX / PTTL / EXEC`;
- `decrement`: `DECR`; `resetKey`: `DEL`;
- `passOnStoreError: true` (queda do cache não bloqueia login; loga);
- sem Valkey → `MemoryStore` (hoje).

Testes do contrato com cliente falso.

### 5.5 CDK

- `CfnServerlessCache`: `engine: 'valkey'`, `majorEngineVersion: '8'`, limites 1 GB /
  5000 ECPU/s, `userGroupId`, `addDependency(grupo)`.
- `SegredoValkey`: senha gerada, 40 caracteres, sem pontuação.
- `SegredoValkeyDefault`: senha gerada, **só para satisfazer o usuário `default`**
  (lição 1 do spike). Ninguém a usa.
- `CfnUser` `manasync-default-off`: `engine: 'valkey'`, `userName: 'default'`,
  `accessString: 'off -@all'`, `authenticationMode: { Type: 'password', Passwords:
  [SegredoValkeyDefault] }`.
- `CfnUser` `manasync-app`: `engine: 'valkey'`, `authenticationMode: { Type:
  'password', Passwords: [SegredoValkey] }`, `accessString` **validada no spike**:
  ```
  on ~rl:* &evento:* -@all +@connection +info +cluster|info +cluster|slots
  +cluster|shards +ssubscribe +sunsubscribe +spublish +multi +exec +incr +decr
  +pexpire +pttl +del
  ```
- `CfnUserGroup`: `engine: 'valkey'`, os dois usuários, `addDependency` em ambos.
- SG do cache: 6379 **e 6380** só de `sgTask` (o `CLUSTER SLOTS` anuncia os dois).
- App: `VALKEY_URL`, `VALKEY_CLUSTER=true`; `VALKEY_USER`/`VALKEY_PASS` via `secrets`.
- `docker-compose.yml`: serviço `valkey/valkey:8-alpine`; backend com
  `VALKEY_URL=redis://valkey:6379`.

**Pronto quando:** com 2 tasks, lançar resultado numa atualiza cliente da outra;
11 tentativas → 429, persistente após redeploy.

---

## 6. S3 e CloudFront (h, i, N6, N8, N15, N19)

### 6.1 Armazenamento

**✅ Implementado no PR 6** (`lib/armazenamento.js`, `lib/uploads.js`,
`lib/config.js#uploadsConfig`). Mudança em relação ao texto abaixo: **disco e S3
usam o mesmo fluxo** — o arquivo chega em memória, a assinatura é conferida e só
então é gravado. Antes, no modo disco, o multer gravava primeiro e apagava depois
se a assinatura falhasse. Acréscimos: `IfNoneMatch: '*'` no `PutObject` e `wx` no
disco (nunca sobrescreve); `remover` só aceita o nome exato `uuid.ext`;
`UPLOADS_BUCKET` exige `AWS_REGION` e nome de bucket válido na subida. 18 testes
novos, incluindo multipart real nos dois modos e `app.js` real (rota `/uploads`
só existe no modo disco).

`backend/src/lib/uploads.js`:
- `UPLOADS_BUCKET` vazio → disco (hoje), com validação de assinatura.
- Definido → `memoryStorage` (limites 5 MB / 512 KB) → assinatura → `PutObject`
  `uploads/<uuid><ext>`, `ContentType` detectado, `CacheControl: public,
  max-age=31536000, immutable`, `ContentDisposition: attachment`.
- `removeFile` → `DeleteObject` com `path.basename`.
- `publicPath` continua `/uploads/<arquivo>`: banco e frontend intactos.
- Dependência `@aws-sdk/client-s3`; `AWS_REGION` explícito.
- Testes com cliente S3 falso.

### 6.2 Servir

`app.js`: `express.static('/uploads')` só no modo disco.

### 6.3 Bucket de imagens (N6)

`grantPut(taskRole, 'uploads/*')` + `grantDelete(taskRole, 'uploads/*')`. Nada de
leitura ou listagem.

### 6.4 Distribuição (h, N15, N19)

| Comportamento | Origem | Ajustes |
|---|---|---|
| padrão | bucket SPA (OAC) | **CloudFront Function** viewer-request: URI sem extensão → `/index.html`; cabeçalhos de segurança atuais |
| `/api/*` | `origin.app.mercadiastore.online` | **`httpPort: 3001`** (N15); HTTP only; `readTimeout` 60 s; `keepaliveTimeout` 60 s; **`compress: false`** (N19); `CACHING_DISABLED`; `ALL_VIEWER_EXCEPT_HOST_HEADER`; header `x-origin-verify` |
| `/uploads/*` | bucket imagens (OAC) | `CACHING_OPTIMIZED`; política de cabeçalhos própria com `nosniff` e `Content-Security-Policy: default-src 'none'; sandbox` |

- **Remover `errorResponses`** (h).
- **Sem `www`** (D11 = B): `domainNames` só com `app.mercadiastore.online`, sem SAN no
  certificado, um par A/AAAA na raiz da zona. Remove o laço `Apex`/`Www` de
  `edge-stack.ts`.
- CloudFront Function não é Lambda@Edge: permitida.

**Pronto quando:** `/event/x` → 200 HTML; `/api/events/nao-existe` → 404 JSON;
`/uploads/nao-existe.png` → 403/404 do S3 sem HTML.

### 6.5 Publicação do SPA (N8, D7)

`scripts/publicar-spa.sh`:
1. lê `BucketSpa` e `DistribuicaoId` dos outputs de `ManaSyncBorda`;
2. `npm ci && npm run build` (Node 24; saída `dist/frontend/browser`, conferida
   no primeiro run);
3. `aws s3 sync … --delete --exclude index.html --cache-control "public,
   max-age=31536000, immutable"`;
4. `aws s3 cp index.html … --cache-control "no-cache"`;
5. `aws cloudfront create-invalidation --paths /index.html /`.

---

## 7. Origem e deploy sem queda (N11, N18, D3)

### 7.1 Lambda de DNS

**✅ Implementada no PR 8** (`infra/lambda/dns-updater/src/{index,reconciliar,aws}.js`;
23 testes, 4 mutações pegas; job `dns-updater` no CI). Diferenças em relação ao
texto abaixo: gravação com **`DELETE` exato + `CREATE` no mesmo lote** (controle de
concorrência otimista do Route 53; `InvalidChangeBatch` → relê e repete, até 3x) em
vez de `UPSERT`; espera de saúde padrão **20 s** (cabe no timeout de 30 s); variável
nova `SERVICE_NAME`. O asset do CDK agora é `lambda/dns-updater/src` (só código, sem
testes nem `node_modules`). Gatilhos e IAM ficam no PR 9.

Evento não traz saúde (N18), então a função **consulta** e **reconcilia**:

**Gatilhos**
1. `ECS Task State Change` do grupo `service:<nome>` (qualquer transição);
2. regra agendada `rate(1 minute)` (rede de segurança; ~43 mil invocações/mês,
   dentro do nível gratuito).

**Lógica**
1. `ListTasks(cluster, serviceName, desiredStatus=RUNNING)` → `DescribeTasks`.
2. Filtra `lastStatus=RUNNING` e `healthStatus=HEALTHY`.
3. ENI → IP público (`DescribeNetworkInterfaces`).
4. Lê o registro atual; se o conjunto ordenado for igual, **não grava** (evita
   chamadas desnecessárias ao Route 53).
5. Diferente e não vazio → `UPSERT` A multi-valor, TTL 30. Tasks com
   `desiredStatus=STOPPED` nunca entram, mesmo que ainda estejam RUNNING.
6. Vazio → não altera (loga aviso).

Idempotente; concorrência sem reserva (limite da conta: 10).
Timeout 30 s. Log de 1 semana. Testes com clientes falsos.

### 7.2 Serviço e desligamento

**✅ Parte do backend implementada no PR 7** (`lib/desligamento.js`,
`lib/config.js#desligamentoConfig`): atraso só no SIGTERM, prazo de segurança
contado depois do atraso, soma validada na subida (≤ 115 s). 11 testes com relógio
falso, verificados por mutação; `app.js` real medido (atraso de 3 s: 200 durante,
SSE encerrado em 3002 ms, saída 0; SIGINT em 11 ms). A parte de infraestrutura
(`stopTimeout`, `minHealthyPercent`, TTL, Lambda) fica no PR 9.

- `desiredCount: 1`, `minHealthyPercent: 100`, `maxHealthyPercent: 200`, circuit
  breaker com rollback.
- Sem ALB, o ECS usa o **health check do container** para considerar a task nova
  saudável antes de parar a velha.
- TTL do registro `origin`: **30 s**.
- `backend/src/app.js`, `desligar()`: espera `PRE_STOP_DELAY_MS` (**45 s**) servindo
  normalmente → `server.close` → `closeAll` (SSE + Valkey) → `pool.end`.
  `SHUTDOWN_TIMEOUT_MS` (10 s) conta depois do atraso.
- `stopTimeout`: **70 s** (45 + 10 + folga; o máximo do Fargate é 120 s).

**Sequência de um deploy**
1. ECS sobe a task nova. O evento `RUNNING` dispara a Lambda, que ainda não a
   publica (não está HEALTHY).
2. A task nova passa no health check. O ECS a considera saudável e **só então**
   manda SIGTERM à velha (`minHealthyPercent: 100`).
3. A parada da velha gera evento → Lambda recalcula: velha tem
   `desiredStatus=STOPPED` e sai; nova está RUNNING + HEALTHY e entra. O registro
   passa a ter só o IP novo.
4. A velha continua atendendo por 45 s, mais que TTL (30 s) + cache do CloudFront.
5. A velha fecha as conexões; clientes SSE reconectam e caem na nova.

O agendamento de 1 min só corrige casos anormais (evento perdido, erro
transitório no Route 53).

**Premissa a confirmar no aceite (11.3 #10):** o CloudFront respeitar o TTL. Se o
laço de `curl` registrar erro, subir `PRE_STOP_DELAY_MS` para 90 s e `stopTimeout`
para 110 s.

### 7.3 IAM (N7)

- `ecs:ListTasks`, `ecs:DescribeTasks`: condição `ecs:cluster` = ARN do cluster.
- `ec2:DescribeNetworkInterfaces`: `*` (API não aceita recurso).
- `route53:ListResourceRecordSets` na zona.
- `route53:ChangeResourceRecordSets` na zona, condição
  `route53:ChangeResourceRecordSetsNormalizedRecordNames` = `origin.app.mercadiastore.online`.

---

## 8. CDK — visão final

### 8.1 Stacks

**✅ Implementado no PR 9.** 54 testes de template (`infra/test/`), 6 mutações pegas,
`cdk synth` real pelo CLI com as credenciais do projeto (lookups gravados em
`cdk.context.json`: `pl-b6a144df`, `us-east-2a/b/c`). Desvios de desenho em relação ao
texto deste plano, todos surgidos na implementação:

| Onde | Plano dizia | Ficou | Por quê |
|---|---|---|---|
| cdk-nag | `Aspects` + `NagSuppressions` | `Validations.of(app).addPlugins(new AwsSolutionsChecks(app))` + `reconhecer()` (lib/nag.ts) | API do cdk-nag 3.0; achado sem reconhecimento **derruba o synth** |
| cdk-nag | supressões com justificativa | **inventário aprovado** testado (`nag.test.ts`): 25 pares construto × regra, nenhum no nível de stack | reconhecimento na stack esconderia achados de recursos novos |
| Usuário sem root | `USER node` no Dockerfile | `user: 'node'` na task definition (app e migração) | o volume `backend_uploads` do compose local é do root |
| Bucket de imagens | nome gerado | `manasync-imagens-<CONTA>-us-east-2` | ARN literal na permissão; reconhecimento estável; sem export entre stacks |
| IAM do bucket | `grantPut` + `grantDelete` | só `s3:PutObject` e `s3:DeleteObject` em `uploads/*` | os grants concediam `DeleteObject*` (apaga **versões**, anulando o versionamento) e `Abort*`/tagging |
| IAM da Lambda | `AWSLambdaBasicExecutionRole` | papel próprio, logs só no log group dela | a política gerenciada escreve em qualquer log group |
| `ORIGIN_VERIFY_ANTERIOR` | sempre mapeado | só com `-c manasync:rotacaoOrigem=true` | campo vazio fora da rotação |
| Alarme de task | `RunningTaskCount < 1` | `SampleCount` de CPU < 1, dado ausente = alarme | `RunningTaskCount` só existe com Container Insights (desligado) |
| Referências entre stacks | implícito | `@aws-cdk/core:defaultCrossStackReferences: strong` explícito | protege recurso em uso contra exclusão; nada implantado, sem custo de migração |
| `adminEmail` | só na migração | também destino do tópico SNS de alertas | e-mail de confirmação chega no 1º deploy |

Custo: 4 alarmes (~US$ 0,40/mês) e 6 segredos no Secrets Manager (~US$ 2,40/mês).

```
ManaSyncRede ──► ManaSyncDados ──► ManaSyncMigracao
     │
     └─────────► ManaSyncBorda ──► ManaSyncApp  (também depende de Dados)
```

| Stack | Conteúdo |
|---|---|
| `ManaSyncRede` | VPC 2 AZs (pública + isolada), endpoint S3, SGs (task, migração, banco, cache), cluster ECS |
| `ManaSyncDados` | RDS 8.4, parameter group, segredos master e app, Valkey + RBAC + segredo. `terminationProtection` |
| `ManaSyncMigracao` | imagem `db/`, task definition, log group |
| `ManaSyncBorda` | buckets SPA e imagens, segredo de origem, CloudFront Function, políticas de cabeçalho, distribuição, A/AAAA de `app.mercadiastore.online` (raiz da zona) |
| `ManaSyncApp` | imagem backend, segredo JWT, task definition, serviço, Lambda de DNS + regras, alarmes |

Todas: tags `projeto`, `ambiente`; região `us-east-2` validada.

### 8.2 Variáveis da task

| Variável | Origem |
|---|---|
| `NODE_ENV=production`, `PORT=3001`, `TRUST_PROXY=1`, `SSE_HEARTBEAT_MS=15000`, `SHUTDOWN_TIMEOUT_MS=10000`, `PRE_STOP_DELAY_MS=45000`, `AWS_REGION=us-east-2`, `CORS_ORIGINS=''` | literal |
| `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_SSL=true`, `DB_SSL_CA_PATH` | referência/literal |
| `DB_USER`, `DB_PASS` | `SegredoAppBanco` |
| `JWT_SECRET` | `SegredoJwt` |
| `ORIGIN_VERIFY_ATUAL`, `ORIGIN_VERIFY_ANTERIOR` | `SegredoOrigem` |
| `VALKEY_URL`, `VALKEY_CLUSTER=true` | referência/literal |
| `VALKEY_USER`, `VALKEY_PASS` | `SegredoValkey` |
| `UPLOADS_BUCKET` | referência |

### 8.3 Observabilidade

- Log groups 1 semana (app, migração, Lambda).
- Tópico SNS com assinatura por e-mail (confirmar no e-mail após o deploy).
- Alarmes: `RunningTaskCount < 1` por 3 min; RDS `FreeStorageSpace < 2 GB`; RDS
  `CPUUtilization > 80%` por 15 min; Lambda de DNS com `Errors > 0` em 5 min.

### 8.4 Contexto (`cdk.json`)

`manasync:region`, `manasync:domainName`, `manasync:hostedZoneId`,
`manasync:certificateArn`, `manasync:env`, `manasync:depuracao`. `adminEmail` só
por `-c`, vindo do `.env`.

### 8.5 CI

Job `infra`: `npm ci`, `npx tsc --noEmit`, `npm test` (asserções de 4.8, sem
credenciais). Job `db`: ✅ feito no PR 4 — `mysql:8.4` como service container,
unitários + integração obrigatória.

---

## 9. Scripts

**✅ Implementado no PR 10.** 37 testes com stubs (`scripts/test/`: nenhuma chamada à
AWS), `shellcheck` limpo, 6 mutações pegas (sem `set -e`, App antes da migração,
exitCode ignorado, `index.html` antes dos bundles, conta não conferida, 404 da API
não conferido). Job `scripts` no CI. Acréscimos em relação à tabela abaixo:

- **`scripts/zona.sh`** (novo): cria a hosted zone (idempotente, com confirmação),
  mostra os 4 NS para o cPanel, confere a delegação e grava o ID no `cdk.json`
  (`--gravar`). `certificado.sh --gravar` faz o mesmo com o ARN.
- `migrar.sh --sem-snapshot` só no primeiro deploy; a limpeza mantém sempre os 3
  snapshots mais recentes e só toca o prefixo `manasync-pre-migracao-`.
- `deploy.sh` roda os testes de template antes (`--pular-testes` desliga), usa
  `cdk deploy --exclusively` em cada passo e só pula aprovação de IAM/SG com `--sim`.
- `fumaca.sh` só lê; é também a verificação de uma release.
- Toda ferramenta externa é trocável por variável (`MANASYNC_AWS`, `MANASYNC_CDK`, …).

| Script | Faz |
|---|---|
| `scripts/aws-env.sh` | carrega `.env`, fixa `AWS_PROFILE=manasync` e `AWS_REGION=us-east-2`, confere a conta com `sts get-caller-identity` (aborta se ≠ `<CONTA>`), confere `buildx` com arm64 |
| `scripts/certificado.sh` | 1.2 |
| `scripts/migrar.sh` | 3.2 |
| `scripts/publicar-spa.sh` | 6.5 |
| `scripts/deploy.sh [primeiro\|release]` | orquestra 11.1/11.3 e para no primeiro erro (`set -euo pipefail`) |
| `scripts/fumaca.sh` | verificações de 11.2 que não precisam de navegador |

---

## 10. Documentação (N13)

**✅ Implementado no PR 11:** `SPEC.md` reescrita, `RUNBOOK.md` novo, `infraestructure/README.md`,
`README.md` da raiz, `diagramas/aws.drawio` refeito. Durante a revisão, a rotação do
segredo de origem ganhou o contexto `manasync:versaoSegredoOrigem` (sem ele o
CloudFormation não atualizaria o CloudFront — RUNBOOK §5.3).

- `infraestructure/aws/SPEC.md`: arquitetura real.
- `infraestructure/README.md`: §2, §2.3, §3, §5.
- `infraestructure/diagramas/aws.drawio`.
- `README.md` raiz: Node 24, Valkey local, `baseline`, como fazer deploy.
- Este arquivo → runbook (seções 0.4, 0.5, 11).

---

## 11. Execução

### 11.1 Implementação (sem deploy)

| # | PR | Depende | Tamanho |
|---|---|---|---|
| 1 | ✅ Node 24 + `tsx` (2) | — | P |
| 2 | ✅ Backend: JWT, origem, CORS, admin, assinatura (4.1–4.5) | 1 | M |
| 3 | ✅ Spike Valkey (5.2) — 11/11, stack destruída | 0.4 | P |
| 4 | ✅ `db/`: migrations e usuário de app (3.2, 3.3) | 1 | M |
| 5 | ✅ Backend: Valkey SSE + rate limit (5.3, 5.4) | 3 | M |
| 6 | ✅ Backend: S3 (6.1, 6.2) | 2 | P |
| 7 | ✅ Backend: desligamento com atraso (7.2) | 5 | P |
| 8 | ✅ Lambda de DNS (7.1) | 1 | P |
| 9 | ✅ CDK completo + testes + cdk-nag (1, 3, 4.6–4.8, 5.5, 6.3, 6.4, 7.3, 8) | 2–8 | G |
| 10 | ✅ Scripts (9) | 9 | P |
| 11 | ✅ Documentação (10) | 9 | P |

Cada PR: testes verdes; o CDK do PR 9 validado com `cdk synth --strict` e contexto
fictício.

### 11.2 Primeiro deploy

Pré: 0.4 e 0.5 feitos; certificado `ISSUED`; PRs 1–11 no `master`; CI verde.

| # | Passo | Tempo |
|---|---|---|
| 1 | `source scripts/aws-env.sh` | — |
| 2 | `cdk bootstrap aws://<CONTA>/us-east-2` | 3 min |
| 3 | `cdk synth --strict` e `cdk diff` — revisar | 2 min |
| 4 | `cdk deploy ManaSyncRede ManaSyncDados ManaSyncMigracao` | 20 min |
| 5 | `scripts/migrar.sh` (primeiro snapshot + schema + `manasync_app`) | 10 min |
| 6 | `cdk deploy ManaSyncBorda` | 10 min |
| 7 | `scripts/publicar-spa.sh` | 3 min |
| 8 | `cdk deploy ManaSyncApp` | 8 min |
| 9 | Confirmar a assinatura SNS no e-mail | — |
| 10 | **Criar sua conta no site** com o e-mail do `ADMIN_EMAIL` | — |
| 11 | `scripts/migrar.sh` → promove a admin; conferir no log | 5 min |
| 12 | `scripts/fumaca.sh` + checklist 11.3 | 15 min |

Se qualquer passo falhar: parar, ler o primeiro evento `_FAILED`
(`cdk --unstable=diagnose diagnose <stack>` ou `describe-events`), corrigir, repetir
o passo. As stacks são independentes o bastante para não refazer as anteriores.

### 11.3 Checklist de aceite

| # | Verificação | Esperado |
|---|---|---|
| 1 | `curl -s https://app.mercadiastore.online/api/health` | 200 `{"status":"ok"}` |
| 2 | `curl -s -H 'x-origin-verify: forjado' https://app.mercadiastore.online/api/events` | 200 (header sobrescrito) |
| 3 | `curl -m 5 http://<IP da task>:3001/api/health` | timeout |
| 4 | Log da task após o passo 3 | nenhuma linha (SG bloqueou antes) |
| 5 | Login e criação de evento com capa | imagem aparece; objeto em `uploads/` |
| 6 | Upload de HTML renomeado para `.png` | 400 |
| 7 | `/event/<id>` aberto direto | 200 |
| 8 | `/api/events/nao-existe` | 404 JSON |
| 9 | 11 senhas erradas | 429; continua após `aws ecs update-service --force-new-deployment` |
| 10 | Deploy forçado com `curl` em laço de 1 s em `/api/health` | nenhum erro |
| 11 | `desiredCount=2`, dois navegadores, lançar resultado | ambos atualizam; voltar para 1 |
| 12 | Cadastro com outro e-mail + `migrar.sh` | não vira admin |
| 13 | Log da migração | `manasync_app` garantido, 0 migrations pendentes |
| 14 | Resposta de `/uploads/…` | `content-security-policy: default-src 'none'; sandbox`, `x-content-type-options: nosniff` |
| 15 | SSE aberto por 5 min sem atividade | conexão continua (pings a cada 15 s) |
| 16 | Billing | gasto do dia compatível com seção 12 |

### 11.4 Releases

`scripts/deploy.sh release`: testes → `cdk deploy ManaSyncMigracao` → `migrar.sh`
(snapshot + migrations; aborta em erro) → `cdk deploy ManaSyncApp` →
`publicar-spa.sh` se `frontend/` mudou.

### 11.5 Rollback

| Falha | Ação |
|---|---|
| Task nova não fica saudável | circuit breaker volta sozinho |
| Migration | restaurar o snapshot do `migrar.sh` num banco novo e trocar o endpoint (DDL no MySQL não é transacional) |
| SPA | `publicar-spa.sh` do commit anterior |
| `UPDATE_ROLLBACK_FAILED` | `cdk rollback <stack>` |
| Desistir de tudo | `cdk destroy` de App, Borda, Migracao, Rede; Dados exige desligar `terminationProtection` e `deletionProtection`; bucket de imagens fica (`RETAIN`); registro `origin.app.mercadiastore.online` e CNAME do ACM ficam na zona |

---

## 12. Custo (`us-east-2`, USD/mês, estimativa de tabela)

| Item | ~ |
|---|---|
| Fargate ARM 0,25 vCPU / 0,5 GB 24×7 | 7 |
| IPv4 público da task | 3,6 |
| RDS `db.t4g.micro` + 20 GB gp3 | 14 |
| Snapshots manuais (≤ 30 dias, 20 GB) | ~1 |
| Valkey Serverless (mínimo) | 6–7 |
| Secrets Manager (6 segredos: master do RDS, app, JWT, origem, Valkey, Valkey `default`) | 2,4 |
| Route 53 (zona + consultas) | 1 |
| CloudFront, S3, CloudWatch, Lambda, EventBridge, SNS, endpoint S3 | 1 |
| **Total** | **~US$ 35/mês** |

US$ 100 de crédito ≈ **3 meses**. Antes de divulgar o site: plano Paid (D2).
Confirmar no AWS Pricing Calculator.

---

## 13. Fora do plano

- Verificação de e-mail e recuperação de senha (raiz do N1).
- WAF na borda.
- ALB + subnets privadas.
- Multi-AZ.
- Deploy pelo GitHub Actions com OIDC.
