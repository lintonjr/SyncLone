/**
 * Fixtures mínimas para os testes de template.
 *
 * A ideia é montar um evento plausível com o menor número de campos escritos à
 * mão: cada helper preenche o resto com um padrão neutro, e o teste declara só
 * o que interessa para o caso. Isso mantém o teste legível — quem lê vê a regra
 * sendo testada, não trinta linhas de objeto.
 */
import { TournamentEvent, Player, Pairing, Round, Clan, ClanStanding } from '../services/event';

export function umEvento(over: Partial<TournamentEvent> = {}): TournamentEvent {
  return {
    id: 'ev1',
    name: 'Torneio de Teste',
    online: 0,
    date: '2026-10-01T20:00:00.000Z',
    game: 'Magic',
    format: 'Commander',
    tournament_format: 'standard',
    pairing_method: 'swiss',
    playoff_structure: 'none',
    allow_byes: 1,
    test_event: 0,
    collaborative_deck: 0,
    async_draws: 0,
    confirm_players: 0,
    qr_code_enabled: 0,
    pod_size: 2,
    round_minutes: 50,
    points_win: 3,
    points_draw: 1,
    points_loss: 0,
    status: 'ongoing',
    current_round: 1,
    owner_id: 'dono',
    players: [],
    rounds: [],
    pairings: [],
    clans: [],
    clan_standings: [],
    swiss_rounds_total: 1,
    ...over,
  } as TournamentEvent;
}

export function umJogador(over: Partial<Player> = {}): Player {
  return {
    id: 'p1',
    event_id: 'ev1',
    user_id: 'u1',
    profile_public: 1,
    display_name: 'Jogador',
    status: 'active',
    wins: 0,
    losses: 0,
    draws: 0,
    points: 0,
    matches_played: 0,
    swiss_rounds_seated: 1,
    mwp: 1 / 3,
    omw: null,
    gwp: null,
    ogw: null,
    ...over,
  } as Player;
}

export function umaRodada(over: Partial<Round> = {}): Round {
  return {
    id: 'r1',
    event_id: 'ev1',
    round_number: 1,
    status: 'active',
    created_at: '2026-10-01T20:00:00.000Z',
    timer_started_at: null,
    is_playoff: 0,
    playoff_stage: null,
    ...over,
  } as Round;
}

export function umaMesa(over: Partial<Pairing> = {}): Pairing {
  return {
    id: 'm1',
    event_id: 'ev1',
    round_id: 'r1',
    table_number: 1,
    player1_id: 'p1',
    player2_id: 'p2',
    player3_id: null,
    player4_id: null,
    p1_name: 'Jogador 1',
    p2_name: 'Jogador 2',
    p3_name: null,
    p4_name: null,
    result: null,
    result_status: 'confirmed',
    p1_games: null,
    p2_games: null,
    ...over,
  } as Pairing;
}

export const umCla = (over: Partial<Clan> = {}): Clan =>
  ({ id: 'c1', event_id: 'ev1', name: 'Dragões', ...over }) as Clan;

export const umaLinhaDeCla = (over: Partial<ClanStanding> = {}): ClanStanding =>
  ({
    id: 'c1',
    name: 'Dragões',
    players: [],
    player_count: 4,
    points: 0,
    wins: 0,
    losses: 0,
    draws: 0,
    mwp: 1 / 3,
    omw: null,
    gwp: null,
    ogw: null,
    ...over,
  }) as ClanStanding;
