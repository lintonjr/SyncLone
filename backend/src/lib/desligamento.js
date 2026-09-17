/**
 * Desligamento limpo.
 *
 * O orquestrador manda SIGTERM e mata no SIGKILL algum tempo depois (o
 * `stopTimeout` da task). Sem tratar o sinal, esse intervalo é perdido: requisição
 * no meio de uma transação morre pela metade, e a pessoa que acabou de lançar um
 * resultado vê um erro de rede sem saber se gravou.
 *
 * A ordem importa:
 *
 *   0. **continuar atendendo** por `atrasoMs` (só no SIGTERM). Sem balanceador, o
 *      CloudFront chega à task pelo DNS, que ainda aponta para ela por até um TTL
 *      depois de o ECS decidir pará-la — ver infraestructure/aws/PLANO-DEPLOY.md
 *      §7.2. Parar de aceitar conexão na hora derrubaria essas requisições;
 *   1. parar de aceitar conexão nova (`server.close` deixa terminar as em voo);
 *   2. **encerrar os streams SSE na mão** — eles nunca terminam sozinhos, então
 *      sem isto o passo 1 espera para sempre e o SIGKILL chega inevitavelmente;
 *   3. fechar o Valkey (com prazo próprio) e devolver o pool do MySQL.
 *
 * O cronômetro de segurança começa **depois** do atraso: o fechamento sempre tem o
 * seu `limiteMs` inteiro. Se algo travar, o processo sai por conta própria antes
 * do SIGKILL, com código de saída que diz que não foi limpo.
 *
 * SIGINT (Ctrl+C) pula o atraso: quem aperta Ctrl+C no terminal não quer esperar.
 *
 * Tudo que toca o mundo é injetado — é o que permite testar a ordem e os tempos
 * sem servidor, banco nem relógio de verdade.
 */
function criarDesligamento({
  server,
  fecharStreams,
  encerrarValkey,
  encerrarBanco,
  atrasoMs = 0,
  limiteMs = 10000,
  log = console,
  sair = (codigo) => process.exit(codigo),
  agendar = setTimeout,
}) {
  let encerrando = false;

  const esperar = (ms) => new Promise((resolve) => agendar(resolve, ms));

  return async function desligar(sinal) {
    // Um segundo sinal não reinicia o processo de saída pela metade.
    if (encerrando) return;
    encerrando = true;

    const atraso = sinal === 'SIGTERM' ? atrasoMs : 0;
    if (atraso > 0) {
      log.log(`[shutdown] ${sinal} recebido; atendendo por mais ${atraso}ms antes de fechar`);
      await esperar(atraso);
    } else {
      log.log(`[shutdown] ${sinal} recebido, encerrando`);
    }

    const prazo = agendar(() => {
      log.error(`[shutdown] não terminou em ${limiteMs}ms, saindo à força`);
      sair(1);
    }, limiteMs);
    // Um timer pendurado não pode ser o motivo de o processo continuar vivo.
    prazo?.unref?.();

    try {
      // `server.close` para de aceitar conexão nova na hora e só chama de volta
      // quando a última conexão viva termina. Por isso a promessa é criada aqui e
      // esperada lá embaixo: entre uma coisa e outra é que os streams SSE são
      // encerrados. Esperar primeiro e fechar depois seria esperar para sempre.
      const semConexoes = new Promise((resolve) => server.close(resolve));

      const streams = fecharStreams();
      if (streams) log.log(`[shutdown] ${streams} stream(s) SSE encerrado(s)`);

      await semConexoes;
      await encerrarValkey();
      await encerrarBanco();
      log.log('[shutdown] concluído');
      sair(0);
    } catch (err) {
      log.error(`[shutdown] falhou: ${err.message}`);
      sair(1);
    }
  };
}

module.exports = { criarDesligamento };
