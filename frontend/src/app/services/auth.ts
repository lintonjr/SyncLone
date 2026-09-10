import { Injectable, signal } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { tap } from 'rxjs/operators';
import { Router } from '@angular/router';
import { environment } from '../../environments/environment';

export interface User {
  id: string;
  display_name: string;
  email: string;
  role: 'player' | 'organizer';
  /** Se o histórico entre eventos pode ser reunido numa página pública. */
  profile_public?: number;
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly API = `${environment.apiUrl}/auth`;
  private readonly USERS_API = `${environment.apiUrl}/users`;
  currentUser = signal<User | null>(this.loadUser());

  /** Reflete no usuário guardado uma mudança feita em outra tela. */
  patchCurrentUser(campos: Partial<User>) {
    const atual = this.currentUser();
    if (!atual) return;
    const novo = { ...atual, ...campos };
    this.currentUser.set(novo);
    try {
      localStorage.setItem('user', JSON.stringify(novo));
    } catch {
      // armazenamento bloqueado: vale só nesta sessão
    }
  }
  token = signal<string | null>(localStorage.getItem('token'));

  constructor(
    private http: HttpClient,
    private router: Router,
  ) {}

  private loadUser(): User | null {
    const raw = localStorage.getItem('user');
    return raw ? JSON.parse(raw) : null;
  }

  register(payload: { display_name: string; email: string; password: string }) {
    return this.http
      .post<{ token: string; user: User }>(`${this.API}/register`, payload)
      .pipe(tap(({ token, user }) => this.persist(token, user)));
  }

  login(payload: { email: string; password: string }) {
    return this.http
      .post<{ token: string; user: User }>(`${this.API}/login`, payload)
      .pipe(tap(({ token, user }) => this.persist(token, user)));
  }

  forgotPassword(email: string) {
    return this.http.post(`${this.API}/forgot-password`, { email });
  }

  upgradeToOrganizer() {
    const headers = new HttpHeaders({ Authorization: `Bearer ${this.token()}` });
    return this.http
      .post<{ token: string; user: User }>(
        `${this.USERS_API}/me/upgrade-to-organizer`,
        {},
        { headers },
      )
      .pipe(tap(({ token, user }) => this.persist(token, user)));
  }

  // Descarta a sessão sem tirar o usuário de onde ele está. É o que a expiração
  // de um token precisa fazer numa página pública: você volta a ser visitante,
  // não é jogado para o login no meio do que estava fazendo.
  clearSession() {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    this.currentUser.set(null);
    this.token.set(null);
  }

  logout() {
    this.clearSession();
    this.router.navigate(['/login']);
  }

  isLoggedIn(): boolean {
    return !!this.token();
  }

  private persist(token: string, user: User) {
    localStorage.setItem('token', token);
    localStorage.setItem('user', JSON.stringify(user));
    this.token.set(token);
    this.currentUser.set(user);
  }
}
