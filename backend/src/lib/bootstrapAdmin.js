const db = require('../db');

/**
 * Cria o primeiro dono da plataforma, a partir de `ADMIN_EMAIL`.
 *
 * O primeiro admin é o único que não pode ser promovido por outro admin — não há
 * ninguém antes dele. Ou ele sai de uma variável de ambiente, ou sai de um UPDATE
 * na mão em produção, que é exatamente o tipo de passo que se esquece de fazer e
 * ninguém documenta.
 *
 * **Só vale enquanto não existe admin nenhum.** Antes, a conta com o e-mail era
 * promovida a cada subida, sem condição. Como o cadastro não confirma e-mail,
 * isso deixava a porta aberta: bastava alguém se cadastrar com o endereço
 * configurado — ou com um palpite como `admin@dominio` — e esperar o próximo
 * deploy. Com a trava, depois que o dono existe, a variável não promove mais
 * ninguém, e os próximos admins só saem das mãos de quem já é.
 *
 * O risco que sobra é chegar antes do dono no primeiro cadastro. Por isso o
 * runbook de deploy manda criar a conta do dono antes de divulgar o endereço.
 *
 * Idempotente e silencioso para quem já é admin. Nunca derruba o servidor: sem
 * admin a API inteira continua funcionando, só a fila de solicitações fica sem
 * quem a decida.
 */
async function bootstrapAdmin({ log = console, banco = db, email = process.env.ADMIN_EMAIL } = {}) {
  email = email?.trim();
  if (!email) return null;

  try {
    const user = await banco.get('SELECT id, role FROM users WHERE email = ?', [email]);
    if (!user) {
      log.warn(`[admin] ADMIN_EMAIL=${email} não corresponde a nenhuma conta — ninguém foi promovido`);
      return null;
    }
    if (user.role === 'admin') return user.id;

    const { total } = await banco.get("SELECT COUNT(*) AS total FROM users WHERE role = 'admin'");
    if (Number(total) > 0) {
      log.warn(`[admin] já existe admin; ADMIN_EMAIL=${email} não é mais aplicado — peça a um admin a promoção`);
      return null;
    }

    await banco.run("UPDATE users SET role = 'admin' WHERE id = ?", [user.id]);
    log.log(`[admin] ${email} promovido a admin (primeiro dono da plataforma)`);
    return user.id;
  } catch (err) {
    log.warn(`[admin] não foi possível aplicar ADMIN_EMAIL: ${err.message}`);
    return null;
  }
}

module.exports = bootstrapAdmin;
