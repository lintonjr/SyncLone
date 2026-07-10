import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink, Router } from '@angular/router';
import { AuthService } from '../../services/auth';

@Component({
  selector: 'app-register',
  imports: [CommonModule, RouterLink],
  templateUrl: './register.html',
  styleUrl: './register.scss',
})
export class RegisterComponent {
  auth = inject(AuthService);
  router = inject(Router);
  displayName = signal('');
  email = signal('');
  password = signal('');
  confirmPassword = signal('');
  loading = signal(false);
  error = signal('');

  submit() {
    if (!this.displayName() || !this.email() || !this.password()) {
      this.error.set('All fields are required');
      return;
    }
    if (this.password() !== this.confirmPassword()) {
      this.error.set('Passwords do not match');
      return;
    }
    if (this.password().length < 6) {
      this.error.set('Password must be at least 6 characters');
      return;
    }
    this.loading.set(true);
    this.error.set('');
    this.auth.register({ display_name: this.displayName(), email: this.email(), password: this.password() }).subscribe({
      next: () => this.router.navigate(['/']),
      error: (err) => {
        this.error.set(err.error?.error || 'Registration failed');
        this.loading.set(false);
      },
    });
  }
}
