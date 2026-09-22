const test = require('node:test');
const assert = require('node:assert');
const {
  codigoDeOS,
  normalizarCodigo,
  tokenPublico,
  emCentavos,
  valoresDaProposta,
  podeAvaliar,
  impedimentoParaAvaliar,
  impedimentoParaResponder,
  impedimentoParaPagamento,
  impedimentoParaAvancar,
  impedimentoParaVoltar,
  statusAnterior,
  trocaOToken,
  dadosPublicos,
} = require('../src/lib/avaliacao');

const os = (over = {}) => ({
  id: 'os1',
  codigo: 'K7M4-Q2X9',
  nome: 'Marina',
  telefone: '92 99999-0000',
  email: 'marina@t.local',
  comentarios: 'Caixa com 400 commons',
  status: 'para_avaliar',
  ...over,
});

// --- Código e token ---

test('código: dois grupos de quatro, sem caracteres que se confundem ao ditar', () => {
  const codigo = codigoDeOS();
  assert.match(codigo, /^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  assert.doesNotMatch(codigo, /[0O1I]/);
});

test('código: não repete, e a busca acha digitado de qualquer jeito', () => {
  const amostras = new Set(Array.from({ length: 200 }, () => codigoDeOS()));
  assert.equal(amostras.size, 200);
  // Balcão: um cola o código, o outro digita sem hífen e em minúscula.
  assert.equal(normalizarCodigo('k7m4q2x9'), 'K7M4Q2X9');
  assert.equal(normalizarCodigo(' K7M4-Q2X9 '), 'K7M4Q2X9');
});

test('token público: 32 hex e sempre diferente', () => {
  assert.match(tokenPublico(), /^[0-9a-f]{32}$/);
  assert.notEqual(tokenPublico(), tokenPublico());
});

// --- Dinheiro ---

test('centavos: aceita número, texto e vírgula; recusa o resto', () => {
  assert.equal(emCentavos(300), 30000);
  assert.equal(emCentavos('33.33'), 3333);
  assert.equal(emCentavos('33,33'), 3333);
  assert.equal(emCentavos('0.05'), 5);
  for (const ruim of ['abc', '-10', '10.999', '', null, undefined]) {
    assert.equal(emCentavos(ruim), null, `${ruim} não deveria virar centavos`);
  }
});

test('proposta: 60% de crédito e 50% de pix, arredondados em centavos', () => {
  const v = valoresDaProposta(300);
  assert.deepEqual(v, {
    valor_bruto: '300.00',
    percentual_credito: 60,
    percentual_pix: 50,
    valor_credito: '180.00',
    valor_pix: '150.00',
  });
});

test('proposta: a metade de um centavo fica com o cliente, não com a loja', () => {
  // 33,33 a 50% = 16,665 → 16,67. Truncar daria 16,66 e a diferença seria da loja.
  const v = valoresDaProposta('33.33');
  assert.equal(v.valor_pix, '16.67');
  assert.equal(v.valor_credito, '20.00');
  // E o ponto flutuante não entra: 0.1+0.2 aqui não existe.
  assert.equal(valoresDaProposta('0.03').valor_pix, '0.02');
});

test('proposta: percentual diferente é gravado junto, não assumido', () => {
  const v = valoresDaProposta(200, { credito: 55, pix: 45 });
  assert.equal(v.valor_credito, '110.00');
  assert.equal(v.valor_pix, '90.00');
  assert.equal(v.percentual_credito, 55);
});

test('proposta: valor zero ou inválido não vira proposta', () => {
  assert.equal(valoresDaProposta(0), null);
  assert.equal(valoresDaProposta('grátis'), null);
});

// --- Quem pode ---

test('permissão: admin sempre; avaliador por marca na conta', () => {
  assert.equal(podeAvaliar({ role: 'admin' }), true);
  assert.equal(podeAvaliar({ role: 'organizer', avaliador: 1 }), true);
  assert.equal(podeAvaliar({ role: 'player', avaliador: 1 }), true);
  assert.equal(podeAvaliar({ role: 'organizer' }), false);
  assert.equal(podeAvaliar(), false);
});

// --- Avaliar ---

test('avaliar: exige link e valor, e só na OS que está para avaliar', () => {
  assert.equal(impedimentoParaAvaliar({ os: os(), link: 'http://x/lista', valor: 300 }), null);
  assert.equal(impedimentoParaAvaliar({ os: os(), link: '  ', valor: 300 }), 'api.linkObrigatorio');
  assert.equal(impedimentoParaAvaliar({ os: os(), link: 'http://x', valor: 0 }), 'api.valorInvalido');
  assert.equal(
    impedimentoParaAvaliar({ os: os({ status: 'a_pagar' }), link: 'http://x', valor: 300 }),
    'api.statusInvalido',
  );
  assert.equal(impedimentoParaAvaliar({ os: null }), 'api.avaliacaoNaoEncontrada');
});

// --- A resposta do cliente ---

test('cliente: aceitar no pix exige a chave; no crédito, não', () => {
  const avaliada = os({ status: 'avaliado' });
  assert.equal(impedimentoParaResponder({ os: avaliada, resposta: 'aceitar', escolha: 'credito' }), null);
  assert.equal(
    impedimentoParaResponder({ os: avaliada, resposta: 'aceitar', escolha: 'pix' }),
    'api.chavePixObrigatoria',
  );
  assert.equal(
    impedimentoParaResponder({ os: avaliada, resposta: 'aceitar', escolha: 'pix', chavePix: 'marina@t.local' }),
    null,
  );
  assert.equal(
    impedimentoParaResponder({ os: avaliada, resposta: 'aceitar', escolha: 'dinheiro' }),
    'api.escolhaInvalida',
  );
});

test('cliente: recusar encerra, e ninguém responde duas vezes', () => {
  assert.equal(impedimentoParaResponder({ os: os({ status: 'avaliado' }), resposta: 'recusar' }), null);
  // O link pode ter sido encaminhado: quem chegar depois não muda a decisão.
  for (const status of ['a_pagar', 'recusada', 'para_guardar', 'para_avaliar']) {
    assert.equal(
      impedimentoParaResponder({ os: os({ status }), resposta: 'aceitar', escolha: 'credito' }),
      'api.jaRespondida',
      status,
    );
  }
});

// --- Pagamento e prateleira ---

test('pagamento: o comprovante é anexo, não tranca — nos dois caminhos', () => {
  // Crédito não tem transferência a comprovar, e no pix a prova que vale está no
  // extrato do banco. Confirmar passa com ou sem imagem.
  for (const escolha of ['credito', 'pix']) {
    assert.equal(impedimentoParaPagamento({ os: os({ status: 'a_pagar', escolha }) }), null, escolha);
    assert.equal(
      impedimentoParaPagamento({ os: os({ status: 'a_pagar', escolha }), comprovante: 'x.png' }),
      null,
      escolha,
    );
  }
});

test('pagamento: só vale em "a pagar"', () => {
  assert.equal(
    impedimentoParaPagamento({ os: os({ status: 'avaliado' }), comprovante: 'x.png' }),
    'api.statusInvalido',
  );
  assert.equal(impedimentoParaPagamento({ os: null }), 'api.avaliacaoNaoEncontrada');
});

test('avançar: vale de guardar para inserir, e de inserir para inserido', () => {
  assert.equal(impedimentoParaAvancar({ os: os({ status: 'para_guardar' }) }), null);
  assert.equal(impedimentoParaAvancar({ os: os({ status: 'para_inserir' }) }), null);
  // O avanço que depende do cliente ou do pagamento tem rota própria.
  assert.equal(impedimentoParaAvancar({ os: os({ status: 'avaliado' }) }), 'api.statusInvalido');
  assert.equal(impedimentoParaAvancar({ os: os({ status: 'inserido' }) }), 'api.statusInvalido');
});

// --- Voltar ---

test('voltar: um passo por vez, sempre com motivo', () => {
  assert.equal(impedimentoParaVoltar({ os: os({ status: 'inserido' }), motivo: 'caixa errada' }), null);
  assert.equal(impedimentoParaVoltar({ os: os({ status: 'inserido' }) }), 'api.motivoObrigatorio');
  assert.deepEqual(
    ['avaliado', 'a_pagar', 'para_guardar', 'para_inserir', 'inserido'].map(statusAnterior),
    ['para_avaliar', 'avaliado', 'a_pagar', 'para_guardar', 'para_inserir'],
  );
});

test('voltar: o começo e a recusa não voltam', () => {
  assert.equal(impedimentoParaVoltar({ os: os({ status: 'para_avaliar' }), motivo: 'x' }), 'api.semRetorno');
  // Retomar uma recusa é abrir OS nova: depois ninguém saberia se a pessoa
  // mudou de ideia ou se a loja insistiu.
  assert.equal(impedimentoParaVoltar({ os: os({ status: 'recusada' }), motivo: 'x' }), 'api.semRetorno');
});

test('voltar para "para avaliar" invalida o link já enviado', () => {
  assert.equal(trocaOToken('avaliado'), true);
  assert.equal(trocaOToken('a_pagar'), false);
  assert.equal(trocaOToken('para_guardar'), false);
});

// --- A página pública ---

test('público: só nome, telefone, os dois valores e os comentários', () => {
  const publico = dadosPublicos(
    os({
      status: 'avaliado',
      email: 'marina@t.local',
      link_avaliacao: 'http://interno/planilha',
      valor_bruto: '300.00',
      valor_credito: '180.00',
      valor_pix: '150.00',
      chave_pix: 'nao-deveria-vazar',
    }),
  );

  assert.deepEqual(Object.keys(publico).sort(), [
    'codigo', 'comentarios', 'escolha', 'nome', 'respondida', 'status', 'telefone', 'valor_credito', 'valor_pix',
  ]);
  for (const proibido of ['email', 'link_avaliacao', 'valor_bruto', 'chave_pix', 'id']) {
    assert.equal(proibido in publico, false, `${proibido} não pode ir para a página pública`);
  }
});

test('público: depois de respondida, a página vira leitura', () => {
  assert.equal(dadosPublicos(os({ status: 'avaliado' })).respondida, false);
  assert.equal(dadosPublicos(os({ status: 'a_pagar', escolha: 'pix' })).respondida, true);
  assert.equal(dadosPublicos(os({ status: 'recusada' })).respondida, true);
  assert.equal(dadosPublicos(null), null);
});
