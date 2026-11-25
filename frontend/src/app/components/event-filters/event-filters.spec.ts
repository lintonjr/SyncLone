import { vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { EventFiltersComponent, FiltroEventos } from './event-filters';
import { LayoutEventosService } from '../../services/layout-eventos';
import { I18nService } from '../../i18n/i18n';
import { environment } from '../../../environments/environment';

/**
 * A barra que a home e "Meus eventos" compartilham.
 *
 * O que os testes protegem é o que ela promete a quem a monta: uma consulta por
 * busca terminada (e não uma por tecla), o padrão de ordem continuando
 * disponível como escolha, e a lista de ligas sem opção que não leva a nada.
 */
function montar(ligas: unknown[] = []) {
  TestBed.configureTestingModule({
    providers: [provideHttpClient(), provideHttpClientTesting()],
  });
  TestBed.inject(I18nService).lang.set('pt-BR');
  const http = TestBed.inject(HttpTestingController);
  const fixture = TestBed.createComponent(EventFiltersComponent);
  const emitidos: FiltroEventos[] = [];
  fixture.componentInstance.mudou.subscribe((f) => emitidos.push(f));
  fixture.detectChanges();
  http.expectOne(`${environment.apiUrl}/leagues`).flush(ligas);
  fixture.detectChanges();
  return { fixture, http, emitidos, html: fixture.nativeElement as HTMLElement };
}

function digitar(html: HTMLElement, texto: string) {
  const campo = html.querySelector('input[type=search]') as HTMLInputElement;
  campo.value = texto;
  campo.dispatchEvent(new Event('input'));
}

function escolher(select: HTMLSelectElement, valor: string) {
  select.value = valor;
  select.dispatchEvent(new Event('change'));
}

describe('EventFiltersComponent', () => {
  it('espera a pessoa parar de digitar antes de pedir a lista', () => {
    // Uma requisição por letra digitada é uma por letra apagada também: quem
    // escreve "commander" e apaga pediria dezoito listas para ver uma.
    vi.useFakeTimers();
    try {
      const { html, emitidos } = montar();

      digitar(html, 'c');
      digitar(html, 'co');
      digitar(html, 'com');
      expect(emitidos).toEqual([]);

      vi.advanceTimersByTime(300);
      expect(emitidos.length).toBe(1);
      expect(emitidos[0].q).toBe('com');
    } finally {
      vi.useRealTimers();
    }
  });

  it('escolher liga e ordem vale na hora, sem espera', () => {
    // Clique não é digitação: não há "última tecla" pela qual esperar.
    const { html, emitidos } = montar([{ id: 'l1', name: 'Liga da Loja', event_count: 4 }]);
    const [liga, ordem] = [...html.querySelectorAll('select')] as HTMLSelectElement[];

    escolher(liga, 'l1');
    expect(emitidos.at(-1)).toEqual({ q: '', leagueId: 'l1', ordem: '' });

    escolher(ordem, 'data_asc');
    expect(emitidos.at(-1)).toEqual({ q: '', leagueId: 'l1', ordem: 'data_asc' });
  });

  it('a ordem padrão continua sendo uma escolha, e vale como "não pedi nada"', () => {
    // Os próximos eventos começam pelo mais perto de acontecer e os passados
    // pelo mais recente: uma barra só não tem como mostrar dois padrões, então
    // mostra a opção de não escolher — e quem decide é o servidor.
    const { html, emitidos } = montar();
    const ordem = html.querySelectorAll('select')[1] as HTMLSelectElement;

    escolher(ordem, 'data_desc');
    escolher(ordem, '');

    expect(emitidos.at(-1)?.ordem).toBe('');
  });

  it('ordem desconhecida não passa adiante', () => {
    // O valor vai para a query string e de lá para o ORDER BY do servidor.
    const { html, emitidos } = montar();
    const ordem = html.querySelectorAll('select')[1] as HTMLSelectElement;

    escolher(ordem, 'e.date; DROP TABLE events');

    expect(emitidos.at(-1)?.ordem).toBe('');
  });

  it('o seletor não oferece liga sem torneio', () => {
    // Filtrar por uma liga vazia devolve uma tela vazia: é uma opção que só
    // serve para decepcionar.
    const { html } = montar([
      { id: 'l1', name: 'Liga Cheia', event_count: 3 },
      { id: 'l2', name: 'Liga Vazia', event_count: 0 },
    ]);
    const opcoes = [...html.querySelectorAll('select')[0].querySelectorAll('option')].map((o) =>
      o.textContent?.trim(),
    );

    expect(opcoes).toContain('Liga Cheia');
    expect(opcoes).not.toContain('Liga Vazia');
    // "Todas as ligas" e "Sem liga" existem sempre.
    expect(opcoes.slice(0, 2)).toEqual(['Todas as ligas', 'Sem liga']);
  });

  it('a lista de ligas falhar não derruba a barra', () => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    TestBed.inject(I18nService).lang.set('pt-BR');
    const http = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(EventFiltersComponent);
    fixture.detectChanges();
    http
      .expectOne(`${environment.apiUrl}/leagues`)
      .error(new ProgressEvent('erro'), { status: 500, statusText: 'erro' });
    fixture.detectChanges();

    // Busca e ordem continuam de pé: barra parcial é melhor que tela com erro.
    const html = fixture.nativeElement as HTMLElement;
    expect(html.querySelector('input[type=search]')).toBeTruthy();
    expect(html.querySelectorAll('select').length).toBe(2);
  });

  it('a escolha de pôster ou lista fica guardada', () => {
    // Quem prefere lista prefere lista sempre; reescolher a cada visita é
    // cobrar duas vezes pela mesma decisão.
    const { html } = montar();
    const [poster, lista] = [...html.querySelectorAll('.layout button')] as HTMLButtonElement[];

    expect(poster.getAttribute('aria-pressed')).toBe('true');

    lista.click();
    expect(TestBed.inject(LayoutEventosService).layout()).toBe('lista');
    expect(localStorage.getItem('eventos_layout')).toBe('lista');

    poster.click();
    expect(localStorage.getItem('eventos_layout')).toBe('poster');
  });

  it('sair da tela antes do prazo não dispara busca nenhuma', () => {
    // O timer sobreviveria ao componente e emitiria para quem já não escuta.
    vi.useFakeTimers();
    try {
      const { fixture, html, emitidos } = montar();
      digitar(html, 'commander');
      fixture.destroy();

      vi.advanceTimersByTime(600);

      expect(emitidos).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });
});
