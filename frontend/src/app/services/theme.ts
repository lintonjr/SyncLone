import { Injectable, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  isDark = signal<boolean>(localStorage.getItem('theme') !== 'light');

  constructor() {
    this.apply();
  }

  toggle() {
    this.isDark.update((v) => !v);
    localStorage.setItem('theme', this.isDark() ? 'dark' : 'light');
    this.apply();
  }

  private apply() {
    document.body.classList.toggle('light-theme', !this.isDark());
  }
}
