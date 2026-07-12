/**
 * PncpHttpGateway · fixtures no formato REAL confirmado contra o OpenAPI oficial do PNCP
 * (https://pncp.gov.br/api/consulta/v3/api-docs, verificado 2026-07-11 — RAD-198, arquitetura/02 §2).
 *
 * Padrão RecordReplay (análogo HTTP do `RecordReplayLlmClient` de triagem, arquitetura/17 §7):
 * `fetch` global é substituído por um replay determinístico dos shapes já confirmados por chamada
 * real — nenhum teste aqui bate na API ao vivo. Os 5 mismatches corrigidos por RAD-198 são cobertos
 * por asserção direta (URL/verbo batido e campo mapeado), não só por não lançar.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PncpHttpGateway } from '../../infra/adapters/pncp-http-gateway.js';
import { SchemaDriftError } from '../../domain/errors/index.js';

// downloadArquivo passa pela SsrfGuard, que resolve DNS — mock evita rede real em teste.
vi.mock('node:dns/promises', () => ({
  lookup: vi.fn(),
}));
import { lookup } from 'node:dns/promises';
const mockLookup = lookup as ReturnType<typeof vi.fn>;

const noop = new AbortController().signal;

function mockFetchResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as Response;
}

/** Item de contratação no shape real (orgaoEntidade/unidadeOrgao achatados, modalidadeId/Nome). */
const CONTRATACAO_REAL = {
  numeroControlePNCP: '80881915000192-1-000044/2026',
  anoCompra: 2026,
  sequencialCompra: 44,
  modalidadeId: 6,
  modalidadeNome: 'Pregão - Eletrônico',
  situacaoCompraNome: 'Divulgada',
  objetoCompra: 'Aquisição de equipamentos de TI',
  valorTotalEstimado: 500000,
  dataEncerramentoProposta: '2026-08-15T23:59:00',
  dataPublicacaoPncp: '2026-07-01T10:00:00',
  dataAtualizacao: '2026-07-01T10:00:00',
  orgaoEntidade: { cnpj: '80881915000192', razaoSocial: 'Prefeitura de São Paulo' },
  unidadeOrgao: { ufSigla: 'SP', ufNome: 'São Paulo', municipioNome: 'São Paulo' },
};

const IDENTIFICADOR = { cnpj: '80881915000192', anoCompra: 2026, sequencialCompra: 44 };

