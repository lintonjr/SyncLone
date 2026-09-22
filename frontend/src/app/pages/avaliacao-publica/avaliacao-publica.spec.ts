import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { ActivatedRoute } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { AvaliacaoPublicaComponent } from './avaliacao-publica';
import { environment } from '../../../environments/environment';
import { I18nService } from '../../i18n/i18n';

const TOKEN = 'a'.repeat(32);

function umaProposta(over: Record<string, unknown> = {}) {
  return {
    codigo: 'K7M4-Q2X9',
    nome: 'Marina',
    telefone: '92 99999-0000',
    comentarios: 'Caixa com 400 commons',
    valor_credito: '180.00',
    valor_pix: '150.00',
    status: 'avaliado',
    escolha: null,
    respondida: false,
    ...over,
  };
}

/** Abre a página como quem clicou no link recebido, e responde a proposta. */
async function montar(proposta: Record<string, unknown> | 'erro' = umaProposta()) {
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      provideHttpClient(),
      provideHttpClientTesting(),
      {
        provide: ActivatedRoute,
        useValue: { snapshot: { paramMap: new Map([['token', TOKEN]]) } },
      },
    ],
  });
  TestBed.inject(I18nService).lang.set('pt-BR');
  const http = TestBed.inject(HttpTestingController);
  const fixture = TestBed.createComponent(AvaliacaoPublicaComponent);
  fixture.detectChanges();

  const req = http.expectOne(`${environment.apiUrl}/avaliacoes/publica/${TOKEN}`);
  if (proposta === 'erro') {
    req.flush({ code: 'api.avaliacaoNaoEncontrada' }, { status: 404, statusText: 'Not Found' });
  } else {
    req.flush(proposta);
  }
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return { fixture, http, html: fixture.nativeElement as HTMLElement };
}

const botao = (html: HTMLElement, texto: string) =>
  [...html.querySelectorAll('button')].find((b) =>
    b.textContent?.includes(texto),
  ) as HTMLButtonElement;

describe('AvaliacaoPublicaComponent', () => {
  it('mostra os dois valores e nada além do combinado', async () => {
    const { html } = await montar();

    expect(html.textContent).toContain('Marina');
    expect(html.textContent).toContain('92 99999-0000');
    expect(html.textContent).toContain('180.00');
    expect(html.textContent).toContain('150.00');
    expect(html.textContent).toContain('400 commons');
  });

  it('aceitar exige escolher, e o pix exige a chave', async () => {
    const { fixture, html } = await montar();

    // Sem escolha, não dá para aceitar: a loja não adivinha como pagar.
    expect(botao(html, 'Aceitar').disabled).toBe(true);

    botao(html, 'Pix').click();
    fixture.detectChanges();
    expect(botao(html, 'Aceitar').disabled).toBe(true);

    const chave = html.querySelector('.chave input') as HTMLInputElement;
    chave.value = 'marina@t.local';
    chave.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(botao(html, 'Aceitar').disabled).toBe(false);
  });

  it('crédito não pede chave nenhuma', async () => {
    const { fixture, html } = await montar();

    botao(html, 'Crédito na loja').click();
    fixture.detectChanges();

    expect(html.querySelector('.chave')).toBeFalsy();
    expect(botao(html, 'Aceitar').disabled).toBe(false);
  });

  it('aceitar manda a escolha e a página vira comprovante', async () => {
    const { fixture, http, html } = await montar();

    botao(html, 'Crédito na loja').click();
    fixture.detectChanges();
    botao(html, 'Aceitar').click();

    const req = http.expectOne(`${environment.apiUrl}/avaliacoes/publica/${TOKEN}`);
    expect(req.request.body).toEqual({ resposta: 'aceitar', escolha: 'credito', chave_pix: '' });
    req.flush(umaProposta({ status: 'a_pagar', escolha: 'credito', respondida: true }));
    fixture.detectChanges();

    expect(html.textContent).toContain('Proposta aceita');
    expect(html.querySelector('.opcoes')).toBeFalsy();
  });

  it('recusar pergunta duas vezes antes de encerrar', async () => {
    const { fixture, http, html } = await montar();

    botao(html, 'Recusar').click();
    fixture.detectChanges();
    // O primeiro clique só abre a confirmação — recusar não tem volta.
    http.expectNone((r) => r.method === 'POST');
    expect(html.querySelector('.recusa')).toBeTruthy();

    const confirmar = [...html.querySelectorAll('.recusa button')].find((b) =>
      b.textContent?.includes('Recusar'),
    ) as HTMLButtonElement;
    confirmar.click();

    const req = http.expectOne(`${environment.apiUrl}/avaliacoes/publica/${TOKEN}`);
    expect(req.request.body.resposta).toBe('recusar');
    req.flush(umaProposta({ status: 'recusada', respondida: true }));
    fixture.detectChanges();

    expect(html.textContent).toContain('Proposta recusada');
  });

  it('link já respondido abre em leitura, sem botões', async () => {
    // O endereço pode ter sido encaminhado: quem chegar depois não muda nada.
    const { html } = await montar(
      umaProposta({ status: 'a_pagar', escolha: 'pix', respondida: true }),
    );

    expect(html.querySelector('.opcoes')).toBeFalsy();
    expect(botao(html, 'Aceitar')).toBeFalsy();
    expect(html.textContent).toContain('Proposta aceita');
  });

  it('link inválido não é uma tela em branco', async () => {
    const { html } = await montar('erro');
    expect(html.textContent).toContain('Link inválido');
  });
});
