const { podeOrganizar } = require('./roles');

/**
 * Quem gerencia o quê numa liga e nos eventos dela.
 *
 * Uma liga é cuidada por um **time**: o dono e os co-organizadores que ele
 * adicionou (`league_organizers`). O time gerencia todos os eventos da liga —
 * inclusive os que outra pessoa criou — e nenhum evento fora dela.
 *
 * As decisões ficam em funções puras (testadas sem banco); as consultas, em
 * funções que recebem a conexão e só levantam os fatos. Mesma divisão do
 * `roles.js`: regra escrita num lugar só.
 *
 * Papéis, do mais forte ao mais fraco:
 *   - `dono`       criou o evento (ou, na liga, é o dono dela);
 *   - `dono-liga`  é dono da liga do evento;
 *   - `equipe`     é co-organizador da liga do evento (ou da liga) e ainda tem
 *                  papel de organizador;
 *   - `null`       não gerencia.
 */

/**
 * O papel de alguém num evento, a partir dos fatos já levantados.
 *
 * `papelNaEquipe` é o `users.role` do co-organizador, ou `undefined` se ele não
 * está no time. Conferir o papel aqui, e não só a linha da tabela, é o que faz
 * quem perdeu o acesso de organizador perder junto o acesso às ligas.
 */
function papelNoEvento({ evento, usuarioId, donoDaLigaId, papelNaEquipe }) {
  if (!evento || !usuarioId) return null;
  if (evento.owner_id === usuarioId) return 'dono';
  if (!evento.league_id) return null;
  if (donoDaLigaId === usuarioId) return 'dono-liga';
  if (podeOrganizar(papelNaEquipe)) return 'equipe';
  return null;
}

/** O papel de alguém numa liga: `dono`, `equipe` ou `null`. */
function papelNaLiga({ liga, usuarioId, papelNaEquipe }) {
  if (!liga || !usuarioId) return null;
  if (liga.owner_id === usuarioId) return 'dono';
  if (podeOrganizar(papelNaEquipe)) return 'equipe';
  return null;
}

/** Lançar resultado, mexer em rodada, jogadores e dados do evento. */
const gerenciaEvento = (papel) => papel !== null;

/**
 * Apagar o evento — irreversível, leva resultados junto — e tirá-lo da liga
 * ficam com quem responde por ele: quem o criou e o dono da liga. Um
 * co-organizador que tirasse da liga um evento alheio perderia, ele mesmo, o
 * acesso a um torneio que outra pessoa conduz.
 */
const respondePeloEvento = (papel) => papel === 'dono' || papel === 'dono-liga';

/** Editar nome e regras da liga, e vincular eventos a ela. */
const gerenciaLiga = (papel) => papel !== null;

/** Apagar a liga e escolher quem está no time. */
const ehDonoDaLiga = (papel) => papel === 'dono';

/**
 * Por que esta pessoa não pode entrar no time, ou null se pode.
 *
 * O código de erro é o que a tela traduz.
 */
function impedimentoParaAdicionar({ liga, alvo, jaNoTime }) {
  if (!alvo) return 'api.userNotFound';
  if (alvo.id === liga.owner_id) return 'api.leagueOwnerAlready';
  if (!podeOrganizar(alvo.role)) return 'api.coOrganizerMustOrganize';
  if (jaNoTime) return 'api.coOrganizerAlready';
  return null;
}

/**
 * Remover alguém do time: o dono remove qualquer um, e cada co-organizador pode
 * sair por conta própria.
 */
function podeRemoverDoTime({ papelDeQuemPede, quemPedeId, alvoId }) {
  return papelDeQuemPede === 'dono' || (papelDeQuemPede === 'equipe' && quemPedeId === alvoId);
}

// --- Consultas ---

/** Dono da liga e o papel atual de `usuarioId` no time dela, numa ida ao banco. */
async function fatosDaLiga(conn, ligaId, usuarioId) {
  return conn.get(
    `SELECT l.owner_id AS dono_da_liga_id,
            (SELECT u.role FROM league_organizers lo JOIN users u ON u.id = lo.user_id
              WHERE lo.league_id = l.id AND lo.user_id = ?) AS papel_na_equipe
     FROM leagues l WHERE l.id = ?`,
    [usuarioId, ligaId]
  );
}

async function papelDoUsuarioNoEvento(conn, evento, usuarioId) {
  if (!evento || !usuarioId) return null;
  if (evento.owner_id === usuarioId) return 'dono';
  if (!evento.league_id) return null;
  const fatos = await fatosDaLiga(conn, evento.league_id, usuarioId);
  return papelNoEvento({
    evento,
    usuarioId,
    donoDaLigaId: fatos?.dono_da_liga_id,
    papelNaEquipe: fatos?.papel_na_equipe ?? undefined,
  });
}

async function papelDoUsuarioNaLiga(conn, liga, usuarioId) {
  if (!liga || !usuarioId) return null;
  if (liga.owner_id === usuarioId) return 'dono';
  const fatos = await fatosDaLiga(conn, liga.id, usuarioId);
  return papelNaLiga({ liga, usuarioId, papelNaEquipe: fatos?.papel_na_equipe ?? undefined });
}

/**
 * Os co-organizadores que ainda valem (com papel de organizador), com nome.
 * Sem e-mail: a lista aparece na página pública da liga.
 */
async function coOrganizadores(conn, ligaId) {
  const linhas = await conn.query(
    `SELECT u.id AS user_id, u.display_name, u.role
     FROM league_organizers lo JOIN users u ON u.id = lo.user_id
     WHERE lo.league_id = ? ORDER BY lo.created_at`,
    [ligaId]
  );
  return linhas.filter((l) => podeOrganizar(l.role)).map(({ user_id, display_name }) => ({ user_id, display_name }));
}

/** Todo mundo que gerencia os eventos da liga: o dono e o time. */
async function idsDoTime(conn, ligaId) {
  const liga = await conn.get('SELECT owner_id FROM leagues WHERE id = ?', [ligaId]);
  if (!liga) return [];
  const time = await coOrganizadores(conn, ligaId);
  return [liga.owner_id, ...time.map((c) => c.user_id)];
}

module.exports = {
  papelNoEvento,
  papelNaLiga,
  gerenciaEvento,
  respondePeloEvento,
  gerenciaLiga,
  ehDonoDaLiga,
  impedimentoParaAdicionar,
  podeRemoverDoTime,
  papelDoUsuarioNoEvento,
  papelDoUsuarioNaLiga,
  coOrganizadores,
  idsDoTime,
};
