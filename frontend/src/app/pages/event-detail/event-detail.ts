import { Component, inject, signal, input, OnInit, OnDestroy, computed } from '@angular/core';
import { I18nService, mensagemDeErro } from '../../i18n/i18n';
import { CommonModule } from '@angular/common';
import { RouterLink, Router } from '@angular/router';
import { Subscription } from 'rxjs';
import * as QRCode from 'qrcode';
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
import { podPlayers } from './pod-view';
import { EventStandingsComponent } from '../event-standings/event-standings';
import { EventMyRoundComponent } from '../event-my-round/event-my-round';
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
  ],
  templateUrl: './event-detail.html',
  styleUrl: './event-detail.scss',
})
export class EventDetailComponent implements OnInit, OnDestroy {
  i18n = inject(I18nService);
  id = input<string>('');
  private eventSvc = inject(EventService);
  private router = inject(Router);
  auth = inject(AuthService);
  apiUrl = environment.apiUrl.replace('/api', '');

  event = signal<TournamentEvent | null>(null);
  loading = signal(true);
  tab = signal<'standings' | 'pairings' | 'results' | 'myround'>('standings');
  actionLoading = signal(false);
  error = signal('');
  resultModal = signal<{ pairing: Pairing } | null>(null);
  editDeckModal = signal<{ playerId: string; current: string } | null>(null);
  deckNameInput = signal('');
  addPlayerModal = signal(false);
  addPlayerEmail = signal('');
  addPlayerName = signal('');
  addPlayerLoading = signal(false);
  addPlayerError = signal('');

  phantomModal = signal(false);
  phantomCount = signal(8);
  phantomLoading = signal(false);

  qrModal = signal(false);
  qrDataUrl = signal('');
  qrCopied = signal(false);
  joinUrl = computed(() => `${window.location.origin}/event/${this.id()}`);

  private randomName = phantomNameGenerator();

  openPhantomModal() {
    this.phantomCount.set(8);
    this.phantomModal.set(true);
  }

