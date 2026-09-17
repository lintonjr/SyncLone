const fs = require('fs/promises');
const path = require('path');
const { S3Client, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');

/**
 * Onde as imagens recebidas são gravadas: disco local ou S3.
 *
 * Os dois têm a mesma forma — `salvar(nome, bytes, tipo)` e `remover(nome)` — e
 * recebem só o **nome** do arquivo, nunca um caminho. Quem decide nome, tipo e
 * validade do conteúdo é lib/uploads.js, antes de chegar aqui.
 */

/**
 * O único formato de nome que o sistema gera: uuid + extensão aceita.
 *
 * `remover` recusa qualquer outra coisa. O nome vem do banco (`/uploads/<nome>`),
 * e um valor adulterado ali não pode virar `../../etc` no disco nem uma chave
 * arbitrária no bucket.
 */
const NOME_VALIDO = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|webp|gif)$/;

/** Prefixo das chaves no bucket — é o caminho que o CloudFront serve em `/uploads/*`. */
const PREFIXO_S3 = 'uploads/';

function erroNomeInvalido(nome) {
  return new Error(`nome de arquivo fora do padrão: ${JSON.stringify(nome)}`);
}

/**
 * Disco local (Docker e `npm run dev`).
 *
 * O nome já vem de um uuid, então sobrescrever seria um defeito — e se um dia
 * acontecesse, trocaria a imagem de outra pessoa. As duas implementações recusam.
 */
function armazenamentoDisco({ diretorio, log = console } = {}) {
  return {
    destino: 'disco',

    async salvar(nome, bytes) {
      if (!NOME_VALIDO.test(nome)) throw erroNomeInvalido(nome);
      await fs.mkdir(diretorio, { recursive: true });
      // `wx`: falha se o arquivo já existir, em vez de sobrescrever.
      await fs.writeFile(path.join(diretorio, nome), bytes, { flag: 'wx' });
    },

    async remover(nome) {
      if (!NOME_VALIDO.test(nome)) {
        log.warn(`[uploads] remoção recusada, nome fora do padrão: ${JSON.stringify(nome)}`);
        return;
      }
      try {
        await fs.unlink(path.join(diretorio, nome));
      } catch {
        // já removido
      }
    },
  };
}

/**
 * S3, servido pelo CloudFront.
 *
 * Os cabeçalhos gravados junto do objeto são os que o navegador recebe:
 *
 *   - `ContentType` é o tipo **detectado pelos bytes**, não o declarado;
 *   - `ContentDisposition: attachment` repete a defesa que o Express aplicava ao
 *     servir do disco — aberto direto, o arquivo baixa em vez de renderizar;
 *     `<img>` ignora o cabeçalho, então a imagem continua aparecendo;
 *   - `CacheControl` imutável: o nome é um uuid e nunca é reaproveitado.
 *
 * `IfNoneMatch: '*'` é a escrita condicional do S3: se a chave existir, o S3
 * recusa (412) em vez de sobrescrever.
 *
 * A credencial vem da cadeia padrão do SDK — no ECS, o papel IAM da task, que só
 * tem `PutObject`/`DeleteObject` em `uploads/*`.
 */
function armazenamentoS3({ bucket, regiao, cliente = new S3Client({ region: regiao }), log = console }) {
  return {
    destino: 's3',

    async salvar(nome, bytes, tipo) {
      if (!NOME_VALIDO.test(nome)) throw erroNomeInvalido(nome);
      await cliente.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: `${PREFIXO_S3}${nome}`,
          Body: bytes,
          ContentType: tipo,
          ContentDisposition: 'attachment',
          CacheControl: 'public, max-age=31536000, immutable',
          IfNoneMatch: '*',
        })
      );
    },

    /**
     * Nunca lança: o registro já saiu do banco, e um objeto órfão é um problema
     * menor que uma exclusão que não completa. O versionamento do bucket guarda a
     * versão apagada por 90 dias.
     */
    async remover(nome) {
      if (!NOME_VALIDO.test(nome)) {
        log.warn(`[uploads] remoção recusada, nome fora do padrão: ${JSON.stringify(nome)}`);
        return;
      }
      try {
        await cliente.send(new DeleteObjectCommand({ Bucket: bucket, Key: `${PREFIXO_S3}${nome}` }));
      } catch (err) {
        log.warn(`[uploads] não foi possível remover ${nome} do S3: ${err.name ?? ''} ${err.message}`);
      }
    },
  };
}

module.exports = { armazenamentoDisco, armazenamentoS3, NOME_VALIDO, PREFIXO_S3 };
