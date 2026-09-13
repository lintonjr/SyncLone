import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

export type EventSignal = 'update' | 'deleted';

export interface TournamentEvent {
  id: string;
  name: string;
  description?: string;
  city?: string;
  address?: string;
  online: number;
  thumbnail?: string;
  date: string;
  game: string;
  format?: string;
  tournament_format: 'standard' | 'clafronto' | 'partner';
  pairing_method: string;
  playoff_structure: string;
  allow_byes: number;
  test_event: number;
  collaborative_deck: number;
  async_draws: number;
  confirm_players: number;
  qr_code_enabled: number;
  league_id?: string | null;
  league_name?: string;
  pod_size: number;
  round_minutes: number;
  points_win: number;
  points_draw: number;
  points_loss: number;
  status: string;
  current_round: number;
  champion_id?: string;
  champion_clan_id?: string | null;
  owner_id: string;
  owner_name?: string;
  player_count?: number;
  players?: Player[];
  rounds?: Round[];
  pairings?: Pairing[];
  clans?: Clan[];
  clan_standings?: ClanStanding[];
  // Rodadas suíças do evento — o mata-mata fica de fora, porque é seletivo e
  // não serve de régua para saber quem entrou depois.
  swiss_rounds_total?: number;
}

export interface Clan {
  id: string;
  event_id: string;
  name: string;
}

// Tabela principal do Clã Fronto: a soma dos quatro membros.
export interface ClanStanding {
  id: string;
  name: string;
  players: Player[];
  player_count: number;
  points: number;
  wins: number;
  losses: number;
  draws: number;
  mwp: number | null;
  omw: number | null;
  gwp: number | null;
  ogw: number | null;
}

export interface Player {
  id: string;
  event_id: string;
  clan_id?: string | null;
  // Nulo em convidados: metade das inscrições do sistema não tem conta por trás,
  // e é essa diferença que decide se o nome vira link para o perfil.
  user_id: string | null;
  // Preferência do titular. Nulo em convidados, que não têm conta nem perfil.
  profile_public?: number | null;
  display_name: string;
  deck_name?: string;
  status: string;
  wins: number;
  losses: number;
  draws: number;
  points: number;
  // Desempates oficiais, calculados pelo servidor (MTR 2.3). Nulos quando não há
  // dado suficiente: sem adversários enfrentados, ou sem placar de games registrado.
  matches_played: number;
  // rodadas em que o jogador teve assento — menor que o total = entrou depois
  swiss_rounds_seated: number;
  mwp: number;
  omw: number | null;
  gwp: number | null;
  ogw: number | null;
}

export interface Round {
  id: string;
  event_id: string;
  round_number: number;
  status: string;
  created_at: string;
  // null enquanto o organizador não soltar o cronômetro
  timer_started_at: string | null;
  is_playoff: number;
  playoff_stage?: string;
}

export interface Pairing {
  id: string;
  round_id: string;
  event_id: string;
  player1_id: string;
  player2_id?: string;
  player3_id?: string;
  player4_id?: string;
  result?: string;
  result_status?: 'pending' | 'confirmed';
  p1_games?: number | null;
  p2_games?: number | null;
  table_number: number;
  p1_name?: string;
  p2_name?: string;
  p3_name?: string;
  p4_name?: string;
  /**
   * Quem venceu a mesa, por inscrição. Vem do servidor porque numa mesa de
   * duplas são dois, e a regra que sabe disso é a mesma que distribui os pontos.
   */
  winner_ids?: string[];
}

@Injectable({ providedIn: 'root' })
export class EventService {
  private readonly API = `${environment.apiUrl}/events`;

  constructor(private http: HttpClient) {}

  private authHeaders(): HttpHeaders {
    const token = localStorage.getItem('token');
    return new HttpHeaders({ Authorization: `Bearer ${token}` });
  }

  getEvents(query?: string, past?: boolean, offset = 0, limit = 24) {
    let params = new HttpParams().set('offset', offset).set('limit', limit);
    if (query) params = params.set('q', query);
    if (past) params = params.set('past', 'true');
    return this.http.get<TournamentEvent[]>(this.API, { params });
  }

  exportUrl(eventId: string, type: 'standings' | 'pairings' | 'clans') {
    return `${this.API}/${eventId}/export?type=${type}`;
  }

  getEvent(id: string) {
    return this.http.get<TournamentEvent>(`${this.API}/${id}`);
  }

