const test = require('node:test');
const assert = require('node:assert');
const { aproveitamento, agruparDecks, chaveDoDeck } = require('../src/lib/retrospecto');

// --- Aproveitamento ---

test('aproveitamento: empate vale meia vitória, como no MTR', () => {
  assert.equal(aproveitamento({ wins: 3, draws: 0, matches: 4 }), 0.75);
  assert.equal(aproveitamento({ wins: 3, draws: 1, matches: 4 }), 0.875);
  assert.equal(aproveitamento({ wins: 0, draws: 4, matches: 4 }), 0.5);
});

test('aproveitamento: sem partida é null, não zero', () => {
  // 0% e "ainda não jogou" são coisas diferentes na tela.
  assert.equal(aproveitamento({ wins: 0, draws: 0, matches: 0 }), null);
  assert.equal(aproveitamento({}), null);
});

// --- Agrupamento de decks ---

const part = (deck, wins, losses, draws, extra = {}) => ({
  deck_name: deck, wins, losses, draws, jogador: extra.jogador ?? 'j1', campeao: extra.campeao ?? false,
});

test('decks: soma as participações do mesmo deck e conta jogadores distintos', () => {
  const decks = agruparDecks([
    part('Aggro Boros', 3, 1, 0, { jogador: 'ana' }),
    part('Aggro Boros', 2, 2, 1, { jogador: 'bia' }),
    part('Aggro Boros', 1, 3, 0, { jogador: 'ana' }),
  ]);

  assert.equal(decks.length, 1);
  assert.deepEqual(
    { ...decks[0], win_rate: Number(decks[0].win_rate.toFixed(4)) },
    { deck: 'Aggro Boros', participacoes: 3, jogadores: 2, wins: 6, losses: 6, draws: 1, matches: 13, win_rate: 0.5, titulos: 0 },
  );
});

test('decks: grafias diferentes são o mesmo deck, e vence a mais usada', () => {
  const decks = agruparDecks([
    part('Aggro Boros', 1, 0, 0),
    part('aggro boros ', 1, 0, 0),
    part('Aggro Boros', 1, 0, 0),
  ]);
  assert.equal(decks.length, 1);
  assert.equal(decks[0].deck, 'Aggro Boros');
  assert.equal(decks[0].participacoes, 3);
});

test('decks: participação sem deck registrado não vira deck vazio', () => {
  const decks = agruparDecks([part(null, 2, 0, 0), part('   ', 1, 0, 0), part('Dimir Control', 1, 1, 0)]);
  assert.deepEqual(decks.map((d) => d.deck), ['Dimir Control']);
});

test('decks: convidado sem conta conta como jogador distinto', () => {
  // `jogador` chega como o id da inscrição quando não há conta.
  const decks = agruparDecks([
    part('Selesnya Tokens', 1, 0, 0, { jogador: 'inscricao-1' }),
    part('Selesnya Tokens', 0, 1, 0, { jogador: 'inscricao-2' }),
  ]);
  assert.equal(decks[0].jogadores, 2);
});

test('decks: título só conta quando aquela participação foi campeã', () => {
  const decks = agruparDecks([
    part('Mono Red', 4, 0, 0, { campeao: true }),
    part('Mono Red', 1, 2, 0),
  ]);
  assert.equal(decks[0].titulos, 1);
});

test('decks: ordem é mais jogado, depois melhor aproveitamento, depois nome', () => {
  const decks = agruparDecks([
    part('Pouco Jogado', 1, 0, 0),
    part('Muito Jogado', 2, 3, 0),
    part('Muito Jogado', 2, 3, 0),
    part('Meio Jogado A', 2, 1, 0),
    part('Meio Jogado B', 1, 2, 0),
  ]);
  assert.deepEqual(decks.map((d) => d.deck), ['Muito Jogado', 'Meio Jogado A', 'Meio Jogado B', 'Pouco Jogado']);
});

test('decks: deck registrado sem partida aparece com aproveitamento nulo', () => {
  // Quem se inscreveu, registrou o deck e saiu antes da primeira rodada.
  const decks = agruparDecks([part('Esperando Rodada', 0, 0, 0)]);
  assert.equal(decks[0].matches, 0);
  assert.equal(decks[0].win_rate, null);
});

test('decks: a soma das partidas dos decks bate com a das participações', () => {
  const entradas = [part('A', 3, 1, 0), part('B', 2, 2, 1), part('A', 0, 1, 1), part(null, 5, 5, 5)];
  const totalParticipacoes = entradas
    .filter((p) => chaveDoDeck(p.deck_name))
    .reduce((t, p) => t + p.wins + p.losses + p.draws, 0);
  const totalDecks = agruparDecks(entradas).reduce((t, d) => t + d.matches, 0);
  assert.equal(totalDecks, totalParticipacoes);
});

test('decks: empate de grafia mantém a primeira digitada, não a alfabética', () => {
  // "Atraxa" e "atraxa" uma vez cada: alfabético escolheria a minúscula, que
  // parece erro de digitação na tela.
  const decks = agruparDecks([part('Atraxa', 1, 0, 0), part('atraxa ', 0, 1, 0)]);
  assert.equal(decks[0].deck, 'Atraxa');
});
