import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import {
  AdminService,
  OrganizerRequestRow,
  StaffRow,
  UserRow,
  UserDetail,
} from '../../services/admin';
import { LeagueService, League } from '../../services/league';
import { DataEventoPipe } from '../../lib/data-evento.pipe';
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
  imports: [CommonModule, RouterLink, DataEventoPipe],
  templateUrl: './admin.html',
  styleUrl: './admin.scss',
})
export class AdminComponent implements OnInit {
  i18n = inject(I18nService);
  auth = inject(AuthService);
  private svc = inject(AdminService);
  private ligaSvc = inject(LeagueService);
  private dialog = inject(DialogService);

  requests = signal<OrganizerRequestRow[]>([]);
  staff = signal<StaffRow[]>([]);
  loading = signal(true);
  error = signal('');
  /** Id da linha em que uma decisão está em curso — trava só ela, não a tela. */
  decidindo = signal<string | null>(null);

  aba = signal<'fila' | 'usuarios'>('fila');

  // --- Área de usuários ---
  //
  // A lista de organizadores virou um filtro desta: eram duas telas respondendo à
  // mesma pergunta ("quem é essa pessoa e o que ela pode fazer"), e voltar e
  // avançar entre elas é o que ninguém faz.
  usuarios = signal<UserRow[]>([]);
  totalUsuarios = signal(0);
  busca = signal('');
  filtroPapel = signal('');
  carregandoUsuarios = signal(false);
  /** Ficha aberta: as ligas e o histórico de papel de uma pessoa. */
  ficha = signal<UserDetail | null>(null);
  ligas = signal<League[]>([]);
  ligaEscolhida = signal('');
  private buscaTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly PAGINA = 25;

  /** Edição de nome e e-mail, e a senha temporária recém-criada. */
  editNome = signal('');
  editEmail = signal('');
  senhaTemporaria = signal('');
  confirmacaoAnonimizar = signal('');

  pendentes = computed(() => this.requests().filter((r) => r.status === 'pending'));
  decididos = computed(() => this.requests().filter((r) => r.status !== 'pending'));

  ngOnInit() {
    this.carregar();
  }

  /** Digitar não dispara uma consulta por tecla: espera a pessoa parar. */
  aoBuscar(texto: string) {
    this.busca.set(texto);
    if (this.buscaTimer) clearTimeout(this.buscaTimer);
    this.buscaTimer = setTimeout(() => this.carregarUsuarios(), 300);
  }

  filtrarPorPapel(papel: string) {
    this.filtroPapel.set(papel);
    this.carregarUsuarios();
  }

  /** `mais` acrescenta a próxima página; sem ele, recomeça do zero. */
  carregarUsuarios(mais = false) {
    const offset = mais ? this.usuarios().length : 0;
    this.carregandoUsuarios.set(true);
    this.svc
      .users({ q: this.busca(), role: this.filtroPapel(), limit: this.PAGINA, offset })
      .subscribe({
        next: (pagina) => {
          this.usuarios.set(mais ? [...this.usuarios(), ...pagina.users] : pagina.users);
          this.totalUsuarios.set(pagina.total);
          this.carregandoUsuarios.set(false);
        },
        error: (err) => {
          this.error.set(mensagemDeErro(this.i18n, err));
          this.carregandoUsuarios.set(false);
        },
      });
  }

  temMais = computed(() => this.usuarios().length < this.totalUsuarios());

  abrirAbaUsuarios() {
    this.aba.set('usuarios');
    if (this.usuarios().length === 0) this.carregarUsuarios();
    if (this.ligas().length === 0)
      this.ligaSvc.getLeagues().subscribe({ next: (l) => this.ligas.set(l) });
  }

