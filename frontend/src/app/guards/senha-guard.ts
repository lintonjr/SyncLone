import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth';

/**
 * Enquanto a senha for a temporária criada por um administrador, toda rota leva à
 * troca.
 *
 * O guard é conveniência, não segurança: quem barra de verdade é o servidor, que
 * só aceita a troca com o token da própria pessoa. O que ele evita é o caso
 * comum — a pessoa entra com a senha ditada no balcão, esquece de trocar, e essa
 * senha segue valendo para quem a ouviu.
 */
export const senhaTemporariaGuard: CanActivateFn = (_rota, estado) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  const precisaTrocar = !!auth.currentUser()?.must_change_password;
  if (!precisaTrocar || estado.url.startsWith('/nova-senha')) return true;
  return router.createUrlTree(['/nova-senha']);
};
