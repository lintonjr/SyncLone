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

  changeRole(userId: string, role: 'player' | 'organizer' | 'admin') {
    return this.http.put<StaffRow>(
      `${this.API}/users/${userId}/role`,
      { role },
      { headers: this.headers() },
    );
  }
}
