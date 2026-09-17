#!/usr/bin/env node
import { App } from 'aws-cdk-lib';
import { loadConfig } from '../lib/config';
import { montar } from '../lib/manasync';

/**
 * ManaSync na AWS — região us-east-2, conta do projeto em MANASYNC_CONTA (.env, fora do git).
 *
 * Deploy só pelos scripts (scripts/deploy.sh): eles rodam a migração entre as
 * stacks e param no primeiro erro. `cdk deploy --all` direto pularia a migração.
 * Ver infraestructure/aws/PLANO-DEPLOY.md §11.
 */
const app = new App();
montar(app, loadConfig(app, { esperada: process.env.MANASYNC_CONTA, doAmbiente: process.env.CDK_DEFAULT_ACCOUNT }));
app.synth();
