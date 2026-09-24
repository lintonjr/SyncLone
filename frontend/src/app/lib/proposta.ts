/**
 * A prévia da proposta enquanto o avaliador digita.
 *
 * Isto é um **espelho** de `valoresDaProposta` em `backend/src/lib/avaliacao.js`,
 * e a duplicação é consciente: o backend é CommonJS e não há build compartilhado
 * entre as duas pontas. O que vale é sempre o número que o servidor devolve e
 * grava — aqui só antecipamos o que ele vai responder, para que ninguém confirme
 * uma proposta sem ver quanto ela paga.
 *
 * Por isso `proposta.spec.ts` repete os mesmos casos de `backend/test/avaliacao.test.js`:
 * o dia em que uma das pontas mudar de regra, é um teste que avisa, não o cliente.
 */

/**
 * Converte para centavos inteiros, aceitando vírgula ou ponto.
 *
 * `null` quando não é um valor: daqui para dentro é tudo inteiro, porque
 * `0.1 + 0.2` não pode decidir quanto a loja paga a alguém.
 */
export function emCentavos(valor: string | number | null | undefined): number | null {
  if (valor === null || valor === undefined || valor === '') return null;
  const texto = String(valor).trim().replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(texto)) return null;
  const [inteira, decimal = ''] = texto.split('.');
  return Number(inteira) * 100 + Number(decimal.padEnd(2, '0'));
}

/** De centavos para o texto de duas casas que a tela mostra. */
export const paraDecimal = (centavos: number): string =>
  `${Math.trunc(centavos / 100)}.${String(centavos % 100).padStart(2, '0')}`;

/**
 * Quanto sai por um percentual, arredondado meio-para-cima em centavos.
 *
 * R$ 33,33 a 50% dá R$ 16,67 e não R$ 16,66 — a diferença é do cliente.
 * Devolve '' quando o valor ou o percentual ainda não formam uma proposta,
 * para a tela simplesmente não mostrar prévia em vez de mostrar "NaN".
 */
export function parteDaProposta(
  valorBruto: string | number | null | undefined,
  percentual: number | null | undefined,
): string {
  const bruto = emCentavos(valorBruto);
  if (bruto === null || bruto <= 0) return '';
  if (!Number.isInteger(percentual) || percentual! < 1 || percentual! > 100) return '';
  return paraDecimal(Math.round((bruto * percentual!) / 100));
}
