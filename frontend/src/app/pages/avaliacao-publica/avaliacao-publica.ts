import { Component, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Meta } from '@angular/platform-browser';
import { ActivatedRoute } from '@angular/router';
import { AvaliacaoService, PropostaPublica } from '../../services/avaliacao';
import { I18nService, mensagemDeErro } from '../../i18n/i18n';

/**
 * A proposta, na tela de quem vendeu a coleção.
 *
 * É a única página do sistema feita para alguém **sem conta**: chega por um link
 * recebido no WhatsApp, decide, e vai embora. Por isso não há navegação para
 * lugar nenhum, nem convite para criar conta — quem está aqui veio responder uma
 * pergunta, não conhecer a plataforma.
 *
 * O que ela mostra é o que o servidor manda, e o servidor manda uma lista
 * fechada: nome, telefone, os dois valores e os comentários. O valor bruto e a
 * planilha da loja não passam por aqui.
 */
@Component({
  selector: 'app-avaliacao-publica',
  imports: [CommonModule],
  templateUrl: './avaliacao-publica.html',
  styleUrl: './avaliacao-publica.scss',
})
export class AvaliacaoPublicaComponent implements OnInit, OnDestroy {
  i18n = inject(I18nService);
  private svc = inject(AvaliacaoService);
  private rota = inject(ActivatedRoute);
  private meta = inject(Meta);

  proposta = signal<PropostaPublica | null>(null);
  carregando = signal(true);
  erro = signal('');
  enviando = signal(false);

  /** null = ainda escolhendo; o resto é o que ela vai mandar. */
  escolha = signal<'credito' | 'pix' | null>(null);
  chavePix = signal('');
  confirmandoRecusa = signal(false);

  private get token() {
    return this.rota.snapshot.paramMap.get('token')!;
  }

  ngOnInit() {
    // A página tem nome e telefone de uma pessoa. O endereço é secreto, mas
    // links vazam para buscadores por caminhos que ninguém controla — uma barra
    // de navegador que sincroniza histórico basta. Pedir para não indexar é
    // barato e é o mínimo.
    this.meta.addTag({ name: 'robots', content: 'noindex, nofollow' });

    this.svc.proposta(this.token).subscribe({
      next: (p) => {
        this.proposta.set(p);
        this.carregando.set(false);
      },
      error: (err) => {
        this.erro.set(mensagemDeErro(this.i18n, err));
        this.carregando.set(false);
      },
    });
  }

  ngOnDestroy() {
    // Sai junto com a página: as outras telas do app são indexáveis.
    this.meta.removeTag("name='robots'");
  }

  aceitar() {
    const escolha = this.escolha();
    if (!escolha) return;
    if (escolha === 'pix' && !this.chavePix().trim()) return;
    this.responder('aceitar', escolha, this.chavePix().trim());
  }

  recusar() {
    this.responder('recusar');
  }

  private responder(resposta: 'aceitar' | 'recusar', escolha?: 'credito' | 'pix', chave?: string) {
    this.enviando.set(true);
    this.erro.set('');
    this.svc.responder(this.token, resposta, escolha, chave).subscribe({
      next: (p) => {
        this.proposta.set(p);
        this.enviando.set(false);
        this.confirmandoRecusa.set(false);
      },
      error: (err) => {
        this.erro.set(mensagemDeErro(this.i18n, err));
        this.enviando.set(false);
      },
    });
  }
}
