/**
 * Middleware de resolução de tenant.
 *
 * Lê o header `x-tenant-id` e expõe o tenantId tipado no contexto Hono.
 * Em produção este header será validado/injetado pelo gateway/WAF upstream
 * antes de chegar ao container (arquitetura/08 §11).
 *
 * `tenantId` é branded type — construído somente na borda da infra (A10 §8).
 */

import { createMiddleware } from 'hono/factory';
import { TenantId } from '@radar/kernel';

declare module 'hono' {
  interface ContextVariableMap {
    tenantId: ReturnType<typeof TenantId>;
  }
}

export const tenantMiddleware = createMiddleware(async (c, next) => {
  const raw = c.req.header('x-tenant-id');
  if (!raw || raw.trim() === '') {
    return c.json({ code: 'TENANT_AUSENTE', mensagem: 'Header x-tenant-id obrigatório.' }, 400);
  }

  c.set('tenantId', TenantId(raw.trim()));
  await next();
});
