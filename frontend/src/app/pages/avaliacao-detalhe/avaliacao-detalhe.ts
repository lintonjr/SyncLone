import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { AvaliacaoService, AvaliacaoDetalhe } from '../../services/avaliacao';
import { DialogService } from '../../services/dialog';
import { I18nService, mensagemDeErro } from '../../i18n/i18n';

/**
 * A ficha de uma OS: onde ela está, o que falta e por onde passou.
 *
 * Cada estado mostra **uma** ação — a que faz sentido agora. Uma tela com os
 * sete botões sempre visíveis, seis deles recusados pelo servidor, é a forma
 * mais rápida de ensinar quem atende a clicar no escuro.
 */
@Component({
  selector: 'app-avaliacao-detalhe',
  imports: [CommonModule, RouterLink],
  templateUrl: './avaliacao-detalhe.html',
  styleUrl: './avaliacao-detalhe.scss',
})
export class AvaliacaoDetalheComponent implements OnInit {
  i18n = inject(I18nService);
  private svc = inject(AvaliacaoService);
  private rota = inject(ActivatedRoute);
  private dialog = inject(DialogService);

  os = signal<AvaliacaoDetalhe | null>(null);
  carregando = signal(true);
  erro = signal('');
  ocupado = signal(false);
  copiado = signal(false);

  // Avaliar
  link = signal('');
  valor = signal('');

  // Editar contato
  editando = signal(false);
  nome = signal('');
  telefone = signal('');
  email = signal('');
  comentarios = signal('');

  /** O endereço que vai para o cliente, montado com o domínio de quem olha. */
  linkPublico = computed(() => {
    const token = this.os()?.token_publico;
    return token ? `${location.origin}/avaliacao/${token}` : '';
  });

  /** Os dois passos de prateleira são os únicos com avanço direto. */
  podeAvancar = computed(() => {
    const status = this.os()?.status;
    return status === 'para_guardar' || status === 'para_inserir';
  });

  podeVoltar = computed(() => {
    const status = this.os()?.status;
    return !!status && status !== 'para_avaliar' && status !== 'recusada';
  });

  ngOnInit() {
    this.carregar();
  }

  private carregar() {
    const id = this.rota.snapshot.paramMap.get('id')!;
    this.carregando.set(true);
    this.svc.abrir(id).subscribe({
      next: (os) => this.receber(os),
      error: (err) => {
        this.erro.set(mensagemDeErro(this.i18n, err));
        this.carregando.set(false);
      },
    });
  }

  private receber(os: AvaliacaoDetalhe) {
    this.os.set(os);
    this.nome.set(os.nome);
    this.telefone.set(os.telefone);
    this.email.set(os.email ?? '');
    this.comentarios.set(os.comentarios ?? '');
    this.link.set(os.link_avaliacao ?? '');
    this.carregando.set(false);
    this.ocupado.set(false);
    this.editando.set(false);
  }

  private falhou(err: unknown) {
    this.erro.set(mensagemDeErro(this.i18n, err));
    this.ocupado.set(false);
  }

  salvarContato() {
    const os = this.os();
    if (!os) return;
    this.ocupado.set(true);
    this.erro.set('');
    this.svc
      .editar(os.id, {
        nome: this.nome().trim(),
        telefone: this.telefone().trim(),
        email: this.email().trim(),
        comentarios: this.comentarios().trim(),
      })
      .subscribe({ next: (novo) => this.receber(novo), error: (err) => this.falhou(err) });
  }

  avaliar() {
    const os = this.os();
    if (!os || !this.link().trim() || !this.valor().trim()) return;
    this.ocupado.set(true);
    this.erro.set('');
    this.svc.avaliar(os.id, this.link().trim(), this.valor().trim()).subscribe({
      next: (novo) => this.receber(novo),
      error: (err) => this.falhou(err),
    });
  }

  enviarComprovante(evento: Event) {
    const os = this.os();
    const arquivo = (evento.target as HTMLInputElement).files?.[0];
    if (!os || !arquivo) return;
    this.ocupado.set(true);
    this.erro.set('');
    this.svc.confirmarPagamento(os.id, arquivo).subscribe({
      next: (novo) => this.receber(novo),
      error: (err) => this.falhou(err),
    });
  }

  avancar() {
    const os = this.os();
    if (!os) return;
    this.ocupado.set(true);
    this.erro.set('');
    this.svc.avancar(os.id).subscribe({
      next: (novo) => this.receber(novo),
      error: (err) => this.falhou(err),
    });
  }

  /**
   * Voltar pede o motivo antes de tudo.
   *
   * Daqui a um mês a pergunta vai ser "por que esta OS andou para trás?", e o
   * histórico precisa responder sozinho.
   */
  async voltar() {
    const os = this.os();
    if (!os) return;
    const motivo = await this.dialog.prompt({
      titulo: this.i18n.t('avaliacoes.backTitle'),
      mensagem:
        os.status === 'avaliado'
          ? this.i18n.t('avaliacoes.backWarnToken')
          : this.i18n.t('avaliacoes.backBody'),
      confirmar: this.i18n.t('avaliacoes.back'),
      placeholder: this.i18n.t('avaliacoes.backReason'),
      perigo: true,
    });
    if (!motivo) return;
    this.ocupado.set(true);
    this.erro.set('');
    this.svc.voltar(os.id, motivo).subscribe({
      next: (novo) => this.receber(novo),
      error: (err) => this.falhou(err),
    });
  }

  async copiarLink() {
    try {
      await navigator.clipboard.writeText(this.linkPublico());
      this.copiado.set(true);
      setTimeout(() => this.copiado.set(false), 2000);
    } catch {
      // Sem permissão de área de transferência: o endereço fica à vista para
      // ser selecionado à mão.
      this.copiado.set(false);
    }
  }
}
