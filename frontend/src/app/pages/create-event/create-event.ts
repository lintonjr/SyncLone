import { Component, inject, signal, input, OnInit, computed } from '@angular/core';
import { I18nService, mensagemDeErro } from '../../i18n/i18n';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { EventService } from '../../services/event';
import { LeagueService, League } from '../../services/league';
import { AuthService } from '../../services/auth';
import { environment } from '../../../environments/environment';

@Component({
  selector: 'app-create-event',
  imports: [CommonModule],
  templateUrl: './create-event.html',
  styleUrl: './create-event.scss',
})
export class CreateEventComponent implements OnInit {
  i18n = inject(I18nService);
  id = input<string>('');
  private eventSvc = inject(EventService);
  private leagueSvc = inject(LeagueService);
  private auth = inject(AuthService);
  private router = inject(Router);
  apiUrl = environment.apiUrl.replace('/api', '');
  myLeagues = signal<League[]>([]);
  leagueId = signal('');

  name = signal('');
  city = signal('');
  address = signal('');
  online = signal(false);
  description = signal('');
  date = signal('');
  time = signal('');
  game = signal('');
  format = signal('');
  pairingMethod = signal('swiss');
  tournamentFormat = signal<'standard' | 'clafronto'>('standard');
  isClanFormat = computed(() => this.tournamentFormat() === 'clafronto');
  podSize = signal(2);
  roundMinutes = signal(50);
  pointsWin = signal(3);
  pointsDraw = signal(1);
  pointsLoss = signal(0);
  playoffStructure = signal('none');
  allowByes = signal(false);
  testEvent = signal(false);
  collaborativeDeck = signal(false);
  asyncDraws = signal(false);
  confirmPlayers = signal(false);
  qrCodeEnabled = signal(false);
  thumbnailFile: File | null = null;
  thumbnailPreview = signal('');
  loading = signal(false);
  error = signal('');

  isEditMode = false;
  existingThumbnail = '';

  readonly GAMES = ['MTG', 'Pokémon', 'Yu-Gi-Oh!', 'Lorcana', 'Flesh and Blood', 'Other'];
  readonly FORMATS = {
    MTG: [
      'Commander',
      'Commander500',
      'cEDH',
      'Conquest',
      'Standard',
      'Modern',
      'Legacy',
      'Pioneer',
      'Pauper',
    ],
    Pokémon: ['Standard', 'Expanded', 'Unlimited'],
    'Yu-Gi-Oh!': ['Advanced', 'Traditional'],
    Lorcana: ['Constructed'],
    'Flesh and Blood': ['Classic Constructed', 'Blitz', 'Draft'],
    Other: [],
  } as Record<string, string[]>;

  ngOnInit() {
    if (this.auth.currentUser()?.role === 'organizer') {
      this.leagueSvc.getMyLeagues().subscribe({
        next: (leagues) => this.myLeagues.set(leagues),
        error: (err) => console.error('Failed to load leagues', err),
      });
    }
    if (this.id()) {
      this.isEditMode = true;
      this.eventSvc.getEvent(this.id()).subscribe({
        next: (ev) => {
          this.name.set(ev.name);
          this.city.set(ev.city ?? '');
          this.address.set(ev.address ?? '');
          this.online.set(!!ev.online);
          this.description.set(ev.description ?? '');
          const d = new Date(ev.date);
          this.date.set(d.toISOString().slice(0, 10));
          this.time.set(d.toTimeString().slice(0, 5));
          this.game.set(ev.game);
          this.format.set(ev.format ?? '');
          this.pairingMethod.set(ev.pairing_method);
          this.tournamentFormat.set(ev.tournament_format ?? 'standard');
          this.podSize.set(this.isClanFormat() ? 4 : (ev.pod_size ?? 2));
          this.roundMinutes.set(ev.round_minutes ?? 50);
          this.pointsWin.set(ev.points_win ?? 3);
          this.pointsDraw.set(ev.points_draw ?? 1);
          this.pointsLoss.set(ev.points_loss ?? 0);
          this.playoffStructure.set(ev.playoff_structure);
          this.allowByes.set(this.isClanFormat() ? false : !!ev.allow_byes);
          this.testEvent.set(!!ev.test_event);
          this.collaborativeDeck.set(!!ev.collaborative_deck);
          this.asyncDraws.set(!!ev.async_draws);
          this.confirmPlayers.set(!!ev.confirm_players);
          this.qrCodeEnabled.set(!!ev.qr_code_enabled);
          this.leagueId.set(ev.league_id ?? '');
          if (ev.thumbnail) {
            this.existingThumbnail = `${this.apiUrl}${ev.thumbnail}`;
            this.thumbnailPreview.set(this.existingThumbnail);
          }
        },
        error: () => this.error.set('Failed to load event'),
      });
    }
  }

