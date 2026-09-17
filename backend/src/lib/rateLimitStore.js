const crypto = require('crypto');

/**
 * Contador do `express-rate-limit` guardado no Valkey.
 *
 * Com o `MemoryStore` padrão, cada task conta sozinha e o contador zera a cada
 * deploy: com duas tasks o limite de tentativas de senha dobra, e um atacante só
 * precisa esperar o próximo deploy. Aqui o contador é um só para a plataforma.
 *
 * Duas decisões:
 *
 *   - **`PEXPIRE ... NX`**: o prazo é fixado na primeira tentativa e as seguintes
 *     não o renovam. Sem o `NX`, quem tenta devagar e sem parar nunca veria a
 *     janela terminar — e quem erra a senha uma vez por hora ficaria bloqueado
 *     para sempre. É a mesma janela fixa do `MemoryStore`.
 *   - **A chave é um resumo**: o limitador chaveia em `ip:email`, e nada disso
 *     precisa ficar legível num cache compartilhado.
 *
 * Tudo numa chave só, então funciona igual em cluster (um slot, uma transação).
 */
class ValkeyStore {
  constructor({ cliente, prefixo = 'rl:' }) {
    this.cliente = cliente;
    this.prefix = prefixo;
    // Contadores compartilhados entre instâncias — é o ponto deste store.
    this.localKeys = false;
    this.windowMs = 60000;
  }

  init(opcoes) {
    this.windowMs = opcoes.windowMs;
  }

  chave(key) {
    return `${this.prefix}${crypto.createHash('sha256').update(String(key), 'utf8').digest('hex')}`;
  }

  async increment(key) {
    const k = this.chave(key);
    const respostas = await this.cliente.multi().incr(k).pexpire(k, this.windowMs, 'NX').pttl(k).exec();
    if (!respostas) throw new Error('transação do rate limit abortada');
    const erro = respostas.find(([e]) => e)?.[0];
    if (erro) throw erro;

    const totalHits = Number(respostas[0][1]);
    const restanteMs = Number(respostas[2][1]);
    return {
      totalHits,
      resetTime: new Date(Date.now() + (restanteMs > 0 ? restanteMs : this.windowMs)),
    };
  }

  /**
   * Devolve uma tentativa (o limitador usa `skipSuccessfulRequests`).
   *
   * Se a janela expirou entre o `increment` e este `decrement`, o `DECR` criaria a
   * chave em -1 e sem prazo — um crédito de tentativa extra, eterno. Nesse caso a
   * chave é apagada.
   */
  async decrement(key) {
    const k = this.chave(key);
    const valor = Number(await this.cliente.decr(k));
    if (valor <= 0) await this.cliente.del(k);
  }

  async resetKey(key) {
    await this.cliente.del(this.chave(key));
  }
}

module.exports = { ValkeyStore };
