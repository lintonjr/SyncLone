/**
 * Suíço por desempenho em duelo, sem revanche.
 *
 * O MTR não traz algoritmo de pareamento: a seção 10.4 ("Pairing Algorithm")
 * diz só que "tournaments are assumed to follow the Swiss pairing algorithm" e
 * gasta o resto no chaveamento do playoff. A norma que falta está na FIDE, nas
 * Regras Básicas do Suíço (C.04.1) e no sistema Dubov (C.04.4.1) — e Dubov é
 * justamente o pareamento adjacente (1º×2º, 3º×4º) que este projeto já fazia.
 * O que faltava não era o sistema: era o critério absoluto.
 *
 * C.04.1, artigo 2: "Two participants shall not play against each other more
 * than once". O caminho antigo ordenava pela classificação e fatiava em pares
 * adjacentes sem olhar o histórico; medido, 96,8% dos torneios de 17 jogadores
 * em 5 rodadas tinham ao menos um reencontro, e o mesmo par chegava a se
 * enfrentar três vezes. Comparado com o emparelhamento ótimo exato, 100% deles
 * eram evitáveis — e com a soma das diferenças de pontos idêntica, isto é, de
 * graça.
 *
 * Os artigos 6, 7 e 8 da C.04.1 (equilíbrio de cor, nunca três cores iguais
 * seguidas, alternância) não se aplicam: Magic não tem brancas e pretas, e quem
 * começa sai do dado a cada partida (MTR 2.2). Por isso o critério [C3] de
 * Dubov também fica de fora.
 *
 * ## Os critérios
 *
 * Cada mesa possível é uma aresta com um custo, e o pareamento da rodada é o
 * emparelhamento perfeito de **custo mínimo**. O custo empacota os critérios em
 * um inteiro só, o de maior prioridade nos bits mais significativos — a ideia é
 * de `weights.ts` do echecsjs/swiss, e o que ela compra é a ordem lexicográfica
 * sem comparador aninhado: um critério de baixa prioridade não consegue, por
 * construção, vencer um de prioridade alta.
 *
 *   R  revanche        [C1]      C.04.1 art. 2 — absoluto
 *   Q  Δ de pontos ao quadrado   [C5] + [C6], Dubov 2.3.1–2.3.2
 *   D  adjacência                C.04.4.1 — o "por desempenho" propriamente dito
 *
 * O quadrado do Δ não é enfeite, é o critério. Dubov 2.3.2 manda "minimise the
 * score differences **taken in descending order**": comparar primeiro a maior
 * diferença, depois a segunda. Num campo de 9, 6, 6, 3 pontos existem duas
 * saídas que somam o mesmo Δ total — 9×3 com 6×6 (diferenças 6 e 0) e 9×6 com
 * 6×3 (diferenças 3 e 3) — e a ordem descendente separa as duas: [3,3] é melhor
 * que [6,0]. A soma simples dos Δ empata em 6 e não decide; somar o quadrado
 * decide igual à regra, 18 contra 36, porque uma função convexa prefere
 * espalhar o deslocamento a concentrá-lo.
 *
 * Isso também é o que impede este módulo de reproduzir o próprio defeito que
 * ele vem corrigir. A primeira versão daqui usava dois critérios separados —
 * "minimize o NÚMERO de mesas com flutuação" acima de "minimize a soma dos Δ" —
 * e com ele o campo 9/6/6/3 saía como 9×3: uma mesa de 3-1 contra 1-3 e outra
 * perfeitamente equilibrada, que é exatamente a mesa estranha que motivou este
 * trabalho. Contar mesas deslocadas premia concentrar o deslocamento numa só.
 *
 * Os critérios [C8] a [C10] de Dubov (2.3.4–2.3.6: não rebaixar sempre o mesmo
 * jogador, nem quem foi rebaixado na rodada anterior) ficaram de fora. Saber
 * quem flutuou numa rodada passada exige a classificação **daquele instante**,
 * que não está gravada — as mesas estão, os pontos de então não. Dá para
 * reconstruir recalculando a classificação a cada prefixo de rodadas, e é por
 * isso que ficou registrado como trabalho seguinte em vez de aproximado aqui:
 * eles são critérios de menor prioridade que [C6], e um palpite sobre quem
 * flutuou decidiria mesa com dado inventado.
 *
 * A divergência deliberada em relação ao echecsjs: lá a aresta de revanche é
 * **omitida** do grafo e o blossom roda em cardinalidade máxima, o que pode
 * deixar jogador sem mesa. Numa rodada de Magic ninguém pode ficar sem mesa, e
 * campo pequeno encolhido por drop às vezes não tem emparelhamento sem revanche
 * nenhum (medido: acontece, e nesses casos nenhum algoritmo faz melhor). Então
 * aqui a revanche é o campo **dominante do custo** em vez de uma aresta ausente:
 * o mínimo continua sendo zero revanche sempre que zero for possível, e quando
 * não for, sai o mínimo possível em vez de "tanto faz". As mesas relaxadas são
 * contadas e devolvidas, porque o organizador precisa poder explicar a mesa
 * (C.04.1, artigo 9).
 *
 * ## A conta exata, e onde ela para
 *
 * Até `LIMITE_EXATO` jogadores o emparelhamento é **exato**, por programação
 * dinâmica sobre bitmask — é o caso de toda loja (17 jogadores, que é o que a
 * Appendix E do MTR manda para 17–32, resolve em milissegundos). Acima disso a
 * busca exata não cabe (2^n estados), e entra uma heurística: guloso pelo custo
 * mais uma melhora local 2-opt, que conserta revanche porque a revanche é o
 * campo dominante. O teste de propriedade compara as duas contra o ótimo.
 */

