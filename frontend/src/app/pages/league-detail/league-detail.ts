import { Component, inject, signal, input, OnInit } from '@angular/core';
import { DialogService } from '../../services/dialog';
import { I18nService, mensagemDeErro } from '../../i18n/i18n';
import { CommonModule } from '@angular/common';
import { RouterLink, Router } from '@angular/router';
import { LeagueService, LeagueDetail, LeagueOrganizer } from '../../services/league';
import { formatarAproveitamento } from '../../lib/retrospecto';
import { AuthService } from '../../services/auth';
import { DataEventoPipe } from '../../lib/data-evento.pipe';

@Component({
  selector: 'app-league-detail',
  imports: [CommonModule, RouterLink, DataEventoPipe],
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
  organizerEmail = signal('');
  organizerError = signal('');
  organizerLoading = signal(false);

  isOwner(): boolean {
    return !!this.auth.currentUser() && this.auth.currentUser()?.id === this.league()?.owner_id;
  }

  /** Está no time (co-organizador): edita a liga e gerencia os eventos dela. */
  isCoOrganizer(): boolean {
    const eu = this.auth.currentUser()?.id;
    return !!eu && !!this.league()?.organizers?.some((o) => o.user_id === eu);
  }

  canManage(): boolean {
    return this.isOwner() || this.isCoOrganizer();
  }

  private setOrganizers(organizers: LeagueOrganizer[]) {
    const atual = this.league();
    if (atual) this.league.set({ ...atual, organizers });
  }

  addOrganizer() {
    const email = this.organizerEmail().trim();
    if (!email) return;
    this.organizerError.set('');
    this.organizerLoading.set(true);
    this.leagueSvc.addOrganizer(this.id(), email).subscribe({
      next: (organizers) => {
        this.setOrganizers(organizers);
        this.organizerEmail.set('');
        this.organizerLoading.set(false);
      },
      error: (err) => {
        this.organizerError.set(mensagemDeErro(this.i18n, err));
        this.organizerLoading.set(false);
      },
    });
  }

  async removeOrganizer(org: LeagueOrganizer) {
    const saindo = org.user_id === this.auth.currentUser()?.id;
    const ok = await this.dialog.confirm({
      titulo: this.i18n.t(saindo ? 'dialog.leaveLeagueTeam' : 'dialog.removeOrganizer', {
        nome: org.display_name,
      }),
      mensagem: this.i18n.t(saindo ? 'dialog.leaveLeagueTeamBody' : 'dialog.removeOrganizerBody', {
        nome: org.display_name,
      }),
      confirmar: this.i18n.t(saindo ? 'league.leaveTeam' : 'league.removeOrganizer'),
      perigo: true,
    });
    if (!ok) return;
    this.organizerError.set('');
    this.organizerLoading.set(true);
    this.leagueSvc.removeOrganizer(this.id(), org.user_id).subscribe({
      next: (organizers) => {
        this.setOrganizers(organizers);
        this.organizerLoading.set(false);
      },
      error: (err) => {
        this.organizerError.set(mensagemDeErro(this.i18n, err));
        this.organizerLoading.set(false);
      },
    });
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

  /** Aproveitamento do deck, ou travessão quando ele ainda não jogou partida. */
  percentual = (valor: number | null) => formatarAproveitamento(valor);

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
