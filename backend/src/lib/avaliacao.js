const crypto = require('crypto');

/**
 * As regras da avaliação de coleção, sem banco e sem HTTP.
 *
 * Mesma razão de `roles.js`, `equipeLiga.js` e `contas.js`: são decisões, e
 * decisão escrita em três lugares um dia diverge em um deles. Aqui moram o
 * dinheiro, a máquina de estados e o que a página pública pode mostrar.
 *
 * O fio condutor é que uma OS é uma **proposta comercial**: o que foi oferecido
 * numa data não pode mudar sozinho depois. Por isso os valores são congelados na
 * linha (percentual junto) e a volta de status é explícita, um passo por vez e
 * com motivo — nunca um efeito colateral de editar um campo.
 */

const STATUS = [
  'para_avaliar',
  'avaliado',
  'recusada',
  'a_pagar',
  'para_guardar',
  'para_inserir',
  'inserido',
];

/**
 * O caminho de ida. `avaliado` tem duas saídas porque é o único ponto em que
 * quem decide é o cliente, e recusar é uma resposta legítima, não um erro.
 */
const DEPOIS = {
  para_avaliar: ['avaliado'],
  avaliado: ['a_pagar', 'recusada'],
  a_pagar: ['para_guardar'],
  para_guardar: ['para_inserir'],
  para_inserir: ['inserido'],
  recusada: [],
  inserido: [],
};

/**
 * O caminho de volta, um passo por vez.
 *
 * `para_avaliar` não volta (é o começo) e `recusada` também não: retomar uma
 * recusa é abrir uma OS nova. Meses depois, ninguém saberia dizer se a pessoa
 * mudou de ideia ou se a loja insistiu até ela mudar.
 */
const ANTES = {
  avaliado: 'para_avaliar',
  a_pagar: 'avaliado',
  para_guardar: 'a_pagar',
  para_inserir: 'para_guardar',
  inserido: 'para_inserir',
};

/** Os status que a equipe move; o resto é o cliente pelo link. */
const AVANCO_DIRETO = ['para_guardar', 'para_inserir'];

// --- Código da OS e token público ---

/** Sem 0/O e 1/I: o código é ditado no balcão e anotado à mão. */
const ALFABETO = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/**
 * O número da OS: dois grupos de quatro, `K7M4-Q2X9`.
 *
 * Aleatório e não sequencial por dois motivos: quem recebe o link não fica
 * sabendo quantas coleções a loja compra por mês, e não há contador para duas
 * OS abertas ao mesmo tempo disputarem. A colisão é tratada por índice único
 * mais nova tentativa, como qualquer sorteio com unicidade.
 */
function codigoDeOS(sorteio = (n) => crypto.randomInt(n)) {
  let bruto = '';
  for (let i = 0; i < 8; i++) bruto += ALFABETO[sorteio(ALFABETO.length)];
  return `${bruto.slice(0, 4)}-${bruto.slice(4)}`;
}

/**
 * Como a busca compara códigos: sem hífen, sem espaço, tudo em maiúscula.
 *
 * Quem digita "k7m4q2x9" no balcão quer a mesma OS de quem cola "K7M4-Q2X9".
 */
const normalizarCodigo = (texto) => String(texto ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

/** O segredo que segura a página sem login. 32 hex = 128 bits de sorteio. */
const tokenPublico = () => crypto.randomBytes(16).toString('hex');

// --- Dinheiro ---

/**
 * Converte para centavos inteiros.
 *
 * O valor chega como número do JSON ou como string do MySQL (DECIMAL vem em
 * texto justamente para não passar por ponto flutuante). Daqui para dentro é
 * tudo inteiro: `0.1 + 0.2` não pode decidir quanto a loja paga a alguém.
 */
function emCentavos(valor) {
  if (valor === null || valor === undefined || valor === '') return null;
  const texto = String(valor).trim().replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(texto)) return null;
  const [inteira, decimal = ''] = texto.split('.');
  return Number(inteira) * 100 + Number(decimal.padEnd(2, '0'));
}

/** De centavos para o texto que o MySQL guarda em DECIMAL(10,2). */
const paraDecimal = (centavos) =>
  `${Math.trunc(centavos / 100)}.${String(centavos % 100).padStart(2, '0')}`;

