import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { EventListComponent } from './event-list';
import { LayoutEventosService } from '../../services/layout-eventos';
import { I18nService } from '../../i18n/i18n';
import { umEvento } from '../../testing/fixtures';

/**
 * A vitrine: a mesma leva de torneios em pôster ou em lista.
 *
 * Existe como componente porque a leva aparece em quatro lugares (as duas seções
 * da home e as duas abas de "Meus eventos") e a grade já estava copiada no SCSS
 * das duas telas. Os testes cobrem o que essa unificação precisa garantir: que o
 * modo escolhido valha, e que mudar de modo não mude *quais* torneios aparecem.
 */
function montar(layout: 'poster' | 'lista', eventos = [umEvento()]) {
  // Reset explícito: há teste que monta a mesma leva nos dois modos para
  // comparar, e o TestBed só zera sozinho entre um teste e outro.
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({ providers: [provideRouter([])] });
  TestBed.inject(I18nService).lang.set('pt-BR');
  TestBed.inject(LayoutEventosService).usar(layout);
  const fixture = TestBed.createComponent(EventListComponent);
  fixture.componentRef.setInput('events', eventos);
  fixture.detectChanges();
  return { fixture, html: fixture.nativeElement as HTMLElement };
}

describe('EventListComponent', () => {
  afterEach(() => localStorage.removeItem('eventos_layout'));

  it('em pôster, desenha a grade de capas', () => {
    const { html } = montar('poster');

    expect(html.querySelector('.events-grid')).toBeTruthy();
    expect(html.querySelector('app-event-card')).toBeTruthy();
    expect(html.querySelector('app-event-row')).toBeFalsy();
  });

  it('em lista, desenha uma linha por torneio', () => {
    const { html } = montar('lista');

    expect(html.querySelector('.events-list')).toBeTruthy();
    expect(html.querySelector('app-event-row')).toBeTruthy();
    expect(html.querySelector('app-event-card')).toBeFalsy();
  });

  it('o modo muda a aparência, não a lista', () => {
    // Trocar de pôster para lista é uma decisão de exibição: ver "3 de 12"
    // depois de alternar seria a vitrine escondendo torneio.
    const tres = [umEvento({ id: 'a' }), umEvento({ id: 'b' }), umEvento({ id: 'c' })];

    expect(montar('poster', tres).html.querySelectorAll('app-event-card').length).toBe(3);
    expect(montar('lista', tres).html.querySelectorAll('app-event-row').length).toBe(3);
  });

  it('a linha mostra o que não cabe no pôster: liga e inscritos', () => {
    // É o que faz a lista servir para achar um torneio entre muitos.
    const { html } = montar('lista', [
      umEvento({ name: 'Commander da Loja', league_name: 'Liga de Verão', player_count: 12 }),
    ]);

    expect(html.textContent).toContain('Commander da Loja');
    expect(html.textContent).toContain('Liga de Verão');
    expect(html.textContent).toContain('12 jogadores');
  });

  it('torneio sem liga não deixa buraco na linha', () => {
    const { html } = montar('lista', [umEvento({ league_name: undefined })]);

    expect(html.querySelector('.event-row-meta')?.textContent).not.toContain('undefined');
  });

  it('leva vazia não desenha nem grade nem lista com sobra', () => {
    const { html } = montar('poster', []);

    expect(html.querySelectorAll('app-event-card').length).toBe(0);
  });
});
