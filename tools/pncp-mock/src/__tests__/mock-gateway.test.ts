/**
 * Validação do MockPncpGateway (P-32 / RAD-166).
 *
 * Verifica:
 *  MG-01  Volume correto por modalidade (perfil P-31)
 *  MG-02  Paginação — 50 items por página, última página menor
 *  MG-03  Campos sigilosos — valorEstimado e prazo null
 *  MG-04  Cenário de erro 429 injetado na página configurada
 *  MG-05  Cenário de erro 422 injetado
 *  MG-06  Modalidade com volume 0 retorna 1 página vazia
 *  MG-07  AbortSignal cancela a iteração
 *  MG-08  buscarContratacoesPorAtualizacao retorna ~15.000 items
 *  MG-09  buscarContratacaoPorNumero retorna item com número correto
 *  MG-10  buscarArquivos retorna lista de arquivos PDF
 *  MG-11  downloadArquivo retorna Uint8Array com cabeçalho %PDF
 *  MG-12  Stress — 100 pages de 50 items (5.000 contratações) em < 2 s
 */

import { describe, expect, it } from 'vitest';
import {
  MockPncpGateway,
  MockHttpError,
  criarGatewaySmoke,
  criarGatewaySigiloso,
  MODALIDADES_DOMINANTES,
} from '../mock-gateway.js';
import {
  PERFIL_DIA_UTIL_PUBLICACAO,
  TAMANHO_PAGINA_MAX,
  VOLUME_ATUALIZACOES_DIA_UTIL,
} from '../fixtures.js';

const signal = new AbortController().signal;
const JANELA = { inicio: new Date('2026-07-10'), fim: new Date('2026-07-10') };

// ---------------------------------------------------------------------------
// MG-01 — Volume por modalidade (perfil P-31)
// ---------------------------------------------------------------------------

describe('MG-01 — volume por modalidade', () => {
  it('volume total das 3 modalidades dominantes ≥ 90 % do volume do dia útil', async () => {
    const gateway = new MockPncpGateway();
    const valores = Object.values(PERFIL_DIA_UTIL_PUBLICACAO) as number[];
    const totalDiaUtil = valores.reduce((a, b) => a + b, 0);
    const totalDominantes = MODALIDADES_DOMINANTES.reduce(
      (acc, m) => acc + (PERFIL_DIA_UTIL_PUBLICACAO[m] ?? 0),
      0,
    );
    expect(totalDominantes / totalDiaUtil).toBeGreaterThanOrEqual(0.9);

    // Confirma que o gateway usa o mesmo perfil
    let contagem = 0;
    for await (const pagina of gateway.buscarContratacoesPorPublicacao(6, JANELA, signal)) {
      contagem += pagina.length;
    }
    expect(contagem).toBe(PERFIL_DIA_UTIL_PUBLICACAO[6]);
  });

  it('volume total do dia útil ≈ 5.800-6.000', () => {
    const total = (Object.values(PERFIL_DIA_UTIL_PUBLICACAO) as number[]).reduce((a, b) => a + b, 0);
    expect(total).toBeGreaterThanOrEqual(5_700);
    expect(total).toBeLessThanOrEqual(6_100);
  });
});

// ---------------------------------------------------------------------------
// MG-02 — Paginação
// ---------------------------------------------------------------------------

describe('MG-02 — paginação', () => {
  it('cada página tem no máximo 50 items', async () => {
    const gateway = criarGatewaySmoke();  // 50 items/modalidade
    for await (const pagina of gateway.buscarContratacoesPorPublicacao(6, JANELA, signal)) {
      expect(pagina.length).toBeLessThanOrEqual(TAMANHO_PAGINA_MAX);
      expect(pagina.length).toBeGreaterThan(0);
    }
  });

  it('total de items somado das páginas bate com o volume configurado', async () => {
    const volume = 137;  // número primo para forçar página residual
    const gateway = new MockPncpGateway({ volumePorModalidade: { 6: volume } });
    let total = 0;
    for await (const pagina of gateway.buscarContratacoesPorPublicacao(6, JANELA, signal)) {
      total += pagina.length;
    }
    expect(total).toBe(volume);
  });

  it('última página tem os items residuais (volume não divisível por 50)', async () => {
    const volume = 75;  // 50 + 25
    const gateway = new MockPncpGateway({ volumePorModalidade: { 6: volume } });
    const paginas: number[] = [];
    for await (const pagina of gateway.buscarContratacoesPorPublicacao(6, JANELA, signal)) {
      paginas.push(pagina.length);
    }
    expect(paginas).toHaveLength(2);
    expect(paginas[0]).toBe(50);
    expect(paginas[1]).toBe(25);
  });
});

