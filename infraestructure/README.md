# Infraestrutura — ManaSync Clone

| Provedor | Estado | Documentos | Diagrama |
|---|---|---|---|
| **AWS** | **implementado** (CDK em `infra/`, scripts em `scripts/`) | [SPEC](aws/SPEC.md) · [RUNBOOK](aws/RUNBOOK.md) · [PLANO-DEPLOY](aws/PLANO-DEPLOY.md) | [`aws.drawio`](diagramas/aws.drawio) |
| Google Cloud | spec de referência, não implementado | [SPEC](googlecloud/SPEC.md) | [`gcp.drawio`](diagramas/gcp.drawio) |

Este README descreve o que é comum aos provedores: a arquitetura da aplicação, o que
ela exige do ambiente e como essas exigências foram resolvidas no código.

---

## 1. Arquitetura da aplicação

```
navegador
   │
   ▼
entrada na mesma origem ──────────────┐
(nginx no Docker local;               │
 CDN / LB em nuvem)                   │
   │ /            │ /api/*            │ /uploads/*
   ▼              ▼                   ▼
SPA estática   backend Node 24     disco local (Docker)
(Angular 21)   Express :3001       ou bucket de objetos
                 │        │
                 ▼        ▼
              MySQL 8.4  Valkey 8 (opcional)
                         pub/sub do SSE + rate limit
```

| Componente | Local (`docker compose`) | Nuvem |
|---|---|---|
| SPA | container nginx (serve e faz proxy) | bucket + CDN |
| backend | container `backend/Dockerfile` | container gerenciado |
| banco | `mysql:8.0` com volume (a troca local para 8.4 está pendente, PLANO §3.1) | MySQL 8.4 gerenciado |
| cache | `valkey/valkey:8.1-alpine` | Valkey gerenciado |
| uploads | volume `backend_uploads` | bucket de objetos |
| schema | `docker-entrypoint-initdb.d` na 1ª subida | runner `db/migrate.js` em task avulsa |

O backend decide tudo pelo ambiente — a mesma imagem roda nos dois lugares. Variáveis:
[`README.md` da raiz](../README.md#variáveis-de-ambiente-backend).

---

## 2. O que a nuvem exige, e como foi resolvido

| Exigência | Antes | Resolvido em | Como |
|---|---|---|---|
| Uploads sobreviverem a deploy e a várias instâncias | `multer.diskStorage` no disco do container | PR 6 | `UPLOADS_BUCKET` grava no bucket; vazio mantém o disco local. Os bytes são conferidos antes de gravar (`backend/src/lib/uploads.js`) |
| SSE funcionar com mais de uma instância | `Map` em memória do processo | PR 5 | `VALKEY_URL` liga pub/sub sharded entre instâncias; vazio mantém o registro em memória (`services/eventStream.js`) |
| Conexão SSE atravessar CDN/LB | heartbeat de 25 s | preparo anterior aos PRs; PR 9 | heartbeat de 15 s (`SSE_HEARTBEAT_MS`); na CDN, compressão desligada em `/api/*` e timeout de leitura de 60 s |
| Schema num banco gerenciado (sem `initdb`) | só o `initdb` do container | PR 4 | runner com histórico, lock e usuário só com DML (`db/`) |
| Deploy sem derrubar conexões | processo morria no SIGTERM | preparo anterior aos PRs; PR 7 | desligamento limpo (fecha SSE e banco) e, no PR 7, atraso configurável depois do SIGTERM (`lib/desligamento.js`) |
| Limite de tentativas de senha com várias instâncias | contador em memória | PR 5 | contador no Valkey (`lib/rateLimitStore.js`) |

---

## 3. Mudanças de código para produção

Todas feitas; nenhuma quebra o `docker compose` local. "Preparo anterior" é o trabalho
que já existia antes dos PRs 1–11 do [PLANO](aws/PLANO-DEPLOY.md).

| # | Arquivo | Mudança | PR |
|---|---|---|---|
| 1 | `frontend/src/environments/environment.ts` | `apiUrl` relativo (`/api`) | anterior aos PRs |
| 2 | `backend/src/lib/uploads.js`, `lib/armazenamento.js` | disco ou S3; assinatura dos bytes | 2, 6 |
| 3 | `backend/src/lib/config.js` | CORS, proxy e TLS do banco (preparo anterior); JWT, origem e CORS em produção (2); Valkey (5); uploads (6); desligamento (7) — tudo do ambiente e validado na subida | anterior, 2, 5, 6, 7 |
| 4 | `backend/src/services/eventStream.js`, `lib/valkey.js` | SSE entre instâncias | 5 |
| 5 | `db/` | runner de migrations e usuário de aplicação | 4 |
| 6 | `backend/src/middleware/originVerify.js` | só aceita requisição da CDN do projeto | 2 |
| 7 | `backend/src/lib/bootstrapAdmin.js` | admin inicial só se não houver admin | 2 |
| 8 | Dockerfiles, CI, Lambda | Node 24 | 1 |

---

## 4. Topologia na AWS (resumo)

CloudFront (SPA, `/api/*`, `/uploads/*`) → ECS Fargate ARM numa subnet pública,
protegida por security group com a prefix list do CloudFront e por header secreto →
RDS MySQL 8.4 e Valkey Serverless em subnets isoladas. Sem ALB e sem NAT: uma Lambda
mantém o DNS da origem com os IPs das tasks saudáveis. Detalhes na [SPEC](aws/SPEC.md).

## 5. Colocar no ar

AWS: siga o [RUNBOOK](aws/RUNBOOK.md) — preparação (zona, certificado), `scripts/deploy.sh
primeiro`, checklist de aceite.

## 6. Fora do escopo atual

- HA multi-AZ / multi-região, WAF — anotados como próximos passos na [SPEC](aws/SPEC.md#10-limitações-conhecidas).
- Verificação de e-mail no cadastro.
- Implementação no Google Cloud (a spec continua como referência de desenho).
