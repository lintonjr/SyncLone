/**
 * Os placares por games que uma mesa de duelo aceita, e o resultado que cada um
 * significa.
 *
 * Espelho de `backend/src/lib/placar.js`, pela mesma razão que
 * `lib/proposta.ts` espelha o cálculo da proposta: a tela precisa montar os
 * botões antes de falar com o servidor, e o número que vale é sempre o que o
 * servidor grava. Os dois lados são testados contra os mesmos casos, e quando
 * divergirem é o teste que avisa, não o organizador no balcão.
 *
 * A regra é a da loja: o placar DIZ o resultado. Quem fez mais games venceu,
 * placar igual é empate. Por isso cada opção aqui já carrega o resultado — a
 * tela não tem segunda pergunta a fazer, e não existe estado contraditório para
 * o servidor recusar.
 */

/** Um placar oferecido na tela, do ponto de vista de um dos lados. */
export interface OpcaoDePlacar {
  /** Rótulo curto do placar, como aparece no botão. */
  label: string;
  /** Games de quem está sendo apontado como autor do placar. */
  meus: number;
  /** Games do outro lado. */
  dele: number;
}

/** Placares que decidem a partida, do ponto de vista de quem venceu. */
export const VITORIAS: OpcaoDePlacar[] = [
  { label: '2-0', meus: 2, dele: 0 },
  { label: '2-1', meus: 2, dele: 1 },
  { label: '1-0', meus: 1, dele: 0 },
];

/** Placares de empate. Iguais dos dois lados, por definição. */
export const EMPATES: OpcaoDePlacar[] = [
  { label: '1-1', meus: 1, dele: 1 },
  { label: '0-0', meus: 0, dele: 0 },
];

/**
 * O placar como os assentos 1 e 2 da mesa, a partir de quem fez o que.
 *
 * `vencedorNoAssento1` diz se o lado apontado pela opção é o assento 1. É aqui
 * que a tela traduz "Ana fez 2-1" para `{ p1: 2, p2: 1 }` ou `{ p1: 1, p2: 2 }`,
 * e é o único lugar que faz essa tradução.
 */
export function placarPorAssento(
  opcao: OpcaoDePlacar,
  vencedorNoAssento1: boolean,
): { p1: number; p2: number } {
  return vencedorNoAssento1
    ? { p1: opcao.meus, p2: opcao.dele }
    : { p1: opcao.dele, p2: opcao.meus };
}

/** Quem venceu, lido do placar — a mesma regra do servidor. */
export function resultadoDoPlacar(p1: number, p2: number): 'player1' | 'player2' | 'draw' {
  if (p1 > p2) return 'player1';
  if (p2 > p1) return 'player2';
  return 'draw';
}

/** O rótulo do placar já registrado numa mesa, ou null quando não há. */
export function rotuloDoPlacar(
  p1?: number | null,
  p2?: number | null,
): string | null {
  if (p1 === null || p1 === undefined) return null;
  if (p2 === null || p2 === undefined) return null;
  return `${p1}-${p2}`;
}
