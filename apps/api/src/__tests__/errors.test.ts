import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { DomainError } from '@radar/kernel';
import { responderErro } from '../errors.js';

class ErroDominioComDetalheSensivel extends DomainError {
  readonly code = 'CRITERIO_INVALIDO' as const;

  constructor() {
    super('critério inválido: cpf=123.456.789-00 senha=segredo');
  }
}

class ErroTenantIncorreto extends DomainError {
  readonly code = 'TENANT_INCORRETO' as const;

  constructor() {
    super('tenant esperado=tenant-a recebido=tenant-b');
  }
}

class ErroPerfilNaoEncontrado extends DomainError {
  readonly code = 'PERFIL_NAO_ENCONTRADO' as const;

  constructor() {
    super('perfil de habilitação não encontrado: perfil-123');
  }
}

class ErroSaidaLlmInvalida extends DomainError {
  readonly code = 'SAIDA_LLM_INVALIDA' as const;

  constructor() {
    super('saída do LLM rejeitada pelo schema: stack trace interna');
  }
}

function appComErro(err: unknown): Hono {
  const app = new Hono();
  app.get('/erro', (c) => responderErro(c, err));
  return app;
}

async function chamar(err: unknown) {
  const res = await appComErro(err).request('http://localhost/erro');
  const body = await res.json() as { code: string; mensagem: string };
  return { res, body };
}

describe('responderErro', () => {
  it('mapeia DomainError desconhecido para 400 sem vazar message/PII', async () => {
    const { res, body } = await chamar(new ErroDominioComDetalheSensivel());

    expect(res.status).toBe(400);
    expect(body).toEqual({ code: 'CRITERIO_INVALIDO', mensagem: 'Requisição inválida.' });
    expect(JSON.stringify(body)).not.toContain('123.456.789-00');
    expect(JSON.stringify(body)).not.toContain('segredo');
  });

  it('colapsa erros de autorização em 403 sem revelar cross-tenant', async () => {
    const { res, body } = await chamar(new ErroTenantIncorreto());

    expect(res.status).toBe(403);
    expect(body).toEqual({ code: 'ACESSO_NEGADO', mensagem: 'Acesso negado.' });
    expect(JSON.stringify(body)).not.toContain('tenant-a');
    expect(JSON.stringify(body)).not.toContain('tenant-b');
  });

  it('mapeia erro de orquestração não encontrado para 404 genérico', async () => {
    const { res, body } = await chamar(new ErroPerfilNaoEncontrado());

    expect(res.status).toBe(404);
    expect(body).toEqual({ code: 'PERFIL_NAO_ENCONTRADO', mensagem: 'Recurso não encontrado.' });
    expect(JSON.stringify(body)).not.toContain('perfil-123');
  });

  it('mapeia falha de integração para 502 sem detalhe de provedor', async () => {
    const { res, body } = await chamar(new ErroSaidaLlmInvalida());

    expect(res.status).toBe(502);
    expect(body).toEqual({ code: 'SAIDA_LLM_INVALIDA', mensagem: 'Falha temporária de integração.' });
    expect(JSON.stringify(body)).not.toContain('stack trace interna');
  });

  it('mapeia erro inesperado para 500 genérico mesmo fora de produção', async () => {
    const originalNodeEnv = process.env['NODE_ENV'];
    process.env['NODE_ENV'] = 'development';

    try {
      const { res, body } = await chamar(new Error('pg://usuario:senha@host/db'));

      expect(res.status).toBe(500);
      expect(body).toEqual({ code: 'ERRO_INTERNO', mensagem: 'Erro interno.' });
      expect(JSON.stringify(body)).not.toContain('pg://');
      expect(JSON.stringify(body)).not.toContain('senha');
    } finally {
      if (originalNodeEnv === undefined) {
        delete process.env['NODE_ENV'];
      } else {
        process.env['NODE_ENV'] = originalNodeEnv;
      }
    }
  });
});
