import { Component, inject, signal, input, OnInit, computed } from '@angular/core';
import { I18nService, mensagemDeErro } from '../../i18n/i18n';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { EventService } from '../../services/event';
import { LeagueService, League } from '../../services/league';
import { AuthService } from '../../services/auth';
import { environment } from '../../../environments/environment';
import {
  FUSO_PADRAO,
  fusosSugeridos,
  paraInstante,
  paraPartes,
  rotuloDoFuso,
} from '../../lib/fuso';

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
  /** Fuso do torneio: a hora digitada é hora de parede dele (lib/fuso.ts). */
  fuso = signal(FUSO_PADRAO);
  fusos = fusosSugeridos();
  rotuloFuso = (f: string) => rotuloDoFuso(f, this.i18n.lang());
  game = signal('');
  format = signal('');
  pairingMethod = signal('swiss');
  tournamentFormat = signal<'standard' | 'clafronto' | 'partner'>('standard');
  isClanFormat = computed(() => this.tournamentFormat() === 'clafronto');
  isPartnerFormat = computed(() => this.tournamentFormat() === 'partner');
  /** Os dois formatos em que a inscrição é por time e a mesa é sempre de quatro. */
  isTeamFormat = computed(() => this.isClanFormat() || this.isPartnerFormat());
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

  // Tirar o evento da liga (ou trocá-lo de liga) é de quem o criou ou do dono da
  // liga; para o restante do time o seletor fica travado, como o servidor exige.
  leagueLocked = signal(false);

  ngOnInit() {
    if (this.auth.podeOrganizar()) {
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
          // O evento guarda um instante; o formulário mostra a hora de parede do
          // fuso dele. Antes daqui saíam a data em UTC e a hora local, o que
          // trocava o dia perto da meia-noite.
          this.fuso.set(ev.timezone || FUSO_PADRAO);
          const { data, hora } = paraPartes(new Date(ev.date), this.fuso());
          this.date.set(data);
          this.time.set(hora);
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
          const eu = this.auth.currentUser()?.id;
          this.leagueLocked.set(!!ev.league_id && ev.owner_id !== eu && ev.league_owner_id !== eu);
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

  /**
   * Os formatos de time mandam na mesa e no playoff, e o servidor cobra as duas
   * coisas. A tela ajusta antes para o organizador não descobrir isso por um 400.
   *
   * A diferença entre eles está no bye: no Clã Fronto o campo é sempre múltiplo
   * de quatro e folga não existe; no partner, número ímpar de duplas obriga uma.
   */
  onTournamentFormatChange(f: 'standard' | 'clafronto' | 'partner') {
    this.tournamentFormat.set(f);
    const playoffsDoFormato: Record<string, string[]> = {
      clafronto: ['clan2', 'clan4'],
      partner: ['partner2', 'partner4', 'partner8'],
    };
    const permitidos = playoffsDoFormato[f];
    if (permitidos) {
      this.podSize.set(4);
      this.allowByes.set(f === 'partner');
      if (!permitidos.includes(this.playoffStructure())) this.playoffStructure.set(permitidos[0]);
    } else if (
      this.playoffStructure().startsWith('clan') ||
      this.playoffStructure().startsWith('partner')
    ) {
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

    // Vai como instante (UTC): a hora digitada é hora de parede do fuso escolhido.
    const dateTime = paraInstante(this.date(), this.time(), this.fuso()).toISOString();
    const fd = new FormData();
    fd.append('name', this.name());
    fd.append('city', this.city());
    fd.append('address', this.address());
    fd.append('online', String(this.online()));
    fd.append('description', this.description());
    fd.append('date', dateTime);
    fd.append('timezone', this.fuso());
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
