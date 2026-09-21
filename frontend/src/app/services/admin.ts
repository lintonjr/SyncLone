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
export type EstadoDaConta = 'ativa' | 'desativada' | 'anonimizada';

export interface UserRow {
  id: string;
  display_name: string;
  email: string;
  role: 'player' | 'organizer' | 'admin';
  status: EstadoDaConta;
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

/** Uma linha do histórico da conta: papel, nome, e-mail, senha, estado, visibilidade. */
export interface RoleChange {
  acao: 'papel' | 'nome' | 'email' | 'senha' | 'status' | 'visibilidade';
  de: string | null;
  para: string | null;
  motivo: string | null;
  created_at: string;
  autor: string | null;
}

/** Um torneio na atividade da pessoa, dentro da ficha. */
export interface AtividadeDoUsuario {
  id: string;
  name: string;
  date: string;
  timezone?: string;
  status: string;
  inscricao?: string;
}

export interface UserDetail extends UserRow {
  profile_public: number;
  must_change_password: boolean;
  leagues: UserLeague[];
  role_history: RoleChange[];
  jogados: AtividadeDoUsuario[];
  organizados: AtividadeDoUsuario[];
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

  /** Nome, e-mail e visibilidade do perfil. */
  editarUsuario(
    id: string,
    dados: { display_name?: string; email?: string; profile_public?: boolean; reason?: string },
  ) {
    return this.http.put<UserRow>(`${this.API}/users/${id}`, dados, { headers: this.headers() });
  }

  /** Devolve a senha temporária uma única vez — no banco só existe o hash. */
  resetarSenha(id: string) {
    return this.http.post<{ senha_temporaria: string }>(
      `${this.API}/users/${id}/reset-password`,
      {},
      { headers: this.headers() },
    );
  }

  mudarEstado(id: string, status: 'ativa' | 'desativada', reason = '') {
    return this.http.post<{ id: string; status: EstadoDaConta }>(
      `${this.API}/users/${id}/status`,
      { status, reason },
      { headers: this.headers() },
    );
  }

  /** Irreversível: exige o nome digitado à mão como confirmação. */
  anonimizar(id: string, confirmacao: string, reason = '') {
    return this.http.post<{ id: string; status: EstadoDaConta }>(
      `${this.API}/users/${id}/anonymize`,
      { confirmacao, reason },
      { headers: this.headers() },
    );
  }

  changeRole(userId: string, role: 'player' | 'organizer' | 'admin', reason = '') {
    return this.http.put<StaffRow>(
      `${this.API}/users/${userId}/role`,
      { role, reason },
      { headers: this.headers() },
    );
  }
}
