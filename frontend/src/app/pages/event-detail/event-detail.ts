import { Component, inject, signal, input, OnInit, OnDestroy, computed } from '@angular/core';
import { I18nService, mensagemDeErro } from '../../i18n/i18n';
import { DialogService } from '../../services/dialog';
import { CommonModule } from '@angular/common';
import { RouterLink, Router } from '@angular/router';
import { Subscription } from 'rxjs';
import {
  EventService,
  TournamentEvent,
  Player,
  Round,
  Pairing,
  ClanStanding,
} from '../../services/event';
import { AuthService } from '../../services/auth';
import { environment } from '../../../environments/environment';
import { phantomNameGenerator } from './phantom-names';
import { EventStandingsComponent } from '../event-standings/event-standings';
import { EventMyRoundComponent } from '../event-my-round/event-my-round';
import { EventShareComponent } from '../event-share/event-share';
import { EventAddPlayerComponent, NovoJogador } from '../event-add-player/event-add-player';
import { EventResultComponent } from '../event-result/event-result';
import { EventClanEnrollComponent, InscricaoDeCla } from '../event-clan-enroll/event-clan-enroll';
import { EventPairingsComponent } from '../event-pairings/event-pairings';
import { EventResultsComponent } from '../event-results/event-results';

@Component({
  selector: 'app-event-detail',
  imports: [
    CommonModule,
    RouterLink,
    EventStandingsComponent,
    EventPairingsComponent,
    EventResultsComponent,
    EventMyRoundComponent,
    EventShareComponent,
    EventAddPlayerComponent,
    EventResultComponent,
    EventClanEnrollComponent,
  ],
  templateUrl: './event-detail.html',
  styleUrl: './event-detail.scss',
})
export class EventDetailComponent implements OnInit, OnDestroy {
  i18n = inject(I18nService);
  id = input<string>('');
  private eventSvc = inject(EventService);
  private router = inject(Router);
  private dialog = inject(DialogService);
  auth = inject(AuthService);
  apiUrl = environment.apiUrl.replace('/api', '');

  event = signal<TournamentEvent | null>(null);
  loading = signal(true);
  tab = signal<'standings' | 'pairings' | 'results' | 'myround'>('standings');
  actionLoading = signal(false);
  error = signal('');
  resultModal = signal<{ pairing: Pairing } | null>(null);
  addPlayerModal = signal(false);
  addPlayerLoading = signal(false);
  addPlayerError = signal('');

  phantomLoading = signal(false);

  qrModal = signal(false);

  private randomName = phantomNameGenerator();

  /**
   * Massa de teste: quantos jogadores fictícios criar. Também era só um número
   * num modal, e também virou prompt.
   */
  async openPhantomModal() {
    const quantos = await this.dialog.prompt({
      titulo: this.i18n.t('event.addPhantomModal'),
      mensagem: this.i18n.t('event.phantomHelp'),
      valor: '8',
      tipo: 'number',
      min: 1,
      max: 100,
      confirmar: this.i18n.t('event.addPhantom'),
    });
    const n = Math.max(1, Math.min(Number(quantos) || 0, 100));
    if (!quantos || !n) return;

    this.phantomLoading.set(true);
    const nomes = Array.from({ length: n }, () => this.randomName());
    let feitos = 0;
    const terminou = () => {
      if (++feitos < n) return;
      this.load();
      this.phantomLoading.set(false);
    };
    for (const nome of nomes) {
      this.eventSvc.addPlayer(this.id(), { display_name: nome }).subscribe({
        next: terminou,
        error: terminou,
      });
    }
  }

  isOwner = computed(() => {
    const user = this.auth.currentUser();
    const ev = this.event();
    return !!(user && ev && ev.owner_id === user.id);
  });

  isJoined = computed(() => {
    const user = this.auth.currentUser();
    const ev = this.event();
    return !!(user && ev?.players?.some((p) => p.user_id === user.id));
  });

