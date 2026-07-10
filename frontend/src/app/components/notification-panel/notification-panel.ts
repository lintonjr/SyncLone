import { Component, inject, output, OnInit } from '@angular/core';
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
