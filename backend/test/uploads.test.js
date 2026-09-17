const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const express = require('express');
const { detectarTipoImagem, conferirEGravar, imageUpload, removeFile, publicPath } = require('../src/lib/uploads');
const { armazenamentoDisco, armazenamentoS3, NOME_VALIDO } = require('../src/lib/armazenamento');
const { uploadsConfig } = require('../src/lib/config');
const errorHandler = require('../src/middleware/errorHandler');
const { HttpError } = require('../src/lib/http');

// Os primeiros bytes reais de cada formato.
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1]);
const GIF = Buffer.from('GIF89a\x01\x00\x01\x00\x00\x00', 'latin1');
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0x24, 0, 0, 0]), Buffer.from('WEBP')]);
const HTML = Buffer.from('<!doctype html><script>alert(1)</script>');

const UUID = '0f8fad5b-d9cb-469f-a165-70867728950e';
const silencioso = () => {
  const l = { avisos: [] };
  l.warn = (m) => l.avisos.push(m);
  return l;
};

// --- detecção ---

test('assinatura: reconhece os quatro formatos aceitos', () => {
  assert.equal(detectarTipoImagem(PNG), 'image/png');
  assert.equal(detectarTipoImagem(JPEG), 'image/jpeg');
  assert.equal(detectarTipoImagem(GIF), 'image/gif');
  assert.equal(detectarTipoImagem(Buffer.from('GIF87a......', 'latin1')), 'image/gif');
  assert.equal(detectarTipoImagem(WEBP), 'image/webp');
});

test('assinatura: o que não é imagem não tem tipo', () => {
  assert.equal(detectarTipoImagem(HTML), null);
  assert.equal(detectarTipoImagem(Buffer.alloc(0)), null);
  assert.equal(detectarTipoImagem(Buffer.from('RIFF\0\0\0\0WAVE')), null);
  assert.equal(detectarTipoImagem(PNG.subarray(0, 4)), null);
});

// --- configuração ---

test('config uploads: sem bucket, disco', () => {
  assert.deepEqual(uploadsConfig({}), { destino: 'disco' });
  assert.deepEqual(uploadsConfig({ UPLOADS_BUCKET: '  ' }), { destino: 'disco' });
});

test('config uploads: com bucket, S3 na região informada', () => {
  assert.deepEqual(uploadsConfig({ UPLOADS_BUCKET: 'manasyncborda-imagens-abc123', AWS_REGION: 'us-east-2' }), {
    destino: 's3',
    bucket: 'manasyncborda-imagens-abc123',
    regiao: 'us-east-2',
  });
});

test('config uploads: bucket sem região, ou com nome inválido, não sobe', () => {
  assert.throws(() => uploadsConfig({ UPLOADS_BUCKET: 'meu-bucket' }), /AWS_REGION/);
  for (const nome of ['Maiusculo', 'ab', 'com_sublinhado', 'dois..pontos', '-comeca-com-hifen']) {
    assert.throws(() => uploadsConfig({ UPLOADS_BUCKET: nome, AWS_REGION: 'us-east-2' }), /UPLOADS_BUCKET/, nome);
  }
});

// --- conferir e gravar ---

/** Armazenamento de mentira que só registra. */
function umArmazenamento({ falhar = false } = {}) {
  const a = { salvos: [], removidos: [] };
  a.salvar = async (nome, bytes, tipo) => {
    if (falhar) throw new Error('S3 indisponível');
    a.salvos.push({ nome, bytes, tipo });
  };
  a.remover = async (nome) => a.removidos.push(nome);
  return a;
}

async function rodar(req, armazenamento) {
  let recebido = 'nao-chamado';
  await conferirEGravar('mensagem de teste', armazenamento)(req, {}, (erro) => { recebido = erro; });
  return recebido;
}

test('gravar: imagem de verdade é gravada com nome uuid e tipo detectado', async () => {
  const armazenamento = umArmazenamento();
  const req = { file: { buffer: PNG, mimetype: 'image/png', originalname: 'foto.html' } };

  assert.equal(await rodar(req, armazenamento), undefined);
  assert.equal(armazenamento.salvos.length, 1);
  const [{ nome, tipo, bytes }] = armazenamento.salvos;
  assert.match(nome, NOME_VALIDO);
  assert.ok(nome.endsWith('.png'), 'extensão vem do tipo, não do nome original');
  assert.equal(tipo, 'image/png');
  assert.equal(bytes, PNG);
  assert.equal(publicPath(req.file), `/uploads/${nome}`);
  assert.equal(req.file.buffer, undefined, 'buffer liberado depois de gravar');
});

test('gravar: HTML declarado como PNG é recusado e NADA é gravado', async () => {
  const armazenamento = umArmazenamento();
  const req = { file: { buffer: HTML, mimetype: 'image/png' } };
  const erro = await rodar(req, armazenamento);

  assert.ok(erro instanceof HttpError);
  assert.equal(erro.status, 400);
  assert.equal(erro.code, 'api.uploadInvalid');
  assert.equal(erro.message, 'mensagem de teste');
  assert.deepEqual(armazenamento.salvos, []);
  assert.equal(req.file, undefined);
  assert.equal(publicPath(req.file), null);
});