/**
 * Os dois valores da proposta, calculados uma vez e congelados.
 *
 * Arredondamento meio-para-cima, em centavos: R$ 33,33 a 50% dá R$ 16,67 e não
 * R$ 16,66 — a diferença é do cliente. Os percentuais entram como argumento e
 * são gravados junto: mudar a política da loja no ano que vem não pode reescrever
 * o que foi oferecido hoje.
 */
function valoresDaProposta(valorBruto, { credito = 60, pix = 50 } = {}) {
  const bruto = emCentavos(valorBruto);
  if (bruto === null || bruto <= 0) return null;
  const parte = (pct) => Math.round((bruto * pct) / 100);
  return {
    valor_bruto: paraDecimal(bruto),
    percentual_credito: credito,
    percentual_pix: pix,
    valor_credito: paraDecimal(parte(credito)),
    valor_pix: paraDecimal(parte(pix)),
  };
}

// --- Máquina de estados ---

/** Admin sempre; avaliador por permissão na conta. */
const podeAvaliar = ({ role, avaliador } = {}) => role === 'admin' || !!avaliador;

/**
 * Por que esta OS não pode ser avaliada agora, ou null.
 *
 * O link e o valor são obrigatórios juntos: é o par que transforma "recebi uma
 * caixa de cartas" em uma proposta que alguém vai aceitar ou recusar.
 */
function impedimentoParaAvaliar({ os, link, valor }) {
  if (!os) return 'api.avaliacaoNaoEncontrada';
  if (os.status !== 'para_avaliar') return 'api.statusInvalido';
  if (!String(link ?? '').trim()) return 'api.linkObrigatorio';
  const valores = valoresDaProposta(valor);
  if (!valores) return 'api.valorInvalido';
  return null;
}

/**
 * Por que o cliente não pode responder, ou null.
 *
 * Responder é irreversível do lado dele: sem isto, um link encaminhado no grupo
 * da família deixaria qualquer um trocar a escolha de quem já decidiu.
 */
function impedimentoParaResponder({ os, resposta, escolha, chavePix }) {
  if (!os) return 'api.avaliacaoNaoEncontrada';
  if (os.status !== 'avaliado') return 'api.jaRespondida';
  if (resposta === 'recusar') return null;
  if (resposta !== 'aceitar') return 'api.respostaInvalida';
  if (escolha !== 'credito' && escolha !== 'pix') return 'api.escolhaInvalida';
  if (escolha === 'pix' && !String(chavePix ?? '').trim()) return 'api.chavePixObrigatoria';
  return null;
}

/**
 * Por que o pagamento não pode ser confirmado, ou null.
 *
 * O comprovante é **anexo, não tranca**. Ele já foi obrigatório aqui, e estava
 * errado por dois motivos: no crédito da loja não existe transferência para
 * comprovar — o crédito é lançado no sistema da casa —, e mesmo no pix a prova
 * que importa está no extrato do banco, não numa imagem que qualquer um anexa.
 * Como o resto do fluxo, este passo anda pela palavra de quem clica, com nome e
 * data no histórico.
 */
function impedimentoParaPagamento({ os }) {
  if (!os) return 'api.avaliacaoNaoEncontrada';
  if (os.status !== 'a_pagar') return 'api.statusInvalido';
  return null;
}

/** Guardar e inserir são os dois passos de prateleira, sem dado a pedir. */
function impedimentoParaAvancar({ os }) {
  if (!os) return 'api.avaliacaoNaoEncontrada';
  if (!AVANCO_DIRETO.includes(os.status)) return 'api.statusInvalido';
  return null;
}

/**
 * Por que não dá para voltar um passo, ou null.
 *
 * O motivo é obrigatório porque voltar é sempre a correção de um erro, e daqui
 * a um mês a pergunta vai ser "por que essa OS voltou para 'a pagar'?".
 */
function impedimentoParaVoltar({ os, motivo }) {
  if (!os) return 'api.avaliacaoNaoEncontrada';
  if (!ANTES[os.status]) return 'api.semRetorno';
  if (!String(motivo ?? '').trim()) return 'api.motivoObrigatorio';
  return null;
}

/** Para onde esta OS volta. */
const statusAnterior = (status) => ANTES[status] ?? null;