  abrirFicha(u: UserRow) {
    if (this.ficha()?.id === u.id) {
      this.ficha.set(null);
      return;
    }
    this.ficha.set(null);
    this.ligaEscolhida.set('');
    this.senhaTemporaria.set('');
    this.confirmacaoAnonimizar.set('');
    this.svc.userDetail(u.id).subscribe({
      next: (d) => {
        this.ficha.set(d);
        this.editNome.set(d.display_name);
        this.editEmail.set(d.email);
      },
      error: (err) => this.error.set(mensagemDeErro(this.i18n, err)),
    });
  }

  /** Salva nome e e-mail; a visibilidade tem botão próprio. */
  salvarDados() {
    const f = this.ficha();
    if (!f) return;
    this.decidindo.set(f.id);
    this.svc
      .editarUsuario(f.id, { display_name: this.editNome().trim(), email: this.editEmail().trim() })
      .subscribe({
        next: () => {
          this.decidindo.set(null);
          this.recarregarFicha(f.id);
          this.carregarUsuarios();
        },
        error: (err) => {
          this.error.set(mensagemDeErro(this.i18n, err));
          this.decidindo.set(null);
        },
      });
  }

  /** A permissão de avaliar: some da ficha de conta anonimizada, como o resto. */
  alternarAvaliador() {
    const f = this.ficha();
    if (!f) return;
    this.decidindo.set(f.id);
    this.svc.marcarAvaliador(f.id, !f.avaliador).subscribe({
      next: () => {
        this.decidindo.set(null);
        this.recarregarFicha(f.id);
      },
      error: (err) => {
        this.error.set(mensagemDeErro(this.i18n, err));
        this.decidindo.set(null);
      },
    });
  }

  alternarVisibilidade() {
    const f = this.ficha();
    if (!f) return;
    this.decidindo.set(f.id);
    this.svc.editarUsuario(f.id, { profile_public: !f.profile_public }).subscribe({
      next: () => {
        this.decidindo.set(null);
        this.recarregarFicha(f.id);
      },
      error: (err) => {
        this.error.set(mensagemDeErro(this.i18n, err));
        this.decidindo.set(null);
      },
    });
  }

  async redefinirSenha() {
    const f = this.ficha();
    if (!f) return;
    const ok = await this.dialog.confirm({
      titulo: this.i18n.t('dialog.resetPasswordTitle', { nome: f.display_name }),
      mensagem: this.i18n.t('dialog.resetPasswordBody', { nome: f.display_name }),
      confirmar: this.i18n.t('admin.resetPassword'),
    });
    if (!ok) return;
    this.decidindo.set(f.id);
    this.svc.resetarSenha(f.id).subscribe({
      next: (r) => {
        // Aparece uma vez só: no banco existe apenas o hash.
        this.senhaTemporaria.set(r.senha_temporaria);
        this.decidindo.set(null);
        this.recarregarFicha(f.id);
      },
      error: (err) => {
        this.error.set(mensagemDeErro(this.i18n, err));
        this.decidindo.set(null);
      },
    });
  }

  async mudarEstado(novo: 'ativa' | 'desativada') {
    const f = this.ficha();
    if (!f) return;
    const chave = novo === 'desativada' ? 'dialog.deactivate' : 'dialog.reactivate';
    const ok = await this.dialog.confirm({
      titulo: this.i18n.t(`${chave}Title`, { nome: f.display_name }),
      mensagem: this.i18n.t(`${chave}Body`, { nome: f.display_name }),
      confirmar: this.i18n.t(novo === 'desativada' ? 'admin.deactivate' : 'admin.reactivate'),
      perigo: novo === 'desativada',
    });
    if (!ok) return;
    this.decidindo.set(f.id);
    this.svc.mudarEstado(f.id, novo).subscribe({
      next: () => {
        this.decidindo.set(null);
        this.recarregarFicha(f.id);
        this.carregarUsuarios();
      },
      error: (err) => {
        this.error.set(mensagemDeErro(this.i18n, err));
        this.decidindo.set(null);
      },
    });
  }

