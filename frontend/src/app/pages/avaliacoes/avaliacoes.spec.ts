import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { AvaliacoesComponent } from './avaliacoes';
import { environment } from '../../../environments/environment';
import { I18nService } from '../../i18n/i18n';

function umaLinha(over: Record<string, unknown> = {}) {
  return {
    id: 'os1',
    codigo: 'K7M4-Q2X9',
    nome: 'Marina',
    telefone: '92 99999-0000',
    email: 'marina@t.local',
    status: 'para_avaliar',
    valor_bruto: null,
    valor_credito: null,
    valor_pix: null,
    escolha: null,
    created_at: '2026-09-20T12:00:00Z',
    updated_at: '2026-09-20T12:00:00Z',
    criada_por_nome: 'Bia',
    ...over,
  };
}

async function montar(linhas: Record<string, unknown>[] = [umaLinha()], porStatus = {}) {
  TestBed.configureTestingModule({
    providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
  });
  TestBed.inject(I18nService).lang.set('pt-BR');
  const http = TestBed.inject(HttpTestingController);
  const fixture = TestBed.createComponent(AvaliacoesComponent);
  fixture.detectChanges();

  http
    .expectOne((r) => r.url.includes('/avaliacoes'))
    .flush({
      avaliacoes: linhas,
      total: linhas.length,
      limit: 25,
      offset: 0,
      por_status: porStatus,
    });
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return { fixture, http, html: fixture.nativeElement as HTMLElement };
}

describe('AvaliacoesComponent', () => {
  it('cada OS aparece pelo código, com quem é e em que pé está', async () => {
    const { html } = await montar([
      umaLinha(),
      umaLinha({ id: 'os2', codigo: 'A2B3-C4D5', status: 'a_pagar' }),
    ]);

    const linhas = [...html.querySelectorAll('.os-row')];
    expect(linhas.length).toBe(2);
    expect(linhas[0].textContent).toContain('K7M4-Q2X9');
    expect(linhas[0].textContent).toContain('Marina');
    expect(linhas[0].textContent).toContain('Para avaliar');
    expect(linhas[1].textContent).toContain('A pagar');
  });

  it('lista vazia é dita, não é uma tela em branco', async () => {
    const { html } = await montar([]);
    expect(html.querySelector('.vazio')?.textContent).toContain('Nenhuma avaliação');
  });

  it('as abas contam quantas esperam alguém', async () => {
    const { html } = await montar([umaLinha()], { para_avaliar: 3, a_pagar: 1 });

    const abas = [...html.querySelectorAll('.abas button')].map((b) => b.textContent?.trim());
    expect(abas.some((t) => t?.startsWith('Para avaliar') && t?.includes('3'))).toBe(true);
    expect(abas.some((t) => t?.startsWith('A pagar') && t?.includes('1'))).toBe(true);
  });

  it('busca e filtro vão para o servidor, não filtram no navegador', async () => {
    const { fixture, http, html } = await montar();

    const busca = html.querySelector('#os-busca') as HTMLInputElement;
    busca.value = 'K7M4';
    busca.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    const filtrar = [...html.querySelectorAll('.abas button')].find((b) =>
      b.textContent?.includes('A pagar'),
    ) as HTMLButtonElement;
    filtrar.click();

    // A consulta vai montada na URL: é o servidor que busca e filtra.
    const req = http.expectOne((r) => r.url.includes('q=K7M4') && r.url.includes('status=a_pagar'));
    req.flush({ avaliacoes: [], total: 0, limit: 25, offset: 0, por_status: {} });
  });

  it('abrir uma OS precisa de nome e telefone', async () => {
    const { fixture, http, html } = await montar([]);

    (
      [...html.querySelectorAll('button')].find((b) =>
        b.textContent?.includes('Nova avaliação'),
      ) as HTMLButtonElement
    ).click();
    fixture.detectChanges();

    const criar = [...html.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Abrir OS'),
    ) as HTMLButtonElement;
    expect(criar.disabled).toBe(true);

    for (const [id, valor] of [
      ['#os-nome', 'Marina'],
      ['#os-telefone', '92 99999-0000'],
    ]) {
      const campo = html.querySelector(id) as HTMLInputElement;
      campo.value = valor;
      campo.dispatchEvent(new Event('input'));
    }
    fixture.detectChanges();

    (
      [...html.querySelectorAll('button')].find((b) =>
        b.textContent?.includes('Abrir OS'),
      ) as HTMLButtonElement
    ).click();

    const req = http.expectOne((r) => r.method === 'POST');
    expect(req.request.body).toEqual({
      nome: 'Marina',
      telefone: '92 99999-0000',
      email: undefined,
      comentarios: undefined,
    });
    req.flush(umaLinha());
    // Criar recarrega a lista: o estado que vale é o do servidor.
    http
      .expectOne((r) => r.method === 'GET')
      .flush({
        avaliacoes: [umaLinha()],
        total: 1,
        limit: 25,
        offset: 0,
        por_status: { para_avaliar: 1 },
      });
  });
});