  // O servidor já devolve a lista na ordem oficial (pontos, OMW%, GW%, OGW%) —
  // a mesma que semeia os playoffs e alimenta a exportação. Aqui só filtramos.
  sortedStandings = computed(() =>
    (this.event()?.players ?? []).filter((p) => p.status === 'active'),
  );

  pendingPlayers = computed(() =>
    (this.event()?.players ?? []).filter((p) => p.status === 'pending'),
  );

  roundsGrouped = computed(() => {
    const ev = this.event();
    if (!ev?.rounds) return [];
    return ev.rounds.map((r) => ({
      ...r,
      pairings: (ev.pairings ?? []).filter((p) => p.round_id === r.id),
    }));
  });

  // Clã Fronto joga sempre em mesa de 4, mesmo que `pod_size` tenha sido salvo
  // com outro valor: sem esta segunda condição, a tela desenha a mesa de quatro
  // como duelo e esconde os assentos 3 e 4.
  isPodMode = computed(() => (this.event()?.pod_size ?? 2) >= 3 || this.isClanFormat());

  /* ---------- Clã Fronto ---------- */

  isClanFormat = computed(() => this.event()?.tournament_format === 'clafronto');

  championClanName = computed(() => {
    const ev = this.event();
    if (!ev?.champion_clan_id) return null;
    return ev.clans?.find((c) => c.id === ev.champion_clan_id)?.name ?? null;
  });

  clanModal = signal(false);
  clanLoading = signal(false);
  clanError = signal('');

  openClanModal() {
    this.clanError.set('');
    this.clanModal.set(true);
  }

  /** Inscreve o clã que o modal montou. A validação de preenchimento é lá. */
  submitClan(payload: InscricaoDeCla) {
    this.clanLoading.set(true);
    this.clanError.set('');
    this.eventSvc.createClan(this.id(), payload).subscribe({
      next: () => {
        this.load();
        this.clanModal.set(false);
        this.clanLoading.set(false);
      },
      error: (err) => {
        this.clanError.set(mensagemDeErro(this.i18n, err));
        this.clanLoading.set(false);
      },
    });
  }

  async removeClan(clanId: string, nome: string) {
    const ok = await this.dialog.confirm({
      titulo: this.i18n.t('dialog.removeClan'),
      mensagem: this.i18n.t('dialog.removeClanBody', { nome }),
      confirmar: this.i18n.t('dialog.remove'),
      perigo: true,
    });
    if (!ok) return;
    this.eventSvc.deleteClan(this.id(), clanId).subscribe({
      next: () => this.load(),
      error: (err) => this.error.set(mensagemDeErro(this.i18n, err)),
    });
  }

  currentRoundPairings = computed(() => {
    const ev = this.event();
    if (!ev?.rounds?.length) return null;
    const latest = ev.rounds[ev.rounds.length - 1];
    return { round: latest, pairings: (ev.pairings ?? []).filter((p) => p.round_id === latest.id) };
  });

  pendingInCurrentRound = computed(() => {
    const current = this.currentRoundPairings();
    return current
      ? current.pairings.some((p) => !p.result || p.result_status === 'pending')
      : false;
  });

  hasPlayoffRound = computed(() => (this.event()?.rounds ?? []).some((r) => r.is_playoff));

  private readonly PLAYOFF_LABELS: Record<string, string> = {
    top4: 'Top 4',
    top8: 'Top 8',
    top16: 'Top 16',
  };

  playoffLabel = computed(
    () => this.PLAYOFF_LABELS[this.event()?.playoff_structure ?? ''] ?? 'Playoffs',
  );

  canStartPlayoffs = computed(() => {
    const ev = this.event();
    if (!ev || ev.status === 'completed') return false;
    if (!ev.playoff_structure || ev.playoff_structure === 'none') return false;
    if (this.hasPlayoffRound()) return false;
    return !this.pendingInCurrentRound();
  });

  showAdvancePlayoffs = computed(() => {
    const ev = this.event();
    const current = this.currentRoundPairings();
    return !!(
      ev &&
      ev.status !== 'completed' &&
      current?.round.is_playoff &&
      !this.pendingInCurrentRound()
    );
  });

