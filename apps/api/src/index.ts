/**
 * Ponto de entrada do servidor BFF — apps/api.
 * Lê a porta do env e inicia o servidor HTTP.
 */

import { serve } from '@hono/node-server';
import { criarApp } from './server.js';
import { resolverConfigAuth } from './middleware/tenant.js';
import { iniciarWorkers } from './workers.js';
import { iniciarSchedulerIngestao } from './scheduler.js';
import { redigirParaLog } from './logging.js';

// Valida config de auth antes de aceitar requests — fail-closed (P-91).
// AUTH_MODE=dev em NODE_ENV=production aborta aqui; sem Cognito em modo dev, idem.
try {
  resolverConfigAuth(process.env);
} catch (err) {
  console.error('[API] Configuração inválida:', redigirParaLog(err));
  process.exit(1);
}

const port = Number(process.env['PORT'] ?? '3000');
const app = criarApp();

const workersHandle = iniciarWorkers();
const schedulerHandle = iniciarSchedulerIngestao();

const server = serve({ fetch: app.fetch, port }, (info) => {
  console.log(`[API] Servidor iniciado em http://localhost:${info.port}`);
});

process.on('SIGTERM', () => {
  workersHandle?.teardown();
  schedulerHandle?.teardown();
  server.close();
});
