/**
 * Montagem do CSV que a loja arquiva depois do evento.
 *
 * Saiu de `routes/events.js` quando a revisão de segurança achou injeção de
 * fórmula: a função é pura e decide uma regra, então mora aqui e é testada sem
 * banco, como o resto de `lib/`.
 *
 * O arquivo nasce para ser aberto no Excel — é por isso que ele sai com BOM —,
 * e é justamente isso que torna uma célula um lugar perigoso: nome de torneio,
 * de jogador e de deck são texto livre de quem se inscreve.
 */

/**
 * Os caracteres que fazem a planilha tratar a célula como fórmula.
 *
 * Tabulação e retorno de carro entram na lista porque o Excel os ignora antes de
 * olhar o primeiro caractere de verdade — `\t=1+1` é fórmula do mesmo jeito.
 */
const INICIOS_DE_FORMULA = ['=', '+', '-', '@', '\t', '\r'];

/**
 * Uma célula, segura para planilha.
 *
 * Duas coisas, nesta ordem, e a ordem importa:
 *
 *   1. **neutralizar fórmula**: célula que começa com `= + - @`, tabulação ou CR
 *      ganha um apóstrofo na frente. Sem isso, um jogador inscrito como
 *      `=HYPERLINK("http://malicioso","Classificação")` vira link executável na
 *      planilha que a loja abre depois do torneio — e a rota de exportação é
 *      pública, então não é preciso nem ter conta para plantar a fórmula;
 *   2. **citar**: só então as aspas, se o conteúdo pedir. Fazer ao contrário
 *      produziria `'"=1,2"`, com o apóstrofo fora das aspas, onde ele não
 *      protege nada.
 *
 * O apóstrofo **aparece** na planilha, e isso é deliberado: foi a opção
 * escolhida por fechar o buraco inclusive para o que já está gravado no banco.
 * Na prática ele só surge em nome que comece com um daqueles caracteres —
 * nenhuma coluna numérica do export pode começar com `-`, porque a pontuação de
 * um torneio é limitada a 0–10 no schema e os percentuais começam em dígito.
 */
function celula(valor) {
  const texto = valor === null || valor === undefined ? '' : String(valor);
  const seguro = INICIOS_DE_FORMULA.includes(texto[0]) ? `'${texto}` : texto;
  return /[",\n;]/.test(seguro) ? `"${seguro.replace(/"/g, '""')}"` : seguro;
}

/** As linhas, com CRLF — que é o que o Excel espera. */
const linhas = (rows) => rows.map((r) => r.map(celula).join(',')).join('\r\n') + '\r\n';

module.exports = { celula, linhas, INICIOS_DE_FORMULA };
