const router = require('express').Router();
const { v4: uuidv4 } = require('uuid');
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const db = require('../db');
const auth = require('../middleware/auth');
const requireAvaliador = require('../middleware/requireAvaliador');
const validate = require('../middleware/validate');
const schemas = require('../schemas');
const { HttpError, asyncHandler } = require('../lib/http');
const { imageUpload, publicPath, removeFile } = require('../lib/uploads');
const { notifyUsers, equipeDeAvaliacaoIds } = require('../services/notify');
const { obterClientes } = require('../lib/valkey');
const { ValkeyStore } = require('../lib/rateLimitStore');
const {
  codigoDeOS,
  normalizarCodigo,
  tokenPublico,
  valoresDaProposta,
  impedimentoParaAvaliar,
  impedimentoParaResponder,
  impedimentoParaPagamento,
  impedimentoParaAvancar,
  impedimentoParaVoltar,
  statusAnterior,
  trocaOToken,
  dadosPublicos,
  DEPOIS,
} = require('../lib/avaliacao');

/**
 * Avaliação de coleção — a ordem de serviço do balcão.
 *
 * Duas plateias no mesmo recurso: a equipe, que passa por `auth` +
 * `requireAvaliador`, e o cliente, que chega por um link sem conta. As rotas do
 * cliente vivem em `/publica/:token` e **nunca** tocam nas colunas internas: elas
 * respondem pelo que `dadosPublicos` deixa sair, e só.
 */

const upload = imageUpload({
  maxBytes: 5 * 1024 * 1024,
  mensagem: 'O comprovante precisa ser PNG, JPEG, WebP ou GIF, com até 5 MB',
});

/**
 * A página pública é a única rota sem login que expõe dado pessoal (nome e
 * telefone de quem vendeu). O token tem 128 bits, então não se adivinha por
 * tentativa — o limite existe para que ninguém *tente*, e para que um link
 * vazado não vire uma varredura.
 */
const valkey = obterClientes();
const limitePublico = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator(req.ip),
  message: { error: 'Too many attempts. Please wait a few minutes and try again.' },
  ...(valkey && { store: new ValkeyStore({ cliente: valkey.comandos }), passOnStoreError: true }),
});

// --- Apoio ---

/** Traduz o impedimento da regra pura no status HTTP que a tela espera. */
const STATUS_HTTP = {
  'api.avaliacaoNaoEncontrada': 404,
  'api.statusInvalido': 409,
  'api.jaRespondida': 409,
  'api.semRetorno': 409,
};

function barrar(codigo) {
  if (!codigo) return;
  throw new HttpError(STATUS_HTTP[codigo] ?? 400, 'This action is not allowed', codigo);
}

/**
 * Uma linha na história da OS.
 *
 * `autor` nulo é o cliente, e é assim que fica: ele responde por um link sem
 * login, então não há a quem atribuir — nem vamos inventar um identificador
 * guardando o IP de quem abriu o WhatsApp.
 */
