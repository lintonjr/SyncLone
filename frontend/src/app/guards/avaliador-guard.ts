import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth';

/**
 * A área de avaliações é da equipe do balcão: admin, ou quem tem a marca de
 * avaliador na conta.
 *
 * Como todo guard daqui, é conveniência e não segurança — quem barra de verdade
 * é o `requireAvaliador` do servidor, que relê a permissão do banco a cada
 * requisição. O que ele evita é a tela oferecer uma porta que vai dar 403.
 */
export const avaliadorGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  if (auth.podeAvaliar()) return true;
  return router.createUrlTree(['/profile']);
};