// Acima daqui o DP sobre bitmask deixa de caber na memória: 2^20 estados em
// Float64Array já são 8 MB, e o pareamento roda uma vez por rodada.
const LIMITE_EXATO = 20;

// Bits de um inteiro que o `Number` ainda soma e compara sem perder dígito.
const BITS_SEGUROS = 52;

/**
 * Quantos bits são necessários para guardar 0..max.
 */
function bitsPara(max) {
  let bits = 1;
  while (2 ** bits - 1 < max) bits++;
  return bits;
}

/**
 * Monta a função de custo de uma aresta.
 *
 * As larguras dos campos são calculadas do campo real, não fixadas: o que tem
 * de caber em cada campo é a **soma** dele sobre todas as mesas da rodada, não
 * o valor de uma mesa. Com largura fixa, um torneio grande com muitos pontos
 * faria a soma de um critério transbordar para o campo do critério acima e
 * inverter a prioridade em silêncio.
 *
 * Se mesmo assim não couber em 52 bits, os critérios de menor prioridade são
 * abandonados um a um — melhor perder a adjacência que perder a aritmética.
 */
function montarCusto(campo, historico) {
  const n = campo.length;
  const mesas = Math.max(1, Math.floor(n / 2));
  const pontos = campo.map((p) => p.points ?? 0);
  const deltaMax = Math.max(0, Math.max(...pontos) - Math.min(...pontos));

  const posicao = new Map(campo.map((p, i) => [p.id, i]));

  // Cada campo com o máximo que a SOMA dele pode atingir nesta rodada.
  const campos = [
    { nome: 'revanche', max: mesas },
    { nome: 'delta2', max: mesas * deltaMax * deltaMax },
    { nome: 'adjacencia', max: mesas * n },
  ];

  // Da menor prioridade para a maior, até caber.
  let usados = campos;
  while (usados.reduce((s, c) => s + bitsPara(c.max), 0) > BITS_SEGUROS && usados.length > 1) {
    usados = usados.slice(0, -1);
  }

  const larguras = usados.map((c) => bitsPara(c.max));
  // Deslocamento de cada campo: o primeiro é o mais significativo.
  const deslocamentos = [];
  let acumulado = 0;
  for (let i = larguras.length - 1; i >= 0; i--) {
    deslocamentos[i] = acumulado;
    acumulado += larguras[i];
  }
  const ativos = new Set(usados.map((c) => c.nome));
  const fator = (nome) => {
    const i = usados.findIndex((c) => c.nome === nome);
    return i === -1 ? 0 : 2 ** deslocamentos[i];
  };
  const fatores = {
    revanche: fator('revanche'),
    delta2: fator('delta2'),
    adjacencia: fator('adjacencia'),
  };

  return (a, b) => {
    const delta = Math.abs((a.points ?? 0) - (b.points ?? 0));
    const revanche = historico.get(a.id)?.has(b.id) ? 1 : 0;

    let custo = revanche * fatores.revanche;
    if (ativos.has('delta2')) custo += delta * delta * fatores.delta2;
    if (ativos.has('adjacencia')) {
      custo += Math.abs(posicao.get(a.id) - posicao.get(b.id)) * fatores.adjacencia;
    }
    return custo;
  };
}

/**
 * Emparelhamento perfeito de custo mínimo, exato, por DP sobre bitmask.
 *
 * O estado é o conjunto de jogadores já pareados; a transição pareia sempre o
 * primeiro livre, o que elimina a contagem repetida das permutações de mesas.
 */
