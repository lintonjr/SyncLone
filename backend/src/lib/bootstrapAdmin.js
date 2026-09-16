const db = require('../db');

/**
 * Garante que existe um dono, a partir de `ADMIN_EMAIL`.
 *
 * O primeiro admin é o único que não pode ser promovido por outro admin — não há
 * ninguém antes dele. Ou ele sai de uma variável de ambiente, ou sai de um UPDATE
 * na mão em produção, que é exatamente o tipo de passo que se esquece de fazer e
 * ninguém documenta.
 *
 * Roda a cada subida e é idempotente: se a conta já é admin, não escreve nada.
 * Não promove quem não existe — a conta precisa ter sido criada pelo cadastro
 * normal, com senha que a pessoa conhece.
 *
 * Nunca derruba o servidor: sem admin a API inteira continua funcionando, só a
 * fila de solicitações fica sem quem a decida. Um backend que não sobe porque o
 * e-mail do dono está errado seria um estrago maior que o problema.
 */
async function bootstrapAdmin({ log = console } = {}) {
  const email = process.env.ADMIN_EMAIL?.trim();
  if (!email) return null;

  try {
    const user = await db.get('SELECT id, role FROM users WHERE email = ?', [email]);
    if (!user) {
      log.warn(`[admin] ADMIN_EMAIL=${email} não corresponde a nenhuma conta — ninguém foi promovido`);
      return null;
    }
    if (user.role === 'admin') return user.id;

    await db.run("UPDATE users SET role = 'admin' WHERE id = ?", [user.id]);
    log.log(`[admin] ${email} promovido a admin`);
    return user.id;
  } catch (err) {
    log.warn(`[admin] não foi possível aplicar ADMIN_EMAIL: ${err.message}`);
    return null;
  }
}

module.exports = bootstrapAdmin;
