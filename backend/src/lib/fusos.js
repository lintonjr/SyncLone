/**
 * O fuso em que um torneio acontece.
 *
 * A data do evento é guardada como instante em UTC; `timezone` diz em que fuso
 * aquele instante deve ser lido e exibido. Os dois juntos respondem à pergunta
 * que a loja faz — "que horas começa?" — sem depender de onde está quem olha.
 *
 * O nome é IANA (`America/Manaus`), e não um deslocamento (`-04:00`), porque o
 * deslocamento muda com horário de verão e o nome não: `America/Sao_Paulo` é a
 * mesma resposta em janeiro e em julho, mesmo quando o país volta a adiantar o
 * relógio.
 */

/** Onde a loja está. Vale para evento sem fuso escolhido e para o formulário. */
const FUSO_PADRAO = 'America/Manaus';

/**
 * O fuso existe neste Node?
 *
 * `Intl.DateTimeFormat` lança `RangeError` para nome inválido — é a própria base
 * de fusos do runtime respondendo, sem lista escrita à mão que envelhece a cada
 * mudança de legislação.
 */
function fusoValido(nome) {
  if (typeof nome !== 'string') return false;
  const limpo = nome.trim();
  // `Intl` também aceita deslocamento ("-04:00"), e é exatamente o que este
  // desenho evita: deslocamento não sabe de horário de verão. Só nome de região
  // (tem "/") ou UTC.
  if (!limpo || (limpo !== 'UTC' && !limpo.includes('/'))) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: limpo });
    return true;
  } catch {
    return false;
  }
}

/** O fuso enviado, se válido; senão o padrão da loja. */
function fusoOuPadrao(nome) {
  return fusoValido(nome) ? nome.trim() : FUSO_PADRAO;
}

module.exports = { FUSO_PADRAO, fusoValido, fusoOuPadrao };
