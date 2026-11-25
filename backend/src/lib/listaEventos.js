/**
 * O recorte de uma lista de torneios: busca, liga e ordem.
 *
 * Existe porque as duas telas que mostram torneios — a home e "Meus eventos" —
 * passaram a oferecer os mesmos controles, e cada uma tem sua própria consulta:
 * a home lista o que é público, "Meus eventos" lista o que é seu. Duas consultas
 * com duas ideias de "buscar" é o tipo de divergência que ninguém lembra depois,
 * então a regra mora aqui e as rotas só a encaixam.
 *
 * Tudo aqui é puro: entra o que veio na query string, sai `condicoes`, `params` e
 * `ordem`. Quem monta o SQL é a rota, que é a única que sabe o resto da consulta
 * dela. Isso também é o que torna a regra testável sem banco, como o resto de
 * `lib/`.
 *
 * As condições pressupõem dois apelidos na consulta de quem chama: `e` para
 * `events` e `l` para `leagues` em LEFT JOIN (a busca casa o nome da liga, e sem
 * o LEFT JOIN um torneio sem liga sumiria da busca).
 */

/**
 * As ordens que o cliente pode pedir, e o SQL de cada uma.
 *
 * É uma lista fechada de propósito: o valor vem da query string e vai para o
 * `ORDER BY`, posição em que o driver não aceita placeholder. Mapear para um
 * literal daqui é o que garante que nada de fora entre inteiro na consulta — um
 * valor desconhecido cai no padrão da seção, não em erro.
 *
 * `e.id` entra como critério de desempate em todas: dois torneios na mesma data
 * são comuns (a rodada de sábado da loja), e sem desempate a ordem entre eles
 * pode mudar de uma página para a outra — o que, com LIMIT/OFFSET, faz o mesmo
 * torneio aparecer duas vezes ou nenhuma no "Carregar mais".
 */
const ORDENS = {
  data_desc: 'e.date DESC, e.id DESC',
  data_asc: 'e.date ASC, e.id ASC',
};

/**
 * A ordem de quem não pediu ordem nenhuma.
 *
 * Cada lista tem um "mais relevante no topo" diferente, e é isso que o padrão
 * persegue:
 *
 *   - próximos eventos: o mais perto de acontecer primeiro — é o torneio de
 *     sábado que a pessoa quer ver, não o do ano que vem;
 *   - eventos passados: o mais recente primeiro;
 *   - "Meus eventos", que mistura futuro e passado: o mais recente primeiro,
 *     porque a lista começa no que acabou de acontecer ou está por acontecer.
 */
function ordemPadrao({ passados } = {}) {
  return passados === true ? 'data_desc' : passados === false ? 'data_asc' : 'data_desc';
}

/**
 * Torneios futuros ou torneios passados — o corte das duas seções da home.
 *
 * Um torneio encerrado é passado mesmo com data no futuro: quem finalizou o
 * evento já disse que ele acabou, e deixá-lo entre os próximos seria contrariar
 * o organizador. É por isso que o corte não é só a data.
 *
 * `agora` é o instante em `'YYYY-MM-DD HH:MM:SS'`, como o MySQL guarda em
 * `events.date` (UTC — ver migrations/017).
 */
function recorteDaSecao({ passados, agora }) {
  return passados
    ? { condicao: "(e.date < ? OR e.status = 'completed')", params: [agora] }
    : { condicao: "e.date >= ? AND e.status != 'completed'", params: [agora] };
}

/**
 * O que a busca por texto procura.
 *
 * Quatro campos do torneio e **o nome de quem está inscrito** — foi esta última
 * parte que motivou o módulo: a pergunta "em que torneios o Zé jogou?" não tinha
 * resposta na tela, só no banco.
 *
 * O nome do jogador sai do mesmo `COALESCE` que a ficha do evento usa: conta tem
 * o nome no cadastro, convidado tem na inscrição, e metade das inscrições do
 * sistema é de convidado. Sem recorte por status — quem entrou e saiu continua
 * tendo jogado, e quem está na fila de espera também é achado.
 */
function filtroDeBusca(texto) {
  const like = `%${texto}%`;
  return {
    condicao: `(e.name LIKE ? OR e.description LIKE ? OR e.game LIKE ? OR l.name LIKE ?
      OR EXISTS (SELECT 1 FROM event_players epb
                   LEFT JOIN users ub ON ub.id = epb.user_id
                  WHERE epb.event_id = e.id
                    AND COALESCE(ub.display_name, epb.display_name) LIKE ?))`,
    params: [like, like, like, like, like],
  };
}

/** O valor de `league_id` que significa "torneio solto, sem liga". */
const SEM_LIGA = 'none';

/**
 * O recorte completo de uma lista de torneios.
 *
 * `passados` só é passado por quem tem as duas seções (a home). Em "Meus
 * eventos" ele fica de fora: a lista é uma só, com futuro e passado juntos, e
 * nenhum corte de data se aplica.
 *
 * Devolve `condicoes` como lista, não como texto pronto, porque cada rota tem a
 * sua própria base no WHERE — `test_event = 0` numa, o dono e o time da liga na
 * outra — e emendar texto de WHERE entre módulos é como se erra a precedência de
 * um OR.
 */
function filtrosDeEventos({ q, liga, ordem, passados, agora } = {}) {
  const condicoes = [];
  const params = [];

  if (passados !== undefined) {
    const secao = recorteDaSecao({ passados, agora });
    condicoes.push(secao.condicao);
    params.push(...secao.params);
  }

  const texto = typeof q === 'string' ? q.trim() : '';
  if (texto) {
    const busca = filtroDeBusca(texto);
    condicoes.push(busca.condicao);
    params.push(...busca.params);
  }

  const ligaEscolhida = typeof liga === 'string' ? liga.trim() : '';
  if (ligaEscolhida === SEM_LIGA) {
    condicoes.push('e.league_id IS NULL');
  } else if (ligaEscolhida) {
    condicoes.push('e.league_id = ?');
    params.push(ligaEscolhida);
  }

  return {
    condicoes,
    params,
    ordem: ORDENS[ordem] ?? ORDENS[ordemPadrao({ passados })],
  };
}

module.exports = { filtrosDeEventos, ordemPadrao, ORDENS, SEM_LIGA };
