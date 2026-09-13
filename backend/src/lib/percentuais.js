/**
 * Comparação de percentuais de desempate.
 *
 * Dois percentuais que diferem no último bit são o mesmo número. Os desempates
 * do MTR são médias de frações — 2/3, 19/30 — e a mesma fração calculada por
 * caminhos diferentes cai em bits diferentes. Comparar com `-` faz o `sort`
 * tratar essa diferença de 1e-16 como desempate real: ele decide ali e nunca
 * chega ao critério seguinte, então dois competidores empatados de verdade ficam
 * ordenados por ruído.
 *
 * E o ruído não é estável entre consultas. Foi assim que o chaveamento do
 * mata-mata passou a discordar da tabela exibida na tela: duas leituras das
 * mesmas mesas, somadas em ordens diferentes, produziam ordens diferentes.
 *
 * A menor diferença real possível é ordens de grandeza maior que esta
 * tolerância: num torneio de 20 rodadas, 1/20 de uma vitória já é 0,0167.
 *
 * Vive num módulo próprio porque os dois lados precisam dele — quem monta a
 * tabela e quem escolhe o bye — e `standings` já depende de `pairing`.
 */
const EPSILON = 1e-9;

/** Comparador decrescente que trata diferenças abaixo do epsilon como empate. */
const cmpPct = (a, b) => (Math.abs(a - b) < EPSILON ? 0 : b - a);

module.exports = { cmpPct, EPSILON };
