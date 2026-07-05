/**
 * Fixture: no-tech-in-port-name
 */
import { RuleTester } from 'eslint';
import parser from '@typescript-eslint/parser';
import { describe, it } from 'vitest';
import rule from '../no-tech-in-port-name.js';

RuleTester.describe = describe;
RuleTester.it = it;

const tester = new RuleTester({
  languageOptions: { parser },
});

tester.run('no-tech-in-port-name', rule, {
  valid: [
    // Port nomeado por papel — correto
    {
      filename: '/project/modules/ingestao/src/application/ports.ts',
      code: `interface EditalRepository { salvar(e: unknown): Promise<void>; }`,
    },
    {
      filename: '/project/modules/ingestao/src/application/ports.ts',
      code: `interface EventPublisher { publicar(e: unknown): Promise<void>; }`,
    },
    // Adapter em infra/ pode ter nome de tecnologia
    {
      filename: '/project/modules/ingestao/src/infra/postgres-edital-repository.ts',
      code: `interface PostgresEditalRepository { }`,
    },
    // Interface fora de application/ não é verificada
    {
      filename: '/project/modules/ingestao/src/domain/entities/edital.ts',
      code: `interface PostgresEdital { }`,
    },
  ],

  invalid: [
    // Port com nome de tecnologia — errado
    {
      filename: '/project/modules/ingestao/src/application/ports.ts',
      code: `interface PostgresEditalRepository { salvar(e: unknown): Promise<void>; }`,
      errors: [{ messageId: 'techInPortName', data: { name: 'PostgresEditalRepository' } }],
    },
    {
      filename: '/project/modules/matching/src/application/ports.ts',
      code: `interface HttpMatchingClient { buscar(): Promise<unknown>; }`,
      errors: [{ messageId: 'techInPortName', data: { name: 'HttpMatchingClient' } }],
    },
    {
      filename: '/project/modules/notificacao/src/application/ports.ts',
      code: `interface AnthropicResumoGateway { resumir(texto: string): Promise<string>; }`,
      errors: [{ messageId: 'techInPortName', data: { name: 'AnthropicResumoGateway' } }],
    },
    {
      filename: '/project/modules/matching/src/application/ports.ts',
      code: `interface RedisSessionStore { get(k: string): Promise<string | null>; }`,
      errors: [{ messageId: 'techInPortName', data: { name: 'RedisSessionStore' } }],
    },
  ],
});
