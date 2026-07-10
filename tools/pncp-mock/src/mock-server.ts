/**
 * PncpMockServer — servidor HTTP que serve respostas no wire format do PNCP.
 *
 * Usado nos testes do PncpHttpGateway: o adaptador HTTP aponta para
 * `http://127.0.0.1:{porta}` em vez de `pncp.gov.br`, garantindo que
 * a paginação, o parsing de JSON e o tratamento de erros sejam testados
 * sem tocar na fonte real (A04 §4 — regra dura).
 *
 * Rotas implementadas (espelham A02 §2):
 *   GET /v1/contratacoes/publicacao
 *   GET /v1/contratacoes/atualizacao
 *
 * Edge cases cobertos (P-32):
 *   - Página vazia (paginasRestantes = 0, data: [])
 *   - 422 quando `pagina` é omitido (comportamento real — P-26)
 *   - 429 configurável (injeção via cenariosErro)
 *   - Campos sigilosos (valorTotalEstimado null, prazo null)
 */

import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import {
  gerarContratacaoRaw,
  gerarPagina,
  paginaVazia,
  PERFIL_DIA_UTIL_PUBLICACAO,
  TAMANHO_PAGINA_MAX,
  VOLUME_ATUALIZACOES_DIA_UTIL,
  type OpcoesGeracao,
} from './fixtures.js';

// ---------------------------------------------------------------------------
// Tipos de configuração
// ---------------------------------------------------------------------------

/** Cenário de erro HTTP injetável no servidor. */
export interface CenarioErroServidor {
  endpoint: 'publicacao' | 'atualizacao';
  /** Se definido, só dispara para esta modalidade. */
  modalidade?: number;
  /** Se definido, só dispara para esta página. */
  pagina?: number;
  status: 422 | 429 | 500;
  /** Mensagem de erro devolvida no corpo JSON. */
  mensagem?: string;
}

export interface PncpMockServerConfig {
  /** Volume por modalidade (default = PERFIL_DIA_UTIL_PUBLICACAO — P-31). */
  volumePorModalidade?: Partial<Record<number, number>>;
  /** Total de atualizações (default = 15.000). */
  volumeAtualizacoes?: number;
  /** Se true, valorTotalEstimado e prazo retornam null. */
  camposSigilosos?: boolean;
  /** Cenários de erro injetados. */
  cenariosErro?: CenarioErroServidor[];
  /** Data-base dos timestamps gerados (default: 2026-07-10T10:00:00Z). */
  dataBase?: Date;
}

export interface ServidorIniciado {
  porta: number;
  baseUrl: string;
}

// ---------------------------------------------------------------------------
// Implementação
// ---------------------------------------------------------------------------

export class PncpMockServer {
  private readonly server: Server;
  private readonly volume: Record<number, number>;
  private readonly volumeAtualizacoes: number;
  private readonly opts: OpcoesGeracao;
  private readonly erros: CenarioErroServidor[];

  /** Contagem de requests recebidos por endpoint — útil para asserções de carga. */
  readonly contadores = {
    publicacao: 0,
    atualizacao: 0,
    erros: 0,
  };

  constructor(config: PncpMockServerConfig = {}) {
    this.volume = { ...PERFIL_DIA_UTIL_PUBLICACAO, ...config.volumePorModalidade } as Record<number, number>;
    this.volumeAtualizacoes = config.volumeAtualizacoes ?? VOLUME_ATUALIZACOES_DIA_UTIL;
    this.opts = {
      sigiloso: config.camposSigilosos ?? false,
      dataBase: config.dataBase ?? new Date('2026-07-10T10:00:00Z'),
    };
    this.erros = config.cenariosErro ?? [];
    this.server = createServer((req, res) => this.roteador(req, res));
  }