function emparelharExato(n, custoDe) {
  const estados = 1 << n;
  const memo = new Float64Array(estados).fill(-1);
  const escolha = new Int32Array(estados).fill(-1);

  const resolver = (mascara) => {
    if (mascara === estados - 1) return 0;
    if (memo[mascara] >= 0) return memo[mascara];

    let i = 0;
    while (mascara & (1 << i)) i++;

    let melhor = Infinity;
    let melhorJ = -1;
    for (let j = i + 1; j < n; j++) {
      if (mascara & (1 << j)) continue;
      const v = custoDe(i, j) + resolver(mascara | (1 << i) | (1 << j));
      if (v < melhor) {
        melhor = v;
        melhorJ = j;
      }
    }
    memo[mascara] = melhor;
    escolha[mascara] = melhorJ;
    return melhor;
  };

  resolver(0);

  const pares = [];
  let mascara = 0;
  while (mascara !== estados - 1) {
    let i = 0;
    while (mascara & (1 << i)) i++;
    const j = escolha[mascara];
    if (j === -1) break;
    pares.push([i, j]);
    mascara |= (1 << i) | (1 << j);
  }
  return pares;
}

/**
 * Campo grande: guloso pelo custo, depois 2-opt até não melhorar mais.
 *
 * O 2-opt é o que conserta a miopia do guloso — inclusive revanche, porque ela
 * é o campo dominante do custo, então qualquer troca que desfaça uma revanche
 * reduz o total e é aceita.
 */
function emparelharAproximado(n, custoDe) {
  const livres = Array.from({ length: n }, (_, i) => i);
  const pares = [];
  while (livres.length >= 2) {
    const i = livres.shift();
    let melhor = 0;
    let melhorCusto = Infinity;
    for (let k = 0; k < livres.length; k++) {
      const c = custoDe(i, livres[k]);
      if (c < melhorCusto) {
        melhorCusto = c;
        melhor = k;
      }
    }
    pares.push([i, livres.splice(melhor, 1)[0]]);
  }

  const par = (a, b) => custoDe(Math.min(a, b), Math.max(a, b));
  let melhorou = true;
  let voltas = 0;
  while (melhorou && voltas < 100) {
    melhorou = false;
    voltas++;
    for (let x = 0; x < pares.length; x++) {
      for (let y = x + 1; y < pares.length; y++) {
        const [a, b] = pares[x];
        const [c, d] = pares[y];
        const atual = par(a, b) + par(c, d);
        const opcao1 = par(a, c) + par(b, d);
        const opcao2 = par(a, d) + par(b, c);
        if (opcao1 < atual && opcao1 <= opcao2) {
          pares[x] = [a, c];
          pares[y] = [b, d];
          melhorou = true;
        } else if (opcao2 < atual) {
          pares[x] = [a, d];
          pares[y] = [b, c];
          melhorou = true;
        }
      }
    }
  }
  return pares;
}

/**
 * Monta as mesas de uma rodada de duelo.
 *
 * @param campo       jogadores já na ordem oficial (melhor primeiro), com `points`
 * @param historico   Map<id, Set<id>> — quem já enfrentou quem
 * @returns { mesas: [[a, b], ...], revanches: number }
 */
function parearDubov1v1(campo, historico) {
  if (campo.length < 2) return { mesas: [], revanches: 0 };
  if (campo.length % 2 !== 0) {
    throw new Error('parearDubov1v1 exige um campo par — o bye sai antes');
  }

  const custo = montarCusto(campo, historico);
  const custoDe = (i, j) => custo(campo[i], campo[j]);

  const pares = campo.length <= LIMITE_EXATO
    ? emparelharExato(campo.length, custoDe)
    : emparelharAproximado(campo.length, custoDe);

  const mesas = pares.map(([i, j]) => [campo[i], campo[j]]);
  const revanches = mesas.filter(([a, b]) => historico.get(a.id)?.has(b.id)).length;
  return { mesas, revanches };
}

/**
 * Existe pareamento sem revanche nenhuma para este campo?
 *
 * É o critério de completude [C4] (Dubov 2.2.1), e serve a quem escolhe o bye:
 * 3.1.2 manda escolher um jogador cuja saída **deixe o resto pareável**.
 */
function fechaSemRevanche(campo, historico) {
  if (campo.length === 0) return true;
  if (campo.length % 2 !== 0) return false;
  return parearDubov1v1(campo, historico).revanches === 0;
}

module.exports = { parearDubov1v1, fechaSemRevanche, LIMITE_EXATO };
