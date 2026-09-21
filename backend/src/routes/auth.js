const router = require('express').Router();

/** O que de um usuário pode ir para o cliente. `password_hash` nunca entra. */
const usuarioPublico = (u) => ({
  id: u.id,
  display_name: u.display_name,
  email: u.email,
  role: u.role,
  profile_public: u.profile_public,
  // Senha criada por um administrador: a tela manda trocar antes de seguir.
  must_change_password: !!u.must_change_password,
});
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const db = require('../db');
const validate = require('../middleware/validate');
const schemas = require('../schemas');
const { HttpError, asyncHandler } = require('../lib/http');
const { jwtSecret, jwtExpiresIn } = require('../lib/config');
const { contaAtiva } = require('../lib/contas');
const { obterClientes } = require('../lib/valkey');
const { ValkeyStore } = require('../lib/rateLimitStore');

// Credential endpoints are the brute-force surface, and bcrypt makes each attempt
// expensive for us too — so the limit is per IP *and* per targeted account: one
// attacker can't spend another user's budget, and spraying many accounts from one
// address still trips the IP half of the key.
//
// Com Valkey, o contador é um só para todas as tasks e sobrevive a deploy (sem
// ele, cada task conta sozinha e o limite zera a cada subida). Se o Valkey cair,
// `passOnStoreError` deixa o login passar sem limite em vez de bloquear todo
// mundo: o bcrypt continua encarecendo cada tentativa, e uma queda do cache não
// pode virar queda do site.
const valkey = obterClientes();
const credentialLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  keyGenerator: (req) => `${ipKeyGenerator(req.ip)}:${String(req.body?.email ?? '').toLowerCase()}`,
  message: { error: 'Too many attempts. Please wait a few minutes and try again.' },
  ...(valkey && { store: new ValkeyStore({ cliente: valkey.comandos }), passOnStoreError: true }),
});

router.post('/register', credentialLimiter, validate(schemas.register), asyncHandler(async (req, res) => {
  const { display_name, email, password } = req.body;

  const existing = await db.get('SELECT id FROM users WHERE email = ?', [email]);
  if (existing) throw new HttpError(409, 'Email already in use', 'api.emailInUse');

  const password_hash = await bcrypt.hash(password, 10);
  const id = uuidv4();
  await db.run('INSERT INTO users (id, display_name, email, password_hash) VALUES (?, ?, ?, ?)',
    [id, display_name, email, password_hash]);

  const role = 'player';
  const token = jwt.sign({ id, email, display_name, role }, jwtSecret(), {
    expiresIn: jwtExpiresIn(),
  });
  // `profile_public` acompanha desde o cadastro: sem ele a tela de conta nasceria
  // sem saber a preferência e teria de ir buscá-la só para desenhar um interruptor.
  res.status(201).json({ token, user: { id, display_name, email, role, profile_public: 1 } });
}));

router.post('/login', credentialLimiter, validate(schemas.login), asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  const user = await db.get('SELECT * FROM users WHERE email = ?', [email]);
  if (!user || !(await bcrypt.compare(password, user.password_hash)))
    throw new HttpError(401, 'Invalid credentials', 'api.invalidCredentials');
  // Mensagem própria: "credenciais inválidas" faria a pessoa tentar de novo a
  // noite inteira com a senha certa.
  if (!contaAtiva(user.status)) throw new HttpError(401, 'This account is disabled', 'api.contaDesativada');

  const token = jwt.sign(
    { id: user.id, email: user.email, display_name: user.display_name, role: user.role },
    jwtSecret(),
    { expiresIn: jwtExpiresIn() }
  );
  res.json({ token, user: usuarioPublico(user) });
}));

router.post('/forgot-password', credentialLimiter, validate(schemas.forgotPassword), (req, res) => {
  res.json({ message: 'If that email exists, a reset link was sent.' });
});

module.exports = router;
