import { Component, inject, signal, input, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { EventService } from '../../services/event';
import { environment } from '../../../environments/environment';

@Component({
  selector: 'app-create-event',
  imports: [CommonModule],
  templateUrl: './create-event.html',
  styleUrl: './create-event.scss',
})
export class CreateEventComponent implements OnInit {
  id = input<string>('');
  private eventSvc = inject(EventService);
  private router = inject(Router);
  apiUrl = environment.apiUrl.replace('/api', '');

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
  podSize = signal(2);
  pointsWin = signal(3);
  pointsDraw = signal(1);
  pointsLoss = signal(0);
  playoffStructure = signal('none');
  allowByes = signal(false);
  testEvent = signal(false);
  collaborativeDeck = signal(false);
  asyncDraws = signal(false);
  confirmPlayers = signal(false);
  thumbnailFile: File | null = null;
  thumbnailPreview = signal('');
  loading = signal(false);
  error = signal('');

  isEditMode = false;
  existingThumbnail = '';

  readonly GAMES = ['MTG', 'Pokémon', 'Yu-Gi-Oh!', 'Lorcana', 'Flesh and Blood', 'Other'];
  readonly FORMATS = {
    MTG: ['Commander', 'Commander500', 'cEDH', 'Conquest', 'Standard', 'Modern', 'Legacy', 'Pioneer', 'Pauper'],
    'Pokémon': ['Standard', 'Expanded', 'Unlimited'],
    'Yu-Gi-Oh!': ['Advanced', 'Traditional'],
    Lorcana: ['Constructed'],
    'Flesh and Blood': ['Classic Constructed', 'Blitz', 'Draft'],
    Other: [],
  } as Record<string, string[]>;

  ngOnInit() {
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
          this.podSize.set(ev.pod_size ?? 2);
          this.pointsWin.set(ev.points_win ?? 3);
          this.pointsDraw.set(ev.points_draw ?? 1);
          this.pointsLoss.set(ev.points_loss ?? 0);
          this.playoffStructure.set(ev.playoff_structure);
          this.allowByes.set(!!ev.allow_byes);
          this.testEvent.set(!!ev.test_event);
          this.collaborativeDeck.set(!!ev.collaborative_deck);
          this.asyncDraws.set(!!ev.async_draws);
          this.confirmPlayers.set(!!ev.confirm_players);
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
    fd.append('pod_size', String(this.podSize()));
    fd.append('points_win', String(this.pointsWin()));
    fd.append('points_draw', String(this.pointsDraw()));
    fd.append('points_loss', String(this.pointsLoss()));
    fd.append('playoff_structure', this.playoffStructure());
    fd.append('allow_byes', String(this.allowByes()));
    fd.append('test_event', String(this.testEvent()));
    fd.append('collaborative_deck', String(this.collaborativeDeck()));
    fd.append('async_draws', String(this.asyncDraws()));
    fd.append('confirm_players', String(this.confirmPlayers()));
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
        this.error.set(err.error?.error || (this.isEditMode ? 'Failed to update event' : 'Failed to create event'));
        this.loading.set(false);
      },
    });
  }
}
