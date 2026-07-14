import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { environment } from '../../environments/environment';

export interface League {
  id: string;
  name: string;
  owner_id: string;
  owner_name?: string;
  playoff_counts: number;
  created_at: string;
  event_count?: number;
}

export interface LeagueStanding {
  user_id: string;
  display_name: string;
  points: number;
  wins: number;
  losses: number;
  draws: number;
  events_played: number;
}

export interface LeagueEvent {
  id: string;
  name: string;
  date: string;
  status: string;
  thumbnail?: string;
  game: string;
  format?: string;
}

export interface LeagueDetail extends League {
  events: LeagueEvent[];
  standings: LeagueStanding[];
}

@Injectable({ providedIn: 'root' })
export class LeagueService {
  private readonly API = `${environment.apiUrl}/leagues`;

  constructor(private http: HttpClient) {}

  private authHeaders(): HttpHeaders {
    const token = localStorage.getItem('token');
    return new HttpHeaders({ Authorization: `Bearer ${token}` });
  }

  getLeagues() {
    return this.http.get<League[]>(this.API);
  }

  getMyLeagues() {
    return this.http.get<League[]>(`${this.API}/mine`, { headers: this.authHeaders() });
  }

  getLeague(id: string) {
    return this.http.get<LeagueDetail>(`${this.API}/${id}`);
  }

  createLeague(payload: { name: string; playoff_counts: boolean }) {
    return this.http.post<League>(this.API, payload, { headers: this.authHeaders() });
  }

  updateLeague(id: string, payload: { name: string; playoff_counts: boolean }) {
    return this.http.put<League>(`${this.API}/${id}`, payload, { headers: this.authHeaders() });
  }

  deleteLeague(id: string) {
    return this.http.delete(`${this.API}/${id}`, { headers: this.authHeaders() });
  }
}
