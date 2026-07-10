import { Injectable, signal } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { environment } from '../../environments/environment';
import { tap } from 'rxjs/operators';

export interface Notification {
  id: string;
  user_id: string;
  message: string;
  read: number;
  created_at: string;
}

@Injectable({ providedIn: 'root' })
export class NotificationService {
  private readonly API = `${environment.apiUrl}/notifications`;
  notifications = signal<Notification[]>([]);
  unreadCount = signal(0);

  constructor(private http: HttpClient) {}

  private authHeaders(): HttpHeaders {
    const token = localStorage.getItem('token');
    return new HttpHeaders({ Authorization: `Bearer ${token}` });
  }

  load() {
    return this.http.get<Notification[]>(this.API, { headers: this.authHeaders() }).pipe(
      tap((notes) => {
        this.notifications.set(notes);
        this.unreadCount.set(notes.filter((n) => !n.read).length);
      })
    );
  }

  markRead(id: string) {
    return this.http.put(`${this.API}/${id}/read`, {}, { headers: this.authHeaders() }).pipe(
      tap(() => {
        this.notifications.update((ns) => ns.map((n) => (n.id === id ? { ...n, read: 1 } : n)));
        this.unreadCount.update((c) => Math.max(0, c - 1));
      })
    );
  }

  markAllRead() {
    return this.http.put(`${this.API}/read-all`, {}, { headers: this.authHeaders() }).pipe(
      tap(() => {
        this.notifications.update((ns) => ns.map((n) => ({ ...n, read: 1 })));
        this.unreadCount.set(0);
      })
    );
  }
}
