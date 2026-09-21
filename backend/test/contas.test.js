const test = require('node:test');
const assert = require('node:assert');
const {
  contaAtiva,
  impedimentoParaEditar,
  impedimentoParaMudarEstado,
  impedimentoParaAnonimizar,
  senhaTemporaria,
  dadosAnonimizados,
} = require('../src/lib/contas');

const conta = (over = {}) => ({ id: 'alvo', role: 'player', status: 'ativa', display_name: 'Caio', ...over });

test('conta: só ativa entra no sistema', () => {
  assert.equal(contaAtiva('ativa'), true);
  assert.equal(contaAtiva(undefined), true, 'linha antiga, sem coluna, é ativa');
  assert.equal(contaAtiva('desativada'), false);
  assert.equal(contaAtiva('anonimizada'), false);
});

// --- Editar ---

test('editar: ninguém se administra pela área de usuários', () => {
  // Mesma armadilha da troca do próprio papel: quem se desativa perde a tela que
  // desfaria isso.
  assert.equal(impedimentoParaEditar({ alvo: conta({ id: 'eu' }), autorId: 'eu' }), 'api.cannotManageSelf');
  assert.equal(impedimentoParaEditar({ alvo: conta(), autorId: 'admin' }), null);
});

test('editar: conta inexistente e conta anonimizada não se editam', () => {
  assert.equal(impedimentoParaEditar({ alvo: null, autorId: 'admin' }), 'api.userNotFound');
  assert.equal(
    impedimentoParaEditar({ alvo: conta({ status: 'anonimizada' }), autorId: 'admin' }),
    'api.accountAnonymized',
  );
});

// --- Desativar e reativar ---

test('estado: desativar e reativar valem; repetir o estado atual não', () => {
  assert.equal(impedimentoParaMudarEstado({ alvo: conta(), autorId: 'admin', novoEstado: 'desativada' }), null);
  assert.equal(
    impedimentoParaMudarEstado({ alvo: conta({ status: 'desativada' }), autorId: 'admin', novoEstado: 'ativa' }),
    null,
  );
  assert.equal(
    impedimentoParaMudarEstado({ alvo: conta(), autorId: 'admin', novoEstado: 'ativa' }),
    'api.statusUnchanged',
  );
});

test('estado: o último administrador ativo não pode ser desativado', () => {
  const admin = conta({ role: 'admin' });
  assert.equal(
    impedimentoParaMudarEstado({ alvo: admin, autorId: 'outro', novoEstado: 'desativada', outrosAdmins: 0 }),
    'api.lastAdmin',
  );
  assert.equal(
    impedimentoParaMudarEstado({ alvo: admin, autorId: 'outro', novoEstado: 'desativada', outrosAdmins: 1 }),
    null,
  );
});

test('estado: anonimizar não passa pela rota de estado', () => {
  // Tem rota própria, com confirmação pelo nome: é irreversível.
  assert.equal(
    impedimentoParaMudarEstado({ alvo: conta(), autorId: 'admin', novoEstado: 'anonimizada' }),
    'api.useAnonymizeRoute',
  );
  assert.equal(impedimentoParaMudarEstado({ alvo: conta(), autorId: 'admin', novoEstado: 'sumida' }), 'api.invalidStatus');
});

// --- Anonimizar ---

test('anonimizar: exige a conta desativada antes', () => {
  // Não é um botão ao lado do nome de quem joga toda sexta.
  assert.equal(impedimentoParaAnonimizar({ alvo: conta(), autorId: 'admin' }), 'api.deactivateFirst');
  assert.equal(impedimentoParaAnonimizar({ alvo: conta({ status: 'desativada' }), autorId: 'admin' }), null);
});

test('anonimizar: as mesmas travas de si mesmo e do último admin', () => {
  assert.equal(
    impedimentoParaAnonimizar({ alvo: conta({ id: 'eu', status: 'desativada' }), autorId: 'eu' }),
    'api.cannotManageSelf',
  );
  assert.equal(
    impedimentoParaAnonimizar({ alvo: conta({ role: 'admin', status: 'desativada' }), autorId: 'outro', outrosAdmins: 0 }),
    'api.lastAdmin',
  );
});

test('anonimizar: o que sobra da conta não identifica ninguém', () => {
  const dados = dadosAnonimizados('abc-123');
  assert.equal(dados.display_name, 'Conta removida');
  assert.match(dados.email, /^removido\+abc-123@invalido\.local$/);
  assert.equal(dados.profile_public, 0);
  assert.equal(dados.status, 'anonimizada');
});

// --- Senha temporária ---

test('senha temporária: tamanho pedido, sem caracteres que se confundem ao ditar', () => {
  const senha = senhaTemporaria();
  assert.equal(senha.length, 12);
  assert.equal(senhaTemporaria(20).length, 20);
  // 0/O e 1/l/I ficam de fora: a senha vai ser ditada no balcão.
  assert.doesNotMatch(senha, /[0O1lI]/);
});

test('senha temporária: não repete', () => {
  const amostras = new Set(Array.from({ length: 50 }, () => senhaTemporaria()));
  assert.equal(amostras.size, 50);
});