  /** Irreversível: o servidor confere o nome digitado antes de apagar os dados. */
  anonimizar() {
    const f = this.ficha();
    if (!f) return;
    this.decidindo.set(f.id);
    this.svc.anonimizar(f.id, this.confirmacaoAnonimizar().trim()).subscribe({
      next: () => {
        this.decidindo.set(null);
        this.confirmacaoAnonimizar.set('');
        this.recarregarFicha(f.id);
        this.carregarUsuarios();
      },
      error: (err) => {
        this.error.set(mensagemDeErro(this.i18n, err));
        this.decidindo.set(null);
      },
    });
  }

  private recarregarFicha(id: string) {
    this.svc.userDetail(id).subscribe({ next: (d) => this.ficha.set(d) });
  }

  /** Ligas que ainda cabem: as que a pessoa não é dona nem já está no time. */
  ligasDisponiveis = computed(() => {
    const f = this.ficha();
    if (!f) return [];
    const jaTem = new Set(f.leagues.map((l) => l.id));
    return this.ligas().filter((l) => !jaTem.has(l.id));
  });

  async trocarPapelDoUsuario(u: UserRow | UserDetail, novo: 'player' | 'organizer' | 'admin') {
    const chave =
      novo === 'admin'
        ? 'dialog.promoteAdmin'
        : novo === 'organizer'
          ? 'dialog.makeOrganizer'
          : 'dialog.makePlayer';
    const ok = await this.dialog.confirm({
      titulo: this.i18n.t(`${chave}Title`, { nome: u.display_name }),
      mensagem: this.i18n.t(`${chave}Body`, { nome: u.display_name }),
      confirmar: this.i18n.t('dialog.confirm'),
      perigo: novo === 'player',
    });
    if (!ok) return;

    this.decidindo.set(u.id);
    this.svc.changeRole(u.id, novo).subscribe({
      next: () => {
        this.decidindo.set(null);
        this.usuarios.update((lista) =>
          lista.map((x) => (x.id === u.id ? { ...x, role: novo } : x)),
        );
        if (this.ficha()?.id === u.id) this.recarregarFicha(u.id);
        this.svc.staff().subscribe({ next: (s) => this.staff.set(s) });
      },
      error: (err) => {
        this.error.set(mensagemDeErro(this.i18n, err));
        this.decidindo.set(null);
      },
    });
  }

  adicionarNoTime() {
    const f = this.ficha();
    const liga = this.ligaEscolhida();
    if (!f || !liga) return;
    this.decidindo.set(f.id);
    // A rota do time recebe o e-mail, a mesma usada na página da liga.
    this.ligaSvc.addOrganizer(liga, f.email).subscribe({
      next: () => {
        this.decidindo.set(null);
        this.ligaEscolhida.set('');
        this.recarregarFicha(f.id);
        this.carregarUsuarios();
      },
      error: (err) => {
        this.error.set(mensagemDeErro(this.i18n, err));
        this.decidindo.set(null);
      },
    });
  }

  async removerDoTime(ligaId: string, nomeDaLiga: string) {
    const f = this.ficha();
    if (!f) return;
    const ok = await this.dialog.confirm({
      titulo: this.i18n.t('dialog.removeOrganizer', { nome: f.display_name }),
      mensagem: this.i18n.t('admin.removeFromTeamBody', { nome: f.display_name, liga: nomeDaLiga }),
      confirmar: this.i18n.t('league.removeOrganizer'),
      perigo: true,
    });
    if (!ok) return;
    this.decidindo.set(f.id);
    this.ligaSvc.removeOrganizer(ligaId, f.id).subscribe({
      next: () => {
        this.decidindo.set(null);
        this.recarregarFicha(f.id);
        this.carregarUsuarios();
      },
      error: (err) => {
        this.error.set(mensagemDeErro(this.i18n, err));
        this.decidindo.set(null);
      },
    });
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