test('gravar: imagem real com tipo declarado diferente é recusada', async () => {
  const armazenamento = umArmazenamento();
  assert.ok((await rodar({ file: { buffer: JPEG, mimetype: 'image/png' } }, armazenamento)) instanceof HttpError);
  assert.deepEqual(armazenamento.salvos, []);
});

test('gravar: sem arquivo, segue (campo opcional nas rotas de edição)', async () => {
  const armazenamento = umArmazenamento();
  assert.equal(await rodar({}, armazenamento), undefined);
  assert.deepEqual(armazenamento.salvos, []);
});

test('gravar: falha do destino vai para o tratador de erros, sem deixar req.file', async () => {
  const req = { file: { buffer: GIF, mimetype: 'image/gif' } };
  const erro = await rodar(req, umArmazenamento({ falhar: true }));
  assert.match(erro.message, /S3 indisponível/);
  assert.equal(req.file, undefined, 'a rota não pode gravar no banco um caminho que não existe');
});

test('remover: só caminhos /uploads/, reduzidos ao nome', async () => {
  const armazenamento = umArmazenamento();
  await removeFile(`/uploads/${UUID}.png`, { armazenamento });
  await removeFile(`/uploads/../../etc/${UUID}.png`, { armazenamento });
  await removeFile('https://outro-site/x.png', { armazenamento });
  await removeFile(null, { armazenamento });
  assert.deepEqual(armazenamento.removidos, [`${UUID}.png`, `${UUID}.png`]);
});

// --- disco ---

