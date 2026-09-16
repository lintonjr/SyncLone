import {
  Component,
  ElementRef,
  HostListener,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { DialogService } from '../../services/dialog';
import { I18nService } from '../../i18n/i18n';

/**
 * Desenha o diálogo pedido pelo DialogService.
 *
 * Fica montado uma vez no app e não desenha nada enquanto ninguém pergunta
 * nada. Usa a linguagem de sobreposição do sistema (`.modal-overlay`/`.modal`,
 * globais), então acompanha o tema claro e escuro sem saber que eles existem.
 */
@Component({
  selector: 'app-dialog',
  imports: [CommonModule],
  templateUrl: './dialog.html',
  styleUrl: './dialog.scss',
})
export class DialogComponent {
  private svc = inject(DialogService);
  i18n = inject(I18nService);

  aberto = this.svc.aberto;
  opcoes = computed(() => this.aberto()?.opcoes ?? null);
  ehPrompt = computed(() => this.aberto()?.modo === 'prompt');

  texto = signal('');
  private campo = viewChild<ElementRef<HTMLInputElement>>('campo');
  private primeiro = viewChild<ElementRef<HTMLButtonElement>>('primeiro');

  /** Quem tinha o foco antes: ele volta para lá quando o diálogo fecha. */
  private origem: HTMLElement | null = null;

  constructor() {
    effect(() => {
      const estado = this.aberto();
      if (!estado) {
        this.origem?.focus();
        this.origem = null;
        return;
      }
      this.origem = document.activeElement as HTMLElement | null;
      this.texto.set(estado.opcoes.valor ?? '');
      // Num prompt o foco vai para o campo; num confirm destrutivo vai para o
      // cancelar, para que um Enter distraído não apague nada.
      queueMicrotask(() => {
        const alvo = this.ehPrompt() ? this.campo()?.nativeElement : this.primeiro()?.nativeElement;
        alvo?.focus();
      });
    });
  }

  podeConfirmar = computed(
    () => !this.ehPrompt() || this.opcoes()?.opcional === true || this.texto().trim().length > 0,
  );

  confirmar() {
    if (!this.podeConfirmar()) return;
    this.svc.responder(this.ehPrompt() ? this.texto().trim() : true);
  }

  cancelar() {
    this.svc.responder(this.ehPrompt() ? null : false);
  }

  @HostListener('document:keydown.escape')
  aoEscape() {
    if (this.aberto()) this.cancelar();
  }

  /**
   * Enquanto houver diálogo, o Tab não sai dele. Sem isto o foco passeia pela
   * página atrás da sobreposição, que é visível mas não deveria ser operável.
   */
  @HostListener('document:keydown.tab', ['$event'])
  aoTab(evento: Event) {
    const e = evento as KeyboardEvent;
    const raiz = this.primeiro()?.nativeElement?.closest('.modal');
    if (!this.aberto() || !raiz) return;
    const focaveis = [
      ...raiz.querySelectorAll<HTMLElement>('button, input, [tabindex]:not([tabindex="-1"])'),
    ].filter((el) => !el.hasAttribute('disabled'));
    if (!focaveis.length) return;
    const primeiro = focaveis[0];
    const ultimo = focaveis[focaveis.length - 1];
    if (e.shiftKey && document.activeElement === primeiro) {
      e.preventDefault();
      ultimo.focus();
    } else if (!e.shiftKey && document.activeElement === ultimo) {
      e.preventDefault();
      primeiro.focus();
    }
  }
}
