import { TestBed } from '@angular/core/testing';
import { provideRouter, ActivatedRoute } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { AvaliacaoDetalheComponent } from './avaliacao-detalhe';
import { DialogService } from '../../services/dialog';
import { AuthService } from '../../services/auth';
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
    valor_extra: '0.00',
    justificativa_extra: null,
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

/** `papel` decide o que a ficha oferece: só admin vê o bloco de excluir. */
async function montar(os: Record<string, unknown> = umaOS(), papel = 'admin') {
  // Alguns testes montam a ficha mais de uma vez (papéis e status diferentes),
  // e o TestBed recusa ser configurado depois de instanciado.
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: ActivatedRoute, useValue: { snapshot: { paramMap: new Map([['id', 'os1']]) } } },
    ],
  });
  TestBed.inject(I18nService).lang.set('pt-BR');
  TestBed.inject(AuthService).currentUser.set({
    id: 'u1', display_name: 'Dona', email: 'dona@t.local', role: papel,
  } as never);
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
      valor_extra: '',
      justificativa_extra: '',
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
      valor_extra: '',
      justificativa_extra: '',
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

  // --- Excluir ---

  it('excluir: só admin vê o bloco', async () => {
    const soAvaliador = await montar(umaOS(), 'organizer');
    expect(soAvaliador.html.querySelector('.bloco.perigo')).toBeFalsy();

    const { html } = await montar();
    expect(html.querySelector('.bloco.perigo')).toBeTruthy();
    expect(botao(html, 'Excluir OS')).toBeTruthy();
  });

  it('excluir: depois do pagamento a tela diz qual é a saída, em vez de só travar', async () => {
    for (const status of ['a_pagar', 'para_guardar', 'para_inserir', 'inserido']) {
      const { html } = await montar(avaliada({ status }));
      expect(botao(html, 'Excluir OS')).toBeFalsy();
      expect(html.querySelector('.bloco.perigo')?.textContent).toContain('volte o status');
    }
  });

  it('excluir: em "para avaliar" pede só o código, e ele confirma como a busca compara', async () => {
    const { fixture, http, html } = await montar();
    botao(html, 'Excluir OS').click();
    fixture.detectChanges();

    // Nada foi oferecido ainda: não há motivo a cobrar.
    expect(html.querySelector('#av-motivo-exclusao')).toBeFalsy();

    const confirmar = () => botao(html, 'Excluir para sempre');
    expect(confirmar().disabled).toBe(true);

    const campo = html.querySelector('#av-confirmacao') as HTMLInputElement;
    campo.value = 'k7m4q2x9';
    campo.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(confirmar().disabled).toBe(false);

    confirmar().click();
    const req = http.expectOne(`${environment.apiUrl}/avaliacoes/os1`);
    expect(req.request.method).toBe('DELETE');
    expect(req.request.body).toEqual({ confirmacao: 'k7m4q2x9', motivo: '' });
  });

  it('excluir: código errado mantém o botão trancado e nada sai', async () => {
    const { fixture, http, html } = await montar();
    botao(html, 'Excluir OS').click();
    fixture.detectChanges();

    const campo = html.querySelector('#av-confirmacao') as HTMLInputElement;
    for (const errado of ['K7M4-Q2X8', 'apagar', '']) {
      campo.value = errado;
      campo.dispatchEvent(new Event('input'));
      fixture.detectChanges();
      expect([errado, botao(html, 'Excluir para sempre').disabled]).toEqual([errado, true]);
    }
    http.expectNone(`${environment.apiUrl}/avaliacoes/os1`);
  });

  it('excluir: numa OS já avaliada, o motivo é obrigatório e o aviso fala do link', async () => {
    const { fixture, http, html } = await montar(avaliada());
    botao(html, 'Excluir OS').click();
    fixture.detectChanges();

    expect(html.querySelector('.bloco.perigo')?.textContent).toContain('link do cliente');

    const campo = html.querySelector('#av-confirmacao') as HTMLInputElement;
    campo.value = 'K7M4-Q2X9';
    campo.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    // Só o código não basta aqui.
    expect(botao(html, 'Excluir para sempre').disabled).toBe(true);

    const motivo = html.querySelector('#av-motivo-exclusao') as HTMLInputElement;
    motivo.value = 'aberta em duplicidade';
    motivo.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(botao(html, 'Excluir para sempre').disabled).toBe(false);

    botao(html, 'Excluir para sempre').click();
    expect(http.expectOne(`${environment.apiUrl}/avaliacoes/os1`).request.body).toEqual({
      confirmacao: 'K7M4-Q2X9',
      motivo: 'aberta em duplicidade',
    });
  });

  it('excluir: cancelar fecha o bloco e esquece o que foi digitado', async () => {
    const { fixture, html } = await montar();
    botao(html, 'Excluir OS').click();
    fixture.detectChanges();

    const campo = html.querySelector('#av-confirmacao') as HTMLInputElement;
    campo.value = 'K7M4-Q2X9';
    campo.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    botao(html, 'Cancelar').click();
    fixture.detectChanges();
    expect(html.querySelector('#av-confirmacao')).toBeFalsy();

    botao(html, 'Excluir OS').click();
    fixture.detectChanges();
    expect((html.querySelector('#av-confirmacao') as HTMLInputElement).value).toBe('');
  });

  it('cabeçalho: mostra quem abriu a OS, e o travessão só quando ninguém abriu', async () => {
    // Este teste nasceu de um defeito que passou por aqui: a ficha mostrava
    // "Aberta por —" em toda OS, porque `GET /avaliacoes/:id` devolvia
    // `criada_por` (um id) e nunca `criada_por_nome`. O fixture já trazia o
    // nome, então a tela parecia certa no teste e errada no ar — o furo estava
    // no contrato com a API, não no template.
    const { html } = await montar(umaOS({ criada_por_nome: 'So Avaliador' }));
    expect(html.querySelector('.sub')?.textContent?.trim()).toBe('Aberta por So Avaliador');

    // Nulo é o caso real de quem abriu e depois teve a conta anonimizada.
    const semAutor = await montar(umaOS({ criada_por_nome: null }));
    expect(semAutor.html.querySelector('.sub')?.textContent?.trim()).toBe('Aberta por —');
  });

  // --- O extra em reais ---

  const preencherProposta = (html: HTMLElement, valor = '1000') => {
    const set = (id: string, v: string) => {
      const el = html.querySelector(id) as HTMLInputElement;
      el.value = v;
      el.dispatchEvent(new Event('input'));
    };
    set('#av-link', 'https://planilha.local/os1');
    set('#av-valor', valor);
    return set;
  };

  it('extra: a justificativa só aparece com acréscimo, e tranca o botão sem ela', async () => {
    const { fixture, html } = await montar();
    const set = preencherProposta(html);
    fixture.detectChanges();

    // Sem extra não há o que explicar, e dá para concluir.
    expect(html.querySelector('#av-extra-motivo')).toBeFalsy();
    expect(botao(html, 'Concluir avaliação').disabled).toBe(false);

    set('#av-extra', '50');
    fixture.detectChanges();
    expect(html.querySelector('#av-extra-motivo')).toBeTruthy();
    expect(botao(html, 'Concluir avaliação').disabled).toBe(true);

    set('#av-extra-motivo', 'cartas raras fora da lista');
    fixture.detectChanges();
    expect(botao(html, 'Concluir avaliação').disabled).toBe(false);
  });

  it('extra: a prévia soma o acréscimo nas duas formas', async () => {
    const { fixture, html } = await montar();
    const set = preencherProposta(html);
    set('#av-pct-credito', '70');
    set('#av-pct-pix', '56');
    fixture.detectChanges();
    expect([...html.querySelectorAll('.percentuais .previa')].map((e) => e.textContent?.trim()))
      .toEqual(['R$ 700.00', 'R$ 560.00']);

    set('#av-extra', '50');
    fixture.detectChanges();
    expect([...html.querySelectorAll('.percentuais .previa')].map((e) => e.textContent?.trim()))
      .toEqual(['R$ 750.00', 'R$ 610.00']);
  });

  it('extra: valor ilegível apaga a prévia e tranca — nunca some como zero', async () => {
    const { fixture, html } = await montar();
    const set = preencherProposta(html, '300');
    for (const ruim of ['abc', '-10', '10.999']) {
      set('#av-extra', ruim);
      fixture.detectChanges();
      expect([ruim, botao(html, 'Concluir avaliação').disabled]).toEqual([ruim, true]);
      expect([ruim, html.querySelectorAll('.percentuais .previa')[0].textContent?.trim()])
        .toEqual([ruim, '']);
    }
  });

  it('extra: vai no corpo junto da justificativa', async () => {
    const { fixture, http, html } = await montar();
    const set = preencherProposta(html);
    set('#av-extra', '50,00');
    fixture.detectChanges();
    set('#av-extra-motivo', 'coleção já organizada');
    fixture.detectChanges();

    botao(html, 'Concluir avaliação').click();
    expect(http.expectOne(`${environment.apiUrl}/avaliacoes/os1/avaliar`).request.body).toEqual({
      link_avaliacao: 'https://planilha.local/os1',
      valor: '1000',
      percentual_credito: 60,
      percentual_pix: 50,
      valor_extra: '50,00',
      justificativa_extra: 'coleção já organizada',
    });
  });

  it('proposta com extra: a quebra fecha com o total que vai ser pago', async () => {
    const { html } = await montar(
      avaliada({
        percentual_credito: 70,
        percentual_pix: 56,
        valor_bruto: '1401.29',
        valor_extra: '50.00',
        justificativa_extra: 'três raras fora da lista',
        valor_credito: '1030.90',
        valor_pix: '834.72',
      }),
    );

    const numeros = [...html.querySelectorAll('.dados .numero')].map((e) => e.textContent?.trim());
    // Bruto, as duas parcelas, o extra, e os dois totais.
    expect(numeros).toEqual([
      'R$ 1401.29',
      'R$ 980.90',
      'R$ 784.72',
      '+ R$ 50.00',
      'R$ 1030.90',
      'R$ 834.72',
    ]);
    // A justificativa é interna, mas aparece para a equipe na ficha.
    expect(html.querySelector('.extra-motivo')?.textContent).toContain('três raras fora da lista');
  });

  it('proposta sem extra: segue com dois valores, sem linha de total', async () => {
    const { html } = await montar(avaliada());
    const numeros = [...html.querySelectorAll('.dados .numero')].map((e) => e.textContent?.trim());
    expect(numeros).toEqual(['R$ 300.00', 'R$ 180.00', 'R$ 150.00']);
    expect(html.querySelector('.extra-motivo')).toBeFalsy();
  });
});