describe('PncpHttpGateway', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('buscarContratacoesPorPublicacao — paginação', () => {
    it('mapeia modalidadeId/modalidadeNome e ufSigla do shape real (RAD-198 itens 2, 3)', async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        mockFetchResponse({
          data: [CONTRATACAO_REAL],
          totalRegistros: 1,
          totalPaginas: 1,
          numeroPagina: 1,
          paginasRestantes: 0,
          empty: false,
        }),
      );
      vi.stubGlobal('fetch', fetchMock);

      const gateway = new PncpHttpGateway();
      const paginas: unknown[] = [];
      for await (const pagina of gateway.buscarContratacoesPorPublicacao(
        6,
        { inicio: new Date('2026-07-01'), fim: new Date('2026-07-10') },
        noop,
      )) {
        paginas.push(...pagina);
      }

      expect(paginas).toHaveLength(1);
      const dado = paginas[0] as Record<string, unknown>;
      expect(dado['modalidadeCodigo']).toBe(6);
      expect(dado['modalidadeNome']).toBe('Pregão - Eletrônico');
      expect((dado['orgao'] as Record<string, unknown>)['uf']).toBe('SP');
      expect(dado['anoCompra']).toBe(2026);
      expect(dado['sequencialCompra']).toBe(44);

      const urlChamada = (fetchMock.mock.calls[0] as [string])[0];
      expect(urlChamada).toContain('/v1/contratacoes/publicacao');
      expect(urlChamada).toContain('codigoModalidadeContratacao=6');
    });
  });

  describe('buscarContratacaoPorNumero — endpoint de detalhe (RAD-198 item 1)', () => {
    it('chama GET /v1/orgaos/{cnpj}/compras/{ano}/{sequencial} — não /v1/contratacoes/{numeroControle}', async () => {
      const fetchMock = vi.fn().mockResolvedValue(mockFetchResponse(CONTRATACAO_REAL));
      vi.stubGlobal('fetch', fetchMock);

      const gateway = new PncpHttpGateway();
      const dado = await gateway.buscarContratacaoPorNumero(IDENTIFICADOR, noop);

      const urlChamada = (fetchMock.mock.calls[0] as [string])[0];
      expect(urlChamada).toBe(
        'https://pncp.gov.br/api/consulta/v1/orgaos/80881915000192/compras/2026/44',
      );
      expect(urlChamada).not.toContain('/v1/contratacoes/');
      expect(dado?.numeroControlePncp).toBe(CONTRATACAO_REAL.numeroControlePNCP);
    });

    it('retorna null em 404', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockFetchResponse(null, 404)));
      const gateway = new PncpHttpGateway();
      const dado = await gateway.buscarContratacaoPorNumero(IDENTIFICADOR, noop);
      expect(dado).toBeNull();
    });
  });

  describe('buscarArquivos — base /api/pncp, não /api/consulta (RAD-198 item 4)', () => {
    /** Item real do payload confirmado por chamada real (RAD-274, arq/02 §6.1). */
    const ARQUIVO_REAL = {
      uri: 'https://pncp.gov.br/pncp-api/v1/orgaos/80881915000192/compras/2026/44/arquivos/1',
      url: 'https://pncp.gov.br/pncp-api/v1/orgaos/80881915000192/compras/2026/44/arquivos/1',
      statusAtivo: true,
      dataPublicacaoPncp: '2026-07-01T00:00:05',
      cnpj: '80881915000192',
      anoCompra: 2026,
      sequencialCompra: 44,
      sequencialDocumento: 1,
      titulo: 'Parecer Contábil PREGAO',
      tipoDocumentoId: 7,
      tipoDocumentoDescricao: 'Estudo Técnico Preliminar',
      tipoDocumentoNome: 'Estudo Técnico Preliminar',
    };

    it('chama a API de DADOS (/api/pncp), não a de consulta, e mapeia o contrato real', async () => {
      const fetchMock = vi.fn().mockResolvedValue(mockFetchResponse([ARQUIVO_REAL]));
      vi.stubGlobal('fetch', fetchMock);

      const gateway = new PncpHttpGateway();
      const arquivos = await gateway.buscarArquivos(IDENTIFICADOR, noop);

      const urlChamada = (fetchMock.mock.calls[0] as [string])[0];
      expect(urlChamada).toBe(
        'https://pncp.gov.br/api/pncp/v1/orgaos/80881915000192/compras/2026/44/arquivos',
      );
      expect(urlChamada).not.toContain('/api/consulta');
      expect(arquivos).toHaveLength(1);
      expect(arquivos[0]).toEqual({
        titulo: 'Parecer Contábil PREGAO',
        urlOrigem: ARQUIVO_REAL.uri,
        sequencialDocumento: 1,
        tipoDocumentoId: 7,
        tipoDocumentoNome: 'Estudo Técnico Preliminar',
        statusAtivo: true,
      });
    });

    it('não expõe tamanhoBytes/tipoMime — esses campos não existem em /arquivos', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockFetchResponse([ARQUIVO_REAL])));
      const gateway = new PncpHttpGateway();
      const [arquivo] = await gateway.buscarArquivos(IDENTIFICADOR, noop);
      expect(arquivo).not.toHaveProperty('tamanhoBytes');
      expect(arquivo).not.toHaveProperty('tipoMime');
      expect(arquivo).not.toHaveProperty('nome');
    });

    it('filtra documento com statusAtivo:false (revogado/substituído)', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          mockFetchResponse([ARQUIVO_REAL, { ...ARQUIVO_REAL, sequencialDocumento: 2, statusAtivo: false }]),
        ),
      );
      const gateway = new PncpHttpGateway();
      const arquivos = await gateway.buscarArquivos(IDENTIFICADOR, noop);
      expect(arquivos).toHaveLength(1);
      expect(arquivos[0]?.sequencialDocumento).toBe(1);
    });

    it('lança SchemaDriftError quando a resposta não é um array', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockFetchResponse({ erro: 'formato inesperado' })));
      const gateway = new PncpHttpGateway();
      await expect(gateway.buscarArquivos(IDENTIFICADOR, noop)).rejects.toThrow(SchemaDriftError);
    });

    it.each(['sequencialDocumento', 'tipoDocumentoId', 'tipoDocumentoNome', 'statusAtivo', 'titulo'])(
      'lança SchemaDriftError quando falta o campo obrigatório %s',
      async (campo) => {
        const { [campo]: _omitido, ...semCampo } = ARQUIVO_REAL as Record<string, unknown>;
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockFetchResponse([semCampo])));
        const gateway = new PncpHttpGateway();
        await expect(gateway.buscarArquivos(IDENTIFICADOR, noop)).rejects.toThrow(SchemaDriftError);
      },
    );

    it.each([0, -1])(
      'lança SchemaDriftError quando sequencialDocumento é %i (identidade inválida, RAD-291/RAD-299)',
      async (sequencialDocumento) => {
        vi.stubGlobal(
          'fetch',
          vi.fn().mockResolvedValue(mockFetchResponse([{ ...ARQUIVO_REAL, sequencialDocumento }])),
        );
        const gateway = new PncpHttpGateway();
        await expect(gateway.buscarArquivos(IDENTIFICADOR, noop)).rejects.toThrow(SchemaDriftError);
      },
    );
  });

  describe('downloadArquivo — metadados só existem no download (arq/02 §6.1)', () => {
    beforeEach(() => {
      mockLookup.mockResolvedValue({ address: '200.10.20.30', family: 4 });
    });

    function mockDownloadResponse(body: Uint8Array, headers: Record<string, string> = {}): Response {
      return {
        ok: true,
        status: 200,
        headers: { get: (nome: string) => headers[nome.toLowerCase()] ?? null } as Headers,
        arrayBuffer: () => Promise.resolve(body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength)),
      } as unknown as Response;
    }

    it('resolve tipoMime por magic bytes (PDF), ignorando o content-type octet-stream do PNCP', async () => {
      const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockDownloadResponse(pdfBytes)));
      const gateway = new PncpHttpGateway();
      const baixado = await gateway.downloadArquivo('https://pncp.gov.br/arquivo', noop);
      expect(baixado.tipoMime).toBe('application/pdf');
    });

    it('resolve tipoMime por magic bytes (ZIP/DOCX)', async () => {
      const zipBytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00]);
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockDownloadResponse(zipBytes)));
      const gateway = new PncpHttpGateway();
      const baixado = await gateway.downloadArquivo('https://pncp.gov.br/arquivo', noop);
      expect(baixado.tipoMime).toBe('application/zip');
    });

    it('resolve tamanhoBytes do content-length', async () => {
      const bytes = new Uint8Array([1, 2, 3, 4, 5]);
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockDownloadResponse(bytes, { 'content-length': '5' })));
      const gateway = new PncpHttpGateway();
      const baixado = await gateway.downloadArquivo('https://pncp.gov.br/arquivo', noop);
      expect(baixado.tamanhoBytes).toBe(5);
    });

    it('cai para o tamanho do corpo quando content-length está ausente', async () => {
      const bytes = new Uint8Array([1, 2, 3]);
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockDownloadResponse(bytes)));
      const gateway = new PncpHttpGateway();
      const baixado = await gateway.downloadArquivo('https://pncp.gov.br/arquivo', noop);
      expect(baixado.tamanhoBytes).toBe(3);
    });

    it('extrai o nome real do content-disposition', async () => {
      const bytes = new Uint8Array([1, 2, 3]);
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          mockDownloadResponse(bytes, { 'content-disposition': 'attachment; filename="edital-044.pdf"' }),
        ),
      );
      const gateway = new PncpHttpGateway();
      const baixado = await gateway.downloadArquivo('https://pncp.gov.br/arquivo', noop);
      expect(baixado.nomeArquivo).toBe('edital-044.pdf');
    });

    it('nomeArquivo é null quando content-disposition está ausente', async () => {
      const bytes = new Uint8Array([1, 2, 3]);
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockDownloadResponse(bytes)));
      const gateway = new PncpHttpGateway();
      const baixado = await gateway.downloadArquivo('https://pncp.gov.br/arquivo', noop);
      expect(baixado.nomeArquivo).toBeNull();
    });
  });
});
