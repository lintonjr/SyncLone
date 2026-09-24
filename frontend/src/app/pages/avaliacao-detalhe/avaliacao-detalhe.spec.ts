import { TestBed } from '@angular/core/testing';
import { provideRouter, ActivatedRoute } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { AvaliacaoDetalheComponent } from './avaliacao-detalhe';
import { DialogService } from '../../services/dialog';
import { environment } from '../../../environments/environment';
import { I18nService } from '../../i18n/i18n';

function umaOS(over: Record<string, unknown> = {}) {
  return {
    id: 'os1',
    codigo: 'K7M4-Q2X9',
    nome: 'Marina',
    telefone: '92 99999-0000',
    email: 'marina@t.local',
    comentarios: 'Caixa com 400 commons',
    status: 'para_avaliar',
    valor_bruto: null,
    valor_credito: null,
    valor_pix: null,
    escolha: null,
    created_at: '2026-09-20T12:00:00Z',
    updated_at: '2026-09-20T12:00:00Z',
    criada_por_nome: 'Bia',
    link_avaliacao: null,
    percentual_credito: 60,
    percentual_pix: 50,
    token_publico: null,
    chave_pix: null,
    comprovante: null,
    historico: [],
    ...over,
  };
}

/** A OS já avaliada, que é o estado de onde partem quase todas as ações. */
const avaliada = (over: Record<string, unknown> = {}) =>
  umaOS({
    status: 'avaliado',
    valor_bruto: '300.00',
    valor_credito: '180.00',
    valor_pix: '150.00',
    link_avaliacao: 'https://planilha.local/os1',
    token_publico: 'b'.repeat(32),
    ...over,
  });

async function montar(os: Record<string, unknown> = umaOS()) {
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: ActivatedRoute, useValue: { snapshot: { paramMap: new Map([['id', 'os1']]) } } },
    ],
  });
  TestBed.inject(I18nService).lang.set('pt-BR');
  const http = TestBed.inject(HttpTestingController);
  const fixture = TestBed.createComponent(AvaliacaoDetalheComponent);
  fixture.detectChanges();

  http.expectOne(`${environment.apiUrl}/avaliacoes/os1`).flush(os);
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
  return { fixture, http, html: fixture.nativeElement as HTMLElement };
}

const botao = (html: HTMLElement, texto: string) =>
  [...html.querySelectorAll('button')].find((b) =>
    b.textContent?.includes(texto),
  ) as HTMLButtonElement;

