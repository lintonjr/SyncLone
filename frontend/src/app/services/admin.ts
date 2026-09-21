import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { environment } from '../../environments/environment';

/** Um pedido na fila do dono, com o contexto para decidi-lo. */
export interface OrganizerRequestRow {
  id: string;
  status: 'pending' | 'approved' | 'rejected';
  justification: string | null;
  reason: string | null;
  created_at: string;
  decided_at: string | null;
  decided_by_name: string | null;
  user_id: string;
  display_name: string;
  email: string;
  role: 'player' | 'organizer' | 'admin';
  user_since: string;
  /** Em quantos eventos a pessoa já jogou — quem pede sem nunca ter jogado é um sinal. */
  events_played: number;
}

/** Uma pessoa na área de usuários. */
export interface UserRow {
  id: string;
  display_name: string;
  email: string;
  role: 'player' | 'organizer' | 'admin';
  created_at: string;
  events_played: number;
  events_owned: number;
  /** Ligas de que é dona e ligas em que está no time. */
  leagues_owned: number;
  leagues_team: number;
}

export interface UsersPage {
  users: UserRow[];
  total: number;
  limit: number;
  offset: number;
}

/** Uma liga na ficha da pessoa: ela é dona ou está no time. */
export interface UserLeague {
  id: string;
  name: string;
  vinculo: 'dona' | 'time';
}

/** Uma linha do histórico de papel. */
export interface RoleChange {
  de: 'player' | 'organizer' | 'admin';
  para: 'player' | 'organizer' | 'admin';
  motivo: string | null;
  created_at: string;
  autor: string | null;
}

export interface UserDetail extends UserRow {
  profile_public: number;
  leagues: UserLeague[];
  role_history: RoleChange[];
}

/** Quem tem poder na plataforma hoje. */
export interface StaffRow {
  id: string;
  display_name: string;
  email: string;
  role: 'organizer' | 'admin';
  created_at: string;
  events_owned: number;
}

@Injectable({ providedIn: 'root' })
export class AdminService {
  private http = inject(HttpClient);
  private readonly API = `${environment.apiUrl}/admin`;

  private headers() {
    return new HttpHeaders({ Authorization: `Bearer ${localStorage.getItem('token')}` });
  }

  requests() {
    return this.http.get<OrganizerRequestRow[]>(`${this.API}/organizer-requests`, {
      headers: this.headers(),
    });
  }

  /** O motivo vale para os dois lados: aprovar também pode vir com recado. */
  decide(id: string, decisao: 'approve' | 'reject', reason: string) {
    return this.http.post<OrganizerRequestRow>(
      `${this.API}/organizer-requests/${id}/${decisao}`,
      { reason },
      { headers: this.headers() },
    );
  }

  staff() {
    return this.http.get<StaffRow[]>(`${this.API}/staff`, { headers: this.headers() });
  }

  /** A lista da área de usuários: busca e filtro são resolvidos no servidor. */
  users(params: { q?: string; role?: string; limit?: number; offset?: number } = {}) {
    const query = new URLSearchParams();
    if (params.q) query.set('q', params.q);
    if (params.role) query.set('role', params.role);
    query.set('limit', String(params.limit ?? 25));
    query.set('offset', String(params.offset ?? 0));
    return this.http.get<UsersPage>(`${this.API}/users?${query}`, { headers: this.headers() });
  }

  /** A ficha: ligas em que a pessoa manda e o histórico do papel dela. */
  userDetail(id: string) {
    return this.http.get<UserDetail>(`${this.API}/users/${id}`, { headers: this.headers() });
  }

  changeRole(userId: string, role: 'player' | 'organizer' | 'admin', reason = '') {
    return this.http.put<StaffRow>(
      `${this.API}/users/${userId}/role`,
      { role, reason },
      { headers: this.headers() },
    );
  }
}
