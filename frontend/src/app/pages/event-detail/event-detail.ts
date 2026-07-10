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
  tab = signal<'standings' | 'results' | 'myround'>('standings');
  actionLoading = signal(false);
  error = signal('');
  resultModal = signal<{ pairingId: string } | null>(null);
  editDeckModal = signal<{ playerId: string; current: string } | null>(null);
  deckNameInput = signal('');
  addPlayerModal = signal(false);
  addPlayerEmail = signal('');
  addPlayerName = signal('');
  addPlayerLoading = signal(false);
  addPlayerError = signal('');

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

  roundsGrouped = computed(() => {
    const ev = this.event();
    if (!ev?.rounds) return [];
    return ev.rounds.map((r) => ({
      ...r,
      pairings: (ev.pairings ?? []).filter((p) => p.round_id === r.id),
    }));
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
      (p) => p.player1_id === myPlayer.id || p.player2_id === myPlayer.id
    );
    return pairing ? { round: latestRound, pairing, myPlayer } : null;
  });

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
      next: () => { this.load(); this.actionLoading.set(false); },
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

  submitResult(pairingId: string, result: string) {
    this.eventSvc.submitResult(this.id(), pairingId, result).subscribe({
      next: () => { this.load(); this.resultModal.set(null); },
      error: (err) => this.error.set(err.error?.error || 'Failed to submit result'),
    });
  }

  dropPlayer(playerId: string) {
    if (!confirm('Drop this player from the event?')) return;
    this.eventSvc.removePlayer(this.id(), playerId).subscribe({
      next: () => this.load(),
      error: (err) => this.error.set(err.error?.error || 'Failed to drop player'),
    });
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
