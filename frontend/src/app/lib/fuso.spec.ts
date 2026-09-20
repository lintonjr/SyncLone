import {
  paraInstante,
  paraPartes,
  formatarData,
  deslocamentoMinutos,
  rotuloDoFuso,
  fusosSugeridos,
} from './fuso';

describe('fuso — hora de parede e instante', () => {
  it('20:00 em Manaus é 00:00Z do dia seguinte', () => {
    // O defeito relatado: criar às 20:00 e a tela mostrar 16:00. O que estava
    // errado era o significado do valor guardado, não o formulário.
    expect(paraInstante('2026-10-02', '20:00', 'America/Manaus').toISOString()).toBe(
      '2026-10-03T00:00:00.000Z',
    );
  });

  it('ida e volta devolve a hora digitada, em qualquer fuso', () => {
    for (const fuso of [
      'America/Manaus',
      'America/Sao_Paulo',
      'Europe/Lisbon',
      'America/New_York',
      'UTC',
    ]) {
      const instante = paraInstante('2026-10-02', '20:00', fuso);
      expect(paraPartes(instante, fuso)).toEqual({ data: '2026-10-02', hora: '20:00' });
    }
  });

  it('respeita o horário de verão vigente naquela data, não o de hoje', () => {
    // São Paulo tinha horário de verão em fevereiro de 2018 (GMT-2) e não tinha
    // em julho (GMT-3): a mesma hora de parede vira instantes diferentes.
    expect(paraInstante('2018-02-10', '20:00', 'America/Sao_Paulo').toISOString()).toBe(
      '2018-02-10T22:00:00.000Z',
    );
    expect(paraInstante('2018-07-10', '20:00', 'America/Sao_Paulo').toISOString()).toBe(
      '2018-07-10T23:00:00.000Z',
    );
  });

  it('hora que não existiu (relógio adiantado) cai na hora seguinte, sem quebrar', () => {
    // Em 04/11/2018 São Paulo pulou de 00:00 para 01:00.
    const instante = paraInstante('2018-11-04', '00:30', 'America/Sao_Paulo');
    expect(Number.isNaN(instante.getTime())).toBe(false);
    expect(paraPartes(instante, 'America/Sao_Paulo').hora).toBe('01:30');
  });

  it('sem hora, vale meia-noite do fuso do evento', () => {
    expect(paraInstante('2026-10-02', '', 'America/Manaus').toISOString()).toBe(
      '2026-10-02T04:00:00.000Z',
    );
  });

  it('deslocamento é o daquele instante', () => {
    expect(deslocamentoMinutos(new Date('2026-10-03T00:00:00Z'), 'America/Manaus')).toBe(-240);
    expect(deslocamentoMinutos(new Date('2018-02-10T22:00:00Z'), 'America/Sao_Paulo')).toBe(-120);
    expect(deslocamentoMinutos(new Date('2026-07-10T12:00:00Z'), 'UTC')).toBe(0);
  });
});

describe('fuso — exibição', () => {
  const instante = '2026-10-03T00:00:00.000Z';

  it('mostra a hora do evento, não a de quem olha', () => {
    const texto = formatarData(instante, 'America/Manaus', 'pt-BR');
    expect(texto).toContain('20:00');
    // A etiqueta do fuso é o que avisa quem está em outro estado.
    expect(texto).toMatch(/GMT-4|GMT−4/);
  });

  it('o mesmo instante em outro fuso mostra outra hora, com a etiqueta certa', () => {
    expect(formatarData(instante, 'America/Sao_Paulo', 'pt-BR')).toContain('21:00');
    expect(formatarData(instante, 'UTC', 'pt-BR')).toContain('00:00');
  });

  it('formato curto não leva hora', () => {
    const curto = formatarData(instante, 'America/Manaus', 'pt-BR', 'curto');
    expect(curto).not.toContain('20:00');
    expect(curto).toContain('2026');
  });

  it('valor ausente ou inválido não quebra a tela', () => {
    expect(formatarData(null, 'America/Manaus', 'pt-BR')).toBe('');
    expect(formatarData('não é data', 'America/Manaus', 'pt-BR')).toBe('');
  });

  it('sem fuso guardado, usa o da loja', () => {
    expect(formatarData(instante, null, 'pt-BR')).toContain('20:00');
  });
});

describe('fuso — lista do formulário', () => {
  it('sugere os fusos do Brasil, começando pelo da loja', () => {
    const lista = fusosSugeridos();
    expect(lista).toContain('America/Manaus');
    expect(lista).toContain('America/Sao_Paulo');
    expect(new Set(lista).size).toBe(lista.length);
  });

  it('o rótulo mostra o nome legível e o deslocamento', () => {
    const rotulo = rotuloDoFuso('America/Sao_Paulo', 'pt-BR', new Date('2026-07-10T12:00:00Z'));
    expect(rotulo).toContain('America/Sao Paulo');
    expect(rotulo).toMatch(/GMT-3|GMT−3/);
  });
});
