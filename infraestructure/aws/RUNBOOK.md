# Runbook — ManaSync na AWS

Passo a passo para colocar no ar e operar. Arquitetura: [SPEC](SPEC.md). Decisões e
histórico: [PLANO-DEPLOY](PLANO-DEPLOY.md).

Todos os comandos rodam da raiz do repositório. Os scripts param no primeiro erro e
conferem sozinhos conta, região, login e ferramentas antes de começar.

---

## 1. Máquina de deploy

| Requisito | Conferir | Instalar / corrigir |
|---|---|---|
| AWS CLI v2 | `aws --version` | — |
| Conta do projeto | `MANASYNC_CONTA` no `.env` da raiz (12 dígitos; ID em AWS Settings → projeto) | acrescentar a linha ao `.env` — **nunca** no código: o repositório é público |
| Login do projeto | `aws sts get-caller-identity --profile manasync` → o mesmo ID de `MANASYNC_CONTA` | `aws login --profile manasync` |
| Perfil na região do projeto | `aws configure get region --profile manasync` → `us-east-2` | editar `~/.aws/config` |
| Node 24 | `node -v` | `nvm use` (lê o `.nvmrc`) |
| Docker com arm64 | `docker buildx ls` mostra `linux/arm64` | `sudo apt install qemu-user-static binfmt-support` |
| `jq`, `dig`, `curl` | `command -v jq dig curl` | `sudo apt install jq dnsutils curl` |
| Dono da plataforma | `ADMIN_EMAIL` no `.env` da raiz | e-mail real, **fora** de `mercadiastore.online` |

`scripts/aws-env.sh` confere tudo isso de uma vez. Comandos `npx cdk` diretos (seção 5)
precisam de `MANASYNC_CONTA` exportada — rode-os depois de `. scripts/aws-env.sh && preparar_ambiente`.

> A sessão do `aws login` fica presa à região em que foi emitida. Se trocar a região
> do perfil, faça login de novo.

---

## 2. Preparação (uma vez)

### 2.1 Orçamento

No console **Billing and Cost Management → Budgets**: budget mensal de US$ 40,
alertas em 50/80/100% para o seu e-mail. Confira plano e gasto em **AWS Settings →
Billing**.

#### Plano Free: limites que já apareceram

