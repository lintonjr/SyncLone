#!/usr/bin/env node
/**
 * Runner de migrations do ManaSync.
 *
 *   node migrate.js            aplica o que falta (ou o schema inteiro, se o banco estiver vazio)
 *   node migrate.js baseline   marca as migrations como aplicadas SEM executá-las
 *
 * `baseline` é para um banco que já existe e já tem todas as migrations — o
 * banco do Docker local criado antes deste runner. Rodar em qualquer outro caso
 * esconde migrations que nunca foram aplicadas.
 *
 * Variáveis: DB_HOST, DB_PORT, DB_NAME, DB_ADMIN_USER, DB_ADMIN_PASS, DB_SSL,
 * DB_SSL_CA_PATH, APP_DB_USER, APP_DB_PASS, ADMIN_EMAIL, MIGRATE_LOCK_TIMEOUT_S.
 * Ver db/README.md.
 *
 * Código de saída diferente de zero em qualquer falha: é o que faz o script de
 * deploy parar antes de subir uma aplicação sobre um banco pela metade.
 */
const { lerConfig } = require('./src/config');
const { executar } = require('./src/executar');

const COMANDOS = new Set(['aplicar', 'baseline']);

async function main() {
  const comando = process.argv[2] ?? 'aplicar';
  if (!COMANDOS.has(comando)) {
    console.error(`comando desconhecido "${comando}". Use: aplicar | baseline`);
    process.exit(2);
  }
  await executar(lerConfig(), comando);
}

main().catch((err) => {
  console.error(`[migrate] FALHOU: ${err.message}`);
  process.exit(1);
});
