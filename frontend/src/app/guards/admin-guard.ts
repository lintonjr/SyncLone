import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth';

/**
 * A área do dono da plataforma.
 *
 * O guard é conveniência, não segurança: o papel guardado no navegador pode
 * estar velho ou ter sido editado à mão. Quem de fato barra é `requireAdmin` no
 * servidor, que lê o papel do banco a cada requisição.
 */
export const adminGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  if (auth.currentUser()?.role === 'admin') return true;
  return router.createUrlTree(['/profile']);
};
