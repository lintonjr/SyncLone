import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth';

export const organizerGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  // Admin passa também: os papéis são excludentes na coluna e hierárquicos na
  // permissão, como no `requireOrganizer` do servidor.
  const papel = auth.currentUser()?.role;
  if (papel === 'organizer' || papel === 'admin') return true;
  return router.createUrlTree(['/profile']);
};
