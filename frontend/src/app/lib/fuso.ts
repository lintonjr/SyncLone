/**
 * Hora de parede e instante, nos dois sentidos.
 *
 * O evento guarda um **instante** (UTC) e o **fuso** em que acontece. Quem cria
 * digita hora de parede ("20:00") e quem lê quer ver a mesma hora de parede, em
 * qualquer lugar do mundo. Estas funções fazem a tradução entre as duas coisas.
 *
 * Tudo sai de `Intl`, que já carrega a base de fusos do navegador: sem biblioteca
 * de datas e sem tabela de deslocamentos escrita à mão, que envelhece a cada
 * mudança de legislação.
 */

/** Onde a loja está: fuso sugerido no formulário e usado quando falta um. */
export const FUSO_PADRAO = 'America/Manaus';

/** As partes de um instante, lidas num fuso. */
export interface PartesNoFuso {
  /** `2026-10-02`, pronto para um `<input type="date">`. */
  data: string;
  /** `20:00`, pronto para um `<input type="time">`. */
  hora: string;
}

const doisDigitos = (n: number) => String(n).padStart(2, '0');

function partes(instante: Date, fuso: string): Record<string, number> {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: fuso,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const saida: Record<string, number> = {};
  for (const { type, value } of fmt.formatToParts(instante)) {
    if (type !== 'literal') saida[type] = Number(value);
  }
  return saida;
}

/**
 * Quanto o fuso está deslocado de UTC **naquele instante**, em minutos.
 *
 * O truque é o de sempre: formatar o instante no fuso, remontar aquelas partes
 * como se fossem UTC e comparar com o instante original. A diferença é o
 * deslocamento vigente — que muda com horário de verão, e é por isso que ele é
 * calculado por instante, e não guardado.
 */
export function deslocamentoMinutos(instante: Date, fuso: string): number {
  const p = partes(instante, fuso);
  const comoUtc = Date.UTC(
    p['year'],
    p['month'] - 1,
    p['day'],
    p['hour'],
    p['minute'],
    p['second'],
  );
  return (comoUtc - Math.floor(instante.getTime() / 1000) * 1000) / 60000;
}

/**
 * Hora de parede num fuso → instante.
 *
 * Duas passadas: a primeira chuta o deslocamento usando a própria data digitada,
 * a segunda confere no instante encontrado. Sem a segunda, um torneio marcado
 * para a hora exata em que o relógio muda (entrada ou saída do horário de verão)
 * sairia uma hora errado.
 *
 * Hora inexistente — o relógio pula das 23:59 para a 1:00 — cai na hora seguinte,
 * que é o que qualquer agenda faz. Hora repetida cai na primeira ocorrência.
 */
export function paraInstante(data: string, hora: string, fuso: string): Date {
  const [ano, mes, dia] = data.split('-').map(Number);
  const [h, min] = (hora || '00:00').split(':').map(Number);
  const ingenuo = Date.UTC(ano, mes - 1, dia, h, min, 0);
  const pedida = `${doisDigitos(h)}:${doisDigitos(min)}`;

  // Dois candidatos: o deslocamento visto do próprio instante ingênuo e o visto
  // do resultado dele. Nos dias comuns os dois coincidem.
  const primeiro = new Date(ingenuo - deslocamentoMinutos(new Date(ingenuo), fuso) * 60000);
  const segundo = new Date(ingenuo - deslocamentoMinutos(primeiro, fuso) * 60000);

  for (const candidato of [segundo, primeiro]) {
    const p = paraPartes(candidato, fuso);
    if (p.data === data && p.hora === pedida) return candidato;
  }
  // Nenhum bate: a hora não existiu naquele dia (o relógio adiantou por cima
  // dela). Vale o candidato mais tarde, que é a hora seguinte — o que qualquer
  // agenda faz, em vez de jogar o evento para o dia anterior.
  return primeiro > segundo ? primeiro : segundo;
}

/** Instante → hora de parede no fuso, pronta para os campos do formulário. */
export function paraPartes(instante: Date, fuso: string): PartesNoFuso {
  const p = partes(instante, fuso);
  return {
    data: `${p['year']}-${doisDigitos(p['month'])}-${doisDigitos(p['day'])}`,
    hora: `${doisDigitos(p['hour'])}:${doisDigitos(p['minute'])}`,
  };
}

/**
 * A data do evento escrita por extenso, no fuso dele.
 *
 * `curto` é o formato dos cartões e das listas, sem hora; o completo leva a hora
 * e o nome do fuso — a etiqueta ("GMT-4") é o que avisa quem está em outro estado
 * de que aquele horário é o da loja, não o do relógio dele.
 */
export function formatarData(
  valor: string | Date | null | undefined,
  fuso: string | null | undefined,
  idioma: string,
  estilo: 'curto' | 'completo' = 'completo',
): string {
  if (!valor) return '';
  const instante = valor instanceof Date ? valor : new Date(valor);
  if (Number.isNaN(instante.getTime())) return '';

  const zona = fuso || FUSO_PADRAO;
  const opcoes: Intl.DateTimeFormatOptions =
    estilo === 'curto'
      ? { timeZone: zona, day: 'numeric', month: 'short', year: 'numeric' }
      : {
          timeZone: zona,
          day: 'numeric',
          month: 'short',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          // `short` vira sigla local ("AMT" em pt-BR), que quase ninguém lê;
          // `shortOffset` dá "GMT-4", que qualquer pessoa entende.
          timeZoneName: 'shortOffset',
        };
  return new Intl.DateTimeFormat(idioma, opcoes).format(instante);
}

/**
 * Fusos oferecidos no formulário: os do Brasil, mais o de quem está criando o
 * evento quando ele estiver fora dessa lista — uma loja em outro país escolhe o
 * dela sem precisar de uma lista com as centenas de fusos do mundo.
 */
export function fusosSugeridos(): string[] {
  const brasil = [
    'America/Manaus',
    'America/Sao_Paulo',
    'America/Belem',
    'America/Fortaleza',
    'America/Cuiaba',
    'America/Porto_Velho',
    'America/Rio_Branco',
    'America/Boa_Vista',
    'America/Recife',
    'America/Bahia',
    'America/Campo_Grande',
    'America/Noronha',
  ];
  let doNavegador = '';
  try {
    doNavegador = Intl.DateTimeFormat().resolvedOptions().timeZone ?? '';
  } catch {
    doNavegador = '';
  }
  return doNavegador && !brasil.includes(doNavegador) ? [doNavegador, ...brasil] : brasil;
}

/** Rótulo do fuso na lista: `America/Sao_Paulo (GMT-3)`. */
export function rotuloDoFuso(fuso: string, idioma: string, instante = new Date()): string {
  try {
    const partesFmt = new Intl.DateTimeFormat(idioma, {
      timeZone: fuso,
      timeZoneName: 'shortOffset',
    }).formatToParts(instante);
    const nome = partesFmt.find((p) => p.type === 'timeZoneName')?.value ?? '';
    return nome ? `${fuso.replace(/_/g, ' ')} (${nome})` : fuso.replace(/_/g, ' ');
  } catch {
    return fuso;
  }
}
