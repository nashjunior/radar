/**
 * RAD-328 — `criarApp()` (server.ts) publica `organizacao.provisionada`/`triagem.solicitada`
 * em fila SQS real sob `QUEUE_TRANSPORT=sqs`, fechando o gap deixado por RAD-319: aquela issue
 * trocou o `EventPublisher` no-op só no composition root de `workers.ts` — o de `server.ts`
 * seguia preso ao `eventPublisherStub` COMPARTILHADO de `matching-stub.ts`, sempre no-op.
 *
 * Ponta a ponta via `POST /api/organizacoes` (rota isenta de tenant, não depende do
 * `PerfilGateway` ainda-stub que faz `POST /api/triagem/:id/solicitar` sempre 403 hoje) — prova
 * que o `SendMessageCommand` chega na fila configurada em vez de cair no stub no-op.
 *
 * `AUTH_MODE`/`AUTH_DEV_SECRET` são lidos por `middleware/tenant.ts` no TOPO do módulo (uma vez,
 * no import) — por isso ficam fixados em `beforeAll` antes do único `import('../server.js')
 * deste arquivo; `QUEUE_TRANSPORT`/`*_QUEUE_URL` são lidos a cada `criarApp()` (mesma postura de
 * `workers.ts`) e por isso variam livremente por teste.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { SQSClient } from '@aws-sdk/client-sqs';
import { SignJWT } from 'jose';
import { createSecretKey } from 'node:crypto';

const AUTH_DEV_SECRET = 'segredo-teste-rad328';
const ORG_QUEUE_URL = 'https://sqs.local/000/organizacao-provisionada-rad328';

// CNPJs estruturalmente válidos distintos — `tenantRepositoryStub` (identidade-stub.ts) é
// singleton de módulo e recusa (`OrganizacaoJaExisteError`) um CNPJ já provisionado por outro teste.
const CNPJ_REAL = '11222333000181';
const CNPJ_STUB = '11222333000262';

let criarApp: typeof import('../server.js')['criarApp'];

beforeAll(async () => {
  process.env['AUTH_MODE'] = 'dev';
  process.env['AUTH_DEV_SECRET'] = AUTH_DEV_SECRET;
  ({ criarApp } = await import('../server.js'));
});

afterEach(() => {
  delete process.env['QUEUE_TRANSPORT'];
  delete process.env['ORGANIZACAO_PROVISIONADA_QUEUE_URL'];
  vi.restoreAllMocks();
});

async function assinarTokenDev(sub: string): Promise<string> {
  const chave = createSecretKey(Buffer.from(AUTH_DEV_SECRET, 'utf-8'));
  return new SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(sub)
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(chave);
}

async function provisionarOrganizacao(sub: string, cnpj: string): Promise<Response> {
  const token = await assinarTokenDev(sub);
  const app = criarApp();
  return app.request('http://localhost/api/organizacoes', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ cnpj, razaoSocial: 'Empresa RAD-328 LTDA' }),
  });
}

describe('RAD-328 — criarApp() com QUEUE_TRANSPORT=sqs', () => {
  it('POST /api/organizacoes publica organizacao.provisionada na fila real (não mais no eventPublisherStub)', async () => {
    process.env['QUEUE_TRANSPORT'] = 'sqs';
    process.env['ORGANIZACAO_PROVISIONADA_QUEUE_URL'] = ORG_QUEUE_URL;
    const enviar = vi.spyOn(SQSClient.prototype, 'send').mockResolvedValue({} as never);

    const res = await provisionarOrganizacao('usuario-rad328-real', CNPJ_REAL);

    expect(res.status).toBe(201);
    expect(enviar).toHaveBeenCalledTimes(1);
    const comando = enviar.mock.calls[0]![0] as { input: { QueueUrl: string; MessageBody: string } };
    expect(comando.input.QueueUrl).toBe(ORG_QUEUE_URL);
    expect(JSON.parse(comando.input.MessageBody)).toMatchObject({ type: 'organizacao.provisionada' });
  });

  it('sem QUEUE_TRANSPORT=sqs (default), a mesma rota nunca toca o SQSClient — stub no-op preservado', async () => {
    const enviar = vi.spyOn(SQSClient.prototype, 'send').mockResolvedValue({} as never);

    const res = await provisionarOrganizacao('usuario-rad328-stub', CNPJ_STUB);

    expect(res.status).toBe(201);
    expect(enviar).not.toHaveBeenCalled();
  });

  it('QUEUE_TRANSPORT=sqs sem ORGANIZACAO_PROVISIONADA_QUEUE_URL não falha o boot (paridade com o item 6 de workers.ts)', () => {
    process.env['QUEUE_TRANSPORT'] = 'sqs';

    expect(() => criarApp()).not.toThrow();
  });
});
