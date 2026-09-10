import { Component, inject, output, OnInit } from '@angular/core';
import { I18nService } from '../../i18n/i18n';
import { CommonModule } from '@angular/common';
import { NotificationService } from '../../services/notification';
import { AuthService } from '../../services/auth';

@Component({
  selector: 'app-notification-panel',
  imports: [CommonModule],
  templateUrl: './notification-panel.html',
  styleUrl: './notification-panel.scss',
})
export class NotificationPanelComponent implements OnInit {
  i18n = inject(I18nService);
  close = output<void>();
  notif = inject(NotificationService);
  auth = inject(AuthService);

  ngOnInit() {
    if (this.auth.isLoggedIn()) {
      this.notif.load().subscribe();
    }
  }

  markAll() {
    this.notif.markAllRead().subscribe();
  }
}
