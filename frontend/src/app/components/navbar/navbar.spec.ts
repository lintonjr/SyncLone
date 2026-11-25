import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { NavbarComponent } from './navbar';
import { AuthService, User } from '../../services/auth';
import { I18nService } from '../../i18n/i18n';

/**
 * A navegação, com atenção ao celular.
 *
 * Abaixo de 640px a barra de links some, e por muito tempo não havia nada no
 * lugar: Avaliações, Administração, Criar evento, Badges e Ligas ficavam
 * inalcançáveis no telefone — justo quem atende o balcão, que é quem mais usa
 * o celular. O menu existe para isso, e estes testes cobrem o jeito de ele
 * voltar a quebrar: a barra e o menu desenharem listas diferentes.
 */
function montar(quem: User | null = null) {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
  });
  TestBed.inject(I18nService).lang.set('pt-BR');
  TestBed.inject(AuthService).currentUser.set(quem);
  const fixture = TestBed.createComponent(NavbarComponent);
  fixture.detectChanges();
  return { fixture, html: fixture.nativeElement as HTMLElement };
}

function alguem(over: Partial<User> = {}): User {
  return { id: 'u1', display_name: 'Pessoa', email: 'p@t.local', role: 'player', ...over };
}

/** Os destinos que a barra do desktop oferece. */
function daBarra(html: HTMLElement) {
  return [...html.querySelectorAll('.nav-links a')].map((a) => a.getAttribute('href'));
}

/** Os destinos do menu do celular — abrindo-o, porque ele só é montado aberto. */
function doMenu(
  fixture: { componentInstance: NavbarComponent; detectChanges: () => void },
  html: HTMLElement,
) {
  fixture.componentInstance.showMenu.set(true);
  fixture.detectChanges();
  return [...html.querySelectorAll('.menu-dropdown a')].map((a) => a.getAttribute('href'));
}

describe('NavbarComponent', () => {
  it('o menu do celular oferece exatamente o que a barra oferece, em todo papel', () => {
    // Este é o teste que importa. Enquanto as duas listas saírem do mesmo
    // `links()`, acrescentar um destino novo chega aos dois lugares sozinho;
    // no dia em que alguém escrever a lista duas vezes, isto falha.
    const papeis: Array<[string, User | null]> = [
      ['deslogado', null],
      ['jogador', alguem()],
      ['organizador', alguem({ role: 'organizer' })],
      ['avaliador', alguem({ avaliador: true })],
      ['admin', alguem({ role: 'admin' })],
    ];
    for (const [nome, quem] of papeis) {
      const { fixture, html } = montar(quem);
      expect({ [nome]: doMenu(fixture, html) }).toEqual({ [nome]: daBarra(html) });
    }
  });

  it('quem avalia alcança Avaliações pelo celular', () => {
    // O defeito relatado: no telefone não havia como chegar ao balcão.
    const { fixture, html } = montar(alguem({ avaliador: true }));

    expect(doMenu(fixture, html)).toContain('/avaliacoes');
    expect(html.querySelector('.menu-dropdown')?.textContent).toContain('Avaliações');
  });

  it('quem organiza alcança Criar evento e Badges pelo celular', () => {
    const { fixture, html } = montar(alguem({ role: 'organizer' }));
    const destinos = doMenu(fixture, html);

    expect(destinos).toContain('/create');
    expect(destinos).toContain('/badges');
  });

  it('o dono da plataforma alcança a Administração, e organiza também', () => {
    // Admin organiza por definição — a regra mora no AuthService.
    const { fixture, html } = montar(alguem({ role: 'admin' }));
    const destinos = doMenu(fixture, html);

    expect(destinos).toContain('/admin');
    expect(destinos).toContain('/create');
    expect(destinos).toContain('/avaliacoes');
  });

  it('o menu não oferece o que o papel não alcança', () => {
    // Quem não organiza nem avalia não deve ver porta que o guard vai fechar.
    const { fixture, html } = montar(alguem());
    const destinos = doMenu(fixture, html);

    expect(destinos).toEqual(['/', '/events', '/leagues']);
  });

  it('o menu fica fechado até alguém pedir, e fecha ao escolher um destino', () => {
    const { fixture, html } = montar(alguem());
    expect(html.querySelector('.menu-dropdown')).toBeFalsy();

    const botao = html.querySelector('.menu-btn') as HTMLButtonElement;
    botao.click();
    fixture.detectChanges();
    expect(html.querySelector('.menu-dropdown')).toBeTruthy();
    expect(botao.getAttribute('aria-expanded')).toBe('true');

    (html.querySelector('.menu-dropdown a') as HTMLAnchorElement).click();
    fixture.detectChanges();
    // Sem isto, o painel cobriria a tela para onde a pessoa acabou de navegar.
    expect(html.querySelector('.menu-dropdown')).toBeFalsy();
  });

  it('tocar fora fecha o menu, como já fechava o da conta', () => {
    const { fixture, html } = montar(alguem());
    fixture.componentInstance.showMenu.set(true);
    fixture.detectChanges();

    document.dispatchEvent(new MouseEvent('click'));
    fixture.detectChanges();

    expect(html.querySelector('.menu-dropdown')).toBeFalsy();
  });

  it('o botão do menu se anuncia, e o rótulo acompanha o idioma', () => {
    const { fixture, html } = montar(alguem());
    const botao = html.querySelector('.menu-btn') as HTMLButtonElement;

    expect(botao.getAttribute('aria-label')).toBe('Abrir menu');
    expect(botao.getAttribute('aria-expanded')).toBe('false');

    TestBed.inject(I18nService).lang.set('en');
    fixture.detectChanges();
    expect(botao.getAttribute('aria-label')).toBe('Open menu');
  });

  it('só a home pede correspondência exata', () => {
    // Sem isso, `/` ficaria marcada como ativa em toda rota, porque toda rota
    // começa com barra — e nenhum outro destino tem esse problema.
    const { fixture } = montar(alguem({ role: 'admin' }));
    const exatos = fixture.componentInstance
      .links()
      .filter((l) => l.exato)
      .map((l) => l.rota);

    expect(exatos).toEqual(['/']);
  });
});