  private readonly POD4_FORMATS = ['Commander', 'Commander500', 'cEDH', 'Conquest'];

  formats(): string[] {
    return this.FORMATS[this.game()] ?? [];
  }

  // Clã Fronto manda na mesa (sempre 4) e no playoff (só 2 ou 4 clãs).
  onTournamentFormatChange(f: 'standard' | 'clafronto') {
    this.tournamentFormat.set(f);
    if (f === 'clafronto') {
      this.podSize.set(4);
      this.allowByes.set(false);
      if (!['clan2', 'clan4'].includes(this.playoffStructure())) this.playoffStructure.set('clan4');
    } else if (['clan2', 'clan4'].includes(this.playoffStructure())) {
      this.playoffStructure.set('none');
    }
  }

  onFormatChange(f: string) {
    this.format.set(f);
    this.podSize.set(this.POD4_FORMATS.includes(f) ? 4 : 2);
  }

  onFile(event: Event) {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    this.thumbnailFile = file;
    const reader = new FileReader();
    reader.onload = (e) => this.thumbnailPreview.set(e.target?.result as string);
    reader.readAsDataURL(file);
  }

  submit() {
    if (!this.name() || !this.game() || !this.date()) {
      this.error.set('Name, game and date are required');
      return;
    }
    this.loading.set(true);
    this.error.set('');

    const dateTime = this.time() ? `${this.date()}T${this.time()}:00` : `${this.date()}T00:00:00`;
    const fd = new FormData();
    fd.append('name', this.name());
    fd.append('city', this.city());
    fd.append('address', this.address());
    fd.append('online', String(this.online()));
    fd.append('description', this.description());
    fd.append('date', dateTime);
    fd.append('game', this.game());
    fd.append('format', this.format());
    fd.append('pairing_method', this.pairingMethod());
    fd.append('tournament_format', this.tournamentFormat());
    fd.append('pod_size', String(this.isClanFormat() ? 4 : this.podSize()));
    fd.append('round_minutes', String(this.roundMinutes()));
    fd.append('points_win', String(this.pointsWin()));
    fd.append('points_draw', String(this.pointsDraw()));
    fd.append('points_loss', String(this.pointsLoss()));
    fd.append('playoff_structure', this.playoffStructure());
    // Clã Fronto não tem folga: o servidor força isso, e o formulário não deve
    // reenviar um valor herdado de um evento gravado antes da trava existir.
    fd.append('allow_byes', String(this.isClanFormat() ? false : this.allowByes()));
    fd.append('test_event', String(this.testEvent()));
    fd.append('collaborative_deck', String(this.collaborativeDeck()));
    fd.append('async_draws', String(this.asyncDraws()));
    fd.append('confirm_players', String(this.confirmPlayers()));
    fd.append('qr_code_enabled', String(this.qrCodeEnabled()));
    fd.append('league_id', this.leagueId());
    if (this.thumbnailFile) fd.append('thumbnail', this.thumbnailFile);

    const request = this.isEditMode
      ? this.eventSvc.updateEvent(this.id(), fd)
      : this.eventSvc.createEvent(fd);

    request.subscribe({
      next: (ev: any) => {
        this.loading.set(false);
        this.router.navigate(['/event', ev.id]);
      },
      error: (err: any) => {
        this.error.set(mensagemDeErro(this.i18n, err));
        this.loading.set(false);
      },
    });
  }
}
