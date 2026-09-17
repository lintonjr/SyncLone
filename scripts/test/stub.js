#!/usr/bin/env node
/**
 * Stub genérico de ferramenta externa (aws, cdk, docker, npm, dig, ...).
 *
 *   node stub.js <ferramenta> <args...>
 *
 * Registra a chamada em $STUB_DIR/chamadas.jsonl e responde com a primeira regra
 * de $STUB_DIR/regras.json cuja `ferramenta` bate e cujo `padrao` (regex) casa com
 * os argumentos unidos por espaço. Sem regra, sai com 97 e diz o que faltou: um
 * teste nunca passa porque uma chamada inesperada respondeu "vazio com sucesso".
 */
const fs = require('fs');
const path = require('path');

const [ferramenta, ...args] = process.argv.slice(2);
const dir = process.env.STUB_DIR;
const linha = args.join(' ');

fs.appendFileSync(path.join(dir, 'chamadas.jsonl'), JSON.stringify({ ferramenta, args, linha }) + '\n');

const regras = JSON.parse(fs.readFileSync(path.join(dir, 'regras.json'), 'utf8'));
const regra = regras.find((r) => r.ferramenta === ferramenta && new RegExp(r.padrao).test(linha));

if (!regra) {
  process.stderr.write(`[stub] sem regra para: ${ferramenta} ${linha}\n`);
  process.exit(97);
}
if (regra.stdout) process.stdout.write(regra.stdout);
if (regra.stderr) process.stderr.write(regra.stderr);
process.exit(regra.codigo ?? 0);
