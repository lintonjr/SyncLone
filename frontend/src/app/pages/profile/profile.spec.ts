import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ProfileComponent } from './profile';
import { AuthService, User } from '../../services/auth';
import { environment } from '../../../environments/environment';
import { I18nService } from '../../i18n/i18n';

function umUsuario(over: Partial<User> = {}): User {
  return {
    id: 'u1',
    display_name: 'Ana Ribeiro',
    email: 'ana@t.local',
    role: 'player',
    profile_public: 1,
    ...over,
  };
}

/**
 * Monta a tela de conta com o papel e o pedido que o teste declarar.
 *
 * As duas chamadas do ngOnInit (reler o papel e buscar o pedido) são respondidas
 * aqui: o `refreshMe` devolve o mesmo usuário, porque quem decide o papel do
 * teste é o `currentUser` que ele acabou de pôr.
 */
async function montar(user: User, pedido: Record<string, unknown> | null = null) {
  TestBed.configureTestingModule({
    providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
  });
  TestBed.inject(I18nService).lang.set('pt-BR');
  TestBed.inject(AuthService).currentUser.set(user);

  const http = TestBed.inject(HttpTestingController);
  const fixture = TestBed.createComponent(ProfileComponent);
  fixture.detectChanges();

  http.expectOne(`${environment.apiUrl}/users/me`).flush(user);
  http.expectOne(`${environment.apiUrl}/users/me/organizer-request`).flush(pedido);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return { fixture, http, html: fixture.nativeElement as HTMLElement };
}

describe('ProfileComponent — solicitação para organizar', () => {
  it('jogador sem pedido vê o convite para solicitar', async () => {
    const { html } = await montar(umUsuario());
    expect(html.textContent).toContain('Tornar-me organizador');
    expect(html.querySelector('.request-state')).toBeFalsy();
  });

  it('solicitar manda a justificativa e não troca o papel', async () => {
    // O ponto do teste: depois de pedir, a pessoa continua jogadora. O antigo
    // `upgrade-to-organizer` promovia aqui mesmo; hoje quem promove é o dono.
    const { fixture, http, html } = await montar(umUsuario());

    [...html.querySelectorAll('button')]
      .find((b) => b.textContent?.includes('Tornar-me organizador'))!
      .click();
    fixture.detectChanges();

    const textarea = html.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = 'Organizo na loja toda quinta';
    textarea.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    [...html.querySelectorAll('button')]
      .find((b) => b.textContent?.includes('Enviar solicitação'))!
      .click();

    const req = http.expectOne(`${environment.apiUrl}/users/me/organizer-request`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ justification: 'Organizo na loja toda quinta' });
    req.flush({ id: 'r1', status: 'pending', justification: null, reason: null });
    fixture.detectChanges();

    expect(TestBed.inject(AuthService).currentUser()?.role).toBe('player');
    expect(html.querySelector('.request-state.pending')).toBeTruthy();
  });

  it('quem está na fila vê que está, e não um botão que repetiria o pedido', async () => {
    const { html } = await montar(umUsuario(), { id: 'r1', status: 'pending', reason: null });

    expect(html.querySelector('.request-state.pending')?.textContent).toContain(
      'Solicitação enviada',
    );
    expect(html.textContent).not.toContain('Tornar-me organizador');
  });

  it('recusa mostra o motivo e libera pedir de novo', async () => {
    // Recusa sem motivo é silêncio; com motivo, é resposta. E o caminho de volta
    // precisa estar à vista, senão a recusa vira um beco.
    const { html } = await montar(umUsuario(), {
      id: 'r1',
      status: 'rejected',
      reason: 'Jogue alguns eventos antes',
    });

    expect(html.querySelector('.request-state.rejected')?.textContent).toContain(
      'Jogue alguns eventos antes',
    );
    expect(html.textContent).toContain('Solicitar novamente');
  });

  it('organizador não vê nada de solicitação', async () => {
    const { html } = await montar(umUsuario({ role: 'organizer' }));
    expect(html.querySelector('.success-msg')?.textContent).toContain('Você é organizador');
    expect(html.querySelector('.request-state')).toBeFalsy();
  });

  it('o dono da plataforma tem o caminho para a administração', async () => {
    const { html } = await montar(umUsuario({ role: 'admin' }));
    expect(html.querySelector('.success-msg')?.textContent).toContain('administrador');
    expect(html.querySelector('a.admin-link')?.getAttribute('href')).toBe('/admin');
  });
});