  championName = computed(() => {
    const ev = this.event();
    if (!ev?.champion_id) return null;
    return ev.players?.find((p) => p.id === ev.champion_id)?.display_name ?? null;
  });

  myRound = computed(() => {
    const user = this.auth.currentUser();
    const ev = this.event();
    if (!user || !ev?.rounds?.length) return null;
    const latestRound = ev.rounds[ev.rounds.length - 1];
    const pairings = (ev.pairings ?? []).filter((p) => p.round_id === latestRound.id);
    const myPlayer = ev.players?.find((p) => p.user_id === user.id);
    if (!myPlayer) return null;
    const pairing = pairings.find(
      (p) =>
        p.player1_id === myPlayer.id ||
        p.player2_id === myPlayer.id ||
        p.player3_id === myPlayer.id ||
        p.player4_id === myPlayer.id,
    );
    return pairing ? { round: latestRound, pairing, myPlayer } : null;
  });

  // Relógio local: o fim da rodada é derivado de round.created_at + round_minutes,
  // então o servidor não precisa emitir nada a cada segundo — o SSE só avisa quando
  // a rodada em si muda.
  private now = signal(Date.now());
  private clock?: ReturnType<typeof setInterval>;

  roundTimer = computed(() => {
    const ev = this.event();
    const current = this.currentRoundPairings();
    if (!ev || !current || ev.status === 'completed') return null;
    if (current.round.status === 'completed') return null;

    // Rodada pareada mas sem cronômetro: é a janela para os jogadores acharem a
    // mesa. Quem decide encerrá-la é o organizador.
    if (!current.round.timer_started_at) {
      return { waiting: true, over: false, warning: false, label: 'aguardando início' };
    }

    const started = new Date(current.round.timer_started_at).getTime();
    if (Number.isNaN(started)) return null;

    const remaining = started + (ev.round_minutes ?? 50) * 60_000 - this.now();
    const over = remaining <= 0;
    const abs = Math.abs(remaining);
    const mm = Math.floor(abs / 60_000);
    const ss = Math.floor((abs % 60_000) / 1000);
    return {
      waiting: false,
      over,
      warning: !over && remaining <= 5 * 60_000,
      label: `${over ? '+' : ''}${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`,
    };
  });

  startRoundTimer() {
    const current = this.currentRoundPairings();
    if (!current) return;
    this.actionLoading.set(true);
    this.eventSvc.startRoundTimer(this.id(), current.round.id).subscribe({
      next: () => {
        this.load();
        this.actionLoading.set(false);
      },
      error: (err) => {
        this.error.set(mensagemDeErro(this.i18n, err));
        this.actionLoading.set(false);
      },
    });
  }

  exportUrl(type: 'standings' | 'pairings' | 'clans') {
    return this.eventSvc.exportUrl(this.id(), type);
  }

  private streamSub?: Subscription;

  ngOnInit() {
    this.load();
    this.streamSub = this.eventSvc.streamEvent(this.id()).subscribe((sinal) => {
      if (sinal === 'deleted') {
        // O evento foi apagado por quem o organiza. Recarregar traria 404, então
        // a tela sai por conta própria em vez de ficar mostrando dados mortos.
        this.error.set('Este evento foi removido pelo organizador.');
        this.router.navigate(['/']);
        return;
      }
      this.refresh();
    });
    this.clock = setInterval(() => this.now.set(Date.now()), 1000);
  }

  ngOnDestroy() {
    this.streamSub?.unsubscribe();
    if (this.clock) clearInterval(this.clock);
  }

  load() {
    this.loading.set(true);
    this.eventSvc.getEvent(this.id()).subscribe({
      next: (ev) => {
        this.event.set(ev);
        this.loading.set(false);
      },
      error: () => this.loading.set(false),
    });
  }

  // Silent refetch used when the SSE stream pings that something changed elsewhere —
  // deliberately doesn't touch `loading`, so it never flashes the full-page spinner.
  refresh() {
    this.eventSvc.getEvent(this.id()).subscribe({ next: (ev) => this.event.set(ev) });
  }

