import { Routes } from '@angular/router';
import { authGuard } from './guards/auth-guard';
import { organizerGuard } from './guards/organizer-guard';
import { adminGuard } from './guards/admin-guard';

export const routes: Routes = [
  { path: '', loadComponent: () => import('./pages/home/home').then((m) => m.HomeComponent) },
  {
    path: 'login',
    loadComponent: () => import('./pages/login/login').then((m) => m.LoginComponent),
  },
  {
    path: 'register',
    loadComponent: () => import('./pages/register/register').then((m) => m.RegisterComponent),
  },
  {
    path: 'forgot-password',
    loadComponent: () =>
      import('./pages/forgot-password/forgot-password').then((m) => m.ForgotPasswordComponent),
  },
  {
    path: 'profile',
    loadComponent: () => import('./pages/profile/profile').then((m) => m.ProfileComponent),
    canActivate: [authGuard],
  },
  {
    path: 'create',
    loadComponent: () =>
      import('./pages/create-event/create-event').then((m) => m.CreateEventComponent),
    canActivate: [authGuard, organizerGuard],
  },
  {
    // Área do organizador: criar badges e entregá-las.
    path: 'badges',
    loadComponent: () => import('./pages/badges/badges').then((m) => m.BadgesComponent),
    canActivate: [authGuard, organizerGuard],
  },
  {
    // Área do dono da plataforma: quem pediu para organizar, e quem já organiza.
    path: 'admin',
    loadComponent: () => import('./pages/admin/admin').then((m) => m.AdminComponent),
    canActivate: [authGuard, adminGuard],
  },
  {
    path: 'events',
    loadComponent: () => import('./pages/my-events/my-events').then((m) => m.MyEventsComponent),
    canActivate: [authGuard],
  },
  {
    path: 'event/:id',
    loadComponent: () =>
      import('./pages/event-detail/event-detail').then((m) => m.EventDetailComponent),
  },
  {
    path: 'event/:id/edit',
    loadComponent: () =>
      import('./pages/create-event/create-event').then((m) => m.CreateEventComponent),
    canActivate: [authGuard, organizerGuard],
  },
  {
    // Público: o perfil só mostra o que já aparece na classificação de cada evento.
    path: 'player/:id',
    loadComponent: () =>
      import('./pages/player-profile/player-profile').then((m) => m.PlayerProfileComponent),
  },
  {
    path: 'leagues',
    loadComponent: () => import('./pages/leagues/leagues').then((m) => m.LeaguesComponent),
  },
  {
    path: 'leagues/create',
    loadComponent: () =>
      import('./pages/create-league/create-league').then((m) => m.CreateLeagueComponent),
    canActivate: [authGuard, organizerGuard],
  },
  {
    path: 'leagues/:id',
    loadComponent: () =>
      import('./pages/league-detail/league-detail').then((m) => m.LeagueDetailComponent),
  },
  {
    path: 'leagues/:id/edit',
    loadComponent: () =>
      import('./pages/create-league/create-league').then((m) => m.CreateLeagueComponent),
    canActivate: [authGuard, organizerGuard],
  },
  { path: '**', redirectTo: '' },
];
