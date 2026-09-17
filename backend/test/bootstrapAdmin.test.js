const test = require('node:test');
const assert = require('node:assert');
const bootstrapAdmin = require('../src/lib/bootstrapAdmin');

/**
 * Um banco de mentira com uma tabela `users` em memória.
 *
 * Responde só às três consultas que o bootstrap faz, e falha alto em qualquer
 * outra: se o código passar a perguntar algo novo, o teste precisa saber.
 */
function umBanco(usuarios) {
  const banco = { usuarios, updates: 0 };
  banco.get = async (sql, params = []) => {
    if (sql.startsWith('SELECT id, role FROM users WHERE email')) {
      return usuarios.find((u) => u.email === params[0]) ?? null;
    }
    if (sql.startsWith('SELECT COUNT(*) AS total')) {
      return { total: usuarios.filter((u) => u.role === 'admin').length };
    }
    throw new Error(`consulta inesperada: ${sql}`);
  };
  banco.run = async (sql, params = []) => {
    if (!sql.startsWith("UPDATE users SET role = 'admin'")) throw new Error(`escrita inesperada: ${sql}`);
    banco.updates++;
    usuarios.find((u) => u.id === params[0]).role = 'admin';
  };
  return banco;
}

const umLog = () => {
  const l = { avisos: [], infos: [] };
  l.warn = (m) => l.avisos.push(m);
  l.log = (m) => l.infos.push(m);
  return l;
};

test('admin: sem admin nenhum, promove a conta do ADMIN_EMAIL', async () => {
  const banco = umBanco([{ id: 'u1', email: 'dono@x.com', role: 'player' }]);
  const id = await bootstrapAdmin({ banco, log: umLog(), email: 'dono@x.com' });
  assert.equal(id, 'u1');
  assert.equal(banco.usuarios[0].role, 'admin');
});

test('admin: com admin existente, NÃO promove — é o que fecha a tomada de conta', async () => {
  // O cenário do ataque: o dono já existe, e alguém se cadastra com o e-mail que
  // está em ADMIN_EMAIL (ou a variável foi trocada). A próxima subida não pode
  // entregar o papel.
  const banco = umBanco([
    { id: 'dono', email: 'dono@x.com', role: 'admin' },
    { id: 'intruso', email: 'admin@x.com', role: 'player' },
  ]);
  const log = umLog();
  const id = await bootstrapAdmin({ banco, log, email: 'admin@x.com' });

  assert.equal(id, null);
  assert.equal(banco.usuarios[1].role, 'player');
  assert.equal(banco.updates, 0);
  assert.match(log.avisos[0], /já existe admin/);
});

test('admin: quem já é admin continua, sem escrita', async () => {
  const banco = umBanco([{ id: 'u1', email: 'dono@x.com', role: 'admin' }]);
  assert.equal(await bootstrapAdmin({ banco, log: umLog(), email: 'dono@x.com' }), 'u1');
  assert.equal(banco.updates, 0);
});

test('admin: e-mail sem conta não promove ninguém', async () => {
  const banco = umBanco([{ id: 'u1', email: 'outro@x.com', role: 'player' }]);
  const log = umLog();
  assert.equal(await bootstrapAdmin({ banco, log, email: 'dono@x.com' }), null);
  assert.equal(banco.updates, 0);
  assert.match(log.avisos[0], /nenhuma conta/);
});

test('admin: sem ADMIN_EMAIL, nem consulta o banco', async () => {
  const banco = umBanco([]);
  banco.get = async () => { throw new Error('não devia consultar'); };
  assert.equal(await bootstrapAdmin({ banco, log: umLog(), email: '  ' }), null);
});

test('admin: erro de banco vira aviso, nunca derruba a subida', async () => {
  const banco = umBanco([]);
  banco.get = async () => { throw new Error('ECONNREFUSED'); };
  const log = umLog();
  assert.equal(await bootstrapAdmin({ banco, log, email: 'dono@x.com' }), null);
  assert.match(log.avisos[0], /ECONNREFUSED/);
});
