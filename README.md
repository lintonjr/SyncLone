# ManaSync Clone

Clone funcional do [manasync.io](https://manasync.io) — plataforma de gerenciamento de torneios de card games (Magic, Commander, etc.), com pareamento suíço, playoffs em bracket, aprovação de jogadores e mais.

Stack: **Angular 21** (frontend) + **Node 24/Express** (backend) + **MySQL 8** + **Valkey 8** (opcional: SSE entre instâncias e rate limit).
Produção: **AWS** (CloudFront, ECS Fargate, RDS, ElastiCache Serverless), descrita em código com CDK — veja [Deploy na AWS](#deploy-na-aws).

## Funcionalidades

### Contas e papéis
- Três papéis, excludentes na coluna e hierárquicos na permissão: **player** → **organizer** → **admin**. Admin pode tudo que organizador pode (inclusive criar e tocar eventos), e a regra mora em um lugar só, `backend/src/lib/roles.js`
- Todo cadastro nasce com papel **player** — pode participar de eventos, mas não pode criar/organizar
- **Organizar depende de aprovação.** Em `/profile` o jogador envia uma solicitação, com justificativa opcional; o dono da plataforma aprova ou recusa em `/admin`. Aprovado, vira `organizer` — que também participa como jogador em outros eventos (não é troca, é permissão a mais). Recusado, recebe o motivo e pode pedir de novo. Um pedido pendente por pessoa, garantido por índice único no banco, não por consulta prévia na rota
- **O primeiro dono vem de `ADMIN_EMAIL`**: na subida, o backend promove a conta com esse e-mail a `admin` **somente se ainda não existir admin nenhum** (`lib/bootstrapAdmin.js`, nunca derruba o servidor). Sem essa trava, qualquer pessoa que se cadastrasse com o e-mail configurado viraria dona no próximo deploy, porque o cadastro não confirma e-mail. Daí em diante, um admin promove outros na aba **Organizadores** de `/admin`
- **Revogação existe**: o dono rebaixa um organizador a player. Os eventos que a pessoa já criou continuam dela, com histórico e jogadores intactos — o que ela perde é criar novos e administrar os que tem. Ninguém altera o próprio papel, nos dois sentidos: um admin que se rebaixasse perderia a rota que desfaria isso
- **O papel é lido do banco a cada requisição** (`middleware/auth.js`), não do JWT. O token dura 7 dias e o papel muda por decisão de outra pessoa: assim a aprovação vale no clique seguinte, sem relogar, e a revogação também — um organizador rebaixado não continua criando eventos por uma semana com o crachá velho no bolso
- `POST /api/events` (criação de evento) exige `organizer` ou `admin` (middleware `requireOrganizer`); as rotas de `/api/admin` exigem `admin` (`requireAdmin`, aplicado no router inteiro). A UI esconde os CTAs conforme o papel, mas quem barra é o servidor

### Eventos
- Criação de evento com nome, descrição, local (presencial/online), data, jogo, formato, imagem de capa (com placeholder automático quando não há imagem)
- Pontuação configurável por evento — pontos para Win / Draw / Loss definidos pelo organizador e aplicados durante todo o torneio
- Tamanho de pod configurável (2 a 4 jogadores por mesa)
- Encerramento manual do evento (`finish`) — evento finalizado vira registro fechado: não aceita mais inscrição, adição de jogador, edição de deck, nova rodada, swap nem alteração de resultado (400 em todas). A única porta de volta é o **Undo**, que continua liberado
- **Generate Entry QR Code**: quando ativado, o organizador tem um botão **Share** na página do evento — modal com nome/organizador/data/local/nº de jogadores, QR code (gerado no cliente, sem depender de serviço externo) apontando pra `/event/:id`, e botões WhatsApp / Email / Copy URL / Open Link, no mesmo formato do manasync.io real

### Jogadores
- Adicionar jogador manualmente (organizador) ou entrada via auto-registro (`join`)
- **Confirm New Players**: quando ativado, novas entradas ficam com status `pending` até o organizador aprovar/rejeitar (seção "Pending Approval" na aba Standings)
- Edição de jogador, e saída do evento por **drop**: quem já foi pareado em alguma rodada fica com status `dropped` — some das standings e dos pareamentos seguintes, mas o histórico (pareamentos e pontos que distribuiu) continua intacto e o nome aparece na seção "Dropped Players". Só quem nunca sentiu à mesa (inscrição rejeitada, desistência antes da 1ª rodada) é apagado de fato
- **Collaborative Deck Registering**: quando ativado, qualquer participante pode editar o deck de qualquer outro jogador do evento (por padrão, só o dono do evento ou o próprio jogador podem)

### Rodadas e pareamento
- 4 métodos de pareamento suíço, fiéis ao site original:
  - **Swiss (Performance Pairing)** — ordena por standing atual
  - **Swiss (Less Repetition)** / **Avoid Repetition** — evita repetir adversários já enfrentados
  - **Random** — pareamento aleatório
- **Allow Byes**: se desativado, o início da rodada é bloqueado (erro 400) quando o número de jogadores não fecha pods completos
- Edição de resultado de pod liberada enquanto a rodada não terminar (organizador, a qualquer momento antes de a rodada fechar)
- **Player-Reported Results** (campo `async_draws`): jogador pode reportar o resultado do próprio pareamento sem depender do organizador — Vitória/Derrota/Empate em 1v1, só "I Won" (inequívoco) ou Empate em pods multiplayer. Resultado enviado pelo jogador entra como **pendente** (`result_status='pending'`) e não pontua até o organizador aprovar (botão "Approve"); enquanto pendente, a rodada não fecha nem libera início da próxima. Organizador pode aprovar ou sobrescrever o valor a qualquer momento antes da rodada terminar — resultados definidos pelo próprio organizador são sempre confirmados na hora, sem aprovação
- **Desempates oficiais** (MTR 2.3), calculados no servidor: a classificação ordena por pontos → **OMW%** (média de vitória dos adversários enfrentados) → **GW%** (games ganhos) → **OGW%**, com piso de 33% em todos os percentuais. A mesma ordem alimenta a tabela, o seeding dos playoffs e a exportação — não há mais um cálculo aproximado no cliente divergindo do servidor
- **Placar por games** (opcional, só mesa 1v1): ao lançar o resultado o organizador pode registrar 2×0 ou 2×1. O placar não decide quem venceu — isso continua sendo o resultado da partida — apenas alimenta GW% e OGW%. Trocar o resultado sem informar placar limpa o anterior, para não sobrar um GW% que nunca aconteceu
- **Timer de rodada**: duração configurável por evento (padrão 50 min), contada a partir do início da rodada e visível para todos na página do evento e na aba My Round; ao estourar, vira contagem positiva com aviso de "Time!"
- **Bye rotativo**: o bye vale uma vitória inteira, então quem senta fora é decidido pela **classificação oficial**, nunca pelo método de pareamento — vai sempre para o pior colocado que **ainda não recebeu um** neste evento, e só quando todos já passaram a rotação recomeça. Empate exato de colocação (a rodada 1 inteira, por exemplo) é resolvido por sorteio uniforme, refeito a cada pareamento: desfazer e reparear uma rodada empatada pode trocar quem sai
- Undo de rodada e swap de pareamento (organizador) — Undo só reverte pontos de resultados já confirmados. Desfazer a final também limpa o campeão gravado

### Playoffs
- **Playoff Structure**: Top 4 / Top 8 / Top 16, seed pela classificação oficial do Swiss (pontos → OMW% → GW% → OGW%, a mesma ordem exibida nas standings)
- Bracket de eliminação simples com seeding em "cobra" (snake) para pods multiplayer
- Botão **Start Playoffs** ao fim da última rodada suíça; **Advance Playoffs** avança a fase seguinte (mesmo endpoint de início de rodada)
- Empate em pod de playoff avança o jogador mais bem-seedado; bye avança sozinho
- Rótulo automático de fase: Final / Semifinals / Quarterfinals / Round of N
- Banner de campeão ao final do bracket

### Ligas
- `/leagues` — lista todas as ligas; `/leagues/create` — cria liga (nome + toggle "Playoff results count towards league standings", default ligado)
- Vincular um torneio a uma liga é opcional e só o dono da liga pode fazer isso pros próprios eventos (`league_id` no Create/Edit Event, valida ownership no backend, 403 se tentar numa liga de outro organizador)
- `/leagues/:id` mostra os torneios vinculados + **standings agregados**: soma pontos/vitórias/derrotas/empates de cada jogador **com conta registrada** em todos os torneios da liga (convidados sem conta não entram na soma, só contam dentro do próprio evento — não dá pra correlacioná-los entre eventos diferentes)
- Quando o toggle de playoff está desligado, os pontos são recalculados do zero só com rodadas suíças confirmadas (a tabela `event_players` guarda só o total corrido, sem separar por tipo de rodada — a rota de standings da liga refaz esse cálculo)
- Apagar uma liga não apaga nem trava os torneios vinculados — eles só voltam a ficar sem liga (`ON DELETE SET NULL`)
- Página do evento mostra um link "🏆 Part of {liga}" quando vinculado

### Outros
- Autenticação JWT (registro / login / esqueci a senha), com limite de 10 tentativas por 15 min por IP + e-mail nos endpoints de credencial
- **Notificações**: o sino da barra superior traz contador de não lidas e é alimentado por eventos reais — inscrição feita pelo organizador, inscrição aprovada, rodada iniciada, classificação para os playoffs, resultado registrado ou aprovado, e evento finalizado. Um resultado auto-reportado avisa o organizador de que há algo esperando aprovação. Só jogadores com conta recebem (convidados avulsos não têm caixa de entrada)
- **Exportação em CSV**: `GET /api/events/:id/export?type=standings|pairings` — classificação com todos os desempates, ou todas as rodadas com mesa, resultado, vencedor e placar por games. Botões na página do evento; arquivo sai com BOM para o Excel não quebrar acentuação
- Upload de imagem de evento (multer) — só PNG / JPEG / WebP / GIF, até 5 MB; o arquivo é gravado com a extensão do tipo aceito (nunca a do nome enviado) e servido com `nosniff` + `Content-Disposition: attachment`, para que um upload nunca seja interpretado como documento na origem da SPA
- **Atualização em tempo real** da página do evento via Server-Sent Events (`GET /api/events/:id/stream`) — quando o organizador adiciona jogador, lança/aprova resultado, inicia/desfaz rodada, faz swap ou finaliza o evento, qualquer outra aba/pessoa olhando aquele evento atualiza sozinha, sem reload

## Estrutura do projeto

```
CloneManaSync/
├── backend/            # API Node/Express
│   ├── src/
│   │   ├── app.js
│   │   ├── db.js                   # pool MySQL + db.transaction()
│   │   ├── lib/http.js             # HttpError + asyncHandler
│   │   ├── middleware/
│   │   │   ├── auth.js
│   │   │   ├── requireOrganizer.js
│   │   │   ├── requireAdmin.js
│   │   │   ├── validate.js         # aplica um schema zod ao body
│   │   │   └── errorHandler.js     # único lugar que responde 500
│   │   ├── schemas/index.js        # schemas de todas as rotas de escrita
│   │   ├── routes/
│   │   │   ├── auth.js             # /api/auth  (com rate limit)
│   │   │   ├── admin.js            # /api/admin (fila de solicitações e papéis)
│   │   │   ├── events.js           # /api/events
│   │   │   ├── leagues.js          # /api/leagues
│   │   │   ├── users.js            # /api/users
│   │   │   └── notifications.js
│   │   └── services/
│   │       ├── pairing.js          # pareamento suíço, byes rotativos e seeding de playoff
│   │       ├── standings.js        # desempates oficiais (MTR 2.3)
│   │       ├── notify.js           # gravação de notificações
│   │       └── eventStream.js      # registry SSE
│   └── test/                       # node --test — pareamento e desempates
├── frontend/           # SPA Angular
│   └── src/app/
│       ├── pages/{home,login,register,forgot-password,my-events,create-event,event-detail,leagues,league-detail,create-league,profile,admin}
│       ├── components/{event-card,navbar,notification-panel}
│       └── services/
├── db/
│   ├── init/01-schema.sql  # schema consolidado (initdb no Docker; banco vazio no runner)
│   ├── migrations/         # alterações posteriores, NNN_nome.sql
│   └── migrate.js          # runner: histórico, lock, usuário só-DML — ver db/README.md
├── infra/                  # AWS CDK (TypeScript): 5 stacks, testes de template, cdk-nag
│   └── lambda/dns-updater/ # Lambda que mantém o DNS da origem com as tasks saudáveis
├── scripts/                # deploy (zona, certificado, migrar, publicar-spa, deploy, fumaça)
├── infraestructure/        # SPEC, RUNBOOK e plano da AWS; diagramas
├── .github/workflows/ci.yml
├── docker-compose.yml
└── README.md
```

## Testes

```bash
cd backend  && npm test          # node --test — torneio, segurança, uploads, SSE, desligamento
cd frontend && npm test          # vitest via Angular CLI
cd db       && npm test          # runner de migrations (unitários)
cd infra    && npm test          # templates do CDK + cdk-nag
cd infra/lambda/dns-updater && npm test
node --test 'scripts/test/*.test.js'   # scripts de deploy, com stubs (sem AWS)
```

Integrações com servidor real (no CI rodam sempre, com service containers):

```bash
# Valkey (backend)
docker run -d --rm --name vk -p 127.0.0.1:36379:6379 valkey/valkey:8.1-alpine
(cd backend && VALKEY_IT_URL=redis://127.0.0.1:36379 npm test); docker stop vk

# MySQL (db) — ver db/README.md
```

## Como rodar — Docker (recomendado)

Pré-requisito: Docker e Docker Compose.

### Windows

Evita ter que instalar Node e MySQL nativamente e os problemas de compatibilidade que vêm junto.

1. Instale o **Docker Desktop for Windows** ([docs.docker.com/desktop/setup/install/windows-install](https://docs.docker.com/desktop/setup/install/windows-install/)) — ele já configura o WSL2 automaticamente no Windows 10/11
2. Instale o **Git for Windows** ([git-scm.com/download/win](https://git-scm.com/download/win)) — junto vem o **Git Bash**, recomendado como terminal (os comandos deste README são todos em bash e funcionam direto nele, sem precisar traduzir pra PowerShell/cmd)
3. Clone o repositório e abra a pasta no Git Bash:
   ```bash
   git clone <url-do-repo>
   cd CloneManaSync
   ```
4. Siga o comando abaixo normalmente

### Linux / macOS / Windows (WSL ou Git Bash)

```bash
docker compose up -d --build
```

Isso sobe 4 containers:

| Serviço  | Descrição                          | Porta no host |
|----------|-------------------------------------|---------------|
| mysql    | MySQL 8, banco `manasync` já criado com schema | 3307 (interno 3306) |
| valkey   | Valkey 8.1 — pub/sub do SSE e contador do rate limit | nenhuma (só o backend acessa) |
| backend  | API Express                         | 3001          |
| frontend | Angular buildado e servido por Nginx (proxy `/api` e `/uploads` para o backend) | 4200 |

Acesse **http://localhost:4200**.

Na primeira subida, o MySQL executa automaticamente `db/init/01-schema.sql`, criando todas as tabelas. Os dados do banco e os uploads persistem em volumes Docker (`mysql_data`, `backend_uploads`) entre reinicializações.

Para derrubar tudo (mantendo os dados):
```bash
docker compose down
```

Para derrubar e apagar os dados também:
```bash
docker compose down -v
```

### Logs
```bash
docker compose logs -f backend
docker compose logs -f frontend
```

## Como rodar sem Docker (desenvolvimento local)

Pré-requisitos: Node 24 (`nvm use` lê o `.nvmrc`), MySQL 8 rodando localmente.

### 1. Banco de dados
Crie o banco e deixe o runner aplicar o schema e registrar as migrations:
```bash
mysql -uroot -p -e "CREATE DATABASE IF NOT EXISTS manasync CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"
cd db && npm ci
DB_HOST=127.0.0.1 DB_NAME=manasync DB_ADMIN_USER=root DB_ADMIN_PASS=<senha> node migrate.js
```
Depois, a cada migration nova, basta rodar `node migrate.js` de novo. Banco criado
antes do runner (sem histórico): veja [`db/README.md`](db/README.md#banco-local-já-existente-docker-antes-do-runner).

### 2. Backend
```bash
cd backend
cp .env.example .env   # ajuste DB_USER/DB_PASS/DB_NAME se necessário
npm install
npm run dev             # nodemon, http://localhost:3001
```

### 3. Frontend
```bash
cd frontend
npm install
npm start                # ng serve, http://localhost:4200 (proxy para :3001 via proxy.conf.json)
```

## Variáveis de ambiente (backend)

Ver `backend/.env.example`:

| Variável         | Descrição                          |
|------------------|--------------------------------------|
| `PORT`           | Porta da API (padrão 3001)          |
| `JWT_SECRET`     | Chave de assinatura dos tokens JWT. Obrigatória: sem ela o backend não sobe; em `NODE_ENV=production`, mínimo de 32 caracteres |
| `JWT_EXPIRES_IN` | Validade do token (padrão `7d`)     |
| `DB_HOST`        | Host do MySQL (`mysql` no Docker, `127.0.0.1` local) |
| `DB_PORT`        | Porta do MySQL (padrão 3306)        |
| `DB_USER`        | Usuário do MySQL                    |
| `DB_PASS`        | Senha do MySQL                      |
| `DB_NAME`        | Nome do banco (`manasync`)          |
| `ADMIN_EMAIL`    | Conta promovida a dono na subida, **só enquanto não houver admin**. Precisa já existir; vazio significa "sem dono", e aí ninguém decide as solicitações |
| `CORS_ORIGINS`   | Origens liberadas, separadas por vírgula. Vazio: `localhost:4200/4201` fora de produção; **nenhuma** em `NODE_ENV=production` |
| `ORIGIN_VERIFY_ATUAL` / `ORIGIN_VERIFY_ANTERIOR` | Segredo do header `x-origin-verify` que só o CloudFront envia (≥ 32 caracteres). Vazio desliga a verificação (Docker local). `ANTERIOR` existe para rotacionar sem queda |
| `VALKEY_URL`     | `redis://host:6379` ou `rediss://…` (TLS). Liga o pub/sub do SSE entre processos e o rate limit compartilhado. **Vazio: tudo em memória, como antes** (um processo só) |
| `VALKEY_CLUSTER` | `true` para o ElastiCache Serverless (exige `rediss://`) |
| `VALKEY_USER` / `VALKEY_PASS` | Credencial do Valkey. Nunca na URL |
| `UPLOADS_BUCKET` | Bucket S3 das imagens enviadas (chaves `uploads/<uuid>.<ext>`, servidas pelo CloudFront). **Vazio: disco local** em `backend/uploads`, servido pelo próprio backend |
| `AWS_REGION`     | Região do bucket. Obrigatória com `UPLOADS_BUCKET` |
| `PRE_STOP_DELAY_MS` | Depois do SIGTERM, quanto tempo o backend **continua atendendo** antes de fechar (o DNS da origem ainda aponta para a task). Padrão `0`; produção `45000`. SIGINT (Ctrl+C) não espera |
| `SHUTDOWN_TIMEOUT_MS` | Prazo para fechar conexões, SSE, Valkey e banco, contado **depois** do atraso. Padrão `10000`. Atraso + prazo ≤ 115000 (o Fargate mata aos 120 s) |

## Deploy na AWS

Tudo por script, na ordem certa (a migração roda entre as stacks de dados e a
aplicação) e parando no primeiro erro:

Pré-requisito: `.env` da raiz com `ADMIN_EMAIL` (seu e-mail) e `MANASYNC_CONTA` (ID da
conta AWS do projeto). Os dois ficam **fora do git** — o repositório é público.

```bash
scripts/zona.sh --gravar          # uma vez: zona mercadiastore.online + troca dos servidores DNS na HostGator
scripts/certificado.sh --gravar   # uma vez: certificado do CloudFront (us-east-1)
scripts/deploy.sh primeiro        # primeira vez
scripts/deploy.sh release         # depois
scripts/fumaca.sh                 # verificação do site no ar
```

- [RUNBOOK](infraestructure/aws/RUNBOOK.md) — pré-requisitos, passo a passo, rotação de segredos, rollback, problemas comuns
- [SPEC](infraestructure/aws/SPEC.md) — arquitetura, segurança, custos
- [PLANO-DEPLOY](infraestructure/aws/PLANO-DEPLOY.md) — decisões e histórico

## API — endpoints principais

```
POST   /api/auth/register
POST   /api/auth/login
POST   /api/auth/forgot-password

GET    /api/events/user/mine
GET    /api/events
GET    /api/events/:id
GET    /api/events/:id/stream            # SSE — avisa clientes conectados quando o evento muda
POST   /api/events
PUT    /api/events/:id
DELETE /api/events/:id

POST   /api/events/:id/join
DELETE /api/events/:id/join
POST   /api/events/:id/players
PUT    /api/events/:id/players/:playerId
DELETE /api/events/:id/players/:playerId

POST   /api/events/:id/finish
POST   /api/events/:id/rounds            # inicia próxima rodada / avança playoff
POST   /api/events/:id/rounds/undo
POST   /api/events/:id/rounds/swap
PUT    /api/events/:id/pairings/:pairingId
POST   /api/events/:id/pairings/:pairingId/approve
POST   /api/events/:id/playoffs/start

GET    /api/notifications
PUT    /api/notifications/read-all
PUT    /api/notifications/:id/read

GET    /api/users/me
POST   /api/users/me/organizer-request     # pedir para organizar (não promove ninguém)
GET    /api/users/me/organizer-request     # o meu pedido mais recente, com o desfecho

GET    /api/admin/organizer-requests       # a fila e o histórico (só admin)
POST   /api/admin/organizer-requests/:id/approve
POST   /api/admin/organizer-requests/:id/reject
GET    /api/admin/staff                    # quem é organizer ou admin hoje
PUT    /api/admin/users/:id/role           # promover ou rebaixar

GET    /api/leagues
GET    /api/leagues/mine
GET    /api/leagues/:id                  # + eventos vinculados e standings agregados
POST   /api/leagues
PUT    /api/leagues/:id
DELETE /api/leagues/:id
```

## Roadmap conhecido (gaps ainda pendentes vs. o site original)

- **Organizer Can Play** — dono se auto-registrar como jogador no próprio evento
- Decklist real (busca de comandante + partner commander + link Moxfield) — hoje é só texto livre
- Página de Perfil/Configurações — existe uma versão mínima (`/profile`: nome/e-mail/papel, visibilidade do perfil e a solicitação para organizar); falta o restante (editar nome/e-mail, trocar senha, preferências)
