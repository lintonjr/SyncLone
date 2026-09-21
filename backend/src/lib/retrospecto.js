/**
 * O retrospecto: a conta de aproveitamento, num lugar só.
 *
 * Empate vale meia vitória, como no MTR. A fórmula mora aqui porque agora ela
 * responde a três perguntas diferentes — o aproveitamento geral do jogador, o
 * dele com cada deck e o de cada deck na liga — e a mesma conta escrita em três
 * lugares é a classe de defeito que este projeto já pagou caro: enquanto ninguém
 * mexe, todas concordam; quando alguém mexe em uma, as outras discordam em
 * silêncio.
 */

/** `null` sem partida jogada: a tela mostra "—" em vez de 0%. */
function aproveitamento({ wins = 0, draws = 0, matches = 0 }) {
  return matches ? (wins + draws / 2) / matches : null;
}

/** Chave de agrupamento de deck: "Aggro Boros" e "aggro boros " são o mesmo deck. */
const chaveDoDeck = (nome) => (nome ?? '').trim().toLowerCase();

/**
 * Agrupa participações por deck.
 *
 * Cada participação é uma inscrição num torneio: o deck registrado, o retrospecto
 * daquele evento, quem jogou e se foi campeão. Entram convidados sem conta — um
 * deck não depende de quem o pilotou ter cadastro — e entra quem deu drop, porque
 * as partidas que ele jogou aconteceram.
 *
 * O nome exibido é a grafia mais usada: com texto livre, "Aggro Boros" aparece
 * cinco vezes e "aggro boros" uma, e mostrar a minoritária pareceria erro. No
 * empate vale a primeira digitada (a ordenação é estável), e não a ordem
 * alfabética — que escolheria a versão em minúsculas.
 *
 * Ordem: mais jogado primeiro (é a leitura de metagame), depois melhor
 * aproveitamento, depois nome — para a lista não dançar entre dois carregamentos.
 */
function agruparDecks(participacoes) {
  const grupos = new Map();

  for (const p of participacoes) {
    const chave = chaveDoDeck(p.deck_name);
    if (!chave) continue;

    const atual = grupos.get(chave) ?? {
      grafias: new Map(),
      participacoes: 0,
      jogadores: new Set(),
      wins: 0,
      losses: 0,
      draws: 0,
      titulos: 0,
    };

    const grafia = (p.deck_name ?? '').trim();
    atual.grafias.set(grafia, (atual.grafias.get(grafia) ?? 0) + 1);
    atual.participacoes += 1;
    if (p.jogador) atual.jogadores.add(p.jogador);
    atual.wins += p.wins ?? 0;
    atual.losses += p.losses ?? 0;
    atual.draws += p.draws ?? 0;
    if (p.campeao) atual.titulos += 1;

    grupos.set(chave, atual);
  }

  return [...grupos.values()]
    .map((g) => {
      const matches = g.wins + g.losses + g.draws;
      const [nome] = [...g.grafias.entries()].sort((a, b) => b[1] - a[1])[0];
      return {
        deck: nome,
        participacoes: g.participacoes,
        jogadores: g.jogadores.size,
        wins: g.wins,
        losses: g.losses,
        draws: g.draws,
        matches,
        win_rate: aproveitamento({ wins: g.wins, draws: g.draws, matches }),
        titulos: g.titulos,
      };
    })
    .sort((a, b) => b.matches - a.matches || (b.win_rate ?? -1) - (a.win_rate ?? -1) || a.deck.localeCompare(b.deck));
}

module.exports = { aproveitamento, agruparDecks, chaveDoDeck };
