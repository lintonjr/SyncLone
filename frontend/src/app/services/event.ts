import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';

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
  pairing_method: string;
  playoff_structure: string;
  allow_byes: number;
  test_event: number;
  collaborative_deck: number;
  async_draws: number;
  confirm_players: number;
  qr_code_enabled: number;
  pod_size: number;
  points_win: number;
  points_draw: number;
  points_loss: number;
  status: string;
  current_round: number;
  champion_id?: string;
  owner_id: string;
  owner_name?: string;
  player_count?: number;
  players?: Player[];
  rounds?: Round[];
  pairings?: Pairing[];
}

export interface Player {
  id: string;
  event_id: string;
  user_id: string;
  display_name: string;
  deck_name?: string;
  status: string;
  wins: number;
  losses: number;
  draws: number;
  points: number;
}

export interface Round {
  id: string;
  event_id: string;
  round_number: number;
  status: string;
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
  table_number: number;
  p1_name?: string;
  p2_name?: string;
  p3_name?: string;
  p4_name?: string;
}

@Injectable({ providedIn: 'root' })
export class EventService {
  private readonly API = `${environment.apiUrl}/events`;

  constructor(private http: HttpClient) {}

  private authHeaders(): HttpHeaders {
    const token = localStorage.getItem('token');
    return new HttpHeaders({ Authorization: `Bearer ${token}` });
  }

  getEvents(query?: string, past?: boolean) {
    let params = new HttpParams();
    if (query) params = params.set('q', query);
    if (past) params = params.set('past', 'true');
    return this.http.get<TournamentEvent[]>(this.API, { params });
  }

  getEvent(id: string) {
    return this.http.get<TournamentEvent>(`${this.API}/${id}`);
  }

  // Pings whenever this event changes server-side; caller re-fetches via getEvent() on each tick.
  streamEvent(id: string): Observable<void> {
    return new Observable<void>((subscriber) => {
      const es = new EventSource(`${this.API}/${id}/stream`);
      es.onmessage = () => subscriber.next();
      return () => es.close();
    });
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
      { headers: this.authHeaders() }
    );
  }

  startRound(eventId: string) {
    return this.http.post(`${this.API}/${eventId}/rounds`, {}, { headers: this.authHeaders() });
  }

  startPlayoffs(eventId: string) {
    return this.http.post(`${this.API}/${eventId}/playoffs/start`, {}, { headers: this.authHeaders() });
  }

  undoRound(eventId: string) {
    return this.http.post(`${this.API}/${eventId}/rounds/undo`, {}, { headers: this.authHeaders() });
  }

  swapPlayers(eventId: string, player1Id: string, player2Id: string) {
    return this.http.post(
      `${this.API}/${eventId}/rounds/swap`,
      { player1Id, player2Id },
      { headers: this.authHeaders() }
    );
  }

  submitResult(eventId: string, pairingId: string, result: string) {
    return this.http.put(
      `${this.API}/${eventId}/pairings/${pairingId}`,
      { result },
      { headers: this.authHeaders() }
    );
  }

  approveResult(eventId: string, pairingId: string) {
    return this.http.post(
      `${this.API}/${eventId}/pairings/${pairingId}/approve`,
      {},
      { headers: this.authHeaders() }
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

  finishEvent(eventId: string) {
    return this.http.post(`${this.API}/${eventId}/finish`, {}, { headers: this.authHeaders() });
  }
}
