import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { AuthService } from '../../services/auth';
import { I18nService, mensagemDeErro } from '../../i18n/i18n';

/**
 * Defina uma senha nova.
 *
 * Aparece quando um administrador redefiniu a senha da pessoa: a temporária foi
 * ditada no balcão, então alguém além do dono a conhece e ela não pode sobreviver
 * ao primeiro acesso. Enquanto a troca não acontece, o guard manda toda rota para
 * cá — sair e entrar de novo não contorna.
 */
@Component({
  selector: 'app-nova-senha',
  imports: [CommonModule],
  templateUrl: './nova-senha.html',
  styleUrl: './nova-senha.scss',
})
export class NovaSenhaComponent {
  i18n = inject(I18nService);
  auth = inject(AuthService);
  private router = inject(Router);

  nova = signal('');
  repetida = signal('');
  erro = signal('');
  salvando = signal(false);

  salvar() {
    if (this.nova().length < 6) {
      this.erro.set(this.i18n.t('senha.curta'));
      return;
    }
    if (this.nova() !== this.repetida()) {
      this.erro.set(this.i18n.t('senha.naoConfere'));
      return;
    }
    this.erro.set('');
    this.salvando.set(true);
    this.auth.trocarSenha(this.nova()).subscribe({
      next: () => {
        this.auth.patchCurrentUser({ must_change_password: false });
        this.salvando.set(false);
        this.router.navigate(['/']);
      },
      error: (err) => {
        this.erro.set(mensagemDeErro(this.i18n, err));
        this.salvando.set(false);
      },
    });
  }
}
