import { Component, computed, input, output, signal, inject } from '@angular/core';
import { I18nService } from '../../i18n/i18n';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { TournamentEvent, Player, ClanStanding } from '../../services/event';

/**
 * A aba de classificação — a tabela de clãs, a tabela individual, a fila de
 * aprovação e a lista de dropados.
 *
 * É apresentação pura: recebe o evento pronto e devolve a intenção do
 * organizador para o pai, que é quem fala com o servidor. Isso é o que permite
 * testar a tela sem HTTP e sem rota — e a fila de aprovação, que já esteve
 * inalcançável uma vez, é justamente o tipo de coisa que só um teste de template
 * pega.
 */
@Component({
  selector: 'app-event-standings',
  imports: [CommonModule, RouterLink],
  templateUrl: './event-standings.html',
  styleUrl: './event-standings.scss',
})
export class EventStandingsComponent {
  i18n = inject(I18nService);
  ev = input.required<TournamentEvent>();
  isOwner = input(false);
  actionLoading = input(false);
  /** Quem pode editar o deck — a regra depende do usuário logado, que só o pai conhece. */
  podeEditarDeck = input<(player: Player) => boolean>(() => false);

  approve = output<string>();
  approveAll = output<void>();
  reject = output<string>();
  drop = output<string>();
  removeClanReq = output<{ id: string; nome: string }>();
  editDeck = output<Player>();
  /** O organizador aponta de que conta é a inscrição de um convidado. */
  linkGuest = output<{ player: Player; email: string }>();

  /** Qual tabela está à frente no Clã Fronto. Estado só desta aba. */
  view = signal<'clans' | 'players'>('clans');

  isClanFormat = computed(() => this.ev()?.tournament_format === 'clafronto');
  clanStandings = computed<ClanStanding[]>(() => this.ev()?.clan_standings ?? []);

  // O servidor já devolve na ordem oficial (pontos, OMW%, GW%, OGW%); aqui só filtra.
  sortedStandings = computed(() => (this.ev()?.players ?? []).filter((p) => p.status === 'active'));
  pendingPlayers = computed(() => (this.ev()?.players ?? []).filter((p) => p.status === 'pending'));
  droppedPlayers = computed(() =>
    (this.ev()?.players ?? []).filter((p) => p.status !== 'active' && p.status !== 'pending'),
  );

  private clanNameByPlayer = computed(() => {
    const nomes = new Map((this.ev()?.clans ?? []).map((c) => [c.id, c.name]));
    const porJogador = new Map<string, string>();
    for (const p of this.ev()?.players ?? []) {
      if (p.clan_id) porJogador.set(p.id, nomes.get(p.clan_id) ?? '');
    }
    return porJogador;
  });

  clanOf(playerId: string | undefined | null): string {
    return playerId ? (this.clanNameByPlayer().get(playerId) ?? '') : '';
  }

  // Uma cor estável por clã, para a tabela ser lida de relance.
  clanIndex(playerId: string | undefined | null): number {
    const clans = this.ev()?.clans ?? [];
    const player = (this.ev()?.players ?? []).find((p) => p.id === playerId);
    const i = clans.findIndex((c) => c.id === player?.clan_id);
    return i < 0 ? 0 : i % 8;
  }

  // Jogador que sentou em menos rodadas do que o torneio teve entrou depois do
  // começo — e comparar os pontos dele com quem jogou tudo engana.
  entrouDepois(player: Player): number {
    // A régua são as rodadas suíças. O mata-mata não entra: quem não passou para
    // o Top 4 tem uma rodada a menos por ter sido eliminado, não por ter chegado
    // tarde — e contá-lo marcava todo o campo eliminado como entrada tardia.
    const total = this.ev()?.swiss_rounds_total ?? 0;
    if (!total || player.swiss_rounds_seated === undefined) return 0;
    return Math.max(0, total - player.swiss_rounds_seated);
  }

  private pct(v: number | null | undefined): string {
    return v === null || v === undefined ? '—' : (v * 100).toFixed(1) + '%';
  }

  // MW% | OMW% | GW% | OGW%, na ordem em que desempatam (MTR 2.3).
  tiebreakers(player: Player): { mw: string; omw: string; gw: string; ogw: string } {
    return {
      mw: this.pct(player.mwp),
      omw: this.pct(player.omw),
      gw: this.pct(player.gwp),
      ogw: this.pct(player.ogw),
    };
  }

  ordinal(n: number): string {
    const s = ['th', 'st', 'nd', 'rd'];
    const v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }

  canEditDeck(player: Player): boolean {
    return this.podeEditarDeck()(player);
  }

  /**
   * O nome vira link quando há uma página para abrir: a pessoa tem conta e não
   * fechou o próprio perfil. Linkar para algo que responde 403 seria pior que
   * não linkar — e mostrar o cadeado de quem fechou não é da conta de ninguém.
   */
  temPerfil(player: Player): boolean {
    return !!player.user_id && (player.profile_public ?? 1) === 1;
  }

  /**
   * Metade do histórico do sistema está em convidados sem conta, e nada além do
   * nome os identifica — por isso quem vincula é o organizador, que sabe quem é
   * quem, e por isso é um prompt e não uma busca automática.
   */
  pedirVinculo(player: Player) {
    const email = prompt(this.i18n.t('standings.linkPrompt', { nome: player.display_name }));
    if (email?.trim()) this.linkGuest.emit({ player, email: email.trim() });
  }

  openDeckEdit(player: Player) {
    this.editDeck.emit(player);
  }

  rejectPlayer(playerId: string) {
    this.reject.emit(playerId);
  }
}
