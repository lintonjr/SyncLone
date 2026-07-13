import { Component, inject, signal, input, OnInit, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink, Router } from '@angular/router';
import { EventService, TournamentEvent, Player, Round, Pairing } from '../../services/event';
import { AuthService } from '../../services/auth';
import { environment } from '../../../environments/environment';

@Component({
  selector: 'app-event-detail',
  imports: [CommonModule, RouterLink],
  templateUrl: './event-detail.html',
  styleUrl: './event-detail.scss',
})
export class EventDetailComponent implements OnInit {
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

  private readonly FIRST = [
    'Alice','Bob','Carlos','Diana','Eduardo','Fernanda','Gabriel','Helena',
    'Igor','Juliana','Klaus','Laura','Marcos','Natalia','Oscar','Paula',
    'Rafael','Sabrina','Thiago','Ursula','Victor','Wendy','Xavier','Yasmin',
    'Zara','André','Beatriz','Caio','Débora','Élton','Fátima','Gustavo',
    'Hígor','Isabela','João','Keila','Leandro','Mariana','Nando','Olivia',
    'Pedro','Quésia','Rodrigo','Sofia','Tânia','Ugo','Vanessa','Wilson',
  ];
  private readonly LAST = [
    'Silva','Santos','Oliveira','Souza','Rodrigues','Ferreira','Alves','Lima',
    'Costa','Pereira','Carvalho','Melo','Ribeiro','Almeida','Nascimento',
    'Gomes','Martins','Araújo','Monteiro','Barbosa','Cardoso','Cavalcanti',
    'Moreira','Nunes','Correia','Dias','Duarte','Cunha','Freitas','Pinto',
  ];

  private usedPhantomNames = new Set<string>();

  private randomName(): string {
    const pick = <T>(arr: T[]) => arr[Math.floor(Math.random() * arr.length)];
    let name: string;
    let tries = 0;
    do { name = `${pick(this.FIRST)} ${pick(this.LAST)}`; tries++; }
    while (this.usedPhantomNames.has(name) && tries < 200);
    this.usedPhantomNames.add(name);
    return name;
  }

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
        next: () => { if (++done === n) { this.load(); this.phantomModal.set(false); this.phantomLoading.set(false); } },
        error: () => { if (++done === n) { this.load(); this.phantomModal.set(false); this.phantomLoading.set(false); } },
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

  sortedStandings = computed(() => {
    const players = this.event()?.players ?? [];
    return [...players]
      .filter((p) => p.status === 'active')
      .sort((a, b) => b.points - a.points || b.wins - a.wins);
  });

  pendingPlayers = computed(() => (this.event()?.players ?? []).filter((p) => p.status === 'pending'));

  droppedPlayers = computed(() =>
    (this.event()?.players ?? []).filter((p) => p.status !== 'active' && p.status !== 'pending')
  );

  roundsGrouped = computed(() => {
    const ev = this.event();
    if (!ev?.rounds) return [];
    return ev.rounds.map((r) => ({
      ...r,
      pairings: (ev.pairings ?? []).filter((p) => p.round_id === r.id),
    }));
  });

  isPodMode = computed(() => (this.event()?.pod_size ?? 2) >= 3);

  currentRoundPairings = computed(() => {
    const ev = this.event();
    if (!ev?.rounds?.length) return null;
    const latest = ev.rounds[ev.rounds.length - 1];
    return { round: latest, pairings: (ev.pairings ?? []).filter(p => p.round_id === latest.id) };
  });

  pendingInCurrentRound = computed(() => {
    const current = this.currentRoundPairings();
    return current ? current.pairings.some((p) => !p.result) : false;
  });

  hasPlayoffRound = computed(() => (this.event()?.rounds ?? []).some((r) => r.is_playoff));

