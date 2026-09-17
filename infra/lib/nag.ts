import { Validations } from 'aws-cdk-lib';
import { IConstruct } from 'constructs';

/**
 * Reconhece um achado do cdk-nag (AwsSolutions), com o motivo escrito.
 *
 * Regra do projeto: só é reconhecido o que é decisão do plano (custo, escopo,
 * limitação da arquitetura sem ALB) ou exigência de recurso gerado pelo próprio
 * CDK. Achado novo faz o synth falhar ("Validation failed") — e o teste
 * `nag.test.ts` também. A resposta a um achado novo é descobrir se ele é real,
 * não acrescentar uma linha aqui.
 *
 * `regra` aceita a forma com achado específico, ex.: `AwsSolutions-IAM5[Resource::*]`.
 * Fica perto do recurso, no construtor da stack, para o motivo ser lido junto do código.
 */
export function reconhecer(construto: IConstruct, regra: string, motivo: string): void {
  Validations.of(construto).acknowledge({ id: `AwsSolutions::${regra}`, reason: motivo });
}
