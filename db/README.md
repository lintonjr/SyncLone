# db — schema, migrations e runner

| Caminho | O que é |
|---|---|
| `init/01-schema.sql` | schema **consolidado**: o estado atual completo, já com todas as migrations |
| `migrations/NNN_nome.sql` | alterações incrementais, aplicadas em ordem, uma vez cada |
| `migrate.js` + `src/` | runner que aplica o que falta e registra em `schema_migrations` |
| `Dockerfile` | imagem do runner (task ECS avulsa em produção) |

## Comandos

```bash
node migrate.js            # aplicar: schema inteiro num banco vazio, ou as migrations pendentes
node migrate.js baseline   # marcar as migrations como aplicadas SEM executar (banco legado)
npm test                   # unitários; a integração é pulada sem MIGRATE_IT_HOST
```

## Como o runner decide

| Estado do banco | Ação |
|---|---|
| vazio | aplica `init/01-schema.sql` e registra todas as migrations como `baseline` |
| com histórico | aplica as pendentes, uma por vez, registrando cada uma logo depois |
| com tabelas e **sem** histórico | **recusa** e pede `baseline` — não há como saber o que ele já tem |
| migration já aplicada com arquivo alterado | **recusa** — crie uma migration nova com a correção |

Um lock nomeado do MySQL (`manasync_migrate`) impede duas execuções simultâneas.
DDL no MySQL não é transacional: se uma migration falhar no meio, as anteriores
ficam aplicadas e registradas, e a que falhou não. Em produção, o script de deploy
tira um snapshot do RDS antes.

## Variáveis

| Variável | Obrigatória | Descrição |
|---|---|---|
| `DB_HOST`, `DB_NAME` | sim | onde conectar |
| `DB_PORT` | não | padrão 3306 |
| `DB_ADMIN_USER`, `DB_ADMIN_PASS` | sim | credencial **master** — só o runner a usa |
| `DB_SSL`, `DB_SSL_CA_PATH` | produção | mesma regra do backend: `true` exige a CA e verifica o servidor |
| `APP_DB_USER` | não | padrão `manasync_app` |
| `APP_DB_PASS` | produção | com ela, o usuário do backend é criado/atualizado com **só** `SELECT, INSERT, UPDATE, DELETE` neste banco (e `REQUIRE SSL` quando `DB_SSL=true`). Permissões extras concedidas à mão são revogadas; a senha é reescrita (rotação) |
| `ADMIN_EMAIL` | não | promove essa conta a admin **somente se ainda não existir admin** |
| `MIGRATE_LOCK_TIMEOUT_S` | não | espera pelo lock, padrão 60 |

## Nova migration

1. Crie `migrations/NNN_descricao.sql` com o próximo número (três dígitos).
2. Atualize `init/01-schema.sql` para o estado final — um banco novo nasce dele.
3. Nunca edite uma migration já aplicada em algum ambiente.

## Banco local já existente (Docker, antes do runner)

O volume do `docker compose` foi criado pelo `initdb` e não tem histórico. Uma vez só:

```bash
cd db && npm ci
DB_HOST=127.0.0.1 DB_PORT=3307 DB_NAME=manasync DB_ADMIN_USER=root DB_ADMIN_PASS=root123 node migrate.js baseline
```

Confira antes que o banco local tem todas as migrations de `migrations/` — o
`baseline` afirma isso sem verificar.

## Integração (MySQL de verdade)

```bash
docker run -d --rm --name manasync-it -e MYSQL_ROOT_PASSWORD=itroot -p 127.0.0.1:33084:3306 mysql:8.4
MIGRATE_IT_HOST=127.0.0.1 MIGRATE_IT_PORT=33084 MIGRATE_IT_ROOT_PASS=itroot npm test
docker stop manasync-it
```

Sete cenários: schema inicial e idempotência, migration nova e arquivo alterado,
migration quebrada, permissões exatas e rotação do usuário de app, admin inicial,
banco legado com `baseline`, lock ocupado. Validado em MySQL 8.4.11 e 8.0.46.

**No CI** o job `db` sobe `mysql:8.4` como service container e roda os sete a cada
PR, com `MIGRATE_IT_OBRIGATORIO=true`: se a configuração do banco faltar, os
testes **falham** em vez de serem pulados.
