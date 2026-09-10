import { ApplicationConfig, LOCALE_ID, provideBrowserGlobalErrorListeners } from '@angular/core';
import { registerLocaleData } from '@angular/common';
import localePt from '@angular/common/locales/pt';

// As datas do DatePipe também são interface: com a tela em português e a data
// em "May 18, 2030", a tradução fica pela metade. O locale é lido uma vez, na
// inicialização — trocar de idioma em tempo de execução recarrega os rótulos,
// mas a formatação de data só muda no próximo carregamento.
registerLocaleData(localePt);
const idiomaSalvo = (() => {
  try {
    return localStorage.getItem('lang');
  } catch {
    return null;
  }
})();
const LOCALE =
  idiomaSalvo === 'en'
    ? 'en-US'
    : idiomaSalvo === 'pt-BR'
      ? 'pt-BR'
      : navigator.language?.toLowerCase().startsWith('pt')
        ? 'pt-BR'
        : 'en-US';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';

import { routes } from './app.routes';
import { authErrorInterceptor } from './interceptors/auth-error-interceptor';

export const appConfig: ApplicationConfig = {
  providers: [
    { provide: LOCALE_ID, useValue: LOCALE },
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes, withComponentInputBinding()),
    provideHttpClient(withFetch(), withInterceptors([authErrorInterceptor])),
    provideAnimationsAsync(),
  ],
};