  join() {
    this.actionLoading.set(true);
    this.eventSvc.joinEvent(this.id()).subscribe({
      next: (res: any) => {
        this.load();
        this.actionLoading.set(false);
        if (res?.pending) alert('Solicitação enviada — aguardando aprovação do organizador.');
      },
      error: (err) => {
        this.error.set(mensagemDeErro(this.i18n, err));
        this.actionLoading.set(false);
      },
    });
  }

  leave() {
    this.actionLoading.set(true);
    this.eventSvc.leaveEvent(this.id()).subscribe({
      next: () => {
        this.load();
        this.actionLoading.set(false);
      },
      error: () => this.actionLoading.set(false),
    });
  }

  startRound() {
    this.actionLoading.set(true);
    this.eventSvc.startRound(this.id()).subscribe({
      next: () => {
        this.load();
        this.actionLoading.set(false);
        this.tab.set('results');
      },
      error: (err) => {
        this.error.set(mensagemDeErro(this.i18n, err));
        this.actionLoading.set(false);
      },
    });
  }

  // '' = não registrar. Só existe em mesa 1v1; pods não têm placar por games.

  /** O modal cuida do placar a partir do que a mesa já tem. */
  openResultModal(pairing: Pairing) {
    this.resultModal.set({ pairing });
  }

  submitResult(pairingId: string, result: string, placar: '' | '2-0' | '2-1' = '') {
    // O placar acompanha o vencedor: 2×1 significa 2 games para quem venceu.
    const winnerGames = placar === '2-0' ? [2, 0] : placar === '2-1' ? [2, 1] : null;
    const games =
      winnerGames && (result === 'player1' || result === 'player2')
        ? result === 'player1'
          ? { p1: winnerGames[0], p2: winnerGames[1] }
          : { p1: winnerGames[1], p2: winnerGames[0] }
        : undefined;

    this.eventSvc.submitResult(this.id(), pairingId, result, games).subscribe({
      next: () => {
        this.load();
        this.resultModal.set(null);
      },
      error: (err) => this.error.set(mensagemDeErro(this.i18n, err)),
    });
  }

  approveResult(pairingId: string) {
    this.eventSvc.approveResult(this.id(), pairingId).subscribe({
      next: () => this.load(),
      error: (err) => this.error.set(mensagemDeErro(this.i18n, err)),
    });
  }

  async startPlayoffs() {
    const ok = await this.dialog.confirm({
      titulo: this.i18n.t('dialog.startPlayoffs'),
      mensagem: this.i18n.t('dialog.startPlayoffsBody', { estrutura: this.playoffLabel() }),
      confirmar: this.i18n.t('dialog.start'),
    });
    if (!ok) return;
    this.actionLoading.set(true);
    this.eventSvc.startPlayoffs(this.id()).subscribe({
      next: () => {
        this.load();
        this.actionLoading.set(false);
        this.tab.set('results');
      },
      error: (err) => {
        this.error.set(mensagemDeErro(this.i18n, err));
        this.actionLoading.set(false);
      },
    });
  }

  advancePlayoffs() {
    this.actionLoading.set(true);
    this.eventSvc.startRound(this.id()).subscribe({
      next: () => {
        this.load();
        this.actionLoading.set(false);
      },
      error: (err) => {
        this.error.set(mensagemDeErro(this.i18n, err));
        this.actionLoading.set(false);
      },
    });
  }

  async undoRound() {
    const ok = await this.dialog.confirm({
      titulo: this.i18n.t('dialog.undoRound', { n: this.event()?.current_round ?? 0 }),
      mensagem: this.i18n.t('dialog.undoRoundBody'),
      confirmar: this.i18n.t('dialog.undo'),
      perigo: true,
    });
    if (!ok) return;
    this.actionLoading.set(true);
    this.eventSvc.undoRound(this.id()).subscribe({
      next: () => {
        this.load();
        this.actionLoading.set(false);
      },
      error: (err) => {
        this.error.set(mensagemDeErro(this.i18n, err));
        this.actionLoading.set(false);
      },
    });
  }

  swapMode = signal(false);
  swapSelected = signal<string | null>(null);

