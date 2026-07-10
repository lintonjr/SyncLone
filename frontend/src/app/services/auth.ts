import { Injectable, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { tap } from 'rxjs/operators';
import { Router } from '@angular/router';
import { environment } from '../../environments/environment';

export interface User {
  id: string;
  display_name: string;
  email: string;
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly API = `${environment.apiUrl}/auth`;
  currentUser = signal<User | null>(this.loadUser());
  token = signal<string | null>(localStorage.getItem('token'));

  constructor(private http: HttpClient, private router: Router) {}

  private loadUser(): User | null {
    const raw = localStorage.getItem('user');
    return raw ? JSON.parse(raw) : null;
  }

  register(payload: { display_name: string; email: string; password: string }) {
    return this.http.post<{ token: string; user: User }>(`${this.API}/register`, payload).pipe(
      tap(({ token, user }) => this.persist(token, user))
    );
  }

  login(payload: { email: string; password: string }) {
    return this.http.post<{ token: string; user: User }>(`${this.API}/login`, payload).pipe(
      tap(({ token, user }) => this.persist(token, user))
    );
  }

  forgotPassword(email: string) {
    return this.http.post(`${this.API}/forgot-password`, { email });
  }

  logout() {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    this.currentUser.set(null);
    this.token.set(null);
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
