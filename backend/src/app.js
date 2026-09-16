require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const errorHandler = require('./middleware/errorHandler');

const app = express();

// One hop: nginx sits in front and forwards X-Forwarded-For. Without this, every
// request through the proxy shares the proxy's IP and the auth rate limiter would
// throttle all users together instead of per client.
app.set('trust proxy', 1);

app.use(cors({ origin: ['http://localhost:4200', 'http://localhost:4201'], credentials: true }));
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: true, limit: '100kb' }));

// Uploads are user-supplied files served from the same origin as the SPA (nginx
// proxies /uploads to this app), so they're hardened twice: multer only accepts
// image mimetypes and names files by that type (routes/events.js), and these
// headers stop anything that still slips through from being sniffed or rendered
// as a document. <img> ignores Content-Disposition, so covers still display.
app.use('/uploads', express.static(path.join(__dirname, '../uploads'), {
  setHeaders: (res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', 'attachment');
  },
}));

app.get('/api/health', (_, res) => res.json({ status: 'ok' }));
app.use('/api/auth', require('./routes/auth'));
app.use('/api/events', require('./routes/events'));
app.use('/api/badges', require('./routes/badges'));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/users', require('./routes/users'));
app.use('/api/leagues', require('./routes/leagues'));
app.use('/api/admin', require('./routes/admin'));

app.use(errorHandler);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`ManaSync backend running on port ${PORT}`);
  // Depois do listen, de propósito: promover o dono é manutenção de dados, não
  // pré-requisito para atender. Se o banco ainda estiver acordando, a API sobe
  // do mesmo jeito e a próxima subida aplica.
  require('./lib/bootstrapAdmin')();
});
