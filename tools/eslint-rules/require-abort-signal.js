/**
 * Regra ESLint: require-abort-signal (P-78)
 *
 * Todo *UseCase.executar() deve receber signal: AbortSignal como parâmetro.
 * Garante que operações longas (I/O, LLM, polling) possam ser canceladas
 * sem deixar recursos presos — requisito de A10 §6 e P-78.
 *
 * Ref: arquitetura/10 §6, P-78
 */

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'UseCase.executar() deve declarar "signal: AbortSignal" para suportar cancelamento (P-78).',
      url: 'https://github.com/radar-negociacoes/docs/arquitetura/10',
    },
    schema: [],
    messages: {
      missingAbortSignal:
        '"{{useCase}}.executar()" não declara "signal: AbortSignal". ' +
        'Adicione o parâmetro para suportar cancelamento (P-78, A10 §6).',
    },
  },

  create(context) {
    return {
      MethodDefinition(node) {
        const methodName = node.key?.type === 'Identifier' ? node.key.name : null;
        if (methodName !== 'executar') return;

        // Sobe até a ClassDeclaration
        const classBody = node.parent;
        const classDecl =
          classBody?.type === 'ClassBody' ? classBody.parent : null;

        const className =
          classDecl?.id?.name ?? classDecl?.parent?.id?.name ?? null;

        if (!className?.endsWith('UseCase')) return;

        const params = node.value?.params ?? [];

        const hasSignal = params.some((p) => {
          if (p.type === 'Identifier' && p.name === 'signal') {
            const ann = p.typeAnnotation?.typeAnnotation;
            return (
              ann?.type === 'TSTypeReference' &&
              (ann.typeName?.name === 'AbortSignal' ||
                ann.typeName?.right?.name === 'AbortSignal')
            );
          }
          return false;
        });

        if (!hasSignal) {
          context.report({
            node: node.key,
            messageId: 'missingAbortSignal',
            data: { useCase: className },
          });
        }
      },
    };
  },
};

export default rule;
