import { Component, inject, signal } from '@angular/core';
import { I18nService, mensagemDeErro } from '../../i18n/i18n';
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
  i18n = inject(I18nService);
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
      next: (r) => {
        // Senha temporária criada por um administrador: a troca vem antes de
        // qualquer outra tela. A guarda já barra o resto, mas cair na home e
        // esbarrar no aviso depois é uma explicação a mais para dar no balcão.
        this.router.navigate([r.user.must_change_password ? '/nova-senha' : '/']);
      },
      error: (err) => {
        this.error.set(mensagemDeErro(this.i18n, err));
        this.loading.set(false);
      },
    });
  }
}