function registrar(tx, { avaliacaoId, acao, de = null, para = null, autor = null, motivo = null }) {
  return tx.run(
    `INSERT INTO avaliacao_historico (id, avaliacao_id, acao, de, para, autor_id, motivo)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [uuidv4(), avaliacaoId, acao, de, para, autor, motivo]
  );
}

/** Avisa a equipe inteira — quem avaliou pode não ser quem paga. */
async function avisarEquipe(tx, code, params) {
  await notifyUsers(tx, await equipeDeAvaliacaoIds(tx), code, params);
}

const buscar = (conn, id) => conn.get('SELECT * FROM avaliacoes WHERE id = ?', [id]);

/** A OS com o histórico que a ficha mostra. */
async function fichaCompleta(id) {
  const os = await buscar(db, id);
  if (!os) throw new HttpError(404, 'Avaliação não encontrada', 'api.avaliacaoNaoEncontrada');
  const historico = await db.query(
    `SELECT h.acao, h.de, h.para, h.motivo, h.created_at, u.display_name AS autor
       FROM avaliacao_historico h LEFT JOIN users u ON u.id = h.autor_id
      WHERE h.avaliacao_id = ? ORDER BY h.created_at DESC, h.id`,
    [id]
  );
  return { ...os, historico };
}

// --- Equipe ---

/**
 * Abre a OS. O código nasce aqui porque é ele que a pessoa leva anotada.
 *
 * O sorteio pode colidir — 31^8 é muito, mas "muito" não é "nunca", e o índice
 * único é quem garante. Três tentativas cobrem qualquer cenário real; falhar
 * ruidosamente na quarta é melhor do que gravar uma OS com código repetido.
 */
router.post('/', auth, requireAvaliador, validate(schemas.criarAvaliacao), asyncHandler(async (req, res) => {
  const { nome, telefone, email = null, comentarios = null } = req.body;
  const id = uuidv4();

  for (let tentativa = 1; ; tentativa++) {
    const codigo = codigoDeOS();
    try {
      await db.transaction(async (tx) => {
        await tx.run(
          `INSERT INTO avaliacoes (id, codigo, nome, telefone, email, comentarios, criada_por)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [id, codigo, nome, telefone, email, comentarios, req.user.id]
        );
        await registrar(tx, { avaliacaoId: id, acao: 'criada', para: 'para_avaliar', autor: req.user.id });
      });
      break;
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY' && tentativa < 3) continue;
      throw err;
    }
  }

  res.status(201).json(await fichaCompleta(id));
}));

/**
 * A lista, com busca por nome, e-mail ou código.
 *
 * Resolvida no servidor como a área de usuários: são as OS de uma loja inteira,
 * e filtrar no navegador exigiria mandar todas para ele — inclusive as colunas
 * que a tela nem mostra.
 */
router.get('/', auth, requireAvaliador, asyncHandler(async (req, res) => {
  const limite = Math.min(Number(req.query.limit) || 25, 100);
  const inicio = Math.max(Number(req.query.offset) || 0, 0);
  const busca = String(req.query.q ?? '').trim();
  const status = String(req.query.status ?? '').trim();

  const onde = [];
  const valores = [];
  if (busca) {
    // O código é comparado sem hífen e sem caixa: quem digita "k7m4q2x9" quer a
    // mesma OS de quem cola "K7M4-Q2X9".
    onde.push("(a.nome LIKE ? OR a.email LIKE ? OR REPLACE(a.codigo, '-', '') LIKE ?)");
    valores.push(`%${busca}%`, `%${busca}%`, `%${normalizarCodigo(busca)}%`);
  }
  if (status) {
    onde.push('a.status = ?');
    valores.push(status);
  }
  const filtro = onde.length ? `WHERE ${onde.join(' AND ')}` : '';

  const linhas = await db.query(
    `SELECT a.id, a.codigo, a.nome, a.telefone, a.email, a.status, a.valor_bruto,
            a.valor_credito, a.valor_pix, a.escolha, a.created_at, a.updated_at,
            u.display_name AS criada_por_nome
       FROM avaliacoes a LEFT JOIN users u ON u.id = a.criada_por
       ${filtro}
      ORDER BY a.created_at DESC LIMIT ? OFFSET ?`,
    [...valores, limite, inicio]
  );
  const total = await db.get(`SELECT COUNT(*) AS n FROM avaliacoes a ${filtro}`, valores);

  // Os contadores por status alimentam as abas da lista: é a pergunta "o que
  // está esperando alguém?" respondida sem uma consulta por aba.
  const porStatus = await db.query('SELECT status, COUNT(*) AS n FROM avaliacoes GROUP BY status');

  res.json({
    avaliacoes: linhas,
    total: total.n,
    limit: limite,
    offset: inicio,
    por_status: Object.fromEntries(porStatus.map((r) => [r.status, r.n])),
  });
}));

router.get('/:id', auth, requireAvaliador, asyncHandler(async (req, res) => {
  res.json(await fichaCompleta(req.params.id));
}));

