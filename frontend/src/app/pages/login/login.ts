import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink, Router } from '@angular/router';
import { AuthService } from '../../services/auth';

@Component({
  selector: 'app-login',
  imports: [CommonModule, RouterLink],
  templateUrl: './login.html',
  styleUrl: './login.scss',
})
export class LoginComponent {
  auth = inject(AuthService);
  router = inject(Router);
  email = signal('');
  password = signal('');
  loading = signal(false);
  error = signal('');

  submit() {
    if (!this.email() || !this.password()) {
      this.error.set('Please fill in all fields');
      return;
    }
    this.loading.set(true);
    this.error.set('');
    this.auth.login({ email: this.email(), password: this.password() }).subscribe({
      next: () => this.router.navigate(['/']),
      error: (err) => {
        this.error.set(err.error?.error || 'Login failed');
        this.loading.set(false);
      },
    });
  }
}
