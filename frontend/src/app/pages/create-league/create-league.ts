import { Component, computed, inject, signal, input, OnInit } from '@angular/core';
import { I18nService, mensagemDeErro } from '../../i18n/i18n';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { LeagueService } from '../../services/league';

@Component({
  selector: 'app-create-league',
  imports: [CommonModule],
  templateUrl: './create-league.html',
  styleUrl: './create-league.scss',
})
export class CreateLeagueComponent implements OnInit {
  i18n = inject(I18nService);
  id = input<string>('');
  private leagueSvc = inject(LeagueService);
  private router = inject(Router);

  name = signal('');
  playoffCounts = signal(true);
  loading = signal(false);
  error = signal('');
  isEditMode = false;

  /**
   * O ponto extra por torneio participado.
   *
   * O interruptor é derivado do número no servidor (zero é desligado), mas na tela
   * ele precisa de estado próprio: marcar a caixa abre o campo **antes** de haver
   * um valor, e sem isso não daria para digitar.
   */
  pontoExtraLigado = signal(false);
  pontosExtra = signal('');

  /** O valor como inteiro de 1 a 99, ou null enquanto não for. */
  private extraValido = computed(() => {
    const t = this.pontosExtra().trim();
    if (!/^\d{1,2}$/.test(t)) return null;
    const n = Number(t);
    return n >= 1 && n <= 99 ? n : null;
  });

  /** Marcado sem valor não salva zero calado: o botão espera o número. */
  extraPendente = computed(() => this.pontoExtraLigado() && this.extraValido() === null);

  alternarPontoExtra(ligado: boolean) {
    this.pontoExtraLigado.set(ligado);
    // Desmarcar esquece o número: deixá-lo guardado faria a caixa voltar marcada
    // com um valor que a pessoa já tinha descartado.
    if (!ligado) this.pontosExtra.set('');
  }

  ngOnInit() {
    if (this.id()) {
      this.isEditMode = true;
      this.leagueSvc.getLeague(this.id()).subscribe({
        next: (l) => {
          this.name.set(l.name);
          this.playoffCounts.set(!!l.playoff_counts);
          // Zero é desligado, e é daí que sai o estado da caixa.
          this.pontoExtraLigado.set(l.pontos_extra > 0);
          this.pontosExtra.set(l.pontos_extra > 0 ? String(l.pontos_extra) : '');
        },
        error: () => this.error.set('Failed to load league'),
      });
    }
  }

  submit() {
    if (!this.name().trim()) {
      this.error.set('League name is required');
      return;
    }
    if (this.extraPendente()) {
      this.error.set(this.i18n.t('league.extraPointsRequired'));
      return;
    }
    this.loading.set(true);
    this.error.set('');
    const payload = {
      name: this.name().trim(),
      playoff_counts: this.playoffCounts(),
      // Caixa desmarcada manda zero, que é o que desliga o bônus no servidor.
      pontos_extra: this.pontoExtraLigado() ? this.extraValido()! : 0,
    };
    const request = this.isEditMode
      ? this.leagueSvc.updateLeague(this.id(), payload)
      : this.leagueSvc.createLeague(payload);

    request.subscribe({
      next: (league) => this.router.navigate(['/leagues', league.id]),
      error: (err) => {
        this.error.set(mensagemDeErro(this.i18n, err));
        this.loading.set(false);
      },
    });
  }
}
