import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { AdminComponent } from './admin';
import { AuthService } from '../../services/auth';
import { DialogService } from '../../services/dialog';
import { environment } from '../../../environments/environment';
import { I18nService } from '../../i18n/i18n';

function umPedido(over: Record<string, unknown> = {}) {
  return {
    id: 'r1',
    status: 'pending',
    justification: 'Organizo na loja toda quinta',
    reason: null,
    created_at: '2026-09-10T18:00:00.000Z',
    decided_at: null,
    decided_by_name: null,
    user_id: 'u1',
    display_name: 'Ana Ribeiro',
    email: 'ana@t.local',
    role: 'player',
    user_since: '2026-01-01T00:00:00.000Z',
    events_played: 4,
    ...over,
  };
}

function umStaff(over: Record<string, unknown> = {}) {
  return {
    id: 's1',
    display_name: 'Bruno Alves',
    email: 'bruno@t.local',
    role: 'organizer',
    created_at: '2026-02-01T00:00:00.000Z',
    events_owned: 3,
    ...over,
  };
}

/** Monta a tela já respondida, com a fila e o quadro que o teste declarar. */
async function montar(
  pedidos: Record<string, unknown>[] = [],
  staff: Record<string, unknown>[] = [],
) {
  TestBed.configureTestingModule({
    providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
  });
  TestBed.inject(I18nService).lang.set('pt-BR');
  const http = TestBed.inject(HttpTestingController);
  const fixture = TestBed.createComponent(AdminComponent);
  fixture.detectChanges();

  http.expectOne(`${environment.apiUrl}/admin/organizer-requests`).flush(pedidos);
  http.expectOne(`${environment.apiUrl}/admin/staff`).flush(staff);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return { fixture, http, html: fixture.nativeElement as HTMLElement };
}

describe('AdminComponent', () => {
  it('mostra o pedido com a justificativa e o histórico de quem pediu', async () => {
    // A decisão é sobre uma pessoa, não sobre uma linha: sem o contexto (há
    // quanto tempo está na plataforma, quantos eventos jogou, por que pede) o
    // dono estaria decidindo no escuro.
    const { html } = await montar([umPedido()]);

    expect(html.textContent).toContain('Ana Ribeiro');
    expect(html.textContent).toContain('ana@t.local');
    expect(html.querySelector('.justification')?.textContent).toContain('loja toda quinta');
    expect(html.textContent).toContain('4 eventos jogados');
  });

  it('diz quando o pedido veio sem justificativa, em vez de deixar um vazio', async () => {
    const { html } = await montar([umPedido({ justification: null })]);

    expect(html.querySelector('.justification')).toBeFalsy();
    expect(html.querySelector('.no-justification')?.textContent).toContain('Sem justificativa');
  });

  it('fila vazia é dita, não é uma tela em branco', async () => {
    const { html } = await montar([]);
    expect(html.querySelector('.empty')?.textContent).toContain('Nenhuma solicitação');
  });

  it('separa pendentes do que já foi decidido, com o motivo à vista', async () => {
    const { html } = await montar([
      umPedido(),
      umPedido({
        id: 'r2',
        status: 'rejected',
        display_name: 'Caio',
        reason: 'Jogue alguns eventos antes',
        decided_at: '2026-09-11T10:00:00.000Z',
      }),
    ]);

    expect(html.querySelectorAll('.request').length).toBe(1);
    expect(html.querySelectorAll('.history-row').length).toBe(1);
    expect(html.querySelector('.history-row')?.textContent).toContain('Jogue alguns eventos antes');
  });

  it('aprovar manda o motivo e recarrega a fila', async () => {
    const { fixture, http, html } = await montar([umPedido()]);
    // O diálogo é assíncrono e não tem DOM neste teste: respondê-lo direto é o
    // que permite testar o que acontece depois da confirmação.
    TestBed.inject(DialogService).prompt = () => Promise.resolve('Bem-vinda');

    const aprovar = [...html.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Aprovar'),
    );
    aprovar!.click();
    await fixture.whenStable();

    const req = http.expectOne(`${environment.apiUrl}/admin/organizer-requests/r1/approve`);
    expect(req.request.body).toEqual({ reason: 'Bem-vinda' });
    req.flush({ id: 'r1', status: 'approved' });

    // Recarrega em vez de remover a linha na mão: o estado que vale é o do
    // servidor, e é dele que sai também o quadro de organizadores, que acabou
    // de ganhar uma pessoa.
    http.expectOne(`${environment.apiUrl}/admin/organizer-requests`).flush([]);
    http.expectOne(`${environment.apiUrl}/admin/staff`).flush([]);
  });

  it('cancelar o diálogo não decide nada', async () => {
    const { fixture, http, html } = await montar([umPedido()]);
    TestBed.inject(DialogService).prompt = () => Promise.resolve(null);

    [...html.querySelectorAll('button')].find((b) => b.textContent?.includes('Recusar'))!.click();
    await fixture.whenStable();

    http.expectNone(`${environment.apiUrl}/admin/organizer-requests/r1/reject`);
  });

  it('não oferece ao dono botão para mexer no próprio papel', async () => {
    // O servidor recusa (api.cannotChangeOwnRole); a tela não deve nem oferecer
    // — um admin que se rebaixa perde a rota que desfaria isso.
    const { fixture, html } = await montar([], [umStaff({ id: 'eu', role: 'admin' }), umStaff()]);
    TestBed.inject(AuthService).currentUser.set({
      id: 'eu',
      display_name: 'Dono',
      email: 'dono@t.local',
      role: 'admin',
    });
    (html.querySelector('.tabs button:last-child') as HTMLButtonElement).click();
    fixture.detectChanges();

    const linhas = html.querySelectorAll('.staff-row');
    expect(linhas.length).toBe(2);
    expect(linhas[0].querySelector('.staff-actions')).toBeFalsy();
    expect(linhas[0].textContent).toContain('Você');
    // A outra conta continua com as duas ações disponíveis.
    expect(linhas[1].querySelectorAll('.staff-actions button').length).toBe(2);
  });

  it('só oferece "tornar administrador" a quem ainda não é', async () => {
    const { fixture, html } = await montar([], [umStaff({ id: 'a1', role: 'admin' })]);
    (html.querySelector('.tabs button:last-child') as HTMLButtonElement).click();
    fixture.detectChanges();

    const botoes = [...html.querySelectorAll('.staff-actions button')].map((b) => b.textContent);
    expect(botoes.some((t) => t?.includes('Tornar administrador'))).toBe(false);
    expect(botoes.some((t) => t?.includes('Remover acesso'))).toBe(true);
  });
});
