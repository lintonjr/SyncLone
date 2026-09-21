const crypto = require('crypto');

/**
 * As regras de administrar uma conta alheia: editar, redefinir senha, desativar,
 * anonimizar.
 *
 * Ficam aqui, puras, pelo mesmo motivo de `roles.js` e `equipeLiga.js`: são
 * decisões, não consultas, e cada uma precisa valer igual na rota, no teste e na
 * próxima tela que perguntar a mesma coisa.
 *
 * O fio condutor é um só: **ninguém se administra por aqui**. Um administrador
 * que se desativa, se anonimiza ou redefine a própria senha perde a tela que
 * desfaria isso — é a mesma armadilha da troca do próprio papel, que o sistema já
 * barra desde que o papel de admin existe.
 */

const ESTADOS = ['ativa', 'desativada', 'anonimizada'];

/** Só conta ativa entra no sistema; as outras nem com token válido no bolso. */
const contaAtiva = (status) => (status ?? 'ativa') === 'ativa';

/**
 * Por que esta conta não pode ser editada por um administrador, ou null.
 *
 * Conta anonimizada não volta: o nome e o e-mail originais não existem mais em
 * lugar nenhum, então "editar" viraria inventar uma pessoa nova sobre o histórico
 * de outra.
 */
function impedimentoParaEditar({ alvo, autorId }) {
  if (!alvo) return 'api.userNotFound';
  if (alvo.id === autorId) return 'api.cannotManageSelf';
  if (alvo.status === 'anonimizada') return 'api.accountAnonymized';
  return null;
}

/**
 * Por que este estado não pode ser aplicado, ou null.
 *
 * `outrosAdmins` é quantos administradores ativos existem além deste. Zerar a
 * conta de administrador da plataforma deixaria a loja sem quem aprove pedido,
 * troque papel ou arrume um time — e a rota que desfaria isso é justamente a que
 * some.
 */
function impedimentoParaMudarEstado({ alvo, autorId, novoEstado, outrosAdmins = 0 }) {
  if (!ESTADOS.includes(novoEstado)) return 'api.invalidStatus';
  if (novoEstado === 'anonimizada') return 'api.useAnonymizeRoute';
  const base = impedimentoParaEditar({ alvo, autorId });
  if (base) return base;
  if (alvo.status === novoEstado) return 'api.statusUnchanged';
  if (novoEstado === 'desativada' && alvo.role === 'admin' && outrosAdmins === 0) {
    return 'api.lastAdmin';
  }
  return null;
}

/**
 * Por que esta conta não pode ser anonimizada, ou null.
 *
 * É irreversível: nome e e-mail somem para sempre. Por isso as mesmas travas da
 * desativação, mais a exigência de a conta já estar desativada — anonimizar é o
 * segundo passo de um caminho, não um botão ao lado do nome de quem joga toda
 * sexta.
 */
function impedimentoParaAnonimizar({ alvo, autorId, outrosAdmins = 0 }) {
  const base = impedimentoParaEditar({ alvo, autorId });
  if (base) return base;
  if (alvo.role === 'admin' && outrosAdmins === 0) return 'api.lastAdmin';
  if (alvo.status !== 'desativada') return 'api.deactivateFirst';
  return null;
}

/**
 * Senha temporária legível e sorteada.
 *
 * Sem caracteres que se confundem lidos em voz alta ou copiados à mão (0/O,
 * 1/l/I): ela vai ser ditada no balcão. `randomInt` é do gerador criptográfico —
 * `Math.random()` numa senha é o tipo de atalho que ninguém revisa depois.
 */
const ALFABETO = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';

function senhaTemporaria(tamanho = 12) {
  let senha = '';
  for (let i = 0; i < tamanho; i++) senha += ALFABETO[crypto.randomInt(ALFABETO.length)];
  return senha;
}

/**
 * Os dados de uma conta anonimizada.
 *
 * O e-mail precisa continuar único (a coluna exige) e não pode ser um endereço
 * real: `removido+<id>@invalido.local` cumpre os dois, e diz o que aconteceu para
 * quem abrir o banco daqui a um ano.
 */
function dadosAnonimizados(id) {
  return {
    display_name: 'Conta removida',
    email: `removido+${id}@invalido.local`,
    profile_public: 0,
    status: 'anonimizada',
  };
}

module.exports = {
  ESTADOS,
  contaAtiva,
  impedimentoParaEditar,
  impedimentoParaMudarEstado,
  impedimentoParaAnonimizar,
  senhaTemporaria,
  dadosAnonimizados,
};
