import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { environment } from '../../environments/environment';

/** Os sete estados de uma OS. A ordem aqui é a do fluxo, e a tela conta com isso. */
export type StatusOS =
  | 'para_avaliar'
  | 'avaliado'
  | 'recusada'
  | 'a_pagar'
  | 'para_guardar'
  | 'para_inserir'
  | 'inserido';

export const STATUS_EM_ORDEM: StatusOS[] = [
  'para_avaliar',
  'avaliado',
  'a_pagar',
  'para_guardar',
  'para_inserir',
  'inserido',
  'recusada',
];

/** Uma OS na lista. Os valores vêm do servidor em texto, como o MySQL os guarda. */
export interface AvaliacaoRow {
  id: string;
  codigo: string;
  nome: string;
  telefone: string;
  email: string | null;
  status: StatusOS;
  valor_bruto: string | null;
  valor_credito: string | null;
  valor_pix: string | null;
  escolha: 'credito' | 'pix' | null;
  created_at: string;
  updated_at: string;
  criada_por_nome: string | null;
}

export interface AvaliacoesPage {
  avaliacoes: AvaliacaoRow[];
  total: number;
  limit: number;
  offset: number;
  /** Quantas OS em cada estado — alimenta os contadores das abas. */
  por_status: Partial<Record<StatusOS, number>>;
}

/** Uma linha da história da OS. `autor` nulo é o cliente, que não se identifica. */
export interface EventoDaOS {
  acao:
    'criada' | 'editada' | 'avaliada' | 'aceita' | 'recusada' | 'pagamento' | 'avanco' | 'retorno';
  de: string | null;
  para: string | null;
  motivo: string | null;
  created_at: string;
  autor: string | null;
}

export interface AvaliacaoDetalhe extends AvaliacaoRow {
  comentarios: string | null;
  link_avaliacao: string | null;
  percentual_credito: number;
  percentual_pix: number;
  token_publico: string | null;
  chave_pix: string | null;
  comprovante: string | null;
  historico: EventoDaOS[];
}

/** O que o cliente vê pelo link: nem e-mail, nem valor bruto, nem a planilha. */
export interface PropostaPublica {
  codigo: string;
  nome: string;
  telefone: string;
  comentarios: string | null;
  valor_credito: string;
  valor_pix: string;
  status: StatusOS;
  escolha: 'credito' | 'pix' | null;
  respondida: boolean;
}

@Injectable({ providedIn: 'root' })
export class AvaliacaoService {
  private readonly API = `${environment.apiUrl}/avaliacoes`;
  private http = inject(HttpClient);

  private headers() {
    return new HttpHeaders({ Authorization: `Bearer ${localStorage.getItem('token')}` });
  }

  lista(opcoes: { q?: string; status?: string; limit?: number; offset?: number } = {}) {
    const params = new URLSearchParams();
    if (opcoes.q) params.set('q', opcoes.q);
    if (opcoes.status) params.set('status', opcoes.status);
    params.set('limit', String(opcoes.limit ?? 25));
    params.set('offset', String(opcoes.offset ?? 0));
    return this.http.get<AvaliacoesPage>(`${this.API}?${params}`, { headers: this.headers() });
  }

  abrir(id: string) {
    return this.http.get<AvaliacaoDetalhe>(`${this.API}/${id}`, { headers: this.headers() });
  }

  criar(dados: { nome: string; telefone: string; email?: string; comentarios?: string }) {
    return this.http.post<AvaliacaoDetalhe>(this.API, dados, { headers: this.headers() });
  }

  editar(
    id: string,
    dados: { nome?: string; telefone?: string; email?: string; comentarios?: string },
  ) {
    return this.http.put<AvaliacaoDetalhe>(`${this.API}/${id}`, dados, { headers: this.headers() });
  }

  /** Link e valor juntos: é o par que vira proposta e cria o endereço público. */
  avaliar(id: string, link_avaliacao: string, valor: string) {
    return this.http.post<AvaliacaoDetalhe>(
      `${this.API}/${id}/avaliar`,
      { link_avaliacao, valor },
      { headers: this.headers() },
    );
  }

  confirmarPagamento(id: string, comprovante: File) {
    const form = new FormData();
    form.append('comprovante', comprovante);
    return this.http.post<AvaliacaoDetalhe>(`${this.API}/${id}/pagamento`, form, {
      headers: this.headers(),
    });
  }

  avancar(id: string) {
    return this.http.post<AvaliacaoDetalhe>(
      `${this.API}/${id}/avancar`,
      {},
      { headers: this.headers() },
    );
  }

  voltar(id: string, motivo: string) {
    return this.http.post<AvaliacaoDetalhe>(
      `${this.API}/${id}/voltar`,
      { motivo },
      { headers: this.headers() },
    );
  }

  // --- Cliente, sem conta e sem cabeçalho de autorização ---

  proposta(token: string) {
    return this.http.get<PropostaPublica>(`${this.API}/publica/${token}`);
  }

  responder(
    token: string,
    resposta: 'aceitar' | 'recusar',
    escolha?: 'credito' | 'pix',
    chave_pix?: string,
  ) {
    return this.http.post<PropostaPublica>(`${this.API}/publica/${token}`, {
      resposta,
      escolha,
      chave_pix,
    });
  }
}
