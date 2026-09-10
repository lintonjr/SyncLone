import { Component, inject, signal } from '@angular/core';
import { I18nService } from '../../i18n/i18n';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../services/auth';

@Component({
  selector: 'app-forgot-password',
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './forgot-password.html',
  styleUrl: './forgot-password.scss',
})
export class ForgotPasswordComponent {
  i18n = inject(I18nService);
  auth = inject(AuthService);
  email = signal('');
  loading = signal(false);
  sent = signal(false);
  error = signal('');

  submit() {
    if (!this.email()) {
      this.error.set('Email is required');
      return;
    }
    this.loading.set(true);
    this.auth.forgotPassword(this.email()).subscribe({
      next: () => {
        this.sent.set(true);
        this.loading.set(false);
      },
      error: () => {
        this.error.set('Something went wrong');
        this.loading.set(false);
      },
    });
  }
}