  /** Inicia o servidor em `127.0.0.1`. Porta 0 = kernel escolhe aleatoriamente. */
  start(porta = 0): Promise<ServidorIniciado> {
    return new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(porta, '127.0.0.1', () => {
        const endereco = this.server.address() as { port: number };
        resolve({
          porta: endereco.port,
          baseUrl: `http://127.0.0.1:${endereco.port}`,
        });
      });
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server.close(err => (err ? reject(err) : resolve()));
    });
  }

  resetContadores(): void {
    this.contadores.publicacao = 0;
    this.contadores.atualizacao = 0;
    this.contadores.erros = 0;
  }

  // ---------------------------------------------------------------------------
  // Roteador
  // ---------------------------------------------------------------------------

  private roteador(req: IncomingMessage, res: ServerResponse): void {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const pathname = url.pathname;

    if (pathname === '/v1/contratacoes/publicacao') {
      this.contadores.publicacao++;
      this.handlePublicacao(url.searchParams, res);
    } else if (pathname === '/v1/contratacoes/atualizacao') {
      this.contadores.atualizacao++;
      this.handleAtualizacao(url.searchParams, res);
    } else {
      this.sendJson(res, 404, { error: 'Endpoint não encontrado' });
    }
  }

  // ---------------------------------------------------------------------------
  // /v1/contratacoes/publicacao
  // ---------------------------------------------------------------------------

  private handlePublicacao(params: URLSearchParams, res: ServerResponse): void {
    // pagina é obrigatório — 422 quando ausente (comportamento real P-26)
    if (!params.has('pagina')) {
      this.contadores.erros++;
      this.sendJson(res, 422, {
        status: 422,
        error: 'Unprocessable Entity',
        message: 'Parâmetro obrigatório ausente: pagina',
      });
      return;
    }

    const pagina = parseInt(params.get('pagina')!, 10);
    const tamanhoPagina = Math.min(
      parseInt(params.get('tamanhoPagina') ?? '50', 10),
      TAMANHO_PAGINA_MAX,
    );
    const codigoStr = params.get('codigoModalidadeContratacao');
    const modalidade = codigoStr !== null ? parseInt(codigoStr, 10) : undefined;

    // Verificar cenário de erro injetado
    const cenario = this.erros.find(
      e =>
        e.endpoint === 'publicacao' &&
        (e.modalidade === undefined || e.modalidade === modalidade) &&
        (e.pagina === undefined || e.pagina === pagina),
    );
    if (cenario !== undefined) {
      this.contadores.erros++;
      this.sendJson(res, cenario.status, {
        status: cenario.status,
        error: cenario.mensagem ?? `Erro injetado pelo mock (P-32): ${cenario.status}`,
      });
      return;
    }

    const total = modalidade !== undefined
      ? (this.volume[modalidade] ?? 0)
      : Object.values(this.volume).reduce((a, b) => a + b, 0);

    const inicio = (pagina - 1) * tamanhoPagina;

    if (total === 0 || inicio >= total) {
      this.sendJson(res, 200, paginaVazia(pagina));
      return;
    }

    const fim = Math.min(inicio + tamanhoPagina, total);
    const items = Array.from({ length: fim - inicio }, (_, i) =>
      gerarContratacaoRaw(inicio + i, modalidade ?? 6, this.opts),
    );

    this.sendJson(res, 200, gerarPagina(items, pagina, total, tamanhoPagina));
  }

  // ---------------------------------------------------------------------------
  // /v1/contratacoes/atualizacao
  // ---------------------------------------------------------------------------

  private handleAtualizacao(params: URLSearchParams, res: ServerResponse): void {
    // pagina é obrigatório — 422 quando ausente (comportamento real P-26)
    if (!params.has('pagina')) {
      this.contadores.erros++;
      this.sendJson(res, 422, {
        status: 422,
        error: 'Unprocessable Entity',
        message: 'Parâmetro obrigatório ausente: pagina',
      });
      return;
    }

    const pagina = parseInt(params.get('pagina')!, 10);
    const tamanhoPagina = Math.min(
      parseInt(params.get('tamanhoPagina') ?? '50', 10),
      TAMANHO_PAGINA_MAX,
    );

    const cenario = this.erros.find(
      e => e.endpoint === 'atualizacao' && (e.pagina === undefined || e.pagina === pagina),
    );
    if (cenario !== undefined) {
      this.contadores.erros++;
      this.sendJson(res, cenario.status, {
        status: cenario.status,
        error: cenario.mensagem ?? `Erro injetado pelo mock (P-32): ${cenario.status}`,
      });
      return;
    }

    const total = this.volumeAtualizacoes;
    const inicio = (pagina - 1) * tamanhoPagina;

    if (total === 0 || inicio >= total) {
      this.sendJson(res, 200, paginaVazia(pagina));
      return;
    }

    const fim = Math.min(inicio + tamanhoPagina, total);
    // /atualizacao retorna mix de modalidades — usamos módulo para variar
    const items = Array.from({ length: fim - inicio }, (_, i) => {
      const modalidades = [6, 8, 9, 4, 12] as const;
      const modalidade = modalidades[(inicio + i) % modalidades.length]!;
      return gerarContratacaoRaw(inicio + i, modalidade, this.opts);
    });

    this.sendJson(res, 200, gerarPagina(items, pagina, total, tamanhoPagina));
  }

  // ---------------------------------------------------------------------------
  // Utilitário
  // ---------------------------------------------------------------------------

  private sendJson(res: ServerResponse, status: number, body: unknown): void {
    const payload = JSON.stringify(body);
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(payload),
    });
    res.end(payload);
  }
}

// ---------------------------------------------------------------------------
// Factory de conveniência
// ---------------------------------------------------------------------------

/**
 * Cria e inicia um servidor de mock com o perfil de dia útil (P-31).
 * Porta é atribuída automaticamente pelo kernel.
 * Retorna o servidor já iniciado + URL base.
 *
 * @example
 * const { server, baseUrl } = await criarServidorMock();
 * // ... testes ...
 * await server.stop();
 */
export async function criarServidorMock(
  config?: PncpMockServerConfig,
): Promise<{ server: PncpMockServer; baseUrl: string; porta: number }> {
  const server = new PncpMockServer(config);
  const { baseUrl, porta } = await server.start();
  return { server, baseUrl, porta };
}
