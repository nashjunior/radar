/**
 * Ponto de entrada do servidor BFF — apps/api.
 * Lê a porta do env e inicia o servidor HTTP.
 */

import { serve } from '@hono/node-server';
import { criarApp } from './server.js';

const VARS_OBRIGATORIAS = [
  'COGNITO_USER_POOL_ID',
  'COGNITO_CLIENT_ID',
] as const;

for (const varName of VARS_OBRIGATORIAS) {
  if (!process.env[varName]) {
    console.error(`[API] Variável de ambiente obrigatória ausente: ${varName}`);
    process.exit(1);
  }
}

const port = Number(process.env['PORT'] ?? '3000');
const app = criarApp();

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`[API] Servidor iniciado em http://localhost:${info.port}`);
});