  submitPhantom() {
    const n = Math.max(1, Math.min(this.phantomCount(), 100));
    this.phantomLoading.set(true);
    const names = Array.from({ length: n }, () => this.randomName());
    let done = 0;
    for (const name of names) {
      this.eventSvc.addPlayer(this.id(), { display_name: name }).subscribe({
        next: () => {
          if (++done === n) {
            this.load();
            this.phantomModal.set(false);
            this.phantomLoading.set(false);
          }
        },
        error: () => {
          if (++done === n) {
            this.load();
            this.phantomModal.set(false);
            this.phantomLoading.set(false);
          }
        },
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
  clanName = signal('');
  clanEmails = signal(['', '', '', '']);
  clanGuestNames = signal(['', '', '', '']);
  clanAsGuests = signal(false);
  clanLoading = signal(false);
  clanError = signal('');

  openClanModal() {
    this.clanName.set('');
    this.clanEmails.set(['', '', '', '']);
    this.clanGuestNames.set(['', '', '', '']);
    this.clanAsGuests.set(false);
    this.clanError.set('');
    this.clanModal.set(true);
  }

  setClanEmail(i: number, value: string) {
    this.clanEmails.update((list) => list.map((v, k) => (k === i ? value : v)));
  }

  setClanGuest(i: number, value: string) {
    this.clanGuestNames.update((list) => list.map((v, k) => (k === i ? value : v)));
  }

  submitClan() {
    const name = this.clanName().trim();
    if (name.length < 2) {
      this.clanError.set('Dê um nome ao clã');
      return;
    }

    const guests = this.clanAsGuests();
    const valores = (guests ? this.clanGuestNames() : this.clanEmails()).map((v) => v.trim());
    if (valores.some((v) => !v)) {
      this.clanError.set(guests ? 'Informe os quatro nomes' : 'Informe os quatro e-mails');
      return;
    }

    this.clanLoading.set(true);
    this.clanError.set('');
    const payload = guests ? { name, display_names: valores } : { name, emails: valores };
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

  removeClan(clanId: string, nome: string) {
    if (!confirm(`Remover o clã ${nome} e os seus quatro jogadores?`)) return;
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
  gameScore = signal<'' | '2-0' | '2-1'>('');

  openResultModal(pairing: Pairing) {
    const recorded =
      pairing.p1_games !== null &&
      pairing.p1_games !== undefined &&
      pairing.p2_games !== null &&
      pairing.p2_games !== undefined
        ? Math.min(pairing.p1_games, pairing.p2_games) === 0
          ? '2-0'
          : '2-1'
        : '';
    this.gameScore.set(recorded as '' | '2-0' | '2-1');
    this.resultModal.set({ pairing });
  }

  submitResult(pairingId: string, result: string) {
    // O placar acompanha o vencedor: 2×1 significa 2 games para quem venceu.
    const choice = this.gameScore();
    const winnerGames = choice === '2-0' ? [2, 0] : choice === '2-1' ? [2, 1] : null;
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
        this.gameScore.set('');
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

  startPlayoffs() {
    if (
      !confirm(
        `Iniciar os playoffs (${this.playoffLabel()})? Os jogadores mais bem colocados na classificação atual serão selecionados para o mata-mata.`,
      )
    )
      return;
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

  undoRound() {
    const roundNum = this.event()?.current_round;
    if (
      !confirm(
        `Desfazer a Rodada ${roundNum}? Todos os pareamentos e resultados desta rodada serão removidos e ela poderá ser pareada novamente. Esta ação não pode ser desfeita.`,
      )
    )
      return;
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

  approvePlayer(playerId: string) {
    const rodada = this.event()?.current_round ?? 0;
    if (rodada > 0) {
      const nome =
        this.pendingPlayers().find((p) => p.id === playerId)?.display_name ?? 'Este jogador';
      const ok = confirm(
        `${nome} entra a partir da Rodada ${rodada + 1}, com 0 pontos e ${rodada} ` +
          `${rodada === 1 ? 'rodada' : 'rodadas'} a menos que os demais. Aprovar mesmo assim?`,
      );
      if (!ok) return;
    }
    this.eventSvc.updatePlayer(this.id(), playerId, { status: 'active' }).subscribe({
      next: () => this.load(),
      error: (err) => this.error.set(mensagemDeErro(this.i18n, err)),
    });
  }

  // Aprovar 16 pedidos um a um é trabalho de mesa que o sistema pode poupar.
  approveAllPending() {
    const pendentes = this.pendingPlayers();
    if (!pendentes.length) return;
    const rodada = this.event()?.current_round ?? 0;
    const aviso =
      rodada > 0
        ? ` Eles entram a partir da Rodada ${rodada + 1}, com ${rodada} ${rodada === 1 ? 'rodada' : 'rodadas'} a menos.`
        : '';
    if (!confirm(`Aprovar ${pendentes.length} pedido(s) de inscrição?${aviso}`)) return;

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

  rejectPlayer(playerId: string) {
    if (!confirm('Reject this join request?')) return;
    this.eventSvc.removePlayer(this.id(), playerId).subscribe({
      next: () => this.load(),
      error: (err) => this.error.set(mensagemDeErro(this.i18n, err)),
    });
  }

  dropPlayer(playerId: string) {
    if (!confirm('Drop this player from the event?')) return;
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

  openDeckEdit(player: Player) {
    this.deckNameInput.set(player.deck_name ?? '');
    this.editDeckModal.set({ playerId: player.id, current: player.deck_name ?? '' });
  }

  saveDeckName() {
    const modal = this.editDeckModal();
    if (!modal) return;
    this.eventSvc
      .updatePlayer(this.id(), modal.playerId, { deck_name: this.deckNameInput() })
      .subscribe({
        next: () => {
          this.load();
          this.editDeckModal.set(null);
        },
        error: (err) => this.error.set(mensagemDeErro(this.i18n, err)),
      });
  }

  finishEvent() {
    if (
      !confirm(
        'Finalizar este evento? Ele será movido para Past Events e não poderá receber novas rodadas.',
      )
    )
      return;
    this.eventSvc.finishEvent(this.id()).subscribe({
      next: () => this.load(),
      error: (err) => this.error.set(mensagemDeErro(this.i18n, err)),
    });
  }

  deleteEvent() {
    if (!confirm('Delete this event permanently? This cannot be undone.')) return;
    this.eventSvc.deleteEvent(this.id()).subscribe({
      next: () => this.router.navigate(['/events']),
      error: (err) => this.error.set(mensagemDeErro(this.i18n, err)),
    });
  }

  openAddPlayer() {
    this.addPlayerEmail.set('');
    this.addPlayerName.set('');
    this.addPlayerError.set('');
    this.addPlayerModal.set(true);
  }

  openQrModal() {
    this.qrCopied.set(false);
    this.qrModal.set(true);
    QRCode.toDataURL(this.joinUrl(), { width: 220, margin: 2 }).then((url) =>
      this.qrDataUrl.set(url),
    );
  }

  copyJoinLink() {
    navigator.clipboard.writeText(this.joinUrl()).then(() => {
      this.qrCopied.set(true);
      setTimeout(() => this.qrCopied.set(false), 2000);
    });
  }

  shareViaWhatsApp() {
    const text = `${this.event()?.name} — ${this.joinUrl()}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank');
  }

  shareViaEmail() {
    const subject = this.event()?.name ?? 'ManaSync Event';
    const body = this.joinUrl();
    window.location.href = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  }

  openJoinLink() {
    window.open(this.joinUrl(), '_blank');
  }

  submitAddPlayer() {
    const email = this.addPlayerEmail().trim();
    const name = this.addPlayerName().trim();
    if (!email && !name) {
      this.addPlayerError.set('Enter an email or a display name');
      return;
    }
    this.addPlayerLoading.set(true);
    this.addPlayerError.set('');
    this.eventSvc
      .addPlayer(this.id(), { email: email || undefined, display_name: name || undefined })
      .subscribe({
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

  // O modal de resultado continua no pai (é ele que guarda o rascunho do placar),
  // e desenha os assentos da mesa com a mesma função das abas.
  podPlayers = podPlayers;

  thumbnailUrl(): string {
    const t = this.event()?.thumbnail;
    return t ? `${this.apiUrl}${t}` : '';
  }
}