/** Corrigir o contato — telefone digitado errado é o erro mais comum do balcão. */
router.put('/:id', auth, requireAvaliador, validate(schemas.editarAvaliacao), asyncHandler(async (req, res) => {
  const os = await buscar(db, req.params.id);
  if (!os) throw new HttpError(404, 'Avaliação não encontrada', 'api.avaliacaoNaoEncontrada');

  const nome = req.body.nome?.trim() || os.nome;
  const telefone = req.body.telefone?.trim() || os.telefone;
  const email = req.body.email === undefined ? os.email : req.body.email?.trim() || null;
  const comentarios =
    req.body.comentarios === undefined ? os.comentarios : req.body.comentarios?.trim() || null;

  await db.transaction(async (tx) => {
    await tx.run(
      'UPDATE avaliacoes SET nome = ?, telefone = ?, email = ?, comentarios = ? WHERE id = ?',
      [nome, telefone, email, comentarios, os.id]
    );
    // Uma linha por campo: a ficha precisa dizer o que mudou, não que "algo mudou".
    const campos = [
      ['nome', os.nome, nome],
      ['telefone', os.telefone, telefone],
      ['email', os.email, email],
      ['comentarios', os.comentarios, comentarios],
    ];
    for (const [campo, de, para] of campos) {
      if ((de ?? '') === (para ?? '')) continue;
      await registrar(tx, {
        avaliacaoId: os.id, acao: 'editada', de: de ?? null, para: para ?? null,
        autor: req.user.id, motivo: campo,
      });
    }
  });

  res.json(await fichaCompleta(os.id));
}));

/**
 * Avaliar: link, valor e o link público nascem juntos.
 *
 * É o passo que transforma "recebi uma caixa" em proposta — e por isso é o único
 * que cria o token. Antes dele não há o que mandar para ninguém.
 */
router.post('/:id/avaliar', auth, requireAvaliador, validate(schemas.avaliarOS), asyncHandler(async (req, res) => {
  const os = await buscar(db, req.params.id);
  const { link_avaliacao, valor } = req.body;
  barrar(impedimentoParaAvaliar({ os, link: link_avaliacao, valor }));

  const v = valoresDaProposta(valor, {
    credito: os.percentual_credito,
    pix: os.percentual_pix,
  });
  // Uma OS que voltou para "para avaliar" perdeu o token; aqui ela ganha outro.
  const token = os.token_publico ?? tokenPublico();

  await db.transaction(async (tx) => {
    await tx.run(
      `UPDATE avaliacoes
          SET link_avaliacao = ?, valor_bruto = ?, valor_credito = ?, valor_pix = ?,
              token_publico = ?, status = 'avaliado'
        WHERE id = ?`,
      [link_avaliacao.trim(), v.valor_bruto, v.valor_credito, v.valor_pix, token, os.id]
    );
    await registrar(tx, {
      avaliacaoId: os.id, acao: 'avaliada', de: os.status, para: 'avaliado',
      autor: req.user.id, motivo: `R$ ${v.valor_bruto}`,
    });
  });

  res.json(await fichaCompleta(os.id));
}));

/**
 * Confirmar o pagamento. O comprovante é opcional nos dois caminhos: no crédito
 * não há transferência a comprovar, e no pix a prova que vale está no extrato.
 */
router.post('/:id/pagamento', auth, requireAvaliador, upload.single('comprovante'),
  asyncHandler(async (req, res) => {
    const os = await buscar(db, req.params.id);
    const arquivo = publicPath(req.file);
    const impedimento = impedimentoParaPagamento({ os, comprovante: arquivo });
    if (impedimento) {
      // O arquivo já subiu antes de a regra ser conferida (é o multer que o
      // recebe): não deixar lixo no bucket faz parte de recusar.
      if (arquivo) await removeFile(arquivo);
      barrar(impedimento);
    }

    await db.transaction(async (tx) => {
      await tx.run(
        "UPDATE avaliacoes SET comprovante = ?, status = 'para_guardar' WHERE id = ?",
        [arquivo, os.id]
      );
      await registrar(tx, {
        avaliacaoId: os.id, acao: 'pagamento', de: os.status, para: 'para_guardar',
        autor: req.user.id,
        // Com dois jeitos de pagar, "pagamento" sozinho não diz o que houve.
        motivo: os.escolha,
      });
    });

    res.json(await fichaCompleta(os.id));
  })
);

