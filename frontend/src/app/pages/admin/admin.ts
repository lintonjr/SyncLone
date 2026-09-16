import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { AdminService, OrganizerRequestRow, StaffRow } from '../../services/admin';
import { AuthService } from '../../services/auth';
import { DialogService } from '../../services/dialog';
import { I18nService, mensagemDeErro } from '../../i18n/i18n';

/**
 * A mesa do dono da plataforma: quem pediu para organizar, e quem já organiza.
 *
 * As duas listas vivem na mesma tela porque respondem à mesma pergunta em dois
 * tempos — quem entra e quem continua. Separá-las em páginas obrigaria a ir e
 * voltar para responder "essa pessoa já não tinha sido aprovada antes?".
 */
@Component({
  selector: 'app-admin',
  imports: [CommonModule, RouterLink],
  templateUrl: './admin.html',
  styleUrl: './admin.scss',
})
export class AdminComponent implements OnInit {
  i18n = inject(I18nService);
  auth = inject(AuthService);
  private svc = inject(AdminService);
  private dialog = inject(DialogService);

  requests = signal<OrganizerRequestRow[]>([]);
  staff = signal<StaffRow[]>([]);
  loading = signal(true);
  error = signal('');
  /** Id da linha em que uma decisão está em curso — trava só ela, não a tela. */
  decidindo = signal<string | null>(null);

  aba = signal<'fila' | 'staff'>('fila');

  pendentes = computed(() => this.requests().filter((r) => r.status === 'pending'));
  decididos = computed(() => this.requests().filter((r) => r.status !== 'pending'));

  ngOnInit() {
    this.carregar();
  }

  private carregar() {
    this.loading.set(true);
    this.svc.requests().subscribe({
      next: (r) => {
        this.requests.set(r);
        this.loading.set(false);
      },
      error: (err) => {
        this.error.set(mensagemDeErro(this.i18n, err));
        this.loading.set(false);
      },
    });
    this.svc.staff().subscribe({ next: (s) => this.staff.set(s) });
  }

  /**
   * Aprovar e recusar pedem a mesma coisa: um motivo opcional.
   *
   * O diálogo aceita texto vazio de propósito — obrigar a justificar toda
   * aprovação transformaria o caminho comum ("sim, pode organizar") em
   * burocracia, e quem tem algo a dizer continua podendo dizer.
   */
  async decidir(pedido: OrganizerRequestRow, decisao: 'approve' | 'reject') {
    const motivo = await this.dialog.prompt({
      titulo: this.i18n.t(decisao === 'approve' ? 'admin.approveTitle' : 'admin.rejectTitle', {
        nome: pedido.display_name,
      }),
      mensagem: this.i18n.t('admin.reasonHelp'),
      placeholder: this.i18n.t('admin.reasonPlaceholder'),
      // Decidir sem escrever nada é o caminho comum; o campo está aqui para
      // quem tem algo a dizer, não para cobrar uma justificativa de todos.
      opcional: true,
      confirmar: this.i18n.t(decisao === 'approve' ? 'admin.approve' : 'admin.reject'),
      perigo: decisao === 'reject',
    });
    if (motivo === null) return;

    this.decidindo.set(pedido.id);
    this.error.set('');
    this.svc.decide(pedido.id, decisao, motivo).subscribe({
      next: () => {
        this.decidindo.set(null);
        this.carregar();
      },
      error: (err) => {
        // O caso concreto é o pedido já decidido em outra aba: recarregar mostra
        // o desfecho que já existe, em vez de deixar a fila mentindo.
        this.error.set(mensagemDeErro(this.i18n, err));
        this.decidindo.set(null);
        this.carregar();
      },
    });
  }

  async trocarPapel(pessoa: StaffRow, novo: 'player' | 'admin') {
    const chave = novo === 'player' ? 'admin.confirmRevoke' : 'admin.confirmPromote';
    const ok = await this.dialog.confirm({
      titulo: this.i18n.t(`${chave}Title`, { nome: pessoa.display_name }),
      mensagem: this.i18n.t(chave, { nome: pessoa.display_name, eventos: pessoa.events_owned }),
      confirmar: this.i18n.t(novo === 'player' ? 'admin.revoke' : 'admin.promote'),
      perigo: novo === 'player',
    });
    if (!ok) return;

    this.decidindo.set(pessoa.id);
    this.error.set('');
    this.svc.changeRole(pessoa.id, novo).subscribe({
      next: () => {
        this.decidindo.set(null);
        this.carregar();
      },
      error: (err) => {
        this.error.set(mensagemDeErro(this.i18n, err));
        this.decidindo.set(null);
      },
    });
  }

  /** O dono não mexe no próprio papel — o servidor recusa, e a tela não oferece. */
  souEu(id: string) {
    return this.auth.currentUser()?.id === id;
  }
}
