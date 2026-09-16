import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { I18nService, mensagemDeErro } from '../../i18n/i18n';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AuthService, OrganizerRequest } from '../../services/auth';
import { PlayerService } from '../../services/player';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-profile',
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './profile.html',
  styleUrl: './profile.scss',
})
export class ProfileComponent implements OnInit {
  i18n = inject(I18nService);
  auth = inject(AuthService);
  loading = signal(false);
  error = signal('');

  private players = inject(PlayerService);
  visibilityLoading = signal(false);
  visibilitySaved = signal(false);

  /** O pedido para organizar: null enquanto nunca houve um. */
  pedido = signal<OrganizerRequest | null>(null);
  formAberto = signal(false);
  justificativa = signal('');

  /** O padrão é público: contas antigas, sem preferência gravada, continuam como estavam. */
  perfilPublico = computed(() => (this.auth.currentUser()?.profile_public ?? 1) === 1);

  ehJogador = computed(() => this.auth.currentUser()?.role === 'player');
  naFila = computed(() => this.pedido()?.status === 'pending');
  recusado = computed(() => this.pedido()?.status === 'rejected');

  ngOnInit() {
    // O papel pode ter mudado por decisão de outra pessoa desde o último login —
    // é justamente esta tela que precisa mostrar isso primeiro.
    this.auth.refreshMe().subscribe({ error: () => {} });
    this.auth.myOrganizerRequest().subscribe({ next: (p) => this.pedido.set(p) });
  }

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

  /**
   * Envia a solicitação. Nada muda de papel aqui — quem decide é o dono.
   *
   * A justificativa é opcional: ela dá contexto a quem vai decidir, e cobrar um
   * texto mínimo só ensinaria a escrever qualquer coisa para destravar o botão.
   */
  solicitar() {
    this.loading.set(true);
    this.error.set('');
    this.auth.requestOrganizer(this.justificativa().trim()).subscribe({
      next: (p) => {
        this.pedido.set(p);
        this.formAberto.set(false);
        this.justificativa.set('');
        this.loading.set(false);
      },
      error: (err) => {
        this.error.set(mensagemDeErro(this.i18n, err));
        this.loading.set(false);
      },
    });
  }
}