- **Backup do RDS:** o plano Free recusa retenção acima de 1 dia ("exceeds the maximum
  available to free tier customers"). Por isso `manasync:backupDias` está em **1** no
  `infra/cdk.json`. **Ao passar para o Paid** (obrigatório antes de abrir ao público,
  PLANO D2): troque para `7` e rode `scripts/deploy.sh release`. Mudar entre valores
  diferentes de 0 não derruba o banco.
- Até lá, o ponto de restauração vai só até 1 dia atrás; os snapshots manuais do
  `migrar.sh` (antes de cada migração) continuam valendo.

### 2.2 Zona DNS

```bash
scripts/zona.sh --gravar
```

O Route 53 passa a responder pelo **domínio inteiro** `mercadiastore.online` (o editor
de zona da HostGator não cria registros NS, então não dá para delegar só `app`). O
site e o e-mail da HostGator continuam funcionando porque os registros dela são
copiados antes.

1. Valida `infra/dns/registros-hostgator.json` (A e MX da raiz, `www`, `mail`, `ftp`).
2. Cria a hosted zone `mercadiastore.online` (pede confirmação; US$ 0,50/mês).
3. Aplica os registros do arquivo (UPSERT) e grava o ID da zona em `infra/cdk.json`.
4. Compara **cada registro** no Route 53 com a HostGator (`dns3.hostgator.com.br`).
   Se algum aparecer como `DIFERENTE`, o script para: **não troque os servidores de
   nome** — corrija o arquivo e rode de novo.
5. Com tudo conferido, mostra os 4 servidores de nome `awsdns`.

**Troca dos servidores de nome** (manual, uma vez): área do cliente HostGator →
**Domínios** → `mercadiastore.online` → **Servidores DNS** / "Alterar DNS" → servidores
personalizados → os 4 mostrados pelo script. É o menu do **domínio**, não o Zone
Editor do cPanel.

Rode `scripts/zona.sh` de novo até aparecer **delegação ativa**. A propagação leva de
minutos a algumas horas (o TTL dos NS na zona `.online` manda). Durante esse tempo,
parte da internet ainda consulta a HostGator — por isso os registros precisam ser
iguais nos dois lados. Confira à parte: `dig +short NS mercadiastore.online @1.1.1.1`.

**Depois da troca:**
- Registro novo ou alterado (SPF, DKIM, DMARC para o e-mail, outro subdomínio) vai em
  `infra/dns/registros-hostgator.json` + `scripts/zona.sh`. Mudar no cPanel **não tem
  mais efeito**.
- Com o domínio estável por alguns dias, suba o `ttl` do arquivo de 300 para 14400 e
  rode o script.
- `app.*` e `origin.app.*` são do CDK e da Lambda de DNS: o script recusa esses nomes
  no arquivo.
- Voltar atrás: recolocar `dns3.hostgator.com.br` e `dns4.hostgator.com.br` no mesmo
  menu (o site na AWS deixa de ser encontrado).

### 2.3 Certificado

```bash
scripts/certificado.sh --gravar
```

Emite em `us-east-1`, cria o CNAME de validação na zona, espera a emissão e grava o ARN
em `infra/cdk.context.json`. **Nunca apague o CNAME `_…acm-validations.aws`**: é ele que
renova o certificado.

O ARN leva o ID da conta, por isso fica no `cdk.context.json` (fora do git), e **não**
no `cdk.json` (versionado, repositório público). A chave também não pode existir no
`cdk.json`, nem como `TROCAR`: o CDK lê aquele arquivo primeiro e esconderia o valor.
Os scripts recusam gravar no `cdk.json` um valor com ID de conta, e um teste do `infra`
falha se ele aparecer lá.

`cdk context --clear` (ou apagar o `cdk.context.json`, ou clonar o repositório em outra
máquina) leva o ARN junto: rode `scripts/certificado.sh --gravar` de novo — ele
reaproveita o certificado emitido, sem pedir outro.

### 2.4 Bootstrap do CDK

Já feito em `us-east-2`. Se um dia faltar:

```bash
. scripts/aws-env.sh && preparar_ambiente
(cd infra && npx cdk bootstrap "aws://$MANASYNC_CONTA/us-east-2")
```

---

## 3. Primeiro deploy

```bash
scripts/deploy.sh primeiro
```

| Passo | Tempo aprox. |
|---|---|
| testes de template + `cdk-nag` | 10 s |
| `ManaSyncRede`, `ManaSyncDados` (RDS e Valkey), `ManaSyncMigracao` | 20–25 min |
| migração sem snapshot (banco vazio) | 3–5 min |
| `ManaSyncBorda` (CloudFront) | 5–10 min |
| build e publicação da SPA | 2–3 min |
| `ManaSyncApp` (imagem arm64, serviço, Lambda, alarmes) | 5–10 min |

O CDK pede aprovação para mudanças de IAM e security groups: revise e confirme. (`--sim`
pula as perguntas.)

**Depois, nesta ordem:**

1. Confirme a assinatura de alertas no e-mail que a AWS mandou para o `ADMIN_EMAIL`.
2. Abra `https://app.mercadiastore.online` e **crie a sua conta com o `ADMIN_EMAIL`**
   antes de divulgar o endereço (o cadastro não confirma e-mail).
3. `scripts/migrar.sh` — promove a sua conta a admin. Confira no log:
   `promovido a admin`.
4. `scripts/fumaca.sh` — tem de terminar com `fumaça limpa`.
5. Checklist de aceite manual (seção 3.1).

### 3.1 Checklist de aceite (manual)

| # | Verificação | Esperado |
|---|---|---|
| 1 | Login, criar evento com capa | imagem aparece |
| 2 | Enviar um `.html` renomeado para `.png` como capa | recusado (400) |
| 3 | 11 senhas erradas para a mesma conta | 11ª dá "Too many attempts"; continua bloqueado após `aws ecs update-service --force-new-deployment` |
| 4 | Dois navegadores no mesmo evento, lançar resultado num | o outro atualiza sozinho |
| 5 | Durante `scripts/deploy.sh release`, em outro terminal: `while true; do curl -s -o /dev/null -w '%{http_code}\n' https://app.mercadiastore.online/api/health; sleep 1; done` | nenhum código diferente de 200 |
| 6 | Criar conta com outro e-mail e rodar `scripts/migrar.sh` | não vira admin |
| 7 | No log da migração | `usuário manasync_app garantido` |
| 8 | **AWS Settings → Billing** no dia seguinte | gasto compatível com a SPEC §11 |

Se o item 5 mostrar erros durante a troca de task, aumente `preStopDelayMs` e
`stopTimeoutS` em `infra/lib/config.ts` (ex.: 90 000 ms / 110 s) — PLANO §7.2.

---

## 4. Releases

```bash
scripts/deploy.sh release
scripts/fumaca.sh
```

Ordem: testes → Rede, Dados, Migracao → **snapshot + migração** → Borda → App → SPA.
Se a migração falhar, a aplicação nova não sobe.

Migration nova: crie `db/migrations/NNN_nome.sql` e atualize `db/init/01-schema.sql`
(veja [`db/README.md`](../../db/README.md)). Nunca edite uma migration já aplicada: o
runner recusa.

---

## 5. Operações

### 5.1 Entrar no container (depuração)

O ECS Exec vem desligado, junto com o disco somente-leitura. Para ligar:

```bash
. scripts/aws-env.sh && preparar_ambiente
(cd infra && npx cdk deploy ManaSyncApp --exclusively -c manasync:adminEmail="$ADMIN_EMAIL" -c manasync:depuracao=true)
CLUSTER=$(aws cloudformation describe-stacks --stack-name ManaSyncApp --query "Stacks[0].Outputs[?OutputKey=='ClusterNome'].OutputValue" --output text)
SERVICO=$(aws cloudformation describe-stacks --stack-name ManaSyncApp --query "Stacks[0].Outputs[?OutputKey=='ServicoNome'].OutputValue" --output text)
TASK=$(aws ecs list-tasks --cluster "$CLUSTER" --service-name "$SERVICO" --query 'taskArns[0]' --output text)
aws ecs execute-command --cluster "$CLUSTER" --task "$TASK" --container backend --interactive --command sh
```

Ao terminar, **desligue**: `scripts/deploy.sh release` (volta ao padrão).

### 5.2 Logs

```bash
aws logs tail "$(aws cloudformation describe-stacks --stack-name ManaSyncApp --query "Stacks[0].Outputs[?OutputKey=='LogGroup'].OutputValue" --output text)" --follow
```

Troque `ManaSyncApp` por `ManaSyncMigracao` para os logs da migração.

### 5.3 Rotação de segredos

| Segredo | Procedimento | Impacto |
|---|---|---|
| **Origem** (`x-origin-verify`) | procedimento abaixo, em 4 passos | nenhum, se a ordem for seguida |
| **JWT** | Gere um valor novo no segredo e `aws ecs update-service --force-new-deployment` | **todas as sessões caem** |
| **Senha do `manasync_app`** | Gere senha nova no segredo → `scripts/migrar.sh` (grava no MySQL) → `update-service --force-new-deployment` | erros de login no banco entre a migração e a troca de task (~1–2 min) |
| **Senha do Valkey** | Gere senha nova no segredo → aplique no usuário do Valkey (abaixo) → `update-service --force-new-deployment` | SSE entre tasks e rate limit degradados na janela (o site continua) |

**Rotação do segredo de origem.** A ordem importa: se o CloudFront trocar de valor
antes de as tasks aceitarem o novo, **toda a API responde 403**.

```bash
. scripts/aws-env.sh && preparar_ambiente
ARN=$(aws cloudformation describe-stacks --stack-name ManaSyncBorda --query "Stacks[0].Outputs[?OutputKey=='SegredoOrigemArn'].OutputValue" --output text)
CTX=(-c manasync:adminEmail="$ADMIN_EMAIL")

# 1. anterior ← atual; atual ← novo (sem os valores passarem pelo terminal)
aws secretsmanager put-secret-value --secret-id "$ARN" --secret-string "$(
  aws secretsmanager get-secret-value --secret-id "$ARN" --query SecretString --output text |
  jq --arg novo "$(openssl rand -hex 24)" '{anterior: .atual, atual: $novo}')"

# 2. tasks aceitam os dois valores
(cd infra && npx cdk deploy ManaSyncApp --exclusively "${CTX[@]}" -c manasync:rotacaoOrigem=true)

# 3. CloudFront passa a enviar o novo. A versão explícita é obrigatória: sem ela o
#    CloudFormation não percebe a troca e a distribuição fica com o valor antigo.
VERSAO=$(aws secretsmanager describe-secret --secret-id "$ARN" --output json |
  jq -r '.VersionIdsToStages | to_entries[] | select(.value | index("AWSCURRENT")) | .key')
(cd infra && npx cdk deploy ManaSyncBorda --exclusively "${CTX[@]}" -c manasync:versaoSegredoOrigem="$VERSAO")
scripts/fumaca.sh   # confirme antes do passo 4

# 4. esvaziar o anterior e voltar ao padrão
aws secretsmanager put-secret-value --secret-id "$ARN" --secret-string "$(
  aws secretsmanager get-secret-value --secret-id "$ARN" --query SecretString --output text | jq '.anterior = ""')"
scripts/deploy.sh release
```

O passo 4 cria uma versão nova do segredo com o mesmo `atual`: o `release` (sem a
versão explícita) resolve para ela e o CloudFront continua com o valor certo.

> **Valkey: `cdk deploy` não troca a senha.** O usuário lê o segredo por referência
> dinâmica, e o CloudFormation não percebe mudança no valor por trás dela — o deploy
> responde "sem mudanças". Aplique direto, sem a senha passar pelo histórico do shell:
>
> ```bash
> SEGREDO=$(aws secretsmanager list-secrets --query "SecretList[?Description=='ManaSync: senha do usuario manasync-app no Valkey'].ARN | [0]" --output text)
> aws elasticache modify-user --user-id manasync-app \
>   --authentication-mode "Type=password,Passwords=$(aws secretsmanager get-secret-value --secret-id "$SEGREDO" --query SecretString --output text)"
> ```
>
> Pelo mesmo motivo, a **senha do `manasync_app` no MySQL** só muda porque a migração a
> reescreve a cada execução.

### 5.4 Escalar temporariamente

```bash
aws ecs update-service --cluster "$CLUSTER" --service "$SERVICO" --desired-count 2
```

O Valkey mantém SSE e rate limit coerentes entre as tasks; a Lambda publica os dois IPs.
Volte para 1 com o mesmo comando (`--desired-count 1`). Não conte com o `release`
para isso: o CloudFormation só reaplica o valor se ele mudar no template.

---

## 6. Rollback

| Falhou | O que fazer |
|---|---|
| Task nova não fica saudável | nada: o circuit breaker volta sozinho para a versão anterior. Veja os logs |
| Migração | o deploy parou antes da App. Corrija com uma **migration nova** e rode `release`. Se o banco ficou inconsistente: restaure o snapshot `manasync-pre-migracao-…` numa instância nova, valide, e só então planeje a troca (manual — envolve a stack de dados) |
| SPA | faça checkout do commit anterior e `scripts/publicar-spa.sh` |
| Stack em `UPDATE_ROLLBACK_FAILED` | `(cd infra && npx cdk rollback <Stack>)` |

---

## 7. Problemas comuns

| Sintoma | Causa provável | O que fazer |
|---|---|---|
| Script para com "credenciais … expiradas" | sessão do `aws login` venceu | `aws login --profile manasync` |
| Build da imagem trava ou dá `exec format error` | emulação arm64 ausente | `docker buildx ls`; instalar `qemu-user-static binfmt-support` |
| Build trava baixando dependências | VPN (AnyConnect) e rede do Docker | o CDK já usa `network: host`; confira a VPN |
| **Toda** chamada `/api` dá 403 | header de origem diferente entre CloudFront e task (rotação pela metade) | conferir o segredo; refazer a rotação (5.3) |
| `/api` dá 502/504 | `origin.app.mercadiastore.online` sem IP, com IP velho, ou task fora do ar | `dig origin.app.mercadiastore.online`; alarme e logs da Lambda de DNS; estado do serviço |
| Alarme "Lambda de DNS falhando" | permissão, zona errada ou throttling do Route 53 | logs da Lambda; o agendamento de 1 min tenta de novo |
| Alarme "Sem task rodando" | task não sobe (imagem, segredo, health check) | eventos do serviço no console do ECS; logs |
| Log `[valkey:…] conexão fechada logo após conectar` | senha ou permissões do usuário do Valkey | o ElastiCache fecha a conexão em vez de dizer `WRONGPASS`; conferir segredo e `ACESSO_VALKEY_APP` |
| Migração: "banco já tem tabelas mas nenhum histórico" | banco criado fora do runner | conferir que tem todas as migrations e rodar `node migrate.js baseline` (db/README) |
| Migração: "migrations já aplicadas foram alteradas" | alguém editou um `.sql` aplicado | desfazer a edição; corrigir com migration nova |
| Certificado não valida | servidores de nome ainda não trocados/propagados, ou CNAME ausente | `scripts/zona.sh` até "delegação ativa"; conferir o CNAME na zona |
| Site ou e-mail da HostGator parou depois da troca | registro que faltou no arquivo | `dig` o nome em `dns3.hostgator.com.br`, acrescentar em `infra/dns/registros-hostgator.json`, `scripts/zona.sh` |
| Acesso negado em operação que funcionava | limite de gasto do plano atingido | **AWS Settings → Billing** (só o dono do projeto altera) |

---

## 8. Desmontar

Em ordem inversa às dependências — as referências entre stacks são `strong`, e o
CloudFormation recusa apagar uma stack cujos recursos outra ainda usa:

```bash
cd infra
CTX=(-c manasync:adminEmail=...)
npx cdk destroy ManaSyncApp "${CTX[@]}"
npx cdk destroy ManaSyncBorda ManaSyncMigracao "${CTX[@]}"
# ManaSyncDados: antes, desligue a termination protection da stack (console do
# CloudFormation) e a deletion protection do RDS (console do RDS).
npx cdk destroy ManaSyncDados "${CTX[@]}"
npx cdk destroy ManaSyncRede "${CTX[@]}"
```
 **Ficam** mesmo depois do destroy (custo ou dado): o bucket de imagens
(`RETAIN`), a instância RDS (`RETAIN`) com seus snapshots, o registro
`origin.app.mercadiastore.online` e o CNAME do certificado na zona, a própria zona, o
certificado em `us-east-1` e o bootstrap do CDK.
