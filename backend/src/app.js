require('dotenv').config();
const express = require('express');
const cors = require('cors');
const errorHandler = require('./middleware/errorHandler');
const { corsOrigins, trustProxy, jwtSecret, jwtExpiresIn, segredosOrigem, desligamentoConfig } = require('./lib/config');
const { criarDesligamento } = require('./lib/desligamento');
const { criarOriginVerify } = require('./middleware/originVerify');
const valkey = require('./lib/valkey');
const eventStream = require('./services/eventStream');
const { servirUploadsLocalmente, UPLOAD_DIR } = require('./lib/uploads');

// Na subida, e não no primeiro login: sem segredo o servidor ficaria no ar,
// passando no health check, com todo login respondendo 500.
jwtSecret();
jwtExpiresIn();
// Também na subida: um atraso de desligamento que não cabe no stopTimeout do
// Fargate só apareceria no primeiro deploy, com o SIGKILL no meio do fechamento.
const configDesligamento = desligamentoConfig();

const app = express();

// Com Valkey, um resultado lançado numa task chega aos navegadores conectados
// nas outras. Sem ele (VALKEY_URL vazia), o registro local de sempre.
const clientesValkey = valkey.obterClientes();
if (clientesValkey) eventStream.usarBarramento(valkey.criarBarramento(clientesValkey));

// Quantos proxies confiáveis estão na frente. Sem isto, toda requisição que passa
// pelo proxy compartilha o IP dele e o limitador de tentativas de senha passaria a
// estrangular todo mundo junto em vez de cada cliente. O número vem do ambiente
// porque muda com a topologia — ver lib/config.js.
app.set('trust proxy', trustProxy());

// Primeiro de tudo: o que não veio pela nossa distribuição CloudFront não chega
// nem a ter o corpo lido. Desligado quando não há segredo (Docker local).
app.use(criarOriginVerify(segredosOrigem()));

app.use(cors({ origin: corsOrigins(), credentials: true }));
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: true, limit: '100kb' }));

// Imagens enviadas, no modo disco (Docker e dev): servidas pela mesma origem da
// SPA, então endurecidas duas vezes — lib/uploads.js só grava imagem conferida
// pelos bytes, e estes cabeçalhos impedem que algo que escape seja farejado ou
// renderizado como documento. <img> ignora Content-Disposition, então as capas
// continuam aparecendo.
//
// No modo S3 (UPLOADS_BUCKET) quem serve `/uploads/*` é o CloudFront, direto do
// bucket; esta rota nem existe.
if (servirUploadsLocalmente()) {
  app.use('/uploads', express.static(UPLOAD_DIR, {
    setHeaders: (res) => {
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Disposition', 'attachment');
    },
  }));
}

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
const server = app.listen(PORT, () => {
  console.log(`ManaSync backend running on port ${PORT}`);
  // Depois do listen, de propósito: promover o dono é manutenção de dados, não
  // pré-requisito para atender. Se o banco ainda estiver acordando, a API sobe
  // do mesmo jeito e a próxima subida aplica.
  //
  // Só age com `ADMIN_EMAIL` definido, e só enquanto não houver admin nenhum —
  // ver lib/bootstrapAdmin.js. Em produção a task do serviço não recebe a
  // variável: lá quem promove é a migração.
  require('./lib/bootstrapAdmin')();
});

// Desligamento em lib/desligamento.js: continuar atendendo por PRE_STOP_DELAY_MS
// depois do SIGTERM (o DNS da origem ainda aponta para esta task), e só então
// fechar conexões, streams SSE, Valkey e banco, nessa ordem.
const desligar = criarDesligamento({
  server,
  fecharStreams: () => eventStream.closeAll(),
  encerrarValkey: () => valkey.encerrar(),
  encerrarBanco: () => require('./db').pool.end(),
  ...configDesligamento,
});

for (const sinal of ['SIGTERM', 'SIGINT']) process.on(sinal, () => desligar(sinal));