  toggleSwapMode() {
    this.swapMode.update((v) => !v);
    this.swapSelected.set(null);
  }

  selectForSwap(playerId: string) {
    if (!this.swapMode()) return;
    const current = this.swapSelected();
    if (!current) {
      this.swapSelected.set(playerId);
      return;
    }
    if (current === playerId) {
      this.swapSelected.set(null);
      return;
    }
    this.actionLoading.set(true);
    this.eventSvc.swapPlayers(this.id(), current, playerId).subscribe({
      next: () => {
        this.load();
        this.swapMode.set(false);
        this.swapSelected.set(null);
        this.actionLoading.set(false);
      },
      error: (err) => {
        this.error.set(mensagemDeErro(this.i18n, err));
        this.swapSelected.set(null);
        this.actionLoading.set(false);
      },
    });
  }

  async approvePlayer(playerId: string) {
    const rodada = this.event()?.current_round ?? 0;
    if (rodada > 0) {
      const nome =
        this.pendingPlayers().find((p) => p.id === playerId)?.display_name ?? 'Este jogador';
      const ok = await this.dialog.confirm({
        titulo: this.i18n.t('dialog.approvePlayer', { nome }),
        mensagem: this.i18n.t('dialog.lateEntryOne', { rodada: rodada + 1, n: rodada }),
        confirmar: this.i18n.t('dialog.approve'),
      });
      if (!ok) return;
    }
    this.eventSvc.updatePlayer(this.id(), playerId, { status: 'active' }).subscribe({
      next: () => this.load(),
      error: (err) => this.error.set(mensagemDeErro(this.i18n, err)),
    });
  }

  // Aprovar 16 pedidos um a um é trabalho de mesa que o sistema pode poupar.
  async approveAllPending() {
    const pendentes = this.pendingPlayers();
    if (!pendentes.length) return;
    const rodada = this.event()?.current_round ?? 0;
    const ok = await this.dialog.confirm({
      titulo: this.i18n.t('dialog.approveAll', { n: pendentes.length }),
      // Com o torneio em andamento, quem aprova precisa saber que está deixando
      // gente entrar com rodadas a menos — é a diferença entre uma decisão e um
      // clique distraído.
      mensagem:
        rodada > 0
          ? this.i18n.t('dialog.lateEntryMany', { rodada: rodada + 1, n: rodada })
          : undefined,
      confirmar: this.i18n.t('dialog.approve'),
    });
    if (!ok) return;

    this.actionLoading.set(true);
    let restantes = pendentes.length;
    for (const p of pendentes) {
      this.eventSvc.updatePlayer(this.id(), p.id, { status: 'active' }).subscribe({
        next: () => {
          if (--restantes === 0) {
            this.load();
            this.actionLoading.set(false);
          }
        },
        error: (err) => {
          this.error.set(mensagemDeErro(this.i18n, err));
          if (--restantes === 0) {
            this.load();
            this.actionLoading.set(false);
          }
        },
      });
    }
  }

  async rejectPlayer(playerId: string) {
    const nome =
      this.pendingPlayers().find((p) => p.id === playerId)?.display_name ??
      this.i18n.t('common.player');
    const ok = await this.dialog.confirm({
      titulo: this.i18n.t('dialog.rejectJoin'),
      mensagem: this.i18n.t('dialog.rejectJoinBody', { nome }),
      confirmar: this.i18n.t('dialog.reject'),
      perigo: true,
    });
    if (!ok) return;
    this.eventSvc.removePlayer(this.id(), playerId).subscribe({
      next: () => this.load(),
      error: (err) => this.error.set(mensagemDeErro(this.i18n, err)),
    });
  }

  async dropPlayer(playerId: string) {
    const nome =
      this.sortedStandings().find((p) => p.id === playerId)?.display_name ??
      this.i18n.t('common.player');
    const ok = await this.dialog.confirm({
      titulo: this.i18n.t('dialog.dropPlayer'),
      mensagem: this.i18n.t('dialog.dropPlayerBody', { nome }),
      confirmar: this.i18n.t('dialog.drop'),
      perigo: true,
    });
    if (!ok) return;
    this.eventSvc.removePlayer(this.id(), playerId).subscribe({
      next: () => this.load(),
      error: (err) => this.error.set(mensagemDeErro(this.i18n, err)),
    });
  }

