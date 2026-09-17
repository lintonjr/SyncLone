const test = require('node:test');
const assert = require('node:assert');
const {
  papelNoEvento,
  papelNaLiga,
  gerenciaEvento,
  respondePeloEvento,
  gerenciaLiga,
  ehDonoDaLiga,
  impedimentoParaAdicionar,
  podeRemoverDoTime,
} = require('../src/lib/equipeLiga');

const LIGA = { id: 'liga1', owner_id: 'dona' };
const eventoNaLiga = (criador) => ({ id: 'ev1', owner_id: criador, league_id: 'liga1' });
const eventoAvulso = (criador) => ({ id: 'ev2', owner_id: criador, league_id: null });

// --- Evento ---

test('equipe: quem criou o evento gerencia e responde por ele, com ou sem liga', () => {
  for (const evento of [eventoNaLiga('ana'), eventoAvulso('ana')]) {
    const papel = papelNoEvento({ evento, usuarioId: 'ana', donoDaLigaId: 'dona' });
    assert.equal(papel, 'dono');
    assert.equal(gerenciaEvento(papel), true);
    assert.equal(respondePeloEvento(papel), true);
  }
});

test('equipe: co-organizador gerencia evento que OUTRA pessoa criou na liga', () => {
  // O coração do pedido: o time cuida da liga inteira, não só do que criou.
  const papel = papelNoEvento({
    evento: eventoNaLiga('ana'), usuarioId: 'bia', donoDaLigaId: 'dona', papelNaEquipe: 'organizer',
  });
  assert.equal(papel, 'equipe');
  assert.equal(gerenciaEvento(papel), true);
});

test('equipe: co-organizador não apaga nem tira da liga evento que não criou', () => {
  const papel = papelNoEvento({
    evento: eventoNaLiga('ana'), usuarioId: 'bia', donoDaLigaId: 'dona', papelNaEquipe: 'organizer',
  });
  assert.equal(respondePeloEvento(papel), false);
});

test('equipe: dono da liga gerencia e responde por todo evento dela', () => {
  const papel = papelNoEvento({ evento: eventoNaLiga('ana'), usuarioId: 'dona', donoDaLigaId: 'dona' });
  assert.equal(papel, 'dono-liga');
  assert.equal(gerenciaEvento(papel), true);
  assert.equal(respondePeloEvento(papel), true);
});

test('equipe: fora da liga, ser do time não dá acesso nenhum', () => {
  // Evento avulso de outra pessoa: nem o "dono da liga" dos fatos vale, porque o
  // evento não está em liga.
  assert.equal(
    papelNoEvento({ evento: eventoAvulso('ana'), usuarioId: 'bia', donoDaLigaId: 'bia', papelNaEquipe: 'organizer' }),
    null
  );
});

test('equipe: quem não está no time não gerencia evento alheio da liga', () => {
  assert.equal(papelNoEvento({ evento: eventoNaLiga('ana'), usuarioId: 'caio', donoDaLigaId: 'dona' }), null);
  assert.equal(gerenciaEvento(null), false);
});

test('equipe: quem perdeu o papel de organizador perde junto o acesso às ligas', () => {
  // A linha em league_organizers continua lá; o papel atual é que decide.
  assert.equal(
    papelNoEvento({ evento: eventoNaLiga('ana'), usuarioId: 'bia', donoDaLigaId: 'dona', papelNaEquipe: 'player' }),
    null
  );
  // Admin organiza também.
  assert.equal(
    papelNoEvento({ evento: eventoNaLiga('ana'), usuarioId: 'bia', donoDaLigaId: 'dona', papelNaEquipe: 'admin' }),
    'equipe'
  );
});

test('equipe: sem usuário ou sem evento, ninguém gerencia', () => {
  assert.equal(papelNoEvento({ evento: eventoNaLiga('ana'), usuarioId: undefined, donoDaLigaId: 'dona' }), null);
  assert.equal(papelNoEvento({ evento: null, usuarioId: 'ana' }), null);
});

// --- Liga ---

test('liga: dono e time editam; só o dono escolhe o time e apaga', () => {
  const dono = papelNaLiga({ liga: LIGA, usuarioId: 'dona' });
  const time = papelNaLiga({ liga: LIGA, usuarioId: 'bia', papelNaEquipe: 'organizer' });
  const fora = papelNaLiga({ liga: LIGA, usuarioId: 'caio' });
  const rebaixada = papelNaLiga({ liga: LIGA, usuarioId: 'bia', papelNaEquipe: 'player' });

  assert.deepEqual([dono, time, fora, rebaixada], ['dono', 'equipe', null, null]);
  assert.deepEqual([dono, time, fora].map(gerenciaLiga), [true, true, false]);
  assert.deepEqual([dono, time, fora].map(ehDonoDaLiga), [true, false, false]);
});

// --- Montagem do time ---

test('time: só entra quem tem conta e já organiza', () => {
  assert.equal(impedimentoParaAdicionar({ liga: LIGA, alvo: null }), 'api.userNotFound');
  assert.equal(
    impedimentoParaAdicionar({ liga: LIGA, alvo: { id: 'caio', role: 'player' } }),
    'api.coOrganizerMustOrganize'
  );
  assert.equal(impedimentoParaAdicionar({ liga: LIGA, alvo: { id: 'bia', role: 'organizer' } }), null);
  assert.equal(impedimentoParaAdicionar({ liga: LIGA, alvo: { id: 'bia', role: 'admin' } }), null);
});

test('time: o dono não entra no próprio time, nem alguém duas vezes', () => {
  assert.equal(
    impedimentoParaAdicionar({ liga: LIGA, alvo: { id: 'dona', role: 'organizer' } }),
    'api.leagueOwnerAlready'
  );
  assert.equal(
    impedimentoParaAdicionar({ liga: LIGA, alvo: { id: 'bia', role: 'organizer' }, jaNoTime: true }),
    'api.coOrganizerAlready'
  );
});

test('time: dono remove qualquer um; co-organizador só sai por conta própria', () => {
  assert.equal(podeRemoverDoTime({ papelDeQuemPede: 'dono', quemPedeId: 'dona', alvoId: 'bia' }), true);
  assert.equal(podeRemoverDoTime({ papelDeQuemPede: 'equipe', quemPedeId: 'bia', alvoId: 'bia' }), true);
  assert.equal(podeRemoverDoTime({ papelDeQuemPede: 'equipe', quemPedeId: 'bia', alvoId: 'davi' }), false);
  assert.equal(podeRemoverDoTime({ papelDeQuemPede: null, quemPedeId: 'caio', alvoId: 'caio' }), false);
});
