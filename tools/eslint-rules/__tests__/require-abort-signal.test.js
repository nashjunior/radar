/**
 * Fixture: require-abort-signal
 */
import { RuleTester } from 'eslint';
import parser from '@typescript-eslint/parser';
import { describe, it } from 'vitest';
import rule from '../require-abort-signal.js';

RuleTester.describe = describe;
RuleTester.it = it;

const tester = new RuleTester({
  languageOptions: { parser },
});

tester.run('require-abort-signal', rule, {
  valid: [
    // UseCase com signal: AbortSignal — correto
    {
      code: `
        class IngerirEditaisUseCase {
          async executar(input: unknown, signal: AbortSignal): Promise<void> {}
        }
      `,
    },
    {
      code: `
        class ReconciliarCatalogoUseCase {
          async executar(input: { janela: unknown }, signal: AbortSignal): Promise<unknown> {
            return {};
          }
        }
      `,
    },
    // Classe que não é UseCase — não verificada
    {
      code: `
        class EditalService {
          async executar(input: unknown): Promise<void> {}
        }
      `,
    },
    // Método não é executar — não verificado
    {
      code: `
        class IngerirEditaisUseCase {
          async processar(input: unknown): Promise<void> {}
        }
      `,
    },
  ],

  invalid: [
    // UseCase sem signal — errado
    {
      code: `
        class IngerirEditaisUseCase {
          async executar(input: unknown): Promise<void> {}
        }
      `,
      errors: [{ messageId: 'missingAbortSignal', data: { useCase: 'IngerirEditaisUseCase' } }],
    },
    {
      code: `
        class EnviarAlertaUseCase {
          async executar(input: { editalId: string }): Promise<boolean> {
            return true;
          }
        }
      `,
      errors: [{ messageId: 'missingAbortSignal', data: { useCase: 'EnviarAlertaUseCase' } }],
    },
    // Parâmetro signal sem tipagem AbortSignal
    {
      code: `
        class GerarResumoUseCase {
          async executar(input: unknown, signal: unknown): Promise<void> {}
        }
      `,
      errors: [{ messageId: 'missingAbortSignal', data: { useCase: 'GerarResumoUseCase' } }],
    },
  ],
});
