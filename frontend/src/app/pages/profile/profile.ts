import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AuthService } from '../../services/auth';

@Component({
  selector: 'app-profile',
  imports: [CommonModule],
  templateUrl: './profile.html',
  styleUrl: './profile.scss',
})
export class ProfileComponent {
  auth = inject(AuthService);
  loading = signal(false);
  error = signal('');

  upgrade() {
    this.loading.set(true);
    this.error.set('');
    this.auth.upgradeToOrganizer().subscribe({
      next: () => this.loading.set(false),
      error: (err) => {
        this.error.set(err.error?.error || 'Something went wrong');
        this.loading.set(false);
      },
    });
  }
}