  // Passada ao filho como valor: a regra depende do usuário logado e do evento,
  // que só o pai conhece.
  canEditDeckFn = (player: Player): boolean => this.canEditDeck(player);

  canEditDeck(player: Player): boolean {
    if (this.isOwner() || player.user_id === this.auth.currentUser()?.id) return true;
    return !!(this.event()?.collaborative_deck && this.isJoined());
  }

  /**
   * Vincula a inscrição de um convidado a uma conta existente.
   *
   * Não muda resultado nenhum — a linha mantém o id, e as mesas continuam
   * apontando para ela. O que muda é que a participação passa a somar entre
   * eventos: a liga só agrega quem tem conta, e é só assim que ela aparece num
   * perfil.
   */
  vincularConvidado(playerId: string, email: string) {
    this.eventSvc.linkGuest(this.id(), playerId, email).subscribe({
      next: () => this.load(),
      error: (err) => this.error.set(mensagemDeErro(this.i18n, err)),
    });
  }

  /**
   * Pedir o nome de um deck é pedir um texto — não precisa de modal próprio.
   * Virou um prompt do sistema quando os diálogos passaram a existir, e a tela
   * perdeu um bloco que só tinha um campo dentro.
   */
  async openDeckEdit(player: Player) {
    const nome = await this.dialog.prompt({
      titulo: this.i18n.t('event.setDeckName'),
      mensagem: this.i18n.t('event.deckHelp'),
      valor: player.deck_name ?? '',
      placeholder: this.i18n.t('event.deckPlaceholder'),
      confirmar: this.i18n.t('common.save'),
    });
    if (nome === null) return;
    this.eventSvc.updatePlayer(this.id(), player.id, { deck_name: nome }).subscribe({
      next: () => this.load(),
      error: (err) => this.error.set(mensagemDeErro(this.i18n, err)),
    });
  }

  async finishEvent() {
    const ok = await this.dialog.confirm({
      titulo: this.i18n.t('dialog.finishEvent'),
      mensagem: this.i18n.t('dialog.finishEventBody'),
      confirmar: this.i18n.t('dialog.finish'),
    });
    if (!ok) return;
    this.eventSvc.finishEvent(this.id()).subscribe({
      next: () => this.load(),
      error: (err) => this.error.set(mensagemDeErro(this.i18n, err)),
    });
  }

  async deleteEvent() {
    const ok = await this.dialog.confirm({
      titulo: this.i18n.t('dialog.deleteEvent'),
      mensagem: this.i18n.t('dialog.deleteEventBody'),
      confirmar: this.i18n.t('dialog.delete'),
      perigo: true,
    });
    if (!ok) return;
    this.eventSvc.deleteEvent(this.id()).subscribe({
      next: () => this.router.navigate(['/events']),
      error: (err) => this.error.set(mensagemDeErro(this.i18n, err)),
    });
  }

  openAddPlayer() {
    this.addPlayerError.set('');
    this.addPlayerModal.set(true);
  }

  /**
   * Inscreve quem o modal preencheu. A validação de "e-mail ou nome" mora lá,
   * onde os campos estão; aqui fica só a conversa com o servidor.
   */
  submitAddPlayer(dados: NovoJogador) {
    this.addPlayerLoading.set(true);
    this.addPlayerError.set('');
    this.eventSvc.addPlayer(this.id(), dados).subscribe({
      next: () => {
        this.load();
        this.addPlayerModal.set(false);
        this.addPlayerLoading.set(false);
      },
      error: (err) => {
        this.addPlayerError.set(mensagemDeErro(this.i18n, err));
        this.addPlayerLoading.set(false);
      },
    });
  }

  thumbnailUrl(): string {
    const t = this.event()?.thumbnail;
    return t ? `${this.apiUrl}${t}` : '';
  }
}