  playoffLabel = computed(() => {
    const ps = this.event()?.playoff_structure;
    return ps === 'top4' ? 'Top 4' : ps === 'top16' ? 'Top 16' : 'Playoffs';
  });

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
    return !!(ev && ev.status !== 'completed' && current?.round.is_playoff && !this.pendingInCurrentRound());
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
      (p) => p.player1_id === myPlayer.id || p.player2_id === myPlayer.id ||
             p.player3_id === myPlayer.id || p.player4_id === myPlayer.id
    );
    return pairing ? { round: latestRound, pairing, myPlayer } : null;
  });

  private mwp(player: Player): number {
    const total = player.wins + player.losses + player.draws;
    if (total === 0) return 1 / 3;
    return Math.max(player.wins / total, 1 / 3);
  }

  private opponents(playerId: string): Player[] {
    const ev = this.event();
    if (!ev?.pairings || !ev?.players) return [];
    const ids = new Set<string>();
    for (const p of ev.pairings) {
      const seats = [p.player1_id, p.player2_id, p.player3_id, p.player4_id].filter(Boolean) as string[];
      if (seats.includes(playerId) && seats.length > 1)
        seats.filter(id => id !== playerId).forEach(id => ids.add(id));
    }
    return ev.players!.filter(p => ids.has(p.id));
  }

  tiebreakers(player: Player): { mw: string; oap: string; ow: string } {
    const opps = this.opponents(player.id);
    const mw = this.mwp(player);
    const oap = opps.length ? opps.reduce((s, o) => s + o.points, 0) / opps.length : 0;
    const ow = opps.length ? opps.reduce((s, o) => s + this.mwp(o), 0) / opps.length : 0;
    return {
      mw: (mw * 100).toFixed(1) + '%',
      oap: oap.toFixed(2),
      ow: (ow * 100).toFixed(1) + '%',
    };
  }

  podPlayers(p: Pairing): { id: string; name: string; slot: string }[] {
    const ev = this.event();
    const entries: { id: string; name: string; slot: string }[] = [];
    if (p.player1_id) entries.push({ id: p.player1_id, name: p.p1_name ?? '?', slot: 'player1' });
    if (p.player2_id) entries.push({ id: p.player2_id, name: p.p2_name ?? '?', slot: 'player2' });
    if (p.player3_id) entries.push({ id: p.player3_id, name: p.p3_name ?? '?', slot: 'player3' });
    if (p.player4_id) entries.push({ id: p.player4_id, name: p.p4_name ?? '?', slot: 'player4' });
    return entries;
  }

  podPlayerResult(p: Pairing, slot: string): 'win' | 'loss' | 'draw' | 'bye' | null {
    if (!p.result) return null;
    if (p.result === 'bye') return 'bye';
    if (p.result === 'draw') return 'draw';
    return p.result === slot ? 'win' : 'loss';
  }

  ngOnInit() {
    this.load();
  }

  load() {
    this.loading.set(true);
    this.eventSvc.getEvent(this.id()).subscribe({
      next: (ev) => { this.event.set(ev); this.loading.set(false); },
      error: () => this.loading.set(false),
    });
  }

  join() {
    this.actionLoading.set(true);
    this.eventSvc.joinEvent(this.id()).subscribe({
      next: (res: any) => {
        this.load();
        this.actionLoading.set(false);
        if (res?.pending) alert('Solicitação enviada — aguardando aprovação do organizador.');
      },
      error: (err) => { this.error.set(err.error?.error || 'Failed to join'); this.actionLoading.set(false); },
    });
  }

  leave() {
    this.actionLoading.set(true);
    this.eventSvc.leaveEvent(this.id()).subscribe({
      next: () => { this.load(); this.actionLoading.set(false); },
      error: () => this.actionLoading.set(false),
    });
  }

  startRound() {
    this.actionLoading.set(true);
    this.eventSvc.startRound(this.id()).subscribe({
      next: () => { this.load(); this.actionLoading.set(false); this.tab.set('results'); },
      error: (err) => { this.error.set(err.error?.error || 'Failed to start round'); this.actionLoading.set(false); },
    });
  }

  canEditResult(pairing: Pairing, round: Round): boolean {
    if (!pairing.result || pairing.result === 'bye') return false;
    if (!this.isOwner() || this.swapMode()) return false;
    const ev = this.event();
    if (!ev || ev.status === 'completed') return false;
    return round.round_number === ev.current_round && round.status !== 'completed';
  }

  submitResult(pairingId: string, result: string) {
    this.eventSvc.submitResult(this.id(), pairingId, result).subscribe({
      next: () => { this.load(); this.resultModal.set(null); },
      error: (err) => this.error.set(err.error?.error || 'Failed to submit result'),
    });
  }

  startRoundTab() {
    this.startRound();
  }

  startPlayoffs() {
    if (!confirm(`Iniciar os playoffs (${this.playoffLabel()})? Os jogadores mais bem colocados na classificação atual serão selecionados para o mata-mata.`)) return;
    this.actionLoading.set(true);
    this.eventSvc.startPlayoffs(this.id()).subscribe({
      next: () => { this.load(); this.actionLoading.set(false); this.tab.set('results'); },
      error: (err) => { this.error.set(err.error?.error || 'Failed to start playoffs'); this.actionLoading.set(false); },
    });
  }

  advancePlayoffs() {
    this.actionLoading.set(true);
    this.eventSvc.startRound(this.id()).subscribe({
      next: () => { this.load(); this.actionLoading.set(false); },
      error: (err) => { this.error.set(err.error?.error || 'Failed to advance playoffs'); this.actionLoading.set(false); },
    });
  }

  undoRound() {
    const roundNum = this.event()?.current_round;
    if (!confirm(`Desfazer a Rodada ${roundNum}? Todos os pareamentos e resultados desta rodada serão removidos e ela poderá ser pareada novamente. Esta ação não pode ser desfeita.`)) return;
    this.actionLoading.set(true);
    this.eventSvc.undoRound(this.id()).subscribe({
      next: () => { this.load(); this.actionLoading.set(false); },
      error: (err) => { this.error.set(err.error?.error || 'Failed to undo round'); this.actionLoading.set(false); },
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
    if (!current) { this.swapSelected.set(playerId); return; }
    if (current === playerId) { this.swapSelected.set(null); return; }
    this.actionLoading.set(true);
    this.eventSvc.swapPlayers(this.id(), current, playerId).subscribe({
      next: () => {
        this.load();
        this.swapMode.set(false);
        this.swapSelected.set(null);
        this.actionLoading.set(false);
      },
      error: (err) => {
        this.error.set(err.error?.error || 'Failed to swap players');
        this.swapSelected.set(null);
        this.actionLoading.set(false);
      },
    });
  }

  approvePlayer(playerId: string) {
    this.eventSvc.updatePlayer(this.id(), playerId, { status: 'active' }).subscribe({
      next: () => this.load(),
      error: (err) => this.error.set(err.error?.error || 'Failed to approve player'),
    });
  }

  rejectPlayer(playerId: string) {
    if (!confirm('Reject this join request?')) return;
    this.eventSvc.removePlayer(this.id(), playerId).subscribe({
      next: () => this.load(),
      error: (err) => this.error.set(err.error?.error || 'Failed to reject player'),
    });
  }

  dropPlayer(playerId: string) {
    if (!confirm('Drop this player from the event?')) return;
    this.eventSvc.removePlayer(this.id(), playerId).subscribe({
      next: () => this.load(),
      error: (err) => this.error.set(err.error?.error || 'Failed to drop player'),
    });
  }

  canEditDeck(player: Player): boolean {
    if (this.isOwner() || player.user_id === this.auth.currentUser()?.id) return true;
    return !!(this.event()?.collaborative_deck && this.isJoined());
  }

  openDeckEdit(player: Player) {
    this.deckNameInput.set(player.deck_name ?? '');
    this.editDeckModal.set({ playerId: player.id, current: player.deck_name ?? '' });
  }

  saveDeckName() {
    const modal = this.editDeckModal();
    if (!modal) return;
    this.eventSvc.updatePlayer(this.id(), modal.playerId, { deck_name: this.deckNameInput() }).subscribe({
      next: () => { this.load(); this.editDeckModal.set(null); },
      error: (err) => this.error.set(err.error?.error || 'Failed to update deck'),
    });
  }

  finishEvent() {
    if (!confirm('Finalizar este evento? Ele será movido para Past Events e não poderá receber novas rodadas.')) return;
    this.eventSvc.finishEvent(this.id()).subscribe({
      next: () => this.load(),
      error: (err) => this.error.set(err.error?.error || 'Failed to finish event'),
    });
  }

  deleteEvent() {
    if (!confirm('Delete this event permanently? This cannot be undone.')) return;
    this.eventSvc.deleteEvent(this.id()).subscribe({
      next: () => this.router.navigate(['/events']),
      error: (err) => this.error.set(err.error?.error || 'Failed to delete event'),
    });
  }

  openAddPlayer() {
    this.addPlayerEmail.set('');
    this.addPlayerName.set('');
    this.addPlayerError.set('');
    this.addPlayerModal.set(true);
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
    this.eventSvc.addPlayer(this.id(), { email: email || undefined, display_name: name || undefined }).subscribe({
      next: () => { this.load(); this.addPlayerModal.set(false); this.addPlayerLoading.set(false); },
      error: (err) => { this.addPlayerError.set(err.error?.error || 'Failed to add player'); this.addPlayerLoading.set(false); },
    });
  }

  thumbnailUrl(): string {
    const t = this.event()?.thumbnail;
    return t ? `${this.apiUrl}${t}` : '';
  }

  resultLabel(result: string | undefined): string {
    if (!result) return 'Pending';
    const map: Record<string, string> = { player1: 'P1 Win', player2: 'P2 Win', draw: 'Draw', bye: 'Bye' };
    return map[result] ?? result;
  }

  roundLabel(round: Round): string {
    return round.is_playoff ? `🏆 Playoffs — ${round.playoff_stage}` : `Round ${round.round_number}`;
  }

  ordinal(n: number): string {
    const s = ['th', 'st', 'nd', 'rd'];
    const v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }

  myResultLabel(pairing: Pairing, myPlayerId: string): { label: string; cls: string } {
    if (!pairing.result) return { label: 'Pending', cls: 'result-pending' };
    if (pairing.result === 'bye') return { label: 'Bye (Win)', cls: 'result-win' };
    if (pairing.result === 'draw') return { label: 'Draw', cls: 'result-draw' };
    const iAm1 = pairing.player1_id === myPlayerId;
    const won = (iAm1 && pairing.result === 'player1') || (!iAm1 && pairing.result === 'player2');
    return won ? { label: 'Win', cls: 'result-win' } : { label: 'Loss', cls: 'result-loss' };
  }
}
