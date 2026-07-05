/**
 * Rota de saúde — usada pelo load balancer e pela orquestração de containers.
 * Não requer autenticação nem tenant.
 */

import { Hono } from 'hono';

export const healthRouter = new Hono();

healthRouter.get('/', (c) => {
  return c.json({ status: 'ok', timestamp: new Date().toISOString() });
});
