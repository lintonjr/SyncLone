import { Component, inject, signal } from '@angular/core';
import { I18nService, mensagemDeErro } from '../../i18n/i18n';
import { CommonModule } from '@angular/common';
import { AuthService } from '../../services/auth';

@Component({
  selector: 'app-profile',
  imports: [CommonModule],
  templateUrl: './profile.html',
  styleUrl: './profile.scss',
})
export class ProfileComponent {
  i18n = inject(I18nService);
  auth = inject(AuthService);
  loading = signal(false);
  error = signal('');

  upgrade() {
    this.loading.set(true);
    this.error.set('');
    this.auth.upgradeToOrganizer().subscribe({
      next: () => this.loading.set(false),
      error: (err) => {
        this.error.set(mensagemDeErro(this.i18n, err));
        this.loading.set(false);
      },
    });
  }
}
