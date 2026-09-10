import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../environments/environment';

/** Uma badge criada por um organizador. */
export interface Badge {
  id: string;
  owner_id: string;
  name: string;
  image: string;
  created_at: string;
  /** Quantas pessoas já a receberam. Só vem na listagem do organizador. */
  awarded_count?: number;
}

/** Uma entrega: quem recebeu, e se essa pessoa optou por mostrá-la. */
export interface BadgeAward {
  id: string;
  user_id: string;
  display_name: string;
  visible: number;
  awarded_at: string;
}

/** Uma badge na visão de quem a recebeu. */
export interface MyBadge {
  id: string;
  badge_id: string;
  name: string;
  image: string;
  visible: number;
  awarded_at: string;
  awarded_by_name: string;
}

@Injectable({ providedIn: 'root' })
export class BadgeService {
  private http = inject(HttpClient);
  private API = environment.apiUrl;

  /**
   * Cabeçalho de autenticação. Tipado explicitamente porque um objeto vazio no
   * ramo anônimo faz o TypeScript escolher a sobrecarga errada de `http.get` e
   * inferir ArrayBuffer no lugar do tipo pedido.
   */
  private auth(): { headers: Record<string, string> } {
    const token = localStorage.getItem('token');
    return { headers: token ? { Authorization: `Bearer ${token}` } : {} };
  }

  mine() {
    return this.http.get<Badge[]>(`${this.API}/badges`, this.auth());
  }

  awards(badgeId: string) {
    return this.http.get<BadgeAward[]>(`${this.API}/badges/${badgeId}/awards`, this.auth());
  }

  /** Criação e edição vão como multipart: a imagem é o corpo. */
  create(form: FormData) {
    return this.http.post<Badge>(`${this.API}/badges`, form, this.auth());
  }

  update(id: string, form: FormData) {
    return this.http.put<Badge>(`${this.API}/badges/${id}`, form, this.auth());
  }

  remove(id: string) {
    return this.http.delete(`${this.API}/badges/${id}`, this.auth());
  }

  award(badgeId: string, email: string) {
    return this.http.post<BadgeAward>(
      `${this.API}/badges/${badgeId}/award`,
      { email },
      this.auth(),
    );
  }

  revoke(badgeId: string, userId: string) {
    return this.http.delete(`${this.API}/badges/${badgeId}/award/${userId}`, this.auth());
  }

  /** Do lado de quem recebeu: liga e desliga a exibição no próprio perfil. */
  setVisible(userBadgeId: string, visible: boolean) {
    return this.http.put<{ id: string; visible: number }>(
      `${this.API}/users/me/badges/${userBadgeId}`,
      { visible },
      this.auth(),
    );
  }
}
