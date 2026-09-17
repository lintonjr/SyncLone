const path = require('path');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const { HttpError } = require('./http');
const { uploadsConfig } = require('./config');
const { armazenamentoDisco, armazenamentoS3 } = require('./armazenamento');

/**
 * Recebimento de imagens enviadas por usuários.
 *
 * Um arquivo enviado por qualquer pessoa acaba servido pela mesma origem da SPA,
 * então o que é gravado nunca pode ser algo que o navegador execute. As regras
 * moram todas aqui, para não haver uma segunda cópia delas em algum lugar que
 * esqueça uma:
 *
 *   1. só mimetypes de imagem passam, e os primeiros bytes do arquivo precisam
 *      confirmar o tipo declarado;
 *   2. a extensão e o `Content-Type` gravados vêm do tipo **detectado**, jamais do
 *      nome que o cliente mandou — "x.html" gravado como .html é servido como
 *      documento;
 *   3. o nome é um uuid, e a gravação recusa sobrescrever;
 *   4. **nada é gravado antes de conferido**: o arquivo chega em memória (no máximo
 *      o limite da rota) e só vai para disco ou S3 depois da assinatura.
 *
 * A quinta regra vive em quem serve: `nosniff` e `Content-Disposition` no app.js
 * (disco) ou nos metadados do objeto e na política de cabeçalhos do CloudFront (S3).
 */
const IMAGE_EXTENSIONS = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
};

const UPLOAD_DIR = path.join(__dirname, '../../uploads');

/** O destino do processo, decidido uma vez a partir do ambiente. */
function armazenamentoDoAmbiente(env = process.env) {
  const cfg = uploadsConfig(env);
  return cfg.destino === 's3'
    ? armazenamentoS3({ bucket: cfg.bucket, regiao: cfg.regiao })
    : armazenamentoDisco({ diretorio: UPLOAD_DIR });
}

let armazenamentoPadrao;
const obterArmazenamento = () => (armazenamentoPadrao ??= armazenamentoDoAmbiente());

/**
 * Os primeiros bytes de cada formato aceito.
 *
 * O `mimetype` do multer é o que o **cliente** declarou — texto livre no
 * multipart. Os bytes iniciais são o que o próprio formato garante, e não
 * dependem de quem envia.
 */
function detectarTipoImagem(bytes) {
  const b = Buffer.from(bytes);
  const comeca = (assinatura, deslocamento = 0) =>
    b.length >= deslocamento + assinatura.length &&
    b.subarray(deslocamento, deslocamento + assinatura.length).equals(Buffer.from(assinatura));

  if (comeca([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (comeca([0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (comeca(Buffer.from('GIF87a')) || comeca(Buffer.from('GIF89a'))) return 'image/gif';
  if (comeca(Buffer.from('RIFF')) && comeca(Buffer.from('WEBP'), 8)) return 'image/webp';
  return null;
}

/**
 * Confere o arquivo recebido e grava no destino.
 *
 * Exigir igualdade com o declarado — e não só "é alguma imagem" — rejeita o
 * cliente que mente sobre o tipo, mesmo quando o conteúdo é imagem.
 *
 * Deixa em `req.file.filename` o nome gravado, que é o que `publicPath` usa: as
 * rotas não sabem se a imagem foi para disco ou para o S3.
 */
function conferirEGravar(mensagem, armazenamento) {
  return async (req, res, next) => {
    if (!req.file) return next();

    const tipo = detectarTipoImagem(req.file.buffer);
    if (!tipo || tipo !== req.file.mimetype) {
      req.file = undefined;
      return next(new HttpError(400, mensagem, 'api.uploadInvalid'));
    }

    const nome = `${uuidv4()}${IMAGE_EXTENSIONS[tipo]}`;
    try {
      await (armazenamento ?? obterArmazenamento()).salvar(nome, req.file.buffer, tipo);
    } catch (err) {
      req.file = undefined;
      return next(err);
    }
    req.file.filename = nome;
    // O buffer já foi gravado; soltá-lo libera até 5 MB por requisição mais cedo.
    req.file.buffer = undefined;
    next();
  };
}

/**
 * Um recebedor de imagem com limite próprio.
 *
 * O limite é parâmetro porque os tamanhos honestos são bem diferentes: a capa de
 * um evento é uma foto, o ícone de uma badge é um ícone. Aceitar 5 MB num ícone
 * de 20 px é convidar alguém a subir uma foto de câmera por engano. É também o
 * teto de memória por requisição, já que o arquivo passa pela memória.
 *
 * Mesma forma de uso de sempre (`upload.single('campo')`): o Express aceita a
 * lista de duas etapas no lugar de um middleware, então as rotas não mudam.
 * `armazenamento` existe para os testes.
 */
function imageUpload({ maxBytes, mensagem }, { armazenamento } = {}) {
  const recebedor = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: maxBytes, files: 1 },
    fileFilter: (_, file, cb) => {
      if (IMAGE_EXTENSIONS[file.mimetype]) return cb(null, true);
      cb(new HttpError(400, mensagem, 'api.uploadInvalid'));
    },
  });

  return {
    single: (campo) => [recebedor.single(campo), conferirEGravar(mensagem, armazenamento)],
  };
}

/**
 * Remove uma imagem que ninguém mais referencia.
 *
 * Quem recebe arquivo precisa também apagá-lo, senão cada capa trocada e cada
 * evento removido deixa lixo que só cresce. Falhar aqui não derruba a operação:
 * o registro já saiu do banco. O `basename` e a validação de nome no
 * armazenamento são as guardas contra um caminho adulterado vindo do banco.
 */
async function removeFile(caminhoPublico, { armazenamento } = {}) {
  if (!caminhoPublico?.startsWith('/uploads/')) return;
  await (armazenamento ?? obterArmazenamento()).remover(path.basename(caminhoPublico));
}

/** O caminho público de um arquivo recebido, como o cliente o vê — igual para disco e S3. */
const publicPath = (file) => (file?.filename ? `/uploads/${file.filename}` : null);

/** Se o próprio backend serve `/uploads` (só no modo disco). */
const servirUploadsLocalmente = (env = process.env) => uploadsConfig(env).destino === 'disco';

module.exports = {
  imageUpload,
  publicPath,
  removeFile,
  detectarTipoImagem,
  conferirEGravar,
  servirUploadsLocalmente,
  IMAGE_EXTENSIONS,
  UPLOAD_DIR,
};
