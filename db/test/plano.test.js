const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { checksum, listarMigrations, planejar } = require('../src/plano');

const arquivo = (versao, sql = `-- ${versao}`) => ({ versao, sql, checksum: checksum(sql) });
const A1 = arquivo('001_a.sql');
const A2 = arquivo('002_b.sql');
const A3 = arquivo('003_c.sql');

const registro = (...arquivos) => new Map(arquivos.map((a) => [a.versao, a.checksum]));

// --- checksum ---

test('checksum: quebra de linha do Windows não muda a migration', () => {
  assert.equal(checksum('ALTER TABLE x;\r\nUPDATE y;\r\n'), checksum('ALTER TABLE x;\nUPDATE y;\n'));
});

test('checksum: qualquer mudança de conteúdo muda', () => {
  assert.notEqual(checksum('ALTER TABLE x ADD a int;'), checksum('ALTER TABLE x ADD b int;'));
});

// --- listagem ---

test('listagem: as migrations reais do repositório estão no padrão e em ordem', () => {
  const lista = listarMigrations(path.join(__dirname, '..', 'migrations'));
  assert.ok(lista.length >= 15);
  assert.deepEqual(lista.map((m) => m.versao), [...lista.map((m) => m.versao)].sort());
  assert.equal(lista[0].versao, '001_add_user_role.sql');
});

test('listagem: ordena por nome e ignora o que não é .sql', () => {
  const lista = listarMigrations('/x', {
    listar: () => ['002_b.sql', 'LEIAME.txt', '001_a.sql'],
    ler: (p) => `-- ${path.basename(p)}`,
  });
  assert.deepEqual(lista.map((m) => m.versao), ['001_a.sql', '002_b.sql']);
});

test('listagem: nome fora do padrão é erro, não é ignorado', () => {
  // Um "16_x.sql" ou "017-x.sql" ignorado em silêncio nunca seria aplicado.
  assert.throws(
    () => listarMigrations('/x', { listar: () => ['001_a.sql', '16_x.sql'], ler: () => '' }),
    /fora do padrão/
  );
});

test('listagem: dois arquivos com o mesmo número são erro', () => {
  assert.throws(
    () => listarMigrations('/x', { listar: () => ['016_a.sql', '016_b.sql'], ler: () => '' }),
    /número 016/
  );
});

// --- plano ---

test('plano: banco vazio recebe o schema consolidado e registra tudo como baseline', () => {
  const plano = planejar({ temTabelas: false, registradas: new Map(), arquivos: [A1, A2] });
  assert.equal(plano.acao, 'schema-inicial');
  assert.deepEqual(plano.registrar.map((a) => a.versao), ['001_a.sql', '002_b.sql']);
});

test('plano: banco com tabelas e sem histórico é recusado — nada de adivinhar', () => {
  const plano = planejar({ temTabelas: true, registradas: new Map(), arquivos: [A1, A2] });
  assert.equal(plano.acao, 'erro');
  assert.match(plano.motivo, /baseline/);
});

test('plano: aplica só as pendentes, em ordem', () => {
  const plano = planejar({ temTabelas: true, registradas: registro(A1), arquivos: [A1, A2, A3] });
  assert.equal(plano.acao, 'migrar');
  assert.deepEqual(plano.aplicar.map((a) => a.versao), ['002_b.sql', '003_c.sql']);
});

test('plano: nada pendente é um migrar vazio', () => {
  const plano = planejar({ temTabelas: true, registradas: registro(A1, A2), arquivos: [A1, A2] });
  assert.equal(plano.acao, 'migrar');
  assert.deepEqual(plano.aplicar, []);
});

test('plano: migration já aplicada com arquivo alterado é erro', () => {
  const alterada = { ...A1, checksum: checksum('-- editada depois') };
  const plano = planejar({ temTabelas: true, registradas: registro(A1), arquivos: [alterada, A2] });
  assert.equal(plano.acao, 'erro');
  assert.match(plano.motivo, /001_a\.sql/);
});

test('plano: alteração detectada vale também no baseline', () => {
  const alterada = { ...A1, checksum: checksum('-- editada') };
  const plano = planejar({ temTabelas: true, registradas: registro(A1), arquivos: [alterada] }, 'baseline');
  assert.equal(plano.acao, 'erro');
});

test('plano: registro sem arquivo vira aviso (órfã), não bloqueio', () => {
  const plano = planejar({ temTabelas: true, registradas: registro(A1, A2), arquivos: [A1] });
  assert.equal(plano.acao, 'migrar');
  assert.deepEqual(plano.orfas, ['002_b.sql']);
});

test('plano: histórico sem tabela users é erro (banco alterado à mão)', () => {
  const plano = planejar({ temTabelas: false, registradas: registro(A1), arquivos: [A1, A2] });
  assert.equal(plano.acao, 'erro');
});

test('baseline: registra as não registradas num banco existente', () => {
  const plano = planejar({ temTabelas: true, registradas: new Map(), arquivos: [A1, A2] }, 'baseline');
  assert.equal(plano.acao, 'baseline');
  assert.deepEqual(plano.registrar.map((a) => a.versao), ['001_a.sql', '002_b.sql']);
});

test('baseline: banco vazio é recusado', () => {
  assert.equal(planejar({ temTabelas: false, registradas: new Map(), arquivos: [A1] }, 'baseline').acao, 'erro');
});

test('plano: comando desconhecido é erro', () => {
  assert.equal(planejar({ temTabelas: true, registradas: registro(A1), arquivos: [A1] }, 'apagar').acao, 'erro');
});
