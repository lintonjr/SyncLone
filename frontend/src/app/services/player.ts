import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../environments/environment';

/** Um torneio na linha do tempo do jogador. */
export interface ProfileEvent {
  event_id: string;
  name: string;
  date: string;
  game: string;
  format?: string;
  event_status: string;
  league_id?: string | null;
  league_name?: string | null;
  deck_name?: string | null;
  dropped: boolean;
  champion: boolean;
  /** Nulo para quem saiu no meio: colocação só faz sentido entre quem terminou. */
  position: number | null;
  field_size: number;
  wins: number;
  losses: number;
  draws: number;
  points: number;
}

/** O retrospecto de um conjunto de participações. */
export interface ProfileTotals {
  events: number;
  wins: number;
  losses: number;
  draws: number;
  matches: number;
  /** Empate vale meia vitória, como no MTR. Nulo quando ainda não jogou nada. */
  win_rate: number | null;
  titles: number;
}

/**
 * Um recorte por liga. O servidor só devolve as que a pessoa jogou — liga que
 * ela nunca disputou simplesmente não aparece.
 *
 * `league_id` nulo é o grupo dos eventos fora de qualquer liga. Ele não tem nome
 * próprio: quem o rotula é a tela, porque o nome de uma liga é dado e "Avulsos"
 * é rótulo — e rótulo se traduz.
 */
export interface ProfileBreakdown extends ProfileTotals {
  key: string;
  league_id: string | null;
  name: string | null;
}

/** Uma badge no perfil de quem a recebeu. */
export interface ProfileBadge {
  id: string;
  badge_id: string;
  name: string;
  image: string;
  visible: number;
  awarded_at: string;
  awarded_by_name: string;
}

export interface PlayerProfile {
  user: {
    id: string;
    display_name: string;
    role: string;
    profile_public: number;
    created_at: string;
  };
  totals: ProfileTotals;
  by_league: ProfileBreakdown[];
  /**
   * As badges que a pessoa mostra. Para o próprio titular vêm todas, inclusive
   * as escondidas — é no perfil que ele liga e desliga cada uma.
   */
  badges: ProfileBadge[];
  events: ProfileEvent[];
}

@Injectable({ providedIn: 'root' })
export class PlayerService {
  private http = inject(HttpClient);
  private API = `${environment.apiUrl}/users`;

  /**
   * Público, mas manda o token quando existe: um perfil marcado como privado
   * continua visível para o próprio titular.
   */
  getProfile(id: string) {
    const token = localStorage.getItem('token');
    return this.http.get<PlayerProfile>(`${this.API}/${id}/profile`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
  }

  /** Liga e desliga a própria página pública. */
  setVisibility(publico: boolean) {
    const token = localStorage.getItem('token');
    return this.http.put<{ profile_public: number }>(
      `${this.API}/me/profile-visibility`,
      { profile_public: publico },
      { headers: { Authorization: `Bearer ${token}` } },
    );
  }
}