describe('AvaliacaoDetalheComponent', () => {
  it('para avaliar: pede link e valor, e nada de link público ainda', async () => {
    const { fixture, http, html } = await montar();

    expect(html.querySelector('.link-publico')).toBeFalsy();
    const concluir = botao(html, 'Concluir avaliação');
    expect(concluir.disabled).toBe(true);

    const link = html.querySelector('#av-link') as HTMLInputElement;
    link.value = 'https://planilha.local/os1';
    link.dispatchEvent(new Event('input'));
    const valor = html.querySelector('#av-valor') as HTMLInputElement;
    valor.value = '300';
    valor.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    // Os percentuais já vêm preenchidos com o padrão que veio na OS, e a prévia
    // mostra quanto cada forma paga antes de alguém confirmar.
    const pctCredito = html.querySelector('#av-pct-credito') as HTMLInputElement;
    const pctPix = html.querySelector('#av-pct-pix') as HTMLInputElement;
    expect(pctCredito.value).toBe('60');
    expect(pctPix.value).toBe('50');
    const previas = [...html.querySelectorAll('.previa')].map((e) => e.textContent?.trim());
    expect(previas).toEqual(['R$ 180.00', 'R$ 150.00']);

    botao(html, 'Concluir avaliação').click();
    const req = http.expectOne(`${environment.apiUrl}/avaliacoes/os1/avaliar`);
    expect(req.request.body).toEqual({
      link_avaliacao: 'https://planilha.local/os1',
      valor: '300',
      percentual_credito: 60,
      percentual_pix: 50,
    });
    req.flush(avaliada());
    fixture.detectChanges();

    // Agora sim existe endereço para mandar para a pessoa.
    expect(html.querySelector('.link-publico')?.textContent).toContain('b'.repeat(32));
  });

  it('percentual negociado: a prévia acompanha e é ele que vai para o servidor', async () => {
    const { fixture, http, html } = await montar();

    const link = html.querySelector('#av-link') as HTMLInputElement;
    link.value = 'https://planilha.local/os1';
    link.dispatchEvent(new Event('input'));
    const valor = html.querySelector('#av-valor') as HTMLInputElement;
    valor.value = '200';
    valor.dispatchEvent(new Event('input'));
    const pctCredito = html.querySelector('#av-pct-credito') as HTMLInputElement;
    pctCredito.value = '55';
    pctCredito.dispatchEvent(new Event('input'));
    const pctPix = html.querySelector('#av-pct-pix') as HTMLInputElement;
    pctPix.value = '45';
    pctPix.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    const previas = [...html.querySelectorAll('.previa')].map((e) => e.textContent?.trim());
    expect(previas).toEqual(['R$ 110.00', 'R$ 90.00']);

    botao(html, 'Concluir avaliação').click();
    expect(
      http.expectOne(`${environment.apiUrl}/avaliacoes/os1/avaliar`).request.body,
    ).toEqual({
      link_avaliacao: 'https://planilha.local/os1',
      valor: '200',
      percentual_credito: 55,
      percentual_pix: 45,
    });
  });

  it('percentual fora de 1–100 tranca o botão: nada sai pela metade', async () => {
    const { fixture, http, html } = await montar();

    const link = html.querySelector('#av-link') as HTMLInputElement;
    link.value = 'https://planilha.local/os1';
    link.dispatchEvent(new Event('input'));
    const valor = html.querySelector('#av-valor') as HTMLInputElement;
    valor.value = '300';
    valor.dispatchEvent(new Event('input'));
    const pctPix = html.querySelector('#av-pct-pix') as HTMLInputElement;

    // O valor entra no par avaliado para o motivo da falha aparecer no relatório:
    // "['101', false]" diz qual percentual destrancou; "false" sozinho não.
    for (const ruim of ['0', '101', '', 'abc']) {
      pctPix.value = ruim;
      pctPix.dispatchEvent(new Event('input'));
      fixture.detectChanges();
      expect([ruim, botao(html, 'Concluir avaliação').disabled]).toEqual([ruim, true]);
    }
    http.expectNone(`${environment.apiUrl}/avaliacoes/os1/avaliar`);
  });

  it('avaliada: mostra os dois valores e o link interno, separado do do cliente', async () => {
    const { html } = await montar(avaliada());

    expect(html.textContent).toContain('180.00');
    expect(html.textContent).toContain('150.00');
    // O valor bruto é da equipe; a página do cliente não o recebe.
    expect(html.textContent).toContain('300.00');
    expect(html.querySelector('.interno')?.textContent).toContain('não aparece para o cliente');
  });

  it('pix: com comprovante anexado, confirma direto', async () => {
    const { fixture, http, html } = await montar(
      avaliada({ status: 'a_pagar', escolha: 'pix', chave_pix: 'marina@t.local' }),
    );

    expect(html.textContent).toContain('marina@t.local');
    const campo = html.querySelector('#comprovante') as HTMLInputElement;
    const arquivo = new File(['x'], 'comprovante.png', { type: 'image/png' });
    Object.defineProperty(campo, 'files', { value: [arquivo] });
    campo.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    botao(html, 'Confirmar pagamento').click();
    await fixture.whenStable();

    const req = http.expectOne(`${environment.apiUrl}/avaliacoes/os1/pagamento`);
    expect((req.request.body as FormData).get('comprovante')).toBeTruthy();
    req.flush(avaliada({ status: 'para_guardar', comprovante: '/uploads/c.png' }));
    fixture.detectChanges();

    expect(html.querySelector('#comprovante')).toBeFalsy();
    expect(html.textContent).toContain('Ver comprovante');
  });

  it('crédito: confirma sem comprovante, depois de perguntar', async () => {
    const { fixture, http, html } = await montar(
      avaliada({ status: 'a_pagar', escolha: 'credito' }),
    );
    TestBed.inject(DialogService).confirm = () => Promise.resolve(true);

    botao(html, 'Confirmar crédito lançado').click();
    await fixture.whenStable();

    const req = http.expectOne(`${environment.apiUrl}/avaliacoes/os1/pagamento`);
    // Vai um formulário vazio: o comprovante é anexo, não requisito.
    expect((req.request.body as FormData).get('comprovante')).toBeNull();
    req.flush(avaliada({ status: 'para_guardar' }));
    fixture.detectChanges();

    expect(html.textContent).toContain('Marcar para inserir');
  });

  it('sem comprovante, cancelar o diálogo não confirma nada', async () => {
    const { fixture, http, html } = await montar(avaliada({ status: 'a_pagar', escolha: 'pix' }));
    TestBed.inject(DialogService).confirm = () => Promise.resolve(false);

    botao(html, 'Confirmar pagamento').click();
    await fixture.whenStable();

    http.expectNone(`${environment.apiUrl}/avaliacoes/os1/pagamento`);
  });

  it('prateleira: avançar leva de guardar para inserir', async () => {
    const { fixture, http, html } = await montar(avaliada({ status: 'para_guardar' }));

    botao(html, 'Marcar para inserir').click();
    http
      .expectOne(`${environment.apiUrl}/avaliacoes/os1/avancar`)
      .flush(avaliada({ status: 'para_inserir' }));
    fixture.detectChanges();

    expect(botao(html, 'Marcar como inserido')).toBeTruthy();
  });

  it('voltar exige motivo: sem ele, nada é enviado', async () => {
    const { fixture, http, html } = await montar(avaliada({ status: 'para_guardar' }));
    TestBed.inject(DialogService).prompt = () => Promise.resolve(null);

    botao(html, 'Voltar um passo').click();
    await fixture.whenStable();

    http.expectNone(`${environment.apiUrl}/avaliacoes/os1/voltar`);
  });

  it('voltar manda o motivo digitado', async () => {
    const { fixture, http, html } = await montar(avaliada({ status: 'para_guardar' }));
    TestBed.inject(DialogService).prompt = () => Promise.resolve('paguei a OS errada');

    botao(html, 'Voltar um passo').click();
    await fixture.whenStable();

    const req = http.expectOne(`${environment.apiUrl}/avaliacoes/os1/voltar`);
    expect(req.request.body).toEqual({ motivo: 'paguei a OS errada' });
    req.flush(avaliada({ status: 'a_pagar' }));
  });

  it('recusada não oferece retorno: retomar é abrir OS nova', async () => {
    const { html } = await montar(avaliada({ status: 'recusada' }));
    expect(botao(html, 'Voltar um passo')).toBeFalsy();
  });

  it('o começo do fluxo não tem para onde voltar', async () => {
    const { html } = await montar(umaOS());
    expect(botao(html, 'Voltar um passo')).toBeFalsy();
  });

  it('o histórico diz quem fez, e "o cliente" quando não há conta', async () => {
    const { html } = await montar(
      avaliada({
        status: 'a_pagar',
        historico: [
          {
            acao: 'aceita',
            de: 'avaliado',
            para: 'a_pagar',
            motivo: 'credito',
            created_at: '2026-09-20T13:00:00Z',
            autor: null,
          },
          {
            acao: 'avaliada',
            de: 'para_avaliar',
            para: 'avaliado',
            motivo: 'R$ 300.00',
            created_at: '2026-09-20T12:30:00Z',
            autor: 'Bia',
          },
        ],
      }),
    );

    const historico = html.querySelector('.historico')!;
    expect(historico.textContent).toContain('pelo cliente');
    expect(historico.textContent).toContain('por Bia');
  });
});
