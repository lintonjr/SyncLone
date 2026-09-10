const fs = require('fs/promises');
const path = require('path');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const { HttpError } = require('./http');

/**
 * Recebimento de imagens enviadas por usuários.
 *
 * Um arquivo enviado por qualquer pessoa acaba servido pela mesma origem da SPA,
 * então o que fica em disco nunca pode ser algo que o navegador execute. Três
 * regras sustentam isso, e todas moram aqui para não haver uma segunda cópia
 * delas em algum lugar que esqueça uma:
 *
 *   1. só mimetypes de imagem passam;
 *   2. a extensão vem do tipo aceito, jamais do nome que o cliente mandou — um
 *      arquivo chamado "x.html" gravado como .html é servido como documento;
 *   3. o nome é um uuid, então nada colide nem sobrescreve.
 *
 * A quarta regra vive no app.js, ao servir: `nosniff` e `Content-Disposition`.
 */
const IMAGE_EXTENSIONS = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
};

const UPLOAD_DIR = path.join(__dirname, '../../uploads');

/**
 * Um recebedor de imagem com limite próprio.
 *
 * O limite é parâmetro porque os tamanhos honestos são bem diferentes: a capa de
 * um evento é uma foto, o ícone de uma badge é um ícone. Aceitar 5 MB num ícone
 * de 20 px é convidar alguém a subir uma foto de câmera por engano.
 */
function imageUpload({ maxBytes, mensagem }) {
  return multer({
    storage: multer.diskStorage({
      destination: UPLOAD_DIR,
      filename: (_, file, cb) => cb(null, `${uuidv4()}${IMAGE_EXTENSIONS[file.mimetype]}`),
    }),
    limits: { fileSize: maxBytes },
    fileFilter: (_, file, cb) => {
      if (IMAGE_EXTENSIONS[file.mimetype]) return cb(null, true);
      cb(new HttpError(400, mensagem, 'api.uploadInvalid'));
    },
  });
}

/**
 * Remove do disco um arquivo que ninguém mais referencia.
 *
 * Quem recebe arquivo precisa também apagá-lo, senão cada capa trocada e cada
 * evento removido deixa lixo que só cresce. Falhar aqui não derruba a operação:
 * o registro já saiu do banco, e um arquivo órfão é um problema menor que uma
 * exclusão que não completa.
 *
 * O `basename` é a guarda que importa: o caminho vem do banco, mas montar um
 * caminho de remoção com texto sem sanear é como se abre um caminho para apagar
 * o que não devia.
 */
async function removeFile(caminhoPublico) {
  if (!caminhoPublico?.startsWith('/uploads/')) return;
  try {
    await fs.unlink(path.join(UPLOAD_DIR, path.basename(caminhoPublico)));
  } catch {
    // já removido, ou disco somente-leitura
  }
}

/** O caminho público de um arquivo recebido, como o cliente o vê. */
const publicPath = (file) => (file ? `/uploads/${file.filename}` : null);

module.exports = { imageUpload, publicPath, removeFile, IMAGE_EXTENSIONS, UPLOAD_DIR };
