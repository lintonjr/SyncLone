import { Component, computed, inject, signal } from '@angular/core';
import { I18nService, mensagemDeErro } from '../../i18n/i18n';
import { CommonModule } from '@angular/common';
import { AuthService } from '../../services/auth';
import { PlayerService } from '../../services/player';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-profile',
  imports: [CommonModule, RouterLink],
  templateUrl: './profile.html',
  styleUrl: './profile.scss',
})
export class ProfileComponent {
  i18n = inject(I18nService);
  auth = inject(AuthService);
  loading = signal(false);
  error = signal('');

  private players = inject(PlayerService);
  visibilityLoading = signal(false);
  visibilitySaved = signal(false);

  /** O padrão é público: contas antigas, sem preferência gravada, continuam como estavam. */
  perfilPublico = computed(() => (this.auth.currentUser()?.profile_public ?? 1) === 1);

  /**
   * O perfil não revela nada que já não esteja na classificação de cada evento —
   * o que ele faz é reunir tudo num lugar só. Por isso a opção existe: reunir é
   * diferente de espalhar, e nem todo mundo quer a própria história agregada.
   */
  alternarVisibilidade() {
    const novo = !this.perfilPublico();
    this.visibilityLoading.set(true);
    this.visibilitySaved.set(false);
    this.error.set('');
    this.players.setVisibility(novo).subscribe({
      next: (r) => {
        this.auth.patchCurrentUser({ profile_public: r.profile_public });
        this.visibilityLoading.set(false);
        this.visibilitySaved.set(true);
      },
      error: (err) => {
        this.error.set(mensagemDeErro(this.i18n, err));
        this.visibilityLoading.set(false);
      },
    });
  }

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
