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

function umUsuario(over: Record<string, unknown> = {}) {
  return {
    id: 'u1',
    display_name: 'Pessoa',
    email: 'pessoa@t.local',
    role: 'player',
    created_at: '2026-01-01T00:00:00.000Z',
    events_played: 3,
    events_owned: 0,
    leagues_owned: 0,
    leagues_team: 0,
    ...over,
  };
}

/** Abre a aba de usuários e responde a listagem que o teste declarar. */
async function abrirUsuarios(
  fixture: { detectChanges: () => void; whenStable: () => Promise<unknown> },
  http: HttpTestingController,
  html: HTMLElement,
  usuarios: Record<string, unknown>[],
) {
  (html.querySelector('.tabs button:last-child') as HTMLButtonElement).click();
  fixture.detectChanges();
  http
    .expectOne((r) => r.url.includes('/admin/users'))
    .flush({ users: usuarios, total: usuarios.length, limit: 25, offset: 0 });
  http.expectOne(`${environment.apiUrl}/leagues`).flush([{ id: 'l9', name: 'Liga Livre' }]);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return [...html.querySelectorAll('.usuario-row')];
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
    const { fixture, http, html } = await montar();
    TestBed.inject(AuthService).currentUser.set({
      id: 'eu',
      display_name: 'Dono',
      email: 'dono@t.local',
      role: 'admin',
    });
    const usuarios = await abrirUsuarios(fixture, http, html, [
      umUsuario({ id: 'eu', role: 'admin', display_name: 'Dono' }),
      umUsuario({ id: 'bia', role: 'organizer', display_name: 'Bia' }),
    ]);

    expect(usuarios.length).toBe(2);
    expect(usuarios[0].textContent).toContain('Você');
    expect(usuarios[0].querySelector('button')).toBeFalsy();
    // A outra conta tem o botão que abre a ficha.
    expect(usuarios[1].querySelector('button')?.textContent).toContain('Gerenciar');
  });

  it('a ficha só oferece os papéis que a pessoa ainda não tem', async () => {
    const { fixture, http, html } = await montar();
    await abrirUsuarios(fixture, http, html, [umUsuario({ id: 'a1', role: 'admin' })]);

    (html.querySelector('.usuario-row button') as HTMLButtonElement).click();
    http.expectOne(`${environment.apiUrl}/admin/users/a1`).flush({
      ...umUsuario({ id: 'a1', role: 'admin' }),
      profile_public: 1,
      leagues: [],
      role_history: [],
    });
    fixture.detectChanges();

    const acoes = [...html.querySelectorAll('.ficha-acoes button')].map((b) => b.textContent ?? '');
    expect(acoes.some((t) => t.includes('Tornar administrador'))).toBe(false);
    expect(acoes.some((t) => t.includes('Tornar organizador'))).toBe(true);
    expect(acoes.some((t) => t.includes('Rebaixar para jogador'))).toBe(true);
  });

  it('a ficha mostra as ligas da pessoa e o histórico de papel', async () => {
    const { fixture, http, html } = await montar();
    await abrirUsuarios(fixture, http, html, [umUsuario({ id: 'bia', role: 'organizer' })]);

    (html.querySelector('.usuario-row button') as HTMLButtonElement).click();
    http.expectOne(`${environment.apiUrl}/admin/users/bia`).flush({
      ...umUsuario({ id: 'bia', role: 'organizer' }),
      profile_public: 1,
      leagues: [
        { id: 'l1', name: 'Liga de Sexta', vinculo: 'time' },
        { id: 'l2', name: 'Liga Anual', vinculo: 'dona' },
      ],
      role_history: [
        {
          de: 'player',
          para: 'organizer',
          motivo: 'Organiza na loja',
          created_at: '2026-09-01T12:00:00Z',
          autor: 'Dono',
        },
      ],
    });
    fixture.detectChanges();

    const ficha = html.querySelector('.ficha')!;
    expect(ficha.textContent).toContain('Liga de Sexta');
    expect(ficha.textContent).toContain('Liga Anual');
    // De dona ninguém a remove; do time, sim.
    expect(ficha.querySelectorAll('.ligas li button').length).toBe(1);
    expect(ficha.textContent).toContain('Organiza na loja');
    expect(ficha.textContent).toContain('por Dono');
  });

  it('busca e filtro vão para o servidor, não filtram no navegador', async () => {
    const { fixture, http, html } = await montar();
    await abrirUsuarios(fixture, http, html, [umUsuario()]);

    const select = html.querySelector('.filtros select') as HTMLSelectElement;
    select.value = 'organizer';
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    // A query vai montada na URL: é o servidor que busca e filtra, não a tela.
    const req = http.expectOne((r) => r.url.includes('role=organizer'));
    expect(req.request.url).toContain('limit=25');
    req.flush({ users: [], total: 0, limit: 25, offset: 0 });
  });
});
