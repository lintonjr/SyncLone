const test = require('node:test');
const assert = require('node:assert');
const { filtrosDeEventos, ordemPadrao, ORDENS, SEM_LIGA } = require('../src/lib/listaEventos');

// O módulo nasceu de duas telas que mostram torneios e precisavam achar a mesma
// coisa com o mesmo texto digitado. O que estes testes protegem é isso: que a
// busca alcance o nome do jogador e o da liga, que a ordem nunca aceite nada de
// fora da lista fechada, e que as duas seções da home continuem excludentes.

test('lista: sem nada pedido, nenhuma condição e a ordem do padrão', () => {
  const r = filtrosDeEventos();
  assert.deepEqual(r.condicoes, []);
  assert.deepEqual(r.params, []);
  // Lista única (Meus eventos): começa no que acabou de acontecer.
  assert.equal(r.ordem, ORDENS.data_desc);
});

test('lista: as duas seções da home são excludentes e cada uma tem sua ordem', () => {
  const proximos = filtrosDeEventos({ passados: false, agora: '2026-11-25 12:00:00' });
  const passados = filtrosDeEventos({ passados: true, agora: '2026-11-25 12:00:00' });

  // O torneio de sábado primeiro nos próximos; o que acabou de acontecer
  // primeiro nos passados — era esta a ordem que faltava.
  assert.equal(proximos.ordem, ORDENS.data_asc);
  assert.equal(passados.ordem, ORDENS.data_desc);

  assert.match(proximos.condicoes[0], /e\.date >= \?/);
  assert.match(passados.condicoes[0], /e\.date < \?/);
  assert.deepEqual(proximos.params, ['2026-11-25 12:00:00']);
  assert.deepEqual(passados.params, ['2026-11-25 12:00:00']);
});

test('lista: torneio encerrado é passado mesmo com data no futuro', () => {
  // Quem finalizou o evento já disse que ele acabou; deixá-lo entre os próximos
  // seria contrariar o organizador.
  const passados = filtrosDeEventos({ passados: true, agora: '2026-11-25 12:00:00' });
  assert.match(passados.condicoes[0], /e\.status = 'completed'/);
  const proximos = filtrosDeEventos({ passados: false, agora: '2026-11-25 12:00:00' });
  assert.match(proximos.condicoes[0], /e\.status != 'completed'/);
});

test('lista: a busca alcança o nome do jogador, e não só o do torneio', () => {
  // A pergunta que o sistema não sabia responder na tela: "em que torneios o Zé
  // jogou?". É o EXISTS sobre as inscrições que a responde.
  const r = filtrosDeEventos({ q: 'Zé' });
  const busca = r.condicoes[0];
  assert.match(busca, /EXISTS \(SELECT 1 FROM event_players epb/);
  assert.match(busca, /COALESCE\(ub\.display_name, epb\.display_name\) LIKE \?/);
  // Conta tem o nome no cadastro, convidado tem na inscrição — e metade das
  // inscrições do sistema é de convidado.
  assert.match(busca, /LEFT JOIN users ub/);
});

test('lista: a busca também alcança o nome da liga e os campos do torneio', () => {
  const r = filtrosDeEventos({ q: 'Zé' });
  const busca = r.condicoes[0];
  for (const campo of [/e\.name LIKE \?/, /e\.description LIKE \?/, /e\.game LIKE \?/, /l\.name LIKE \?/]) {
    assert.match(busca, campo);
  }
  // Cinco campos, cinco parâmetros, todos o mesmo LIKE.
  assert.deepEqual(r.params, ['%Zé%', '%Zé%', '%Zé%', '%Zé%', '%Zé%']);
});

test('lista: busca em branco não filtra nada', () => {
  // Apagar o que foi digitado tem de devolver a lista inteira, e um espaço
  // sobrando não é uma busca por espaço.
  for (const q of ['', '   ', undefined, null]) {
    assert.deepEqual(filtrosDeEventos({ q }).condicoes, [], `q=${JSON.stringify(q)}`);
  }
});

test('lista: a busca não recorta por status — quem saiu e quem está na fila também são achados', () => {
  // Quem entrou e saiu continua tendo jogado aquele torneio, e o histórico não
  // desaparece quando alguém dropa. A ausência de `epb.status` na condição é a
  // decisão, não um esquecimento.
  const busca = filtrosDeEventos({ q: 'Zé' }).condicoes[0];
  assert.ok(!/epb\.status/.test(busca), 'a busca por jogador não deve filtrar por status');
});

test('lista: a liga filtra por id, e "none" é o torneio sem liga', () => {
  const comLiga = filtrosDeEventos({ liga: 'liga-1' });
  assert.deepEqual(comLiga.condicoes, ['e.league_id = ?']);
  assert.deepEqual(comLiga.params, ['liga-1']);

  const semLiga = filtrosDeEventos({ liga: SEM_LIGA });
  assert.deepEqual(semLiga.condicoes, ['e.league_id IS NULL']);
  // "Sem liga" é uma condição sem valor: nada a passar para o driver.
  assert.deepEqual(semLiga.params, []);

  assert.deepEqual(filtrosDeEventos({ liga: '  ' }).condicoes, []);
});

test('lista: a ordem só pode vir da lista fechada', () => {
  // O valor vem da query string e vai para o ORDER BY, posição em que o driver
  // não aceita placeholder: o que não está na lista cai no padrão da seção, e
  // nada de fora entra na consulta.
  const malicioso = filtrosDeEventos({ ordem: 'e.date ASC; DROP TABLE events', passados: true });
  assert.equal(malicioso.ordem, ORDENS.data_desc);
  assert.ok(!malicioso.ordem.includes('DROP'));

  assert.equal(filtrosDeEventos({ ordem: 'data_asc', passados: true }).ordem, ORDENS.data_asc);
  assert.equal(filtrosDeEventos({ ordem: 'data_desc', passados: false }).ordem, ORDENS.data_desc);
});

test('lista: toda ordem desempata por id, para a paginação não repetir torneio', () => {
  // Dois torneios na mesma data são comuns (a rodada de sábado da loja). Sem
  // desempate, a ordem entre eles pode mudar de uma página para a outra e, com
  // LIMIT/OFFSET, o mesmo torneio aparece duas vezes ou nenhuma.
  for (const [nome, sql] of Object.entries(ORDENS)) {
    assert.match(sql, /e\.id (ASC|DESC)/, `${nome} precisa desempatar por id`);
  }
});

test('lista: o padrão de cada tela', () => {
  assert.equal(ordemPadrao({ passados: false }), 'data_asc');
  assert.equal(ordemPadrao({ passados: true }), 'data_desc');
  assert.equal(ordemPadrao(), 'data_desc');
});

test('lista: os filtros se somam, e os parâmetros saem na ordem das condições', () => {
  // A ordem importa: quem monta o SQL concatena as condições nesta sequência e
  // passa esta lista de parâmetros. Trocar uma coisa de lugar aqui desalinha
  // tudo silenciosamente.
  const r = filtrosDeEventos({
    q: 'commander',
    liga: 'liga-1',
    ordem: 'data_asc',
    passados: false,
    agora: '2026-11-25 12:00:00',
  });
  assert.equal(r.condicoes.length, 3);
  assert.match(r.condicoes[0], /e\.date >= \?/);
  assert.match(r.condicoes[1], /EXISTS/);
  assert.equal(r.condicoes[2], 'e.league_id = ?');
  assert.deepEqual(r.params, [
    '2026-11-25 12:00:00',
    '%commander%', '%commander%', '%commander%', '%commander%', '%commander%',
    'liga-1',
  ]);
});
