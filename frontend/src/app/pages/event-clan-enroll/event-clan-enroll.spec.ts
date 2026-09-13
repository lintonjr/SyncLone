import { TestBed } from '@angular/core/testing';
import { EventClanEnrollComponent } from './event-clan-enroll';
import { I18nService } from '../../i18n/i18n';

/**
 * O mesmo formulário serve ao clã de quatro e à dupla de dois, e o número de
 * campos vem de fora. Um tamanho ignorado aqui pediria quatro e-mails num
 * torneio de duplas e só seria descoberto por um 400 do servidor.
 */
function montar(tamanho: number, isOwner = true) {
  TestBed.configureTestingModule({});
  TestBed.inject(I18nService).lang.set('pt-BR');
  const fixture = TestBed.createComponent(EventClanEnrollComponent);
  fixture.componentRef.setInput('tamanho', tamanho);
  fixture.componentRef.setInput('isOwner', isOwner);
  fixture.detectChanges();
  return fixture;
}

/** Os campos de integrante, sem contar o do nome do time. */
function camposDeIntegrante(fixture: ReturnType<typeof montar>) {
  return [...fixture.nativeElement.querySelectorAll('.clan-input')].slice(1);
}

describe('EventClanEnrollComponent', () => {
  it('desenha dois campos numa dupla', () => {
    const fixture = montar(2);
    expect(camposDeIntegrante(fixture).length).toBe(2);
  });

  it('desenha quatro campos num clã', () => {
    const fixture = montar(4);
    expect(camposDeIntegrante(fixture).length).toBe(4);
  });

  it('na dupla, os rótulos falam em dupla e não em clã', () => {
    const fixture = montar(2);
    const texto = fixture.nativeElement.textContent as string;
    expect(texto).toContain('dupla');
    expect(texto).not.toContain('clã');
    expect(fixture.nativeElement.querySelector('h3').textContent).toContain('Inscrever dupla');
  });

  it('cobra o preenchimento contando o tamanho certo', () => {
    const fixture = montar(2);
    const comp = fixture.componentInstance;
    comp.nome.set('Ana & Bruno');
    comp.definirEmail(0, 'ana@x.com');
    comp.enviar();
    // o segundo campo está vazio: nada é emitido, e a mensagem cita dois
    expect(comp.erroLocal()).toContain('2');
  });

  it('emite os dois e-mails quando o formulário está completo', () => {
    const fixture = montar(2);
    const comp = fixture.componentInstance;
    let emitido: unknown = null;
    comp.inscrever.subscribe((v) => (emitido = v));
    comp.nome.set('Ana & Bruno');
    comp.definirEmail(0, 'ana@x.com');
    comp.definirEmail(1, 'bruno@x.com');
    comp.enviar();
    expect(emitido).toEqual({ name: 'Ana & Bruno', emails: ['ana@x.com', 'bruno@x.com'] });
  });
});
