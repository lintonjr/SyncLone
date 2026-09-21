import { Injectable, computed, signal } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { tap } from 'rxjs/operators';
import { Router } from '@angular/router';
import { environment } from '../../environments/environment';

export interface User {
  id: string;
  display_name: string;
  email: string;
  role: 'player' | 'organizer' | 'admin';
  /** Se o histórico entre eventos pode ser reunido numa página pública. */
  profile_public?: number;
  /** Verdadeiro quando a senha atual é a temporária criada por um administrador. */
  must_change_password?: boolean;
}

/** Um pedido para organizar, do ponto de vista de quem pediu. */
export interface OrganizerRequest {
  id: string;
  status: 'pending' | 'approved' | 'rejected';
  justification: string | null;
  /** O recado de quem decidiu. É o que transforma uma recusa em resposta. */
  reason: string | null;
  created_at: string;
  decided_at: string | null;
  decided_by_name: string | null;
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly API = `${environment.apiUrl}/auth`;
  private readonly USERS_API = `${environment.apiUrl}/users`;
  currentUser = signal<User | null>(this.loadUser());

  /**
   * Admin também organiza: os papéis são excludentes na coluna e hierárquicos na
   * permissão, como `podeOrganizar` no servidor (lib/roles.js). Toda tela que
   * mostra algo "só para organizador" pergunta aqui — comparar com 'organizer'
   * direto deixava o admin sem os botões de criar evento e liga.
   */
  podeOrganizar = computed(() => {
    const papel = this.currentUser()?.role;
    return papel === 'organizer' || papel === 'admin';
  });

  /** Troca a própria senha. Com senha temporária, a atual não é exigida. */
  trocarSenha(nova: string, atual = '') {
    return this.http.put<{ ok: boolean }>(
      `${this.USERS_API}/me/password`,
      { nova_senha: nova, senha_atual: atual },
      { headers: new HttpHeaders({ Authorization: `Bearer ${localStorage.getItem('token')}` }) },
    );
  }

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

  /**
   * Pede para organizar. Não muda papel nenhum: abre uma solicitação que o dono
   * da plataforma decide.
   *
   * Substituiu `upgradeToOrganizer`, que promovia na hora e devolvia um token
   * novo com o papel dentro. Hoje não há token novo a receber — o servidor lê o
   * papel do banco a cada requisição, então quando a aprovação sair ela vale no
   * clique seguinte, sem relogar.
   */
  requestOrganizer(justification: string) {
    return this.http.post<OrganizerRequest>(
      `${this.USERS_API}/me/organizer-request`,
      { justification },
      { headers: this.authHeaders() },
    );
  }

  /** O meu pedido mais recente, ou null se nunca pedi. */
  myOrganizerRequest() {
    return this.http.get<OrganizerRequest | null>(`${this.USERS_API}/me/organizer-request`, {
      headers: this.authHeaders(),
    });
  }

  /**
   * Relê o papel do servidor.
   *
   * O usuário guardado no localStorage foi escrito no login e não sabe de nada
   * que aconteceu depois — e agora o papel muda por decisão de outra pessoa, nos
   * dois sentidos. Sem isto, quem foi aprovado continuaria vendo a interface de
   * jogador até relogar, e quem foi revogado continuaria vendo botões que o
   * servidor já recusa.
   */
  refreshMe() {
    return this.http
      .get<User>(`${this.USERS_API}/me`, { headers: this.authHeaders() })
      .pipe(tap((user) => this.patchCurrentUser(user)));
  }

  private authHeaders() {
    return new HttpHeaders({ Authorization: `Bearer ${this.token()}` });
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
