/**
 * Aproveitamento e agrupamento por deck, do lado da tela.
 *
 * É o espelho de `backend/src/lib/retrospecto.js`: mesma fórmula (empate vale
 * meia vitória, como no MTR) e mesma regra de agrupamento de nome. O perfil
 * calcula aqui porque os dados por evento já chegam no payload — pedir ao
 * servidor um número que a tela já tem seria uma volta inútil. A liga calcula lá,
 * porque ali são dezenas de torneios que o navegador não recebe.
 */

export interface RetrospectoDoDeck {
  deck: string;
  eventos: number;
  wins: number;
  losses: number;
  draws: number;
  matches: number;
  /** `null` enquanto não houver partida jogada com o deck. */
  win_rate: number | null;
}

/** Uma participação num torneio, do ponto de vista do deck. */
export interface ParticipacaoDeDeck {
  deck_name?: string | null;
  wins: number;
  losses: number;
  draws: number;
}

export function aproveitamento({ wins = 0, draws = 0, matches = 0 }): number | null {
  return matches ? (wins + draws / 2) / matches : null;
}

/** Percentual com uma casa, ou travessão quando ainda não houve partida. */
export function formatarAproveitamento(valor: number | null | undefined): string {
  return valor === null || valor === undefined ? '—' : `${(valor * 100).toFixed(1)}%`;
}

/** "Aggro Boros" e "aggro boros " são o mesmo deck. */
export const chaveDoDeck = (nome: string | null | undefined): string =>
  (nome ?? '').trim().toLowerCase();

/**
 * Agrupa as participações por deck, somando o retrospecto de cada uma.
 *
 * Ordem: mais jogado primeiro, depois melhor aproveitamento, depois nome — a
 * mesma do ranking de decks da liga, para as duas telas lerem igual. O nome
 * exibido é a grafia mais usada e, no empate, a primeira digitada.
 */
export function agruparDecks(participacoes: ParticipacaoDeDeck[]): RetrospectoDoDeck[] {
  const grupos = new Map<
    string,
    { grafias: Map<string, number>; eventos: number; wins: number; losses: number; draws: number }
  >();

  for (const p of participacoes) {
    const chave = chaveDoDeck(p.deck_name);
    if (!chave) continue;

    const atual = grupos.get(chave) ?? {
      grafias: new Map(),
      eventos: 0,
      wins: 0,
      losses: 0,
      draws: 0,
    };
    const grafia = (p.deck_name ?? '').trim();
    atual.grafias.set(grafia, (atual.grafias.get(grafia) ?? 0) + 1);
    atual.eventos += 1;
    atual.wins += p.wins ?? 0;
    atual.losses += p.losses ?? 0;
    atual.draws += p.draws ?? 0;
    grupos.set(chave, atual);
  }

  return [...grupos.values()]
    .map((g) => {
      const matches = g.wins + g.losses + g.draws;
      const [nome] = [...g.grafias.entries()].sort((a, b) => b[1] - a[1])[0];
      return {
        deck: nome,
        eventos: g.eventos,
        wins: g.wins,
        losses: g.losses,
        draws: g.draws,
        matches,
        win_rate: aproveitamento({ wins: g.wins, draws: g.draws, matches }),
      };
    })
    .sort(
      (a, b) =>
        b.matches - a.matches ||
        (b.win_rate ?? -1) - (a.win_rate ?? -1) ||
        a.deck.localeCompare(b.deck),
    );
}
