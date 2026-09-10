import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Badge, BadgeAward, BadgeService } from '../../services/badge';
import { I18nService, mensagemDeErro } from '../../i18n/i18n';
import { environment } from '../../../environments/environment';

/**
 * A área de badges do organizador: criar, editar, entregar e revogar.
 *
 * A entrega é por e-mail porque o sistema não tem — e deliberadamente não deve
 * ter — busca de usuários: uma lista de contas consultável exporia a base
 * inteira para resolver um problema que o organizador já resolve sabendo a quem
 * está entregando.
 */
@Component({
  selector: 'app-badges',
  imports: [CommonModule],
  templateUrl: './badges.html',
  styleUrl: './badges.scss',
})
export class BadgesComponent implements OnInit {
  i18n = inject(I18nService);
  private svc = inject(BadgeService);
  private apiUrl = environment.apiUrl.replace('/api', '');

  badges = signal<Badge[]>([]);
  loading = signal(true);
  error = signal('');
  saving = signal(false);

  /** Formulário de criação/edição. `editando` nulo significa criar. */
  formOpen = signal(false);
  editando = signal<Badge | null>(null);
  nome = signal('');
  arquivo = signal<File | null>(null);
  previewUrl = signal('');

  /** Badge cuja lista de recebedores está aberta. */
  aberta = signal<string | null>(null);
  recebedores = signal<BadgeAward[]>([]);

  vazio = computed(() => !this.loading() && this.badges().length === 0);

  ngOnInit() {
    this.carregar();
  }

  private carregar() {
    this.svc.mine().subscribe({
      next: (b) => {
        this.badges.set(b);
        this.loading.set(false);
      },
      error: (err) => {
        this.error.set(mensagemDeErro(this.i18n, err));
        this.loading.set(false);
      },
    });
  }

  imagemDe(b: Badge): string {
    return `${this.apiUrl}${b.image}`;
  }

  abrirCriacao() {
    this.editando.set(null);
    this.nome.set('');
    this.arquivo.set(null);
    this.previewUrl.set('');
    this.error.set('');
    this.formOpen.set(true);
  }

  abrirEdicao(b: Badge) {
    this.editando.set(b);
    this.nome.set(b.name);
    this.arquivo.set(null);
    // Na edição a prévia começa mostrando a imagem que já está lá: trocar é
    // opcional, e um espaço vazio sugeriria que a antiga se perdeu.
    this.previewUrl.set(this.imagemDe(b));
    this.error.set('');
    this.formOpen.set(true);
  }

  escolherArquivo(e: Event) {
    const f = (e.target as HTMLInputElement).files?.[0] ?? null;
    this.arquivo.set(f);
    this.previewUrl.set(f ? URL.createObjectURL(f) : '');
  }

  podeSalvar = computed(
    () => this.nome().trim().length >= 2 && (!!this.arquivo() || !!this.editando()),
  );

  salvar() {
    if (!this.podeSalvar()) return;
    const form = new FormData();
    form.append('name', this.nome().trim());
    const f = this.arquivo();
    if (f) form.append('image', f);

    this.saving.set(true);
    this.error.set('');
    const alvo = this.editando();
    const req = alvo ? this.svc.update(alvo.id, form) : this.svc.create(form);
    req.subscribe({
      next: () => {
        this.saving.set(false);
        this.formOpen.set(false);
        this.carregar();
      },
      error: (err) => {
        this.error.set(mensagemDeErro(this.i18n, err));
        this.saving.set(false);
      },
    });
  }

  apagar(b: Badge) {
    if (!confirm(this.i18n.t('badges.deleteConfirm', { nome: b.name }))) return;
    this.svc.remove(b.id).subscribe({
      next: () => this.carregar(),
      error: (err) => this.error.set(mensagemDeErro(this.i18n, err)),
    });
  }

  alternarRecebedores(b: Badge) {
    if (this.aberta() === b.id) {
      this.aberta.set(null);
      return;
    }
    this.aberta.set(b.id);
    this.carregarRecebedores(b.id);
  }

  private carregarRecebedores(badgeId: string) {
    this.recebedores.set([]);
    this.svc.awards(badgeId).subscribe({
      next: (r) => this.recebedores.set(r),
      error: (err) => this.error.set(mensagemDeErro(this.i18n, err)),
    });
  }

  entregar(b: Badge) {
    const email = prompt(this.i18n.t('badges.awardPrompt', { nome: b.name }));
    if (!email?.trim()) return;
    this.error.set('');
    this.svc.award(b.id, email.trim()).subscribe({
      next: () => {
        this.carregar();
        // Com a lista aberta, a pessoa acabou de entregar e espera ver o nome ali.
        if (this.aberta() === b.id) this.carregarRecebedores(b.id);
      },
      error: (err) => this.error.set(mensagemDeErro(this.i18n, err)),
    });
  }

  revogar(b: Badge, r: BadgeAward) {
    if (!confirm(this.i18n.t('badges.revokeConfirm', { nome: b.name, quem: r.display_name })))
      return;
    this.svc.revoke(b.id, r.user_id).subscribe({
      next: () => {
        this.recebedores.update((lista) => lista.filter((x) => x.id !== r.id));
        this.carregar();
      },
      error: (err) => this.error.set(mensagemDeErro(this.i18n, err)),
    });
  }
}
