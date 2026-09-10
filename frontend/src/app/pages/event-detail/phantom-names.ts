/**
 * Gerador de nomes para os jogadores-fantasma.
 *
 * Isto é massa de teste do organizador, não regra de torneio: vivia dentro do
 * componente da tela de evento só porque foi ali que nasceu. Sai daqui um nome
 * de cada vez, sem repetir enquanto houver combinação disponível.
 */
const FIRST = [
  'Alice',
  'Bob',
  'Carlos',
  'Diana',
  'Eduardo',
  'Fernanda',
  'Gabriel',
  'Helena',
  'Igor',
  'Juliana',
  'Klaus',
  'Laura',
  'Marcos',
  'Natalia',
  'Oscar',
  'Paula',
  'Rafael',
  'Sabrina',
  'Thiago',
  'Ursula',
  'Victor',
  'Wendy',
  'Xavier',
  'Yasmin',
  'Zara',
  'André',
  'Beatriz',
  'Caio',
  'Débora',
  'Élton',
  'Fátima',
  'Gustavo',
  'Hígor',
  'Isabela',
  'João',
  'Keila',
  'Leandro',
  'Mariana',
  'Nando',
  'Olivia',
  'Pedro',
  'Quésia',
  'Rodrigo',
  'Sofia',
  'Tânia',
  'Ugo',
  'Vanessa',
  'Wilson',
];

const LAST = [
  'Silva',
  'Santos',
  'Oliveira',
  'Souza',
  'Rodrigues',
  'Ferreira',
  'Alves',
  'Lima',
  'Costa',
  'Pereira',
  'Carvalho',
  'Melo',
  'Ribeiro',
  'Almeida',
  'Nascimento',
  'Gomes',
  'Martins',
  'Araújo',
  'Monteiro',
  'Barbosa',
  'Cardoso',
  'Cavalcanti',
  'Moreira',
  'Nunes',
  'Correia',
  'Dias',
  'Duarte',
  'Cunha',
  'Freitas',
  'Pinto',
];

/** Fábrica com memória própria: cada tela tem a sua, e não vazam entre eventos. */
export function phantomNameGenerator(): () => string {
  const usados = new Set<string>();
  const pick = <T>(arr: T[]) => arr[Math.floor(Math.random() * arr.length)];

  return () => {
    let nome: string;
    let tentativas = 0;
    do {
      nome = `${pick(FIRST)} ${pick(LAST)}`;
      tentativas++;
    } while (usados.has(nome) && tentativas < 200);
    usados.add(nome);
    return nome;
  };
}

/** Quantos nomes distintos o gerador consegue produzir. */
export const PHANTOM_NAME_CAPACITY = FIRST.length * LAST.length;
