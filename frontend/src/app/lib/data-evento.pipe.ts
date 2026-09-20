import { Pipe, PipeTransform, inject } from '@angular/core';
import { I18nService } from '../i18n/i18n';
import { formatarData } from './fuso';

/**
 * A data de um torneio, sempre no fuso em que ele acontece.
 *
 * Existe no lugar do `DatePipe` do Angular porque aquele converte para o fuso de
 * quem está olhando: o torneio marcado para as 20:00 na loja aparecia às 16:00
 * para quem estivesse em outro fuso — ou, antes da correção, para todo mundo.
 *
 *   {{ evento.date | dataEvento: evento.timezone }}          2 de out. de 2026, 20:00 GMT-4
 *   {{ evento.date | dataEvento: evento.timezone : 'curto' }} 2 de out. de 2026
 *
 * O idioma vem do `I18nService`, então a data acompanha o idioma escolhido na
 * barra superior, e não o do sistema operacional.
 */
@Pipe({ name: 'dataEvento' })
export class DataEventoPipe implements PipeTransform {
  private i18n = inject(I18nService);

  transform(
    valor: string | Date | null | undefined,
    fuso: string | null | undefined,
    estilo: 'curto' | 'completo' = 'completo',
  ): string {
    return formatarData(valor, fuso, this.i18n.lang(), estilo);
  }
}
