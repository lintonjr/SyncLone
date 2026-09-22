import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import {
  AvaliacaoService,
  AvaliacaoRow,
  StatusOS,
  STATUS_EM_ORDEM,
} from '../../services/avaliacao';
import { I18nService, mensagemDeErro } from '../../i18n/i18n';

/**
 * A fila do balcão: toda OS de avaliação, em qualquer estado.
 *
 * A busca e o filtro são resolvidos no servidor, como na área de usuários — a
 * lista cresce com a loja, e mandar tudo para o navegador filtrar significaria
 * mandar junto telefone e valor de gente que a tela nem vai mostrar.
 */
@Component({
  selector: 'app-avaliacoes',
  imports: [CommonModule, RouterLink],
  templateUrl: './avaliacoes.html',
  styleUrl: './avaliacoes.scss',
})
export class AvaliacoesComponent implements OnInit {
  i18n = inject(I18nService);
  private svc = inject(AvaliacaoService);

  avaliacoes = signal<AvaliacaoRow[]>([]);
  porStatus = signal<Partial<Record<StatusOS, number>>>({});
  total = signal(0);
  carregando = signal(true);
  erro = signal('');
  salvando = signal(false);

  busca = signal('');
  filtro = signal<StatusOS | ''>('');
  readonly estados = STATUS_EM_ORDEM;

  // O cadastro vive na própria lista: quem abre uma OS está com a pessoa na
  // frente, e mandar para outra página só acrescenta um passo entre a caixa de
  // cartas no balcão e o código anotado no papel.
  criando = signal(false);
  nome = signal('');
  telefone = signal('');
  email = signal('');
  comentarios = signal('');

  ngOnInit() {
    this.carregar();
  }

  carregar() {
    this.carregando.set(true);
    this.svc.lista({ q: this.busca(), status: this.filtro() }).subscribe({
      next: (pagina) => {
        this.avaliacoes.set(pagina.avaliacoes);
        this.porStatus.set(pagina.por_status);
        this.total.set(pagina.total);
        this.carregando.set(false);
      },
      error: (err) => {
        this.erro.set(mensagemDeErro(this.i18n, err));
        this.carregando.set(false);
      },
    });
  }

  filtrar(status: StatusOS | '') {
    this.filtro.set(status);
    this.carregar();
  }

  contar(status: StatusOS) {
    return this.porStatus()[status] ?? 0;
  }

  abrirCadastro() {
    this.criando.set(true);
    this.erro.set('');
  }

  cancelarCadastro() {
    this.criando.set(false);
    for (const campo of [this.nome, this.telefone, this.email, this.comentarios]) campo.set('');
  }

  criar() {
    if (!this.nome().trim() || !this.telefone().trim()) return;
    this.salvando.set(true);
    this.erro.set('');
    this.svc
      .criar({
        nome: this.nome().trim(),
        telefone: this.telefone().trim(),
        email: this.email().trim() || undefined,
        comentarios: this.comentarios().trim() || undefined,
      })
      .subscribe({
        next: () => {
          this.salvando.set(false);
          this.cancelarCadastro();
          this.carregar();
        },
        error: (err) => {
          this.erro.set(mensagemDeErro(this.i18n, err));
          this.salvando.set(false);
        },
      });
  }
}
