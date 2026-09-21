import { TestBed } from '@angular/core/testing';
import { provideRouter, Router, UrlTree } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { senhaTemporariaGuard } from './senha-guard';
import { AuthService } from '../services/auth';

/** Roda a guarda como o router roda: dentro do contexto de injeção. */
function guarda(url: string) {
  return TestBed.runInInjectionContext(() =>
    senhaTemporariaGuard({} as never, { url } as never),
  ) as boolean | UrlTree;
}

function entrar(must_change_password: boolean) {
  TestBed.inject(AuthService).currentUser.set({
    id: 'u1',
    display_name: 'Pessoa',
    email: 'pessoa@t.local',
    role: 'player',
    must_change_password,
  });
}

describe('senhaTemporariaGuard', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
  });

  it('com senha temporária, toda rota leva à troca', () => {
    entrar(true);
    const destino = guarda('/events');
    expect(destino).toBeInstanceOf(UrlTree);
    expect(TestBed.inject(Router).serializeUrl(destino as UrlTree)).toBe('/nova-senha');
  });

  it('a própria tela de troca passa, senão o desvio não teria fim', () => {
    entrar(true);
    expect(guarda('/nova-senha')).toBe(true);
  });

  it('quem já trocou segue para onde ia', () => {
    entrar(false);
    expect(guarda('/events')).toBe(true);
  });
});
