import { Injectable, computed, signal } from '@angular/core';
import { PT_BR } from './pt-br';
import { EN } from './en';

export type Lang = 'pt-BR' | 'en';

const DICIONARIOS: Record<Lang, Record<string, string>> = { 'pt-BR': PT_BR, en: EN };
const CHAVE = 'lang';

/**
 * Tradução em tempo de execução.
 *
 * O i18n nativo do Angular é de tempo de compilação: gera um bundle por idioma
 * e exige rotear por prefixo no nginx. Para o volume deste app — algumas
 * centenas de rótulos — isso é peso de operação sem retorno. Um dicionário em
 * memória troca de idioma na hora, sem rebuild e sem redeploy.
 *
 * Como `t()` lê o signal `lang`, qualquer template que a chame passa a depender
 * dele: trocar de idioma redesenha as telas sozinho, sem recarregar a página.
 *
 * O preço é não ter extração automática nem plural/ICU. Se um dia a interface
 * crescer a ponto de precisar disso, a migração é mecânica: as chaves já estão
 * separadas do código.
 */
@Injectable({ providedIn: 'root' })
export class I18nService {
  readonly lang = signal<Lang>(idiomaInicial());
  private readonly dict = computed(() => DICIONARIOS[this.lang()]);

  constructor() {
    // O index.html declarava pt-BR fixo enquanto a interface falava inglês.
    // Agora o atributo acompanha a escolha: é o que leitores de tela e o
    // corretor ortográfico do navegador consultam.
    document.documentElement.lang = this.lang();
  }

  /**
   * Traduz uma chave. Parâmetros entram como `{nome}` no texto.
   *
   * Chave sem tradução volta como ela mesma, em vez de string vazia: numa tela
   * quebrada, ver `event.standings` diz onde procurar; ver nada não diz nada.
   */
  t(chave: string, params?: Record<string, string | number>): string {
    let texto = this.dict()[chave] ?? PT_BR[chave] ?? chave;
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        texto = texto.replaceAll(`{${k}}`, String(v));
      }
    }
    return texto;
  }

  setLang(l: Lang) {
    this.lang.set(l);
    try {
      localStorage.setItem(CHAVE, l);
    } catch {
      // Navegador com armazenamento bloqueado: o idioma vale só nesta sessão.
    }
    document.documentElement.lang = l;
    // O LOCALE_ID do Angular (que formata datas) é resolvido na inicialização,
    // então a data só acompanha o idioma no próximo carregamento. Recarregar
    // aqui é o que impede a tela de ficar meio traduzida.
    location.reload();
  }
}

function idiomaInicial(): Lang {
  try {
    const salvo = localStorage.getItem(CHAVE);
    if (salvo === 'pt-BR' || salvo === 'en') return salvo;
  } catch {
    // segue para o padrão
  }
  return navigator.language?.toLowerCase().startsWith('pt') ? 'pt-BR' : 'en';
}

/**
 * Mensagem de erro de uma resposta da API, no idioma da tela.
 *
 * O servidor manda `code` (traduzível) e `error` (a frase pronta). Onde o
 * código ainda não existe — a conversão é incremental — a frase serve de
 * fallback, e é por isso que nada quebra durante a migração.
 */
export function mensagemDeErro(i18n: I18nService, err: unknown, padrao = 'api.internal'): string {
  const corpo = (
    err as { error?: { code?: string; error?: string; params?: Record<string, string> } }
  )?.error;
  if (corpo?.code) return i18n.t(corpo.code, corpo.params);
  if (corpo?.error) return corpo.error;
  return i18n.t(padrao);
}
