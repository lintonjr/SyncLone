import { Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { PlayerService, PlayerProfile, ProfileEvent, ProfileTotals } from '../../services/player';
import { I18nService, mensagemDeErro } from '../../i18n/i18n';
import { BadgeService } from '../../services/badge';
import { AuthService } from '../../services/auth';
import { environment } from '../../../environments/environment';
import { DataEventoPipe } from '../../lib/data-evento.pipe';

/**
 * Perfil público de um jogador: o que ele jogou e como se saiu.
 *
 * A página é pública porque o dado já é — nome, retrospecto e colocação aparecem
 * na classificação de cada evento. O que o servidor nunca devolve, e portanto
 * nunca aparece aqui, é o e-mail.
 */
@Component({
  selector: 'app-player-profile',
  imports: [CommonModule, RouterLink, DataEventoPipe],
  templateUrl: './player-profile.html',
  styleUrl: './player-profile.scss',
})
export class PlayerProfileComponent implements OnInit {
  id = input<string>('');
  i18n = inject(I18nService);
  private svc = inject(PlayerService);
  private badgeSvc = inject(BadgeService);
  private auth = inject(AuthService);
  private apiUrl = environment.apiUrl.replace('/api', '');

  profile = signal<PlayerProfile | null>(null);
  loading = signal(true);
  error = signal('');

  ngOnInit() {
    this.svc.getProfile(this.id()).subscribe({
      next: (p) => {
        this.profile.set(p);
        this.loading.set(false);
      },
      error: (err) => {
        // 403 é escolha da pessoa; 404 é endereço errado. Dizer "não existe"
        // para alguém que existe seria mentir, e a tela sabe a diferença.
        this.error.set(
          err.status === 403
            ? this.i18n.t('profilePub.private')
            : this.i18n.t('profilePub.notFound'),
        );
        this.loading.set(false);
      },
    });
  }

  /* ---------- Badges ---------- */

  /** Sou eu vendo o meu próprio perfil? É o que libera ligar e desligar badges. */
  souEu = computed(() => this.auth.currentUser()?.id === this.profile()?.user.id);

  /**
   * Quantas badges cabem ao lado do nome antes de o cabeçalho virar uma parede.
   * O resto abre na seção de baixo.
   */
  private readonly TETO_NA_LINHA = 5;

  badgesVisiveis = computed(() => (this.profile()?.badges ?? []).filter((b) => b.visible));
  badgesNaLinha = computed(() => this.badgesVisiveis().slice(0, this.TETO_NA_LINHA));
  badgesAlem = computed(() => Math.max(0, this.badgesVisiveis().length - this.TETO_NA_LINHA));

  /**
   * A seção existe sempre que houver badge — é ela que dá tamanho ao
   * reconhecimento. As miniaturas ao lado do nome continuam ali, mas são adorno
   * do nome; quem quer ver o que a pessoa conquistou olha aqui.
   *
   * Para o titular ela abre mesmo com tudo escondido: é onde ele liga de volta.
   */
  mostrarSecaoBadges = computed(() =>
    this.souEu() ? (this.profile()?.badges?.length ?? 0) > 0 : this.badgesVisiveis().length > 0,
  );

  imagemDaBadge(caminho: string): string {
    return `${this.apiUrl}${caminho}`;
  }

  /**
   * O jogador decide o que aparece. Quem entregou não manda nisto: a badge é
   * reconhecimento de quem a deu, mas a página é da pessoa. Esconder não devolve
   * a badge — ela continua entregue, e volta quando ela quiser.
   */
  alternarBadge(id: string, visivelAgora: number) {
    this.badgeSvc.setVisible(id, !visivelAgora).subscribe({
      next: (r) => {
        this.profile.update((p) =>
          p
            ? {
                ...p,
                badges: p.badges.map((b) => (b.id === r.id ? { ...b, visible: r.visible } : b)),
              }
            : p,
        );
      },
      error: (err) => this.error.set(mensagemDeErro(this.i18n, err)),
    });
  }

  /** O titular vendo o próprio perfil fechado merece saber que só ele o vê. */
  ehMeuPerfilPrivado = computed(() => {
    const p = this.profile();
    return !!p && p.user.profile_public === 0;
  });

  /**
   * Recorte em foco. `'all'` é a visão geral, que existe sempre; os demais são
   * as ligas de que a pessoa participou, mais o grupo dos eventos avulsos.
   */
  recorte = signal<string>('all');

  /** Os números do recorte em foco — geral ou de um formato só. */
  emFoco = computed<ProfileTotals>(() => {
    const p = this.profile();
    if (!p)
      return { events: 0, wins: 0, losses: 0, draws: 0, matches: 0, win_rate: null, titles: 0 };
    if (this.recorte() === 'all') return p.totals;
    return p.by_league.find((b) => b.key === this.recorte()) ?? p.totals;
  });

  /** Os eventos do recorte em foco, para o histórico acompanhar os números. */
  eventosEmFoco = computed(() => {
    const p = this.profile();
    if (!p) return [];
    if (this.recorte() === 'all') return p.events;
    const alvo = p.by_league.find((b) => b.key === this.recorte());
    if (!alvo) return p.events;
    return p.events.filter((e) => (e.league_id ?? null) === alvo.league_id);
  });

  /**
   * Só vale oferecer o recorte quando há mais de um: com uma liga só, o "geral" e
   * a ficha dela seriam a mesma tabela com dois nomes.
   */
  mostrarRecortes = computed(() => (this.profile()?.by_league.length ?? 0) > 1);

  /** O grupo sem liga é o único cujo rótulo é do sistema, e não dado do evento. */
  rotuloDoRecorte(b: { league_id: string | null; name: string | null }): string {
    return b.name ?? this.i18n.t('profilePub.standalone');
  }

  /** Aproveitamento como percentual, ou "—" enquanto não houver partida. */
  aproveitamento = computed(() => {
    const r = this.emFoco().win_rate;
    return r === null || r === undefined ? '—' : `${(r * 100).toFixed(1)}%`;
  });

  /** Decks só aparecem quando alguém de fato registrou algum. */
  decks = computed(() => {
    const nomes = this.eventosEmFoco()
      .map((e) => e.deck_name)
      .filter((d): d is string => !!d && d.trim().length > 0);
    return [...new Set(nomes)];
  });

  /** Só as três primeiras colocações ganham destaque, como na tabela do evento. */
  medalha(e: ProfileEvent): string {
    if (e.champion) return 'rank-1';
    if (!e.position || e.position > 3) return '';
    return `rank-${e.position}`;
  }

  ordinal(n: number | null): string {
    if (!n) return '—';
    return this.i18n.lang() === 'pt-BR'
      ? `${n}º`
      : `${n}${['th', 'st', 'nd', 'rd'][((n % 100) - 20) % 10] || ['th', 'st', 'nd', 'rd'][n % 100] || 'th'}`;
  }
}
