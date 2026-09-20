import { PT_BR } from './pt-br';
import { EN } from './en';

/**
 * Guardas do dicionário.
 *
 * A tela em inglês com metade das frases em português (e vice-versa) foi um
 * defeito real: frase escrita direto no HTML não passa por aqui e não muda com o
 * idioma. Estes testes cobrem os dois jeitos de isso voltar — chave que existe
 * num dicionário e falta no outro, e chave usada num template que não existe em
 * nenhum.
 *
 * Os fontes chegam como texto pelo `import.meta.glob` do Vite: o teste roda no
 * navegador simulado, onde não há acesso a disco.
 */
// O Vite substitui `import.meta.glob` na transformação do arquivo, então ele
// precisa aparecer escrito assim, literalmente; os tipos do projeto são os do
// navegador e não o conhecem.
// @ts-expect-error tipo do Vite, ausente no tsconfig do app
const FONTES: Record<string, string> = import.meta.glob('../**/*.{html,ts}', {
  query: '?raw',
  import: 'default',
  eager: true,
});

describe('i18n', () => {
  it('português e inglês têm exatamente as mesmas chaves', () => {
    const soEmPt = Object.keys(PT_BR).filter((k) => !(k in EN));
    const soEmEn = Object.keys(EN).filter((k) => !(k in PT_BR));
    expect({ soEmPt, soEmEn }).toEqual({ soEmPt: [], soEmEn: [] });
  });

  it('nenhuma tradução ficou vazia', () => {
    const vazias = [...Object.entries(PT_BR), ...Object.entries(EN)]
      .filter(([, v]) => !v.trim())
      .map(([k]) => k);
    expect(vazias).toEqual([]);
  });

  it('toda chave usada em template ou componente existe nos dois dicionários', () => {
    const faltando = new Set<string>();
    for (const [arquivo, conteudo] of Object.entries(FONTES)) {
      if (arquivo.endsWith('.spec.ts') || arquivo.includes('/i18n/')) continue;
      for (const [, chave] of conteudo.matchAll(/i18n\.t\(\s*'([^']+)'/g)) {
        // Chaves montadas em tempo de execução ('status.' + x) não dá para conferir aqui.
        if (chave.endsWith('.')) continue;
        if (!(chave in PT_BR) || !(chave in EN)) faltando.add(`${chave} (${arquivo})`);
      }
    }
    expect([...faltando]).toEqual([]);
  });

  it('os parâmetros de uma frase são os mesmos nos dois idiomas', () => {
    // '{n} eventos' e 'events' (sem o {n}) passaria despercebido até alguém trocar
    // o idioma e ver o número sumir.
    const params = (frase: string) => [...frase.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    const divergentes = Object.keys(PT_BR)
      .filter((k) => k in EN)
      .filter((k) => params(PT_BR[k]).join(',') !== params(EN[k]).join(','))
      .map((k) => `${k}: pt=[${params(PT_BR[k])}] en=[${params(EN[k])}]`);
    expect(divergentes).toEqual([]);
  });
});
