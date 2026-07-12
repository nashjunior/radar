/**
 * Boundary enforcement do monorepo — Clean Architecture (arquitetura/10 §§2,3,5,8).
 * Resolve P-69 (boundary entre camadas/contextos) e o lado-dependência de P-74
 * (tecnologia só no infra). Roda no CI antes dos testes (arq/08 §6, gate `lint`).
 *
 *   pnpm boundaries      # na raiz do monorepo
 *
 * O lado-NOME de P-74 (`<Tech><Port>` no adapter, port sem tecnologia no nome) e
 * P-78 (AbortSignal em use cases/ports) são regras ESLint customizadas — RAD-33.
 *
 * @type {import('dependency-cruiser').IConfiguration}
 */
module.exports = {
  forbidden: [
    {
      name: 'domain-puro',
      comment:
        'domain é puro: não importa application, infra nem ui (A10 §3 — depende de NADA).',
      severity: 'error',
      from: { path: '(^|/)(modules/[^/]+/src|apps/[^/]+)/domain/' },
      to: { path: '(^|/)(modules/[^/]+/src|apps/[^/]+)/(application|infra|ui)/' },
    },
    {
      name: 'application-sem-infra',
      comment:
        'application define as portas mas não conhece adapters/infra nem ui (A10 §3). A dependência aponta para dentro.',
      severity: 'error',
      from: { path: '(^|/)(modules/[^/]+/src|apps/[^/]+)/application/' },
      to: { path: '(^|/)(modules/[^/]+/src|apps/[^/]+)/(infra|ui)/' },
    },
    {
      name: 'nucleo-sem-tecnologia',
      comment:
        'domain/application nunca importam pacote de tecnologia (db, cloud SDK, LLM, fila, e-mail, observabilidade — ALS/I-O de runtime Node) — isso vive SÓ no infra (A10 §8, P-74; A18 §3.3 p/ @radar/observabilidade).',
      severity: 'error',
      from: { path: '(^|/)(modules/[^/]+/src|apps/[^/]+)/(domain|application)/' },
      to: {
        path: 'node_modules/(pg|postgres|@aws-sdk|aws-sdk|@anthropic-ai|@smithy|ioredis|amqplib|kafkajs|nodemailer|@radar/observabilidade)(/|$)',
      },
    },
    {
      name: 'kernel-sem-observabilidade',
      comment:
        'o kernel é importado pelo domain: não pode ganhar dependência de @radar/observabilidade (A18 §3.3 — decisão explícita de não colocar ALS no kernel).',
      severity: 'error',
      from: { path: '(^|/)shared/kernel/ts/src/' },
      to: { path: 'node_modules/@radar/observabilidade(/|$)' },
    },
    {
      name: 'contexto-nao-invade-contexto',
      comment:
        'um bounded context não importa o interior de outro — só via eventos (fila) ou shared/contracts (A10 §5, doc 13). $2 = nome do contexto de origem.',
      severity: 'error',
      from: { path: '(^|/)modules/([^/]+)/src/' },
      to: {
        path: '(^|/)modules/([^/]+)/src/',
        pathNot: '(^|/)modules/$2/src/',
      },
    },
    {
      name: 'sem-ciclos',
      comment: 'ciclo de dependência = boundary quebrado.',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.base.json' },
    doNotFollow: { path: 'node_modules' },
    exclude: {
      path: '(node_modules|dist|\\.turbo|__tests__|\\.test\\.ts$|\\.spec\\.ts$)',
    },
  },
};