/** Guardar → inserir → inserido: os passos de prateleira, sem dado a pedir. */
router.post('/:id/avancar', auth, requireAvaliador, asyncHandler(async (req, res) => {
  const os = await buscar(db, req.params.id);
  barrar(impedimentoParaAvancar({ os }));
  const destino = DEPOIS[os.status][0];

  await db.transaction(async (tx) => {
    await tx.run('UPDATE avaliacoes SET status = ? WHERE id = ?', [destino, os.id]);
    await registrar(tx, {
      avaliacaoId: os.id, acao: 'avanco', de: os.status, para: destino, autor: req.user.id,
    });
  });

  res.json(await fichaCompleta(os.id));
}));

/**
 * Voltar um passo, com motivo.
 *
 * Voltar de `avaliado` troca o token: a proposta antiga pode já estar
 * encaminhada num grupo, e duas propostas diferentes não podem ficar abertas ao
 * mesmo tempo. Voltar de `a_pagar` reabre a decisão do cliente — é o caminho
 * para "ela aceitou pix, mas quer crédito".
 */
router.post('/:id/voltar', auth, requireAvaliador, validate(schemas.voltarAvaliacao),
  asyncHandler(async (req, res) => {
    const os = await buscar(db, req.params.id);
    barrar(impedimentoParaVoltar({ os, motivo: req.body.motivo }));
    const destino = statusAnterior(os.status);
    const novoToken = trocaOToken(os.status) ? null : os.token_publico;

    await db.transaction(async (tx) => {
      await tx.run(
        `UPDATE avaliacoes
            SET status = ?, token_publico = ?,
                escolha = CASE WHEN ? = 'avaliado' THEN NULL ELSE escolha END,
                chave_pix = CASE WHEN ? = 'avaliado' THEN NULL ELSE chave_pix END
          WHERE id = ?`,
        [destino, novoToken, destino, destino, os.id]
      );
      await registrar(tx, {
        avaliacaoId: os.id, acao: 'retorno', de: os.status, para: destino,
        autor: req.user.id, motivo: req.body.motivo.trim(),
      });
    });

    res.json(await fichaCompleta(os.id));
  })
);

// --- Cliente, pelo link ---

/** A proposta, para quem recebeu o link. Sem conta e sem nada além do combinado. */
router.get('/publica/:token', limitePublico, asyncHandler(async (req, res) => {
  const os = await db.get('SELECT * FROM avaliacoes WHERE token_publico = ?', [req.params.token]);
  if (!os) throw new HttpError(404, 'Avaliação não encontrada', 'api.avaliacaoNaoEncontrada');
  res.json(dadosPublicos(os));
}));

/**
 * Aceitar ou recusar.
 *
 * O autor fica nulo no histórico: quem respondeu não tem conta, e não é papel
 * deste sistema descobrir quem é. A ficha da equipe mostra "o cliente".
 */
router.post('/publica/:token', limitePublico, validate(schemas.responderAvaliacao),
  asyncHandler(async (req, res) => {
    const os = await db.get('SELECT * FROM avaliacoes WHERE token_publico = ?', [req.params.token]);
    const { resposta, escolha = null, chave_pix = null } = req.body;
    barrar(impedimentoParaResponder({ os, resposta, escolha, chavePix: chave_pix }));

    const aceitou = resposta === 'aceitar';
    const destino = aceitou ? 'a_pagar' : 'recusada';

    await db.transaction(async (tx) => {
      await tx.run(
        'UPDATE avaliacoes SET status = ?, escolha = ?, chave_pix = ? WHERE id = ?',
        [destino, aceitou ? escolha : null, aceitou && escolha === 'pix' ? chave_pix.trim() : null, os.id]
      );
      await registrar(tx, {
        avaliacaoId: os.id,
        acao: aceitou ? 'aceita' : 'recusada',
        de: 'avaliado',
        para: destino,
        motivo: aceitou ? escolha : null,
      });
      await avisarEquipe(tx, aceitou ? 'notif.avaliacaoAceita' : 'notif.avaliacaoRecusada', {
        codigo: os.codigo,
        nome: os.nome,
      });
    });

    const atualizada = await db.get('SELECT * FROM avaliacoes WHERE id = ?', [os.id]);
    res.json(dadosPublicos(atualizada));
  })
);

module.exports = router;
