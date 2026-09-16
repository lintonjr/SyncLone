import { TestBed } from '@angular/core/testing';
import { DialogComponent } from './dialog';
import { DialogService } from '../../services/dialog';
import { I18nService } from '../../i18n/i18n';

/**
 * O diálogo substituiu `confirm()` e `prompt()` do navegador. Os testes cobrem
 * o que o nativo dava de graça e agora é responsabilidade nossa: a promessa só
 * resolve quando a pessoa escolhe, Esc cancela, e a ação destrutiva se
 * distingue da comum.
 */
function montar() {
  TestBed.configureTestingModule({});
  TestBed.inject(I18nService).lang.set('pt-BR');
  const svc = TestBed.inject(DialogService);
  const fixture = TestBed.createComponent(DialogComponent);
  fixture.detectChanges();
  return { fixture, svc, html: fixture.nativeElement as HTMLElement };
}

describe('DialogComponent', () => {
  it('não desenha nada enquanto ninguém pergunta', () => {
    const { html } = montar();
    expect(html.querySelector('.modal-overlay')).toBeFalsy();
  });

  it('confirmar resolve com true e fecha', async () => {
    const { fixture, svc, html } = montar();
    const resposta = svc.confirm({ titulo: 'Apagar o evento?' });
    fixture.detectChanges();

    expect(html.querySelector('.modal')).toBeTruthy();
    expect(html.textContent).toContain('Apagar o evento?');

    fixture.componentInstance.confirmar();
    fixture.detectChanges();

    expect(await resposta).toBe(true);
    expect(html.querySelector('.modal-overlay')).toBeFalsy();
  });

  it('cancelar resolve com false', async () => {
    const { fixture, svc } = montar();
    const resposta = svc.confirm({ titulo: 'Apagar?' });
    fixture.detectChanges();

    fixture.componentInstance.cancelar();
    expect(await resposta).toBe(false);
  });

  it('Esc cancela, como no nativo', async () => {
    const { fixture, svc } = montar();
    const resposta = svc.confirm({ titulo: 'Apagar?' });
    fixture.detectChanges();

    fixture.componentInstance.aoEscape();
    expect(await resposta).toBe(false);
  });

  it('ação destrutiva usa o botão de perigo', () => {
    const { fixture, svc, html } = montar();
    svc.confirm({ titulo: 'Apagar?', perigo: true });
    fixture.detectChanges();

    expect(html.querySelector('.btn-danger')).toBeTruthy();
    expect(html.querySelector('.btn-primary')).toBeFalsy();
  });

  it('ação comum usa o botão normal', () => {
    const { fixture, svc, html } = montar();
    svc.confirm({ titulo: 'Encerrar?' });
    fixture.detectChanges();

    expect(html.querySelector('.btn-primary')).toBeTruthy();
    expect(html.querySelector('.btn-danger')).toBeFalsy();
  });

  it('o rótulo do botão diz o que acontece, não "OK"', () => {
    const { fixture, svc, html } = montar();
    svc.confirm({ titulo: 'Apagar?', confirmar: 'Apagar evento' });
    fixture.detectChanges();

    const botoes = [...html.querySelectorAll('.dialog-actions button')].map((b) =>
      b.textContent?.trim(),
    );
    expect(botoes).toContain('Apagar evento');
    expect(botoes.join(' ')).not.toContain('OK');
  });

  it('prompt resolve com o texto, aparado', async () => {
    const { fixture, svc } = montar();
    const resposta = svc.prompt({ titulo: 'E-mail da conta' });
    fixture.detectChanges();

    fixture.componentInstance.texto.set('  alguem@exemplo.com  ');
    fixture.componentInstance.confirmar();

    expect(await resposta).toBe('alguem@exemplo.com');
  });

  it('prompt cancelado resolve com null, e não com string vazia', async () => {
    // A diferença importa: "" é uma resposta, null é a ausência dela.
    const { fixture, svc } = montar();
    const resposta = svc.prompt({ titulo: 'E-mail' });
    fixture.detectChanges();

    fixture.componentInstance.cancelar();
    expect(await resposta).toBeNull();
  });

  it('prompt vazio não deixa confirmar', () => {
    const { fixture, svc, html } = montar();
    svc.prompt({ titulo: 'E-mail' });
    fixture.detectChanges();

    expect(fixture.componentInstance.podeConfirmar()).toBe(false);
    const confirmar = html.querySelectorAll('.dialog-actions button')[1] as HTMLButtonElement;
    expect(confirmar.disabled).toBe(true);

    fixture.componentInstance.texto.set('a@b.com');
    fixture.detectChanges();
    expect(fixture.componentInstance.podeConfirmar()).toBe(true);
  });

  it('o prompt abre com o valor inicial quando há um', () => {
    const { fixture, svc } = montar();
    svc.prompt({ titulo: 'Nome do deck', valor: 'Atraxa' });
    fixture.detectChanges();

    expect(fixture.componentInstance.texto()).toBe('Atraxa');
  });
  it('prompt marcado como opcional confirma vazio, e devolve string vazia', async () => {
    // O caso é o motivo de uma aprovação: decidir sem escrever nada é resposta,
    // não desistência — e precisa ser distinguível do cancelar, que devolve null.
    const { fixture, svc, html } = montar();
    const resposta = svc.prompt({ titulo: 'Aprovar?', opcional: true });
    fixture.detectChanges();

    expect(fixture.componentInstance.podeConfirmar()).toBe(true);
    const confirmar = html.querySelectorAll('.dialog-actions button')[1] as HTMLButtonElement;
    expect(confirmar.disabled).toBe(false);

    confirmar.click();
    expect(await resposta).toBe('');
  });
});
