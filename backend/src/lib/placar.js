/**
 * O placar por games de uma mesa de duelo, e a regra que o liga ao resultado.
 *
 * A regra, dita pelo dono da loja: **o placar determina o resultado**. Quem fez
 * mais games venceu a partida; placar igual é empate. 2-1 e 2-0 são vitória de
 * quem fez 2, 1-0 é vitória de quem fez 1, e 1-1 e 0-0 são empate.
 *
 * Isso é o que justifica este arquivo existir. Antes havia duas entradas
 * independentes — quem venceu, e qual o placar — e a rota só conferia uma delas
 * (`events.js`: partida decidida não podia terminar em placar igual). Faltavam
 * as duas combinações contraditórias, e as duas eram aceitas:
 *
 *   - `result: 'player1'` com placar `0-2`, isto é, o vencedor da partida com
 *     MENOS games que o perdedor. O GW% então creditava os games a quem perdeu.
 *   - `result: 'draw'` com placar `2-0`, um empate em que alguém fez dois games.
 *
 * Nenhuma das duas era alcançável pela tela de então, porque ela só oferecia
 * 2-0 e 2-1 e nunca mandava placar em empate. As duas passariam a ser
 * alcançáveis no instante em que 1-0, 1-1 e 0-0 aparecessem. Derivar o resultado
 * do placar mata as duas por construção: não existe estado contraditório para
 * validar, porque o resultado não é mais uma segunda entrada.
 *
 * O `0-0` grava o empate e **não contribui para o GW%** — são zero games
 * decididos, e `computeStandings` ignora mesa sem game. A Appendix C do MTR tem
 * um refinamento ("unfinished games are considered draws", valendo 1 ponto de
 * game), mas aplicá-lo exigiria saber que houve um game começado e não
 * terminado, e o banco guarda games GANHOS por cada lado — um 0-0 não distingue
 * "deu tempo no primeiro game" de "a partida não começou". Inventar o game
 * seria inventar desempate; fica registrado como trabalho seguinte, com coluna
 * própria.
 */

/** Placar sem vencedor: os dois lados fizeram o mesmo número de games. */
const EMPATES = [[1, 1], [0, 0]];

/** Placar com vencedor, do ponto de vista de quem venceu. */
const VITORIAS = [[2, 0], [2, 1], [1, 0]];

/**
 * Quem venceu, lido do placar. É a regra da loja, e o único lugar que a decide.
 */
function resultadoDoPlacar(p1Games, p2Games) {
  if (p1Games > p2Games) return 'player1';
  if (p2Games > p1Games) return 'player2';
  return 'draw';
}

const mesmoPlacar = ([a, b]) => (p, q) => (a === p && b === q);
const ehPlacarConhecido = (p1, p2) =>
  EMPATES.some((e) => mesmoPlacar(e)(p1, p2)) ||
  VITORIAS.some((v) => mesmoPlacar(v)(p1, p2) || mesmoPlacar(v)(p2, p1));

/**
 * Confere um placar recebido. Devolve `null` quando está bom, ou `{ status,
 * message, code }` para a rota transformar em erro HTTP.
 *
 * @param result    o resultado que o cliente mandou ('player1'..'player4' | 'draw')
 * @param p1Games   games do assento 1, ou undefined quando não há placar
 * @param p2Games   games do assento 2, ou undefined
 * @param ehDuelo   a mesa tem exatamente dois assentos
 */
function conferirPlacar({ result, p1Games, p2Games, ehDuelo }) {
  const temPlacar = p1Games !== undefined && p2Games !== undefined;
  if (!temPlacar) return null;

  // Mesa de três ou quatro não tem "2×1": o desempate não saberia ler, e a
  // classificação passaria a depender de um número que ninguém definiu.
  if (!ehDuelo) {
    return { status: 400, message: 'Game scores only apply to 1v1 tables', code: 'api.gameScoreDuelOnly' };
  }

  if (!ehPlacarConhecido(p1Games, p2Games)) {
    return {
      status: 400,
      message: 'Placar inválido: use 2-0, 2-1, 1-0, 1-1 ou 0-0',
      code: 'api.gameScoreInvalid',
    };
  }

  // A trava que faltava: o resultado tem de ser o que o placar diz.
  const esperado = resultadoDoPlacar(p1Games, p2Games);
  if (result !== esperado) {
    return {
      status: 400,
      message: `Placar ${p1Games}-${p2Games} corresponde a "${esperado}", não a "${result}"`,
      code: 'api.gameScoreMismatch',
    };
  }

  return null;
}

/**
 * O rótulo que a tela mostra, do ponto de vista de um assento.
 * Devolve null quando a mesa não tem placar registrado.
 */
function rotuloDoPlacar(p1Games, p2Games) {
  if (p1Games === null || p1Games === undefined) return null;
  if (p2Games === null || p2Games === undefined) return null;
  return `${p1Games}-${p2Games}`;
}

module.exports = { EMPATES, VITORIAS, resultadoDoPlacar, conferirPlacar, rotuloDoPlacar, ehPlacarConhecido };