  // Avisa sempre que o evento muda no servidor. 'update' pede um re-fetch via
  // getEvent(); 'deleted' diz que o evento deixou de existir — a tela precisa
  // sair, porque recarregar só traria um 404.
  streamEvent(id: string): Observable<EventSignal> {
    return new Observable<EventSignal>((subscriber) => {
      const es = new EventSource(`${this.API}/${id}/stream`);
      es.onmessage = (e) => subscriber.next(e.data === 'deleted' ? 'deleted' : 'update');
      return () => es.close();
    });
  }

  /** Organizador aponta de que conta é a inscrição de um convidado. */
  linkGuest(eventId: string, playerId: string, email: string) {
    return this.http.put(
      `${this.API}/${eventId}/players/${playerId}/link`,
      { email },
      { headers: this.authHeaders() },
    );
  }

  createEvent(formData: FormData) {
    return this.http.post<TournamentEvent>(this.API, formData, {
      headers: this.authHeaders(),
    });
  }

  updateEvent(id: string, formData: FormData) {
    return this.http.put<TournamentEvent>(`${this.API}/${id}`, formData, {
      headers: this.authHeaders(),
    });
  }

  deleteEvent(id: string) {
    return this.http.delete(`${this.API}/${id}`, { headers: this.authHeaders() });
  }

  joinEvent(id: string) {
    return this.http.post(`${this.API}/${id}/join`, {}, { headers: this.authHeaders() });
  }

  leaveEvent(id: string) {
    return this.http.delete(`${this.API}/${id}/join`, { headers: this.authHeaders() });
  }

  getMyEvents() {
    return this.http.get<{ owned: TournamentEvent[]; joined: TournamentEvent[] }>(
      `${this.API}/user/mine`,
      { headers: this.authHeaders() },
    );
  }

  startRound(eventId: string) {
    return this.http.post(`${this.API}/${eventId}/rounds`, {}, { headers: this.authHeaders() });
  }

  startPlayoffs(eventId: string) {
    return this.http.post(
      `${this.API}/${eventId}/playoffs/start`,
      {},
      { headers: this.authHeaders() },
    );
  }

  // Solta o cronômetro da rodada — separado de criá-la, para os jogadores terem
  // tempo de achar a mesa antes do relógio correr.
  startRoundTimer(eventId: string, roundId: string) {
    return this.http.post(
      `${this.API}/${eventId}/rounds/${roundId}/timer`,
      {},
      { headers: this.authHeaders() },
    );
  }

  undoRound(eventId: string) {
    return this.http.post(
      `${this.API}/${eventId}/rounds/undo`,
      {},
      { headers: this.authHeaders() },
    );
  }

  swapPlayers(eventId: string, player1Id: string, player2Id: string) {
    return this.http.post(
      `${this.API}/${eventId}/rounds/swap`,
      { player1Id, player2Id },
      { headers: this.authHeaders() },
    );
  }

  submitResult(
    eventId: string,
    pairingId: string,
    result: string,
    games?: { p1: number; p2: number },
  ) {
    return this.http.put(
      `${this.API}/${eventId}/pairings/${pairingId}`,
      games ? { result, p1_games: games.p1, p2_games: games.p2 } : { result },
      { headers: this.authHeaders() },
    );
  }

  approveResult(eventId: string, pairingId: string) {
    return this.http.post(
      `${this.API}/${eventId}/pairings/${pairingId}/approve`,
      {},
      { headers: this.authHeaders() },
    );
  }

  updatePlayer(eventId: string, playerId: string, data: Partial<Player>) {
    return this.http.put(`${this.API}/${eventId}/players/${playerId}`, data, {
      headers: this.authHeaders(),
    });
  }

  removePlayer(eventId: string, playerId: string) {
    return this.http.delete(`${this.API}/${eventId}/players/${playerId}`, {
      headers: this.authHeaders(),
    });
  }

  addPlayer(eventId: string, data: { email?: string; display_name?: string }) {
    return this.http.post(`${this.API}/${eventId}/players`, data, {
      headers: this.authHeaders(),
    });
  }

  // Clã Fronto: o clã entra inteiro, com quatro e-mails de contas existentes —
  // ou quatro nomes, quando é o organizador cadastrando convidados.
  createClan(
    eventId: string,
    payload: { name: string; emails?: string[]; display_names?: string[] },
  ) {
    return this.http.post<Clan>(`${this.API}/${eventId}/clans`, payload, {
      headers: this.authHeaders(),
    });
  }

  deleteClan(eventId: string, clanId: string) {
    return this.http.delete(`${this.API}/${eventId}/clans/${clanId}`, {
      headers: this.authHeaders(),
    });
  }

  finishEvent(eventId: string) {
    return this.http.post(`${this.API}/${eventId}/finish`, {}, { headers: this.authHeaders() });
  }
}
