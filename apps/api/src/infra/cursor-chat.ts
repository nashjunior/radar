/**
 * Chat one-shot via Cursor SDK (Agent.prompt) — demo local.
 * Proibido em production. cwd efêmero + modo plan para não editar o monorepo.
 */

import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Agent } from '@cursor/sdk';
import { INSTRUCAO_ESPECIALISTA_CONTRATOS } from './demo-chat-instrucao.js';
import { paraTextoPlano } from './texto-plano.js';

export interface CursorChatOpts {
  readonly apiKey: string;
  readonly modelo?: string;
  readonly mensagem: string;
  readonly contexto: string;
  readonly instrucao?: string;
  readonly nodeEnv?: string | undefined;
}

export async function perguntarComCursor(opts: CursorChatOpts): Promise<string> {
  const env = opts.nodeEnv ?? process.env['NODE_ENV'];
  if (env === 'production') {
    throw new Error('Cursor chat é proibido em NODE_ENV=production.');
  }
  if (!opts.apiKey.trim()) {
    throw new Error('CURSOR_API_KEY é obrigatório.');
  }

  // Workspace isolado fora do monorepo — evita o `node --watch` reiniciar a API
  // quando o SDK grava SQLite/estado no cwd do processo.
  const cwd = mkdtempSync(join(tmpdir(), 'radar-cursor-chat-'));
  writeFileSync(
    join(cwd, 'README.txt'),
    'Workspace efêmero do chat Radar — não editar o monorepo.\n',
    'utf8',
  );

  const instrucao = opts.instrucao?.trim() || INSTRUCAO_ESPECIALISTA_CONTRATOS;
  const prompt = [
    instrucao,
    '',
    'NÃO use ferramentas, NÃO edite arquivos, NÃO rode shell — só responda em texto.',
    '',
    '<contexto_editais_nao_confiavel>',
    opts.contexto,
    '</contexto_editais_nao_confiavel>',
    '',
    `Pergunta / perfil do usuário: ${opts.mensagem}`,
  ].join('\n');

  const modelo = opts.modelo?.trim() || 'composer-2.5';
  const apiKey = opts.apiKey.trim();

  const runPrompt = (withSandbox: boolean) =>
    Agent.prompt(prompt, {
      apiKey,
      model: { id: modelo },
      mode: 'plan',
      local: {
        cwd,
        ...(withSandbox && process.env['CURSOR_SANDBOX'] !== '0'
          ? { sandboxOptions: { enabled: true } }
          : {}),
      },
    });

  let result;
  try {
    result = await runPrompt(true);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/sandbox|bubblewrap|ConfigurationError/i.test(msg)) {
      result = await runPrompt(false);
    } else {
      throw err;
    }
  }

  if (result.status === 'error') {
    throw new Error(`Cursor agent falhou (run ${result.id}). Verifique a CURSOR_API_KEY.`);
  }
  if (result.status === 'cancelled') {
    throw new Error('Cursor agent cancelado.');
  }

  const texto = (result.result ?? '').trim();
  if (!texto) {
    throw new Error('Cursor não devolveu texto.');
  }
  return paraTextoPlano(texto);
}
