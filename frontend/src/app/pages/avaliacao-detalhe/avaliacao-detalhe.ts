import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AvaliacaoService, AvaliacaoDetalhe } from '../../services/avaliacao';
import { AuthService } from '../../services/auth';
import { DialogService } from '../../services/dialog';
import { I18nService, mensagemDeErro } from '../../i18n/i18n';
import { parteDaProposta } from '../../lib/proposta';

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
  private router = inject(Router);
  private auth = inject(AuthService);
  private dialog = inject(DialogService);

  os = signal<AvaliacaoDetalhe | null>(null);
  carregando = signal(true);
  erro = signal('');
  ocupado = signal(false);
  copiado = signal(false);

  // Avaliar
  link = signal('');
  valor = signal('');

  /**
   * Os percentuais da proposta, como texto: o campo fica vazio por um instante
   * enquanto se apaga para redigitar, e `signal(60)` viraria `NaN` nesse instante.
   *
   * O valor inicial vem da OS, não de uma constante repetida aqui — numa OS
   * ainda por avaliar são os 60/50 padrão da loja (o DEFAULT da coluna), e numa
   * que voltou para correção são os que foram usados da última vez.
   */
  pctCredito = signal('');
  pctPix = signal('');

  /** O percentual como número, ou null enquanto não for um inteiro de 1 a 100. */
  private inteiro = (texto: string): number | null => {
    if (!/^\d{1,3}$/.test(texto.trim())) return null;
    const n = Number(texto.trim());
    return n >= 1 && n <= 100 ? n : null;
  };

  creditoValido = computed(() => this.inteiro(this.pctCredito()));
  pixValido = computed(() => this.inteiro(this.pctPix()));

  /**
   * A prévia dos dois valores enquanto se digita.
   *
   * O número que vale continua sendo o que o servidor grava; isto existe para
   * ninguém confirmar uma proposta sem ver quanto ela paga. Vazio quando a conta
   * ainda não fecha — melhor não mostrar nada do que mostrar um número errado.
   */
  previaCredito = computed(() => parteDaProposta(this.valor(), this.creditoValido()));
  previaPix = computed(() => parteDaProposta(this.valor(), this.pixValido()));

  /** Só dá para concluir com link, valor e os dois percentuais em pé. */
  podeAvaliar = computed(
    () =>
      !!this.link().trim() &&
      !!this.previaCredito() &&
      !!this.previaPix(),
  );

  /** O comprovante escolhido, se houver: ele é anexo, não requisito. */
  comprovante = signal<File | null>(null);

  /**
   * Excluir: o bloco fica fechado e só abre no clique.
   *
   * Dois campos (o código e o motivo) não cabem no `dialog.prompt`, que pede um
   * texto só — e encadear dois prompts transformaria uma decisão em duas
   * perguntas soltas. Aqui os dois ficam à vista, ao lado do aviso do que vai
   * acontecer.
   */
  excluindo = signal(false);
  confirmacao = signal('');
  motivoExclusao = signal('');

  /** Só admin exclui, e só antes de a loja se comprometer com dinheiro. */
  ehAdmin = computed(() => this.auth.currentUser()?.role === 'admin');

  /**
   * Os status que a tela oferece para excluir.
   *
   * A lista está repetida aqui e em `EXCLUIVEIS`, no `lib/avaliacao.js` — não há
   * build compartilhado entre as pontas. Quem **decide** é sempre o servidor,
   * que recusa com `api.excluirDepoisDoPagamento`; isto aqui só escolhe entre
   * mostrar o botão e mostrar o aviso de como desfazer. Errar de um lado deixa a
   * tela confusa, nunca deixa apagar o que não podia.
   */
  podeExcluir = computed(() => {
    const status = this.os()?.status;
    return !!status && ['para_avaliar', 'avaliado', 'recusada'].includes(status);
  });

  /** Passado o pagamento, a saída é voltar o status — a tela diz isso. */
  excluirBloqueado = computed(() => this.ehAdmin() && !this.podeExcluir());

  /** Fora de "para avaliar", sumir com a OS some com uma proposta já enviada. */
  exigeMotivo = computed(() => this.os()?.status !== 'para_avaliar');

  confirmacaoConfere = computed(() => {
    const limpo = (t: string) => t.toUpperCase().replace(/[^A-Z0-9]/g, '');
    const os = this.os();
    return !!os && limpo(this.confirmacao()) === limpo(os.codigo);
  });

  podeConfirmarExclusao = computed(
    () => this.confirmacaoConfere() && (!this.exigeMotivo() || !!this.motivoExclusao().trim()),
  );

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
    this.pctCredito.set(String(os.percentual_credito));
    this.pctPix.set(String(os.percentual_pix));
    this.carregando.set(false);
    this.ocupado.set(false);
    this.editando.set(false);
    this.comprovante.set(null);
    this.excluindo.set(false);
    this.confirmacao.set('');
    this.motivoExclusao.set('');
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
    const credito = this.creditoValido();
    const pix = this.pixValido();
    if (!os || !this.podeAvaliar() || credito === null || pix === null) return;
    this.ocupado.set(true);
    this.erro.set('');
    this.svc.avaliar(os.id, this.link().trim(), this.valor().trim(), credito, pix).subscribe({
      next: (novo) => this.receber(novo),
      error: (err) => this.falhou(err),
    });
  }

  escolherComprovante(evento: Event) {
    this.comprovante.set((evento.target as HTMLInputElement).files?.[0] ?? null);
  }

  /**
   * Confirma o pagamento — com ou sem comprovante.
   *
   * Sem imagem anexada, pergunta antes: nada além do clique sustenta a
   * afirmação de que o dinheiro saiu ou de que o crédito foi lançado. Com o
   * comprovante em mãos, confirma direto; uma pergunta a mais no balcão cheio
   * só atrasa quem já fez o que tinha de fazer.
   */
  async confirmarPagamento() {
    const os = this.os();
    if (!os) return;
    const arquivo = this.comprovante();

    if (!arquivo) {
      const credito = os.escolha === 'credito';
      const ok = await this.dialog.confirm({
        titulo: this.i18n.t(
          credito ? 'avaliacoes.confirmCreditTitle' : 'avaliacoes.confirmPaymentTitle',
        ),
        mensagem: this.i18n.t(
          credito ? 'avaliacoes.confirmCreditBody' : 'avaliacoes.confirmPaymentBody',
          {
            valor: (credito ? os.valor_credito : os.valor_pix) ?? '',
            nome: os.nome,
          },
        ),
        confirmar: this.i18n.t(credito ? 'avaliacoes.confirmCredit' : 'avaliacoes.confirmPayment'),
      });
      if (!ok) return;
    }

    this.ocupado.set(true);
    this.erro.set('');
    this.svc.confirmarPagamento(os.id, arquivo ?? undefined).subscribe({
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

  /**
   * Exclui e sai para a lista.
   *
   * Não há `receber()` no fim: a OS não existe mais, e recarregar a ficha daria
   * 404 na cara de quem acabou de apagar de propósito.
   */
  /**
   * Abre e fecha o bloco, sempre com os campos limpos.
   *
   * Fechar tem de esquecer o que foi digitado: um código já confirmado esperando
   * atrás de um bloco fechado é uma exclusão a um clique de distância, feita por
   * quem já tinha desistido dela.
   */
  alternarExclusao(aberto: boolean) {
    this.excluindo.set(aberto);
    this.confirmacao.set('');
    this.motivoExclusao.set('');
  }

  excluir() {
    const os = this.os();
    if (!os || !this.podeConfirmarExclusao()) return;
    this.ocupado.set(true);
    this.erro.set('');
    this.svc.excluir(os.id, this.confirmacao().trim(), this.motivoExclusao().trim()).subscribe({
      next: () => this.router.navigate(['/avaliacoes']),
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