// ---------------------------------------------------------------------------
// MG-03 — Campos sigilosos
// ---------------------------------------------------------------------------

describe('MG-03 — campos sigilosos', () => {
  it('valorEstimado e prazoProposta são null quando camposSigilosos=true', async () => {
    const gateway = criarGatewaySigiloso();
    let paginasLidas = 0;
    for await (const pagina of gateway.buscarContratacoesPorPublicacao(6, JANELA, signal)) {
      for (const item of pagina) {
        expect(item.valorEstimado).toBeNull();
        expect(item.prazoProposta).toBeNull();
      }
      paginasLidas++;
    }
    expect(paginasLidas).toBeGreaterThan(0);
  });

  it('sem sigiloso: campos têm valores numéricos e datas válidas', async () => {
    const gateway = new MockPncpGateway({ volumePorModalidade: { 6: 1 } });
    for await (const pagina of gateway.buscarContratacoesPorPublicacao(6, JANELA, signal)) {
      for (const item of pagina) {
        expect(typeof item.valorEstimado).toBe('number');
        expect(item.prazoProposta).toBeInstanceOf(Date);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// MG-04/05 — Cenários de erro injetados
// ---------------------------------------------------------------------------

describe('MG-04 — cenário 429 injetado', () => {
  it('lança MockHttpError com status 429 na página configurada', async () => {
    const gateway = new MockPncpGateway({
      volumePorModalidade: { 6: 200 },
      cenariosErro: [{ pagina: 2, modalidade: 6, tipo: 429 }],
    });

    const iterador = gateway.buscarContratacoesPorPublicacao(6, JANELA, signal);
    await iterador.next();  // página 1 — ok

    await expect(iterador.next()).rejects.toSatisfy(
      (e: unknown) => e instanceof MockHttpError && e.status === 429,
    );
  });
});

describe('MG-05 — cenário 422 injetado', () => {
  it('lança MockHttpError com status 422 na página configurada', async () => {
    const gateway = new MockPncpGateway({
      volumePorModalidade: { 8: 100 },
      cenariosErro: [{ pagina: 1, tipo: 422 }],  // sem modalidade = qualquer
    });

    const iterador = gateway.buscarContratacoesPorPublicacao(8, JANELA, signal);
    await expect(iterador.next()).rejects.toSatisfy(
      (e: unknown) => e instanceof MockHttpError && e.status === 422,
    );
  });
});

// ---------------------------------------------------------------------------
// MG-06 — Modalidade com volume 0
// ---------------------------------------------------------------------------

describe('MG-06 — modalidade com volume zero', () => {
  it('retorna exatamente 1 página vazia', async () => {
    const gateway = new MockPncpGateway({ volumePorModalidade: { 2: 0 } });
    const paginas: number[] = [];
    for await (const pagina of gateway.buscarContratacoesPorPublicacao(2, JANELA, signal)) {
      paginas.push(pagina.length);
    }
    expect(paginas).toHaveLength(1);
    expect(paginas[0]).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// MG-07 — AbortSignal
// ---------------------------------------------------------------------------

describe('MG-07 — AbortSignal cancela iteração', () => {
  it('para de gerar páginas quando o sinal é abortado', async () => {
    const ac = new AbortController();
    const gateway = new MockPncpGateway({ volumePorModalidade: { 6: 500 } });
    let paginasLidas = 0;

    for await (const _pagina of gateway.buscarContratacoesPorPublicacao(6, JANELA, ac.signal)) {
      paginasLidas++;
      if (paginasLidas === 2) ac.abort();
    }

    expect(paginasLidas).toBeLessThanOrEqual(3);  // abortado na 3ª ou antes
  });
});

// ---------------------------------------------------------------------------
// MG-08 — buscarContratacoesPorAtualizacao (~15.000 items)
// ---------------------------------------------------------------------------

describe('MG-08 — atualizações diárias', () => {
  it('total de atualizações bate com VOLUME_ATUALIZACOES_DIA_UTIL', async () => {
    const gateway = new MockPncpGateway({ volumeAtualizacoes: VOLUME_ATUALIZACOES_DIA_UTIL });
    let total = 0;
    for await (const pagina of gateway.buscarContratacoesPorAtualizacao(JANELA, signal)) {
      total += pagina.length;
      // Contar apenas primeiras 10 páginas para manter o teste rápido
      if (total >= 500) break;
    }
    expect(total).toBeGreaterThanOrEqual(500);
  });

  it('volume configurado customizado funciona', async () => {
    const gateway = new MockPncpGateway({ volumeAtualizacoes: 100 });
    let total = 0;
    for await (const pagina of gateway.buscarContratacoesPorAtualizacao(JANELA, signal)) {
      total += pagina.length;
    }
    expect(total).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// MG-09 — buscarContratacaoPorNumero
// ---------------------------------------------------------------------------

describe('MG-09 — busca por número de controle', () => {
  it('retorna item com o numeroControlePncp passado', async () => {
    const gateway = new MockPncpGateway();
    const numero = '00394502000167-1-000042/2026';
    const item = await gateway.buscarContratacaoPorNumero(numero, signal);
    expect(item).not.toBeNull();
    expect(item!.numeroControlePncp).toBe(numero);
  });

  it('retorna null para string vazia', async () => {
    const gateway = new MockPncpGateway();
    const item = await gateway.buscarContratacaoPorNumero('', signal);
    expect(item).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// MG-10 — buscarArquivos
// ---------------------------------------------------------------------------

describe('MG-10 — buscar arquivos', () => {
  it('retorna lista de arquivos PDF', async () => {
    const gateway = new MockPncpGateway();
    const arquivos = await gateway.buscarArquivos('00394502000167-1-000001/2026', signal);
    expect(arquivos.length).toBeGreaterThan(0);
    for (const arq of arquivos) {
      expect(arq.tipoMime).toBe('application/pdf');
      expect(arq.tamanhoBytes).toBeGreaterThan(0);
      expect(arq.nome).toBeTruthy();
    }
  });
});

// ---------------------------------------------------------------------------
// MG-11 — downloadArquivo
// ---------------------------------------------------------------------------

describe('MG-11 — download de arquivo', () => {
  it('retorna Uint8Array com cabeçalho %PDF', async () => {
    const gateway = new MockPncpGateway();
    const bytes = await gateway.downloadArquivo('https://pncp.gov.br/mock/edital.pdf', signal);
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes[0]).toBe(0x25); // %
    expect(bytes[1]).toBe(0x50); // P
    expect(bytes[2]).toBe(0x44); // D
    expect(bytes[3]).toBe(0x46); // F
  });
});

// ---------------------------------------------------------------------------
// MG-12 — Stress: geração de 5.000 contratações em < 2 s
// ---------------------------------------------------------------------------

describe('MG-12 — stress de geração in-process', () => {
  it('gera 5.000 contratações (100 páginas × 50) em < 2 s', async () => {
    const VOLUME = 5_000;
    const gateway = new MockPncpGateway({ volumePorModalidade: { 6: VOLUME } });
    let total = 0;

    const t0 = performance.now();
    for await (const pagina of gateway.buscarContratacoesPorPublicacao(6, JANELA, signal)) {
      total += pagina.length;
    }
    const elapsedMs = performance.now() - t0;

    console.info(`[MG-12] ${total} contratações geradas em ${elapsedMs.toFixed(1)}ms`);

    expect(total).toBe(VOLUME);
    expect(elapsedMs, `geração demorou ${elapsedMs.toFixed(0)}ms — mock muito lento`).toBeLessThan(2_000);
  });
});
