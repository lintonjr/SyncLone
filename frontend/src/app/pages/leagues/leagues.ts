import { Component, inject, signal, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { LeagueService, League } from '../../services/league';
import { AuthService } from '../../services/auth';

@Component({
  selector: 'app-leagues',
  imports: [CommonModule, RouterLink],
  templateUrl: './leagues.html',
  styleUrl: './leagues.scss',
})
export class LeaguesComponent implements OnInit {
  private leagueSvc = inject(LeagueService);
  auth = inject(AuthService);
  leagues = signal<League[]>([]);
  loading = signal(true);

  ngOnInit() {
    this.leagueSvc.getLeagues().subscribe({
      next: (leagues) => { this.leagues.set(leagues); this.loading.set(false); },
      error: () => this.loading.set(false),
    });
  }
}
