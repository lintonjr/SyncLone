/**
 * O histórico de uma inscrição num torneio.
 *
 * Existe por causa de uma pergunta que o sistema não soube responder: um jogador
 * terminou as quatro rodadas de uma etapa de liga e sumiu da classificação, e
 * `event_players` — que guarda só o estado atual — não tinha como dizer quem o
 * tirou. O sistema não dropa ninguém sozinho; são três rotas, todas humanas. O
 * que faltava era o autor e a hora.
 *
 * Duas coisas moram aqui: a decisão de *como se chama* o que aconteceu (pura, sem
 * banco) e a escrita da linha.
 */

const { v4: uuidv4 } = require('uuid');

/**
 * O nome do que aconteceu com a inscrição.
 *
 * `de` é o status antes (null quando a inscrição está nascendo) e `para` o status
 * depois (null quando a linha foi apagada). `peloProprio` separa os dois fatos
 * que terminam no mesmo status e não são a mesma coisa: sair por conta própria e
 * ser tirado pelo organizador.
 *
 * A função é total de propósito — toda transição cai num rótulo. Uma troca de
 * status que a tela não faz hoje cai em `alterado` em vez de não gerar linha:
 * auditoria com buraco é pior que auditoria grosseira.
 */
function acaoDaMudanca({ de, para, peloProprio = false }) {
  if (!de) return 'entrou';

  // Linha apagada: só acontece com quem nunca sentou à mesa (retirePlayer). Um
  // pedido que nunca foi aprovado e desaparece é uma recusa, não uma exclusão.
  if (!para) return de === 'pending' ? 'rejeitado' : 'excluido';

  if (de === para) return 'alterado';
  if (para === 'dropped') return peloProprio ? 'saiu' : 'removido';
  if (para === 'active') return de === 'pending' ? 'aprovado' : 'restaurado';
  return 'alterado';
}

/**
 * Uma linha no histórico da inscrição.
 *
 * Recebe a conexão em vez de usar o módulo do banco direto porque várias das
 * chamadas rodam dentro de transação (`db.tx`) — o registro tem de entrar ou
 * sumir junto com o fato que ele descreve.
 *
 * `display_name` vai gravado, e não buscado na leitura, porque a inscrição pode
 * não existir mais: é justamente o caso do pedido recusado, cuja linha é apagada.
 */
function registrar(conn, { evento, inscricao, nome, de, para, autor, peloProprio, motivo = null }) {
  return conn.run(
    `INSERT INTO event_player_history
       (id, event_id, event_player_id, display_name, acao, de, para, autor_id, motivo)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      uuidv4(),
      evento,
      inscricao,
      nome,
      acaoDaMudanca({ de, para, peloProprio }),
      de ?? null,
      para ?? null,
      autor ?? null,
      motivo,
    ]
  );
}

module.exports = { acaoDaMudanca, registrar };