/**
 * Os status em que apagar a OS ainda é apagar um papel, não uma transação.
 *
 * `a_pagar` é a fronteira: dali em diante a loja se comprometeu a pagar, pagou,
 * ou já colocou as cartas na prateleira. Apagar isso seria sumir com a prova de
 * um negócio fechado — e o caminho certo para desfazê-lo já existe, um `voltar`
 * por vez, cada passo com motivo no histórico.
 */
const EXCLUIVEIS = ['para_avaliar', 'avaliado', 'recusada'];

/** Nestes, sumir com a OS some também com uma proposta que alguém recebeu. */
const EXIGEM_MOTIVO = ['avaliado', 'recusada'];

/**
 * Por que esta OS não pode ser excluída, ou null.
 *
 * Excluir é o único ato do módulo que não deixa a OS para trás, e por isso é o
 * mais travado dos sete: fora de `para_avaliar` cobra motivo, e sempre cobra o
 * código digitado à mão — o mesmo pedágio que anonimizar uma conta cobra com o
 * nome da pessoa. Um clique errado numa lista não pode apagar a coleção de
 * ninguém.
 *
 * O que sobra da OS não mora aqui: é a linha em `avaliacao_exclusoes` que a rota
 * grava antes de apagar. Esta função só decide se pode.
 */
function impedimentoParaExcluir({ os, confirmacao, motivo }) {
  if (!os) return 'api.avaliacaoNaoEncontrada';
  if (!EXCLUIVEIS.includes(os.status)) return 'api.excluirDepoisDoPagamento';
  if (EXIGEM_MOTIVO.includes(os.status) && !String(motivo ?? '').trim()) {
    return 'api.motivoDaExclusao';
  }
  if (normalizarCodigo(confirmacao) !== normalizarCodigo(os.codigo)) {
    return 'api.codigoNaoConfere';
  }
  return null;
}

/**
 * O que fica registrado de uma OS apagada.
 *
 * Nem tudo: o e-mail, o link da planilha e a chave pix do cliente vão embora com
 * a linha, porque guardar dado pessoal de um negócio que a loja decidiu apagar
 * seria o contrário do que apagar significa. Fica o que responde "o que houve
 * com a OS K7M4-Q2X9?" — código, contato mínimo, em que pé estava e quanto valia.
 */
function dadosDaExclusao(os) {
  return {
    codigo: os.codigo,
    nome: os.nome,
    telefone: os.telefone,
    status_na_exclusao: os.status,
    valor_bruto: os.valor_bruto,
    percentual_credito: os.percentual_credito,
    percentual_pix: os.percentual_pix,
    escolha: os.escolha,
  };
}

/**
 * Voltar de `avaliado` para `para_avaliar` invalida o link.
 *
 * O cliente pode já ter recebido a proposta — e encaminhado. Se o valor vai ser
 * refeito, o endereço antigo tem de parar de abrir, senão duas propostas
 * diferentes ficam circulando ao mesmo tempo.
 */
const trocaOToken = (de) => de === 'avaliado';

/**
 * O que a página sem login mostra.
 *
 * Lista fechada, montada aqui e não na rota: o dia em que alguém acrescentar uma
 * coluna à tabela — o e-mail, o valor bruto, a planilha interna — ela não vaza
 * junto por estar num `SELECT *`.
 */
function dadosPublicos(os) {
  if (!os) return null;
  return {
    codigo: os.codigo,
    nome: os.nome,
    telefone: os.telefone,
    comentarios: os.comentarios,
    valor_credito: os.valor_credito,
    valor_pix: os.valor_pix,
    status: os.status,
    escolha: os.escolha,
    respondida: os.status !== 'avaliado',
  };
}

module.exports = {
  STATUS,
  DEPOIS,
  ANTES,
  codigoDeOS,
  normalizarCodigo,
  tokenPublico,
  emCentavos,
  paraDecimal,
  valoresDaProposta,
  podeAvaliar,
  impedimentoParaAvaliar,
  impedimentoParaResponder,
  impedimentoParaPagamento,
  impedimentoParaAvancar,
  impedimentoParaVoltar,
  impedimentoParaExcluir,
  dadosDaExclusao,
  statusAnterior,
  trocaOToken,
  dadosPublicos,
};
