import { Component, inject, signal, input, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { LeagueService } from '../../services/league';

@Component({
  selector: 'app-create-league',
  imports: [CommonModule],
  templateUrl: './create-league.html',
  styleUrl: './create-league.scss',
})
export class CreateLeagueComponent implements OnInit {
  id = input<string>('');
  private leagueSvc = inject(LeagueService);
  private router = inject(Router);

  name = signal('');
  playoffCounts = signal(true);
  loading = signal(false);
  error = signal('');
  isEditMode = false;

  ngOnInit() {
    if (this.id()) {
      this.isEditMode = true;
      this.leagueSvc.getLeague(this.id()).subscribe({
        next: (l) => {
          this.name.set(l.name);
          this.playoffCounts.set(!!l.playoff_counts);
        },
        error: () => this.error.set('Failed to load league'),
      });
    }
  }

  submit() {
    if (!this.name().trim()) {
      this.error.set('League name is required');
      return;
    }
    this.loading.set(true);
    this.error.set('');
    const payload = { name: this.name().trim(), playoff_counts: this.playoffCounts() };
    const request = this.isEditMode
      ? this.leagueSvc.updateLeague(this.id(), payload)
      : this.leagueSvc.createLeague(payload);

    request.subscribe({
      next: (league) => this.router.navigate(['/leagues', league.id]),
      error: (err) => {
        this.error.set(err.error?.error || (this.isEditMode ? 'Failed to update league' : 'Failed to create league'));
        this.loading.set(false);
      },
    });
  }
}
