import { Routes } from '@angular/router';
import { authGuard } from './guards/auth-guard';

export const routes: Routes = [
  { path: '', loadComponent: () => import('./pages/home/home').then(m => m.HomeComponent) },
  { path: 'login', loadComponent: () => import('./pages/login/login').then(m => m.LoginComponent) },
  { path: 'register', loadComponent: () => import('./pages/register/register').then(m => m.RegisterComponent) },
  { path: 'forgot-password', loadComponent: () => import('./pages/forgot-password/forgot-password').then(m => m.ForgotPasswordComponent) },
  { path: 'create', loadComponent: () => import('./pages/create-event/create-event').then(m => m.CreateEventComponent), canActivate: [authGuard] },
  { path: 'events', loadComponent: () => import('./pages/my-events/my-events').then(m => m.MyEventsComponent), canActivate: [authGuard] },
  { path: 'event/:id', loadComponent: () => import('./pages/event-detail/event-detail').then(m => m.EventDetailComponent) },
  { path: 'event/:id/edit', loadComponent: () => import('./pages/create-event/create-event').then(m => m.CreateEventComponent), canActivate: [authGuard] },
  { path: '**', redirectTo: '' },
];
