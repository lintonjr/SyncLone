import { environment } from './environment';

/**
 * Guarda de um defeito que só aparece em produção.
 *
 * O `apiUrl` vai compilado no bundle. Enquanto ele foi absoluto
 * (`http://localhost:3001/api`), tudo passava — testes, build, Docker local —
 * e o site publicado mandava o navegador de cada visitante falar com a porta
 * 3001 da máquina dele. Nenhum outro teste desta suíte pega isso: todos usam
 * `environment.apiUrl` para montar o que esperam, então acompanham o erro.
 *
 * Por isso a asserção é sobre a forma do valor, não sobre o valor.
 */
describe('environment', () => {
  it('apiUrl é relativo — nunca aponta para um host', () => {
    expect(environment.apiUrl.startsWith('/')).toBe(true);
    expect(environment.apiUrl).not.toContain('://');
    expect(environment.apiUrl).not.toContain('localhost');
  });

  it('e tirar o /api dele dá um caminho de mesma origem, que é como as imagens são montadas', () => {
    // event-card, event-detail, badges e player-profile fazem exatamente isto.
    const base = environment.apiUrl.replace('/api', '');
    expect(`${base}/uploads/capa.png`).toBe('/uploads/capa.png');
  });
});