async function umDiretorio(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'uploads-disco-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}

test('disco: grava, e recusa sobrescrever', async (t) => {
  const dir = await umDiretorio(t);
  const disco = armazenamentoDisco({ diretorio: dir, log: silencioso() });
  await disco.salvar(`${UUID}.png`, PNG);
  assert.deepEqual(await fs.readFile(path.join(dir, `${UUID}.png`)), PNG);
  await assert.rejects(disco.salvar(`${UUID}.png`, JPEG), /EEXIST/);
  assert.deepEqual(await fs.readFile(path.join(dir, `${UUID}.png`)), PNG, 'o original ficou intacto');
});

test('disco: nome fora do padrão não grava nem remove', async (t) => {
  const dir = await umDiretorio(t);
  const log = silencioso();
  const disco = armazenamentoDisco({ diretorio: dir, log });
  await assert.rejects(disco.salvar('../fora.png', PNG), /fora do padrão/);
  await assert.rejects(disco.salvar(`${UUID}.html`, HTML), /fora do padrão/);

  const vitima = path.join(dir, 'importante.txt');
  await fs.writeFile(vitima, 'não apague');
  await disco.remover('importante.txt');
  assert.equal(await fs.readFile(vitima, 'utf8'), 'não apague');
  assert.equal(log.avisos.length, 1);
});

test('disco: remove, e remover o que não existe não é erro', async (t) => {
  const dir = await umDiretorio(t);
  const disco = armazenamentoDisco({ diretorio: dir, log: silencioso() });
  await disco.salvar(`${UUID}.gif`, GIF);
  await disco.remover(`${UUID}.gif`);
  await assert.rejects(fs.access(path.join(dir, `${UUID}.gif`)));
  await disco.remover(`${UUID}.gif`);
});

// --- S3 ---

/** Cliente S3 de mentira: guarda os comandos enviados. */
function umClienteS3({ falhar } = {}) {
  const c = { enviados: [] };
  c.send = async (comando) => {
    if (falhar) throw Object.assign(new Error(falhar), { name: 'ServiceUnavailable' });
    c.enviados.push({ tipo: comando.constructor.name, input: comando.input });
    return {};
  };
  return c;
}

test('s3: PutObject com os cabeçalhos que protegem quem abre a imagem', async () => {
  const cliente = umClienteS3();
  const s3 = armazenamentoS3({ bucket: 'bucket-imagens', regiao: 'us-east-2', cliente, log: silencioso() });
  await s3.salvar(`${UUID}.webp`, WEBP, 'image/webp');

  assert.equal(cliente.enviados.length, 1);
  const { tipo, input } = cliente.enviados[0];
  assert.equal(tipo, 'PutObjectCommand');
  assert.deepEqual(input, {
    Bucket: 'bucket-imagens',
    // O CloudFront serve /uploads/* direto do bucket: a chave tem o mesmo prefixo.
    Key: `uploads/${UUID}.webp`,
    Body: WEBP,
    ContentType: 'image/webp',
    ContentDisposition: 'attachment',
    CacheControl: 'public, max-age=31536000, immutable',
    IfNoneMatch: '*',
  });
});

test('s3: nome fora do padrão nem chega ao S3', async () => {
  const cliente = umClienteS3();
  const log = silencioso();
  const s3 = armazenamentoS3({ bucket: 'b-imagens', regiao: 'us-east-2', cliente, log });
  await assert.rejects(s3.salvar('../../outro-prefixo/x.png', PNG, 'image/png'), /fora do padrão/);
  await s3.remover('index.html');
  await s3.remover(`uploads/${UUID}.png`);
  assert.deepEqual(cliente.enviados, []);
  assert.equal(log.avisos.length, 2);
});

test('s3: remover envia DeleteObject com o prefixo', async () => {
  const cliente = umClienteS3();
  const s3 = armazenamentoS3({ bucket: 'b-imagens', regiao: 'us-east-2', cliente, log: silencioso() });
  await s3.remover(`${UUID}.jpg`);
  assert.deepEqual(cliente.enviados, [
    { tipo: 'DeleteObjectCommand', input: { Bucket: 'b-imagens', Key: `uploads/${UUID}.jpg` } },
  ]);
});

test('s3: falha ao remover vira aviso, nunca erro', async () => {
  const log = silencioso();
  const s3 = armazenamentoS3({ bucket: 'b-imagens', regiao: 'us-east-2', cliente: umClienteS3({ falhar: 'Slow Down' }), log });
  await s3.remover(`${UUID}.jpg`);
  assert.match(log.avisos[0], /Slow Down/);
});

test('s3: falha ao gravar sobe (a requisição precisa saber que não gravou)', async () => {
  const s3 = armazenamentoS3({ bucket: 'b-imagens', regiao: 'us-east-2', cliente: umClienteS3({ falhar: 'Slow Down' }), log: silencioso() });
  await assert.rejects(s3.salvar(`${UUID}.jpg`, JPEG, 'image/jpeg'), /Slow Down/);
});

// --- multipart real (express + multer) ---

async function comApp(armazenamento, maxBytes, fn) {
  const app = express();
  const upload = imageUpload({ maxBytes, mensagem: 'imagem inválida' }, { armazenamento });
  app.post('/t', upload.single('image'), (req, res) => res.json({ caminho: publicPath(req.file) }));
  app.use(errorHandler);
  const servidor = app.listen(0, '127.0.0.1');
  await new Promise((r) => servidor.once('listening', r));
  try {
    const url = `http://127.0.0.1:${servidor.address().port}/t`;
    const enviar = async (bytes, tipo, nome = 'arquivo') => {
      const fd = new FormData();
      if (bytes) fd.append('image', new Blob([bytes], { type: tipo }), nome);
      const r = await fetch(url, { method: 'POST', body: fd });
      return { status: r.status, corpo: await r.json() };
    };
    return await fn(enviar);
  } finally {
    await new Promise((r) => servidor.close(r));
  }
}

test('multipart: modo disco, de ponta a ponta', async (t) => {
  const dir = await umDiretorio(t);
  const disco = armazenamentoDisco({ diretorio: dir, log: silencioso() });
  await comApp(disco, 1024 * 1024, async (enviar) => {
    const ok = await enviar(PNG, 'image/png', 'capa.png');
    assert.equal(ok.status, 200);
    assert.match(ok.corpo.caminho, /^\/uploads\/[0-9a-f-]{36}\.png$/);

    assert.equal((await enviar(HTML, 'image/png', 'x.png')).status, 400);
    assert.equal((await enviar(HTML, 'text/html', 'x.html')).status, 400);
    assert.deepEqual((await enviar(null)).corpo, { caminho: null });

    // Só o PNG legítimo foi parar no disco.
    assert.deepEqual(await fs.readdir(dir), [path.basename(ok.corpo.caminho)]);
  });
});

test('multipart: modo S3, de ponta a ponta com cliente falso', async () => {
  const cliente = umClienteS3();
  const s3 = armazenamentoS3({ bucket: 'b-imagens', regiao: 'us-east-2', cliente, log: silencioso() });
  await comApp(s3, 1024 * 1024, async (enviar) => {
    const ok = await enviar(JPEG, 'image/jpeg', 'capa.jpg');
    assert.equal(ok.status, 200);
    assert.equal((await enviar(HTML, 'image/jpeg')).status, 400);
    assert.equal(cliente.enviados.length, 1, 'só a imagem legítima chegou ao S3');
    assert.equal(cliente.enviados[0].input.Key, `uploads/${path.basename(ok.corpo.caminho)}`);
  });
});

test('multipart: arquivo acima do limite é 400 e não grava nada', async () => {
  const armazenamento = umArmazenamento();
  const grande = Buffer.concat([PNG, Buffer.alloc(2048)]);
  await comApp(armazenamento, 1024, async (enviar) => {
    const r = await enviar(grande, 'image/png');
    assert.equal(r.status, 400);
    assert.equal(r.corpo.code, 'api.uploadTooLarge');
    assert.deepEqual(armazenamento.salvos, []);
  });
});
