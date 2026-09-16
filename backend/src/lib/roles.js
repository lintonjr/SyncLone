/**
 * As regras de papel, sem banco e sem HTTP.
 *
 * Ficam aqui porque são decisões, não consultas: "admin também organiza",
 * "ninguém rebaixa a si mesmo", "só player pede para organizar". Cada uma delas
 * é uma frase que precisa valer igual na rota, no teste e amanhã em qualquer
 * outro lugar que pergunte a mesma coisa — e regra escrita três vezes é regra
 * que um dia vai divergir em uma delas.
 */

const PAPEIS = ['player', 'organizer', 'admin'];

/**
 * Admin pode tudo que organizador pode.
 *
 * Sem isto, promover a própria conta a admin tiraria dela o direito de criar
 * eventos — o dono da plataforma seria a única pessoa impedida de organizar um
 * torneio nela. Os papéis são excludentes na coluna, hierárquicos na permissão.
 */
const podeOrganizar = (papel) => papel === 'organizer' || papel === 'admin';

const ehAdmin = (papel) => papel === 'admin';

/** Só quem ainda não organiza tem o que pedir. */
const podePedirParaOrganizar = (papel) => papel === 'player';

/**
 * Por que este papel não pode ser atribuído, ou null se puder.
 *
 * Devolve o motivo em vez de um booleano porque quem chama precisa dizer à
 * pessoa o que houve — e o código de erro é o que a tela traduz.
 */
function impedimentoParaTrocarPapel({ alvoId, alvoPapel, autorId, novoPapel }) {
  if (!PAPEIS.includes(novoPapel)) return 'api.invalidRole';

  // Um admin que se rebaixa por engano não tem como voltar: a rota que desfaria
  // isso é a mesma que ele acabou de perder. Trocar de dono é sempre um admin
  // promovendo outro, nunca um se demitindo sozinho.
  if (alvoId === autorId) return 'api.cannotChangeOwnRole';

  if (alvoPapel === novoPapel) return 'api.roleUnchanged';

  return null;
}

/**
 * Por que este pedido não pode ser decidido agora, ou null se puder.
 *
 * Um pedido já decidido não volta para a fila: duas abas abertas na tela do dono
 * não podem virar uma aprovação em cima de uma recusa.
 */
function impedimentoParaDecidir(pedido) {
  if (!pedido) return 'api.requestNotFound';
  if (pedido.status !== 'pending') return 'api.requestAlreadyDecided';
  return null;
}

module.exports = {
  PAPEIS,
  podeOrganizar,
  ehAdmin,
  podePedirParaOrganizar,
  impedimentoParaTrocarPapel,
  impedimentoParaDecidir,
};
