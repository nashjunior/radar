/**
 * Regra ESLint: no-tech-in-port-name (P-74 lado-nome)
 *
 * Ports (interfaces) em application/ não podem ter nome de tecnologia.
 * Nome de tecnologia indica que o adapter vazou para a camada de portas.
 * Ports são nomeados por PAPEL (ex: EditalRepository, EventPublisher).
 * Adapters em infra/ seguem o padrão <Tech><Port> (ex: PostgresEditalRepository).
 *
 * Ref: arquitetura/10 §8, P-74
 */

/** @type {RegExp} */
const TECH_PATTERN =
  /Postgres|Mysql|Sqlite|Prisma|Drizzle|Knex|Sql|Http|Fetch|Axios|Anthropic|OpenAI|Gemini|Sqs|Sns|S3|Kafka|Redis|Ioredis|Nodemailer|Smtp|Sendgrid|Mongo|Dynamo|Firebase|Supabase/i;

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Ports em application/ não podem ter nome de tecnologia — nomeie por papel (P-74).',
      url: 'https://github.com/radar-negociacoes/docs/arquitetura/10',
    },
    schema: [],
    messages: {
      techInPortName:
        'Interface "{{name}}" em application/ contém nome de tecnologia. ' +
        'Ports nomeiam por papel (ex: EditalRepository, EventPublisher). ' +
        'Adapters com nome de tecnologia ficam em infra/ (ex: Postgres{{name}}).',
    },
  },

  create(context) {
    const filename = context.filename ?? context.getFilename?.() ?? '';
    if (!filename.includes('/application/')) return {};

    return {
      TSInterfaceDeclaration(node) {
        const name = node.id?.name;
        if (name && TECH_PATTERN.test(name)) {
          context.report({
            node: node.id,
            messageId: 'techInPortName',
            data: { name },
          });
        }
      },
    };
  },
};

export default rule;
