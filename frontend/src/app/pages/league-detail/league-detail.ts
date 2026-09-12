import { Component, inject, signal, input, OnInit } from '@angular/core';
import { DialogService } from '../../services/dialog';
import { I18nService, mensagemDeErro } from '../../i18n/i18n';
import { CommonModule } from '@angular/common';
import { RouterLink, Router } from '@angular/router';
import { LeagueService, LeagueDetail } from '../../services/league';
import { AuthService } from '../../services/auth';

@Component({
  selector: 'app-league-detail',
  imports: [CommonModule, RouterLink],
  templateUrl: './league-detail.html',
  styleUrl: './league-detail.scss',
})
export class LeagueDetailComponent implements OnInit {
  i18n = inject(I18nService);
  private dialog = inject(DialogService);
  id = input<string>('');
  private leagueSvc = inject(LeagueService);
  private router = inject(Router);
  auth = inject(AuthService);

  league = signal<LeagueDetail | null>(null);
  loading = signal(true);
  error = signal('');
  actionLoading = signal(false);

  isOwner(): boolean {
    return !!this.auth.currentUser() && this.auth.currentUser()?.id === this.league()?.owner_id;
  }

  ngOnInit() {
    this.load();
  }

  load() {
    this.loading.set(true);
    this.leagueSvc.getLeague(this.id()).subscribe({
      next: (l) => {
        this.league.set(l);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  ordinal(n: number): string {
    const s = ['th', 'st', 'nd', 'rd'];
    const v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }

  async deleteLeague() {
    const ok = await this.dialog.confirm({
      titulo: this.i18n.t('dialog.deleteLeague'),
      mensagem: this.i18n.t('dialog.deleteLeagueBody'),
      confirmar: this.i18n.t('dialog.delete'),
      perigo: true,
    });
    if (!ok) return;
    this.actionLoading.set(true);
    this.leagueSvc.deleteLeague(this.id()).subscribe({
      next: () => this.router.navigate(['/leagues']),
      error: (err) => {
        this.error.set(mensagemDeErro(this.i18n, err));
        this.actionLoading.set(false);
      },
    });
  }
}
