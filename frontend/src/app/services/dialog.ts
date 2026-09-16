import { Injectable, signal } from '@angular/core';

/** Uma pergunta de sim ou não. */
export interface ConfirmOptions {
  titulo: string;
  mensagem?: string;
  /** Rótulo do botão que confirma. Diz o que vai acontecer, não "OK". */
  confirmar?: string;
  cancelar?: string;
  /** Ação destrutiva: o botão vem em vermelho e o foco começa no cancelar. */
  perigo?: boolean;
}

/** Uma pergunta que pede um texto. */
export interface PromptOptions extends ConfirmOptions {
  valor?: string;
  placeholder?: string;
  tipo?: 'text' | 'email' | 'number';
  min?: number;
  max?: number;
  /**
   * Aceita resposta vazia.
   *
   * O padrão é exigir texto, porque a maioria dos prompts pede um dado sem o
   * qual a ação não existe — um nome de deck em branco não é um deck. Há o caso
   * oposto: o motivo de uma aprovação, em que confirmar sem escrever nada é uma
   * resposta legítima. Sem isto, o botão ficaria travado e a única saída seria
   * cancelar, que significa outra coisa.
   */
  opcional?: boolean;
}

interface EstadoAberto {
  modo: 'confirm' | 'prompt';
  opcoes: PromptOptions;
  resolver: (r: boolean | string | null) => void;
}

/**
 * Os diálogos do sistema, no lugar de `confirm()` e `prompt()` do navegador.
 *
 * Os nativos têm três problemas que não se contornam: o cromo é do navegador e
 * ignora o tema, os botões ficam no idioma do sistema operacional em vez do
 * idioma do app, e a ação destrutiva parece igual a qualquer outra — "OK" é o
 * mesmo botão para apagar um evento e para confirmar um deck.
 *
 * A diferença de comportamento que importa: o nativo trava a aba e este não. O
 * `Promise` só resolve quando a pessoa escolhe, e enquanto o diálogo está
 * aberto nada atrás dele recebe foco — é isso que impede um clique duplo em
 * "Apagar" enquanto alguém ainda pensa.
 */
@Injectable({ providedIn: 'root' })
export class DialogService {
  /** Lido pelo componente que desenha; nunca escrito por fora. */
  readonly aberto = signal<EstadoAberto | null>(null);

  confirm(opcoes: ConfirmOptions): Promise<boolean> {
    return new Promise((resolve) => {
      this.aberto.set({
        modo: 'confirm',
        opcoes,
        resolver: (r) => resolve(r === true),
      });
    });
  }

  /** Resolve com o texto, ou `null` se a pessoa cancelou. */
  prompt(opcoes: PromptOptions): Promise<string | null> {
    return new Promise((resolve) => {
      this.aberto.set({
        modo: 'prompt',
        opcoes,
        resolver: (r) => resolve(typeof r === 'string' ? r : null),
      });
    });
  }

  /** Chamado pelo componente ao confirmar, cancelar, apertar Esc ou clicar fora. */
  responder(resposta: boolean | string | null) {
    const atual = this.aberto();
    if (!atual) return;
    this.aberto.set(null);
    atual.resolver(resposta);
  }
}
