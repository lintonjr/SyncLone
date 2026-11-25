import { Injectable, signal } from '@angular/core';

/** Pôster (a vitrine 2:3) ou linha (a lista compacta). */
export type LayoutEventos = 'poster' | 'lista';

const CHAVE = 'eventos_layout';

/**
 * Como a pessoa prefere ver torneios: em pôster ou em lista.
 *
 * Mora num serviço, e não dentro de cada tela, por dois motivos. A escolha vale
 * para a home e para "Meus eventos" ao mesmo tempo — alternar numa e a outra
 * voltar ao pôster seria a mesma inconsistência que o filtro acabou de resolver.
 * E ela sobrevive ao recarregar, como o tema: quem prefere lista prefere lista
 * sempre, e reescolher a cada visita é cobrar duas vezes pela mesma decisão.
 *
 * O pôster é o padrão, inclusive quando o armazenamento está bloqueado: é o que
 * as duas telas mostram hoje.
 */
@Injectable({ providedIn: 'root' })
export class LayoutEventosService {
  readonly layout = signal<LayoutEventos>(inicial());

  usar(l: LayoutEventos) {
    this.layout.set(l);
    try {
      localStorage.setItem(CHAVE, l);
    } catch {
      // Navegador com armazenamento bloqueado: a escolha vale só nesta sessão.
    }
  }
}

function inicial(): LayoutEventos {
  try {
    return localStorage.getItem(CHAVE) === 'lista' ? 'lista' : 'poster';
  } catch {
    return 'poster';
  }
}
