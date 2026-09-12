import { Component } from '@angular/core';
import { RouterOutlet, RouterLink } from '@angular/router';
import { NavbarComponent } from './components/navbar/navbar';
import { DialogComponent } from './components/dialog/dialog';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, NavbarComponent, RouterLink, DialogComponent],
  template: `
    <app-navbar />
    <main>
      <router-outlet />
    </main>
    <footer class="footer">
      <div class="footer-inner">
        <span>© 2025 Mercadia</span>
        <a routerLink="/terms-of-service">Terms of Service</a>
        <a routerLink="/privacy-policy">Privacy Policy</a>
      </div>
    </footer>

    <!-- Montado uma vez e invisível até alguém perguntar algo. Fica por último
         para ficar por cima de tudo sem depender só do z-index. -->
    <app-dialog />
  `,
  styles: [
    `
      main {
        min-height: calc(100vh - 64px);
        padding-top: 64px;
      }
      .footer {
        border-top: 1px solid var(--border);
        padding: 20px 24px;
        margin-top: 32px;
      }
      .footer-inner {
        max-width: 1200px;
        margin: 0 auto;
        display: flex;
        align-items: center;
        gap: 20px;
        font-size: 13px;
        color: var(--text-muted);
        flex-wrap: wrap;
      }
      .footer-inner a {
        color: var(--text-muted);
      }
      .footer-inner a:hover {
        color: var(--text);
      }
    `,
  ],
})
export class App {}
