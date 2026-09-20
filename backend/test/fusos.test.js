const test = require('node:test');
const assert = require('node:assert');
const { FUSO_PADRAO, fusoValido, fusoOuPadrao } = require('../src/lib/fusos');

test('fusos: nomes IANA de verdade passam, invenções não', () => {
  for (const bom of ['America/Manaus', 'America/Sao_Paulo', 'UTC', 'Europe/Lisbon', 'America/New_York']) {
    assert.equal(fusoValido(bom), true, bom);
  }
  for (const ruim of ['America/Manaus2', 'GMT-4', '-04:00', 'Brasil/Manaus', '', '   ', null, undefined, 42]) {
    assert.equal(fusoValido(ruim), false, String(ruim));
  }
});

test('fusos: sem fuso válido, vale o da loja', () => {
  assert.equal(fusoOuPadrao(undefined), FUSO_PADRAO);
  assert.equal(fusoOuPadrao('Marte/Olympus'), FUSO_PADRAO);
  assert.equal(fusoOuPadrao('  America/Sao_Paulo  '), 'America/Sao_Paulo');
});

test('fusos: o padrão da loja é um fuso que o runtime conhece', () => {
  // Uma constante errada aqui só apareceria no primeiro evento criado.
  assert.equal(fusoValido(FUSO_PADRAO), true);
});

// --- O fuso chegando pela API ---

const schemas = require('../src/schemas');

test('fusos: o schema do evento aceita nome IANA e recusa deslocamento', () => {
  const base = { name: 'Torneio', date: '2026-10-03T00:00:00.000Z', game: 'Magic' };
  assert.equal(schemas.createEvent.parse({ ...base, timezone: 'America/Manaus' }).timezone, 'America/Manaus');
  // Sem fuso continua válido: a rota assume o da loja.
  assert.equal(schemas.createEvent.parse(base).timezone, undefined);
  // Campo vazio do formulário multipart não vira erro.
  assert.equal(schemas.createEvent.parse({ ...base, timezone: '' }).timezone, undefined);
  for (const ruim of ['GMT-4', '-04:00', 'Brasil/Manaus']) {
    assert.throws(() => schemas.createEvent.parse({ ...base, timezone: ruim }), /fuso/i, ruim);
  }
});

test('fusos: a API exige fuso na data — texto ambíguo é recusado', () => {
  const base = { name: 'Torneio', game: 'Magic' };
  // Sem fuso, o servidor leria no fuso dele: é o defeito que gerou este trabalho.
  assert.throws(() => schemas.createEvent.parse({ ...base, date: '2026-10-02T20:00:00' }), /fuso/);
  assert.throws(() => schemas.createEvent.parse({ ...base, date: '2026-10-02' }), /fuso/);
  for (const bom of ['2026-10-03T00:00:00.000Z', '2026-10-02T20:00:00-04:00', '2026-10-02T20:00:00-0400']) {
    assert.equal(schemas.createEvent.parse({ ...base, date: bom }).date, bom);
  }
});
