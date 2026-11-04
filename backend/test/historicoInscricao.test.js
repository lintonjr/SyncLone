const test = require('node:test');
const assert = require('node:assert');
const { acaoDaMudanca, registrar } = require('../src/lib/historicoInscricao');

// A tabela nasceu de um drop que ninguém conseguiu explicar depois do fato. O que
// a torna útil é justamente o que estes testes cobrem: que sair e ser tirado
// sejam fatos distinguíveis, e que nenhuma transição fique sem linha.

test('histórico: inscrição nova é "entrou", em qualquer status inicial', () => {
  assert.equal(acaoDaMudanca({ de: null, para: 'active' }), 'entrou');
  assert.equal(acaoDaMudanca({ de: null, para: 'pending' }), 'entrou');
});

test('histórico: sair e ser tirado terminam no mesmo status e não são a mesma coisa', () => {
  // Esta é a distinção que o banco não guardava, e por isso a pergunta "quem
  // dropou o jogador?" não tinha resposta.
  assert.equal(acaoDaMudanca({ de: 'active', para: 'dropped', peloProprio: true }), 'saiu');
  assert.equal(acaoDaMudanca({ de: 'active', para: 'dropped', peloProprio: false }), 'removido');
  // Sem informação de autoria, o padrão é o fato menos presumido: alguém agiu.
  assert.equal(acaoDaMudanca({ de: 'active', para: 'dropped' }), 'removido');
});

test('histórico: voltar da fila é aprovação; voltar de fora é restauração', () => {
  assert.equal(acaoDaMudanca({ de: 'pending', para: 'active' }), 'aprovado');
  assert.equal(acaoDaMudanca({ de: 'dropped', para: 'active' }), 'restaurado');
});

test('histórico: linha apagada distingue recusa de exclusão', () => {
  // retirePlayer apaga a inscrição de quem nunca sentou à mesa. Se ela nunca foi
  // aprovada, o que aconteceu foi uma recusa — e é esse o caso em que o nome
  // gravado na linha é a única coisa que sobra.
  assert.equal(acaoDaMudanca({ de: 'pending', para: null }), 'rejeitado');
  assert.equal(acaoDaMudanca({ de: 'active', para: null }), 'excluido');
});

test('histórico: a derivação é total — nenhuma transição fica sem rótulo', () => {
  // Auditoria com buraco é pior que auditoria grosseira: o que a tela não faz
  // hoje cai em `alterado` em vez de não gerar linha.
  assert.equal(acaoDaMudanca({ de: 'active', para: 'pending' }), 'alterado');
  assert.equal(acaoDaMudanca({ de: 'dropped', para: 'pending' }), 'alterado');
  assert.equal(acaoDaMudanca({ de: 'active', para: 'active' }), 'alterado');

  const STATUS = [null, 'active', 'pending', 'dropped'];
  const NOMES = new Set([
    'entrou', 'saiu', 'removido', 'restaurado', 'aprovado', 'rejeitado', 'excluido', 'alterado',
  ]);
  for (const de of STATUS) {
    for (const para of STATUS) {
      for (const peloProprio of [true, false]) {
        const acao = acaoDaMudanca({ de, para, peloProprio });
        // O enum da coluna recusaria qualquer coisa fora desta lista, e o INSERT
        // morreria junto com o fato que ele deveria registrar.
        assert.ok(NOMES.has(acao), `(${de} -> ${para}) devolveu "${acao}"`);
      }
    }
  }
});

test('histórico: a linha grava o nome, porque a inscrição pode não existir mais', async () => {
  const gravadas = [];
  const conn = { run: (sql, params) => { gravadas.push({ sql, params }); return Promise.resolve(); } };

  await registrar(conn, {
    evento: 'ev-1', inscricao: 'ins-1', nome: 'Gabriel Padinha',
    de: 'active', para: null, autor: 'org-1', peloProprio: false,
    motivo: 'pedido não aprovado',
  });

  assert.equal(gravadas.length, 1);
  const [, evento, inscricao, nome, acao, de, para, autor, motivo] = gravadas[0].params;
  assert.equal(evento, 'ev-1');
  assert.equal(inscricao, 'ins-1');
  assert.equal(nome, 'Gabriel Padinha');
  assert.equal(acao, 'excluido');
  assert.equal(de, 'active');
  assert.equal(para, null);
  assert.equal(autor, 'org-1');
  assert.equal(motivo, 'pedido não aprovado');
});

test('histórico: sem autor a linha ainda nasce — convidado não tem conta', async () => {
  const gravadas = [];
  const conn = { run: (_, params) => { gravadas.push(params); return Promise.resolve(); } };

  await registrar(conn, {
    evento: 'ev-1', inscricao: 'ins-2', nome: 'Convidado',
    de: null, para: 'active', autor: undefined, peloProprio: false,
  });

  const [, , , , acao, , , autor, motivo] = gravadas[0];
  assert.equal(acao, 'entrou');
  assert.equal(autor, null);
  assert.equal(motivo, null);
});
