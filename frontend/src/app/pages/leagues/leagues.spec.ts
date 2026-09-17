import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { LeaguesComponent } from '../leagues/leagues';
import { MyEventsComponent } from '../my-events/my-events';
import { AuthService } from '../../services/auth';
import { environment } from '../../../environments/environment';
import { I18nService } from '../../i18n/i18n';

type Papel = 'player' | 'organizer' | 'admin';

function logar(papel: Papel) {
  TestBed.configureTestingModule({
    providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
  });
  TestBed.inject(I18nService).lang.set('pt-BR');
  TestBed.inject(AuthService).currentUser.set({
    id: 'u1',
    display_name: 'Pessoa',
    email: 'pessoa@t.local',
    role: papel,
  } as never);
  return TestBed.inject(HttpTestingController);
}

async function botoesDeCriar(papel: Papel, tela: 'ligas' | 'eventos') {
  const http = logar(papel);
  const fixture =
    tela === 'ligas'
      ? TestBed.createComponent(LeaguesComponent)
      : TestBed.createComponent(MyEventsComponent);
  fixture.detectChanges();
  if (tela === 'ligas') http.expectOne(`${environment.apiUrl}/leagues`).flush([]);
  else http.expectOne(`${environment.apiUrl}/events/user/mine`).flush({ owned: [], joined: [] });
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  const html = fixture.nativeElement as HTMLElement;
  return [...html.querySelectorAll('a.btn')]
    .map((a) => a.textContent?.trim() ?? '')
    .filter((t) => t.includes('Criar'));
}

describe('Botões de criar: admin também organiza', () => {
  // O bug: as telas comparavam o papel com 'organizer' e o dono da plataforma
  // (admin) ficava sem "Criar liga" e "Criar evento", embora o servidor e as rotas
  // já o deixassem criar.
  it('admin vê criar liga e criar evento', async () => {
    expect(await botoesDeCriar('admin', 'ligas')).toContain('+ Criar liga');
  });

  it('admin vê criar evento em Meus eventos', async () => {
    expect(await botoesDeCriar('admin', 'eventos')).toContain('+ Criar evento');
  });

  it('organizador continua vendo', async () => {
    expect(await botoesDeCriar('organizer', 'ligas')).toContain('+ Criar liga');
  });

  it('jogador não vê', async () => {
    expect(await botoesDeCriar('player', 'ligas')).toEqual([]);
    TestBed.resetTestingModule();
    expect(
      (await botoesDeCriar('player', 'eventos')).filter((t) => t === '+ Criar evento'),
    ).toEqual([]);
  });
});
