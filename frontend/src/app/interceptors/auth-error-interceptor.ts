import { inject } from '@angular/core';
import { HttpInterceptorFn, HttpErrorResponse } from '@angular/common/http';
import { Router, ActivatedRouteSnapshot } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import { AuthService } from '../services/auth';

// A rota atual exige login? (é a mesma pergunta que o authGuard responde)
function onGuardedRoute(root: ActivatedRouteSnapshot): boolean {
  for (let route: ActivatedRouteSnapshot | null = root; route; route = route.firstChild) {
    if (route.routeConfig?.canActivate?.length) return true;
  }
  return false;
}

/**
 * Um 401 significa que a sessão morreu — token expirado, ou conta que não existe
 * mais. A sessão é sempre descartada; o redirecionamento para o login só acontece
 * se a página atual exigir login.
 *
 * A distinção passou a importar quando a navbar começou a buscar notificações em
 * toda carga de página para o contador do sino: sem ela, um token velho no
 * localStorage expulsava o visitante de páginas públicas — inclusive da própria
 * tela de cadastro — antes que ele conseguisse digitar qualquer coisa.
 */
export const authErrorInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const router = inject(Router);
  return next(req).pipe(
    catchError((err: HttpErrorResponse) => {
      if (err.status === 401 && auth.isLoggedIn()) {
        if (onGuardedRoute(router.routerState.snapshot.root)) auth.logout();
        else auth.clearSession();
      }
      return throwError(() => err);
    }),
  );
};
