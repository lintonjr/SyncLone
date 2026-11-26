const test = require('node:test');
const assert = require('node:assert');
const { celula, linhas } = require('../src/lib/csv');

// O CSV do evento nasce para ser aberto no Excel, e nome de torneio, de jogador
// e de deck são texto livre de quem se inscreve. A rota que o gera é pública.
// Estes testes cobrem as duas coisas que isso exige: que fórmula não execute, e
// que o arquivo continue sendo um CSV válido.

test('csv: célula comum passa intacta', () => {
  assert.equal(celula('Ana Ribeiro'), 'Ana Ribeiro');
  assert.equal(celula('Burn'), 'Burn');
  assert.equal(celula(3), '3');
});

test('csv: vazio e ausente viram célula vazia, não "null"', () => {
  assert.equal(celula(null), '');
  assert.equal(celula(undefined), '');
  assert.equal(celula(''), '');
});

test('csv: fórmula é neutralizada na entrada da célula', () => {
  // O caso que motivou o módulo: a planilha executaria isto ao abrir.
  assert.equal(
    celula('=HYPERLINK("http://malicioso","Classificação")'),
    '"\'=HYPERLINK(""http://malicioso"",""Classificação"")"'
  );
});

test('csv: os cinco inícios perigosos ganham apóstrofo', () => {
  assert.equal(celula('=1+1'), "'=1+1");
  assert.equal(celula('+1'), "'+1");
  assert.equal(celula('-1'), "'-1");
  assert.equal(celula('@SUM(A1)'), "'@SUM(A1)");
  // Tabulação e CR entram porque o Excel os ignora antes de olhar o primeiro
  // caractere de verdade.
  assert.equal(celula('\t=1+1'), "'\t=1+1");
  assert.equal(celula('\r=1+1'), "'\r=1+1");
});

test('csv: o perigo é só no começo', () => {
  // Neutralizar no meio da frase estragaria texto legítimo sem ganho nenhum.
  assert.equal(celula('Deck A+B'), 'Deck A+B');
  assert.equal(celula('2-1 na final'), '2-1 na final');
  assert.equal(celula('contato@loja.com'), 'contato@loja.com');
});

test('csv: neutraliza primeiro, cita depois', () => {
  // Na ordem inversa sairia `'"=1,2"`, com o apóstrofo fora das aspas, onde ele
  // não protege nada.
  assert.equal(celula('=1,2'), '"\'=1,2"');
  assert.ok(celula('=1,2').startsWith('"\''), 'o apóstrofo tem de estar dentro das aspas');
});

test('csv: a citação continua valendo para quem precisa dela', () => {
  assert.equal(celula('Ribeiro, Ana'), '"Ribeiro, Ana"');
  assert.equal(celula('Deck "Burn"'), '"Deck ""Burn"""');
  assert.equal(celula('uma\nlinha'), '"uma\nlinha"');
  // Ponto e vírgula: o Excel em português usa ele como separador.
  assert.equal(celula('a;b'), '"a;b"');
});

test('csv: as linhas saem com CRLF e terminam com quebra', () => {
  assert.equal(linhas([['a', 'b'], ['c', 'd']]), 'a,b\r\nc,d\r\n');
});

test('csv: uma linha inteira de nomes maliciosos sai inofensiva', () => {
  const saida = linhas([['Jogador', 'Deck'], ['=cmd|calc', '+1']]);
  // Nenhuma célula do arquivo começa com um caractere de fórmula.
  for (const linha of saida.trim().split('\r\n')) {
    for (const campo of linha.split(',')) {
      assert.ok(!/^[=+\-@\t\r]/.test(campo), `célula perigosa: ${campo}`);
    }
  }
});
