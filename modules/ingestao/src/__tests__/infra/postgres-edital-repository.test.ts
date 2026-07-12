import { describe, expect, it } from 'vitest';
import { EditalId } from '@radar/kernel';
import { PostgresEditalRepository } from '../../infra/adapters/postgres-edital-repository.js';
import { Edital } from '../../domain/entities/edital.js';

const signal = new AbortController().signal;
const CNPJ_VALIDO = '11222333000181';

// Base row as pg would return from the editais table
function rowBase(overrides: object = {}) {
  return {
    id: 'edital-1',
    numero_controle_pncp: '00394502000167-1-000001/2024',
    ano_compra: 2024,
    sequencial_compra: 1,
    modalidade_codigo: 6,
    modalidade_nome: 'Concorrência',
    fase_atual: 'Publicado',
    objeto: 'Aquisição de equipamentos de TI',
    valor_estimado: '500000.00',
    prazo_proposta: new Date('2024-03-15T23:59:00Z'),
    data_publicacao: new Date('2024-01-10T10:00:00Z'),
    data_atualizacao: new Date('2024-01-10T10:00:00Z'),
    orgao_cnpj: CNPJ_VALIDO,
    orgao_nome: 'Prefeitura de São Paulo',
    orgao_uf: 'SP',
    orgao_municipio: 'São Paulo',
    prov_fonte: 'PNCP',
    prov_base_legal: 'Lei 14.133/2021, art. 174',
    prov_coletado_em: new Date('2024-01-10T11:00:00Z'),
    itens: [{ numeroItem: 1, descricao: 'Notebook', quantidade: 10, valorUnitarioEstimado: '5000.00' }],
    ...overrides,
  };
}

function editalBase() {
  return Edital.criar({
    id: EditalId('edital-1'),
    numeroControlePncp: '00394502000167-1-000001/2024',
    anoCompra: 2024,
    sequencialCompra: 1,
    modalidadeCodigo: 6,
    modalidadeNome: 'Concorrência',
    faseAtual: 'Publicado',
    objeto: 'Aquisição de equipamentos de TI',
    valorEstimado: 500000,
    prazoProposta: new Date('2024-03-15T23:59:00Z'),
    dataPublicacao: new Date('2024-01-10T10:00:00Z'),
    dataAtualizacao: new Date('2024-01-10T10:00:00Z'),
    orgao: { cnpj: CNPJ_VALIDO, nome: 'Prefeitura de São Paulo', uf: 'SP', municipio: 'São Paulo' },
    proveniencia: { fonte: 'PNCP', baseLegal: 'Lei 14.133/2021, art. 174', coletadoEm: new Date('2024-01-10T11:00:00Z') },
    itens: [{ numeroItem: 1, descricao: 'Notebook', quantidade: 10, valorUnitarioEstimado: 5000 }],
  });
}

function criarDb(rows: object[] = []) {
  const chamadas: { sql: string; params: unknown[]; opts?: unknown }[] = [];
  return {
    chamadas,
    async query<R extends object>(_sql: string, _params: unknown[], opts?: unknown): Promise<{ rows: R[] }> {
      chamadas.push({ sql: _sql, params: _params, opts });
      return { rows: rows as R[] };
    },
  };
}

describe('PostgresEditalRepository.porId', () => {
  it('retorna null quando o edital não existe', async () => {
    const db = criarDb([]);
    const repo = new PostgresEditalRepository(db);

    const resultado = await repo.porId(EditalId('edital-x'), signal);

    expect(resultado).toBeNull();
    expect(db.chamadas[0]!.sql).toMatch(/WHERE id = \$1/);
    expect(db.chamadas[0]!.params[0]).toBe('edital-x');
  });

  it('reconstrói Edital a partir da row — campos básicos', async () => {
    const db = criarDb([rowBase()]);
    const repo = new PostgresEditalRepository(db);

    const resultado = await repo.porId(EditalId('edital-1'), signal);

    expect(resultado).not.toBeNull();
    expect(resultado!.objeto).toBe('Aquisição de equipamentos de TI');
    expect(resultado!.faseAtual).toBe('Publicado');
    expect(resultado!.anoCompra).toBe(2024);
    expect(resultado!.modalidade.codigo).toBe(6);
  });

  it('prazoProposta null → prazoProposta null no domínio', async () => {
    const db = criarDb([rowBase({ prazo_proposta: null })]);
    const repo = new PostgresEditalRepository(db);

    const resultado = await repo.porId(EditalId('edital-1'), signal);

    expect(resultado!.prazoProposta).toBeNull();
  });

  it('valor_estimado null → valorEstimado null no domínio', async () => {
    const db = criarDb([rowBase({ valor_estimado: null })]);
    const repo = new PostgresEditalRepository(db);

    const resultado = await repo.porId(EditalId('edital-1'), signal);

    expect(resultado!.valorEstimado).toBeNull();
  });

  it('propaga AbortSignal ao db.query', async () => {
    const ac = new AbortController();
    const capturedOpts: unknown[] = [];
    const db = {
      async query<R extends object>(_sql: string, _params: unknown[], opts?: unknown): Promise<{ rows: R[] }> {
        capturedOpts.push(opts);
        return { rows: [] as R[] };
      },
    };
    const repo = new PostgresEditalRepository(db);

    await repo.porId(EditalId('edital-1'), ac.signal);

    expect(capturedOpts[0]).toEqual({ signal: ac.signal });
  });
});

describe('PostgresEditalRepository.porNumeroControle', () => {
  it('retorna null quando não encontra', async () => {
    const db = criarDb([]);
    const repo = new PostgresEditalRepository(db);

    const resultado = await repo.porNumeroControle('000-1-2/2024', signal);

    expect(resultado).toBeNull();
    expect(db.chamadas[0]!.sql).toMatch(/WHERE numero_controle_pncp = \$1/);
    expect(db.chamadas[0]!.params[0]).toBe('000-1-2/2024');
  });

  it('reconstrói o Edital quando encontra', async () => {
    const db = criarDb([rowBase()]);
    const repo = new PostgresEditalRepository(db);

    const resultado = await repo.porNumeroControle('00394502000167-1-000001/2024', signal);

    expect(resultado).not.toBeNull();
    expect(resultado!.id).toBe('edital-1');
  });
});

describe('PostgresEditalRepository.upsertPorNumeroControle', () => {
  it('usa ON CONFLICT (numero_controle_pncp) DO UPDATE', async () => {
    const db = criarDb([]);
    const repo = new PostgresEditalRepository(db);

    await repo.upsertPorNumeroControle(editalBase(), signal);

    expect(db.chamadas[0]!.sql).toMatch(/ON CONFLICT \(numero_controle_pncp\) DO UPDATE/);
  });

  it('serializa prazoProposta como ISO string quando presente', async () => {
    const db = criarDb([]);
    const repo = new PostgresEditalRepository(db);
    const edital = editalBase();

    await repo.upsertPorNumeroControle(edital, signal);

    const prazoPrazo = db.chamadas[0]!.params[9];
    expect(prazoPrazo).toBe(edital.prazoProposta!.toISOString());
  });

  it('passa null para prazoProposta quando o edital não tem prazo', async () => {
    const db = criarDb([]);
    const repo = new PostgresEditalRepository(db);
    const edital = Edital.criar({
      id: EditalId('edital-2'),
      numeroControlePncp: '00394502000167-1-000002/2024',
      anoCompra: 2024,
      sequencialCompra: 2,
      modalidadeCodigo: 8,
      modalidadeNome: 'Pregão',
      faseAtual: 'Publicado',
      objeto: 'Serviços de limpeza',
      valorEstimado: null,
      prazoProposta: null,
      dataPublicacao: new Date('2024-02-01T00:00:00Z'),
      dataAtualizacao: new Date('2024-02-01T00:00:00Z'),
      orgao: { cnpj: CNPJ_VALIDO, nome: 'Estado do RS', uf: 'RS', municipio: 'Porto Alegre' },
      proveniencia: { fonte: 'PNCP', baseLegal: 'Lei 14.133/2021', coletadoEm: new Date() },
      itens: [],
    });

    await repo.upsertPorNumeroControle(edital, signal);

    expect(db.chamadas[0]!.params[9]).toBeNull();  // prazoProposta
    expect(db.chamadas[0]!.params[8]).toBeNull();  // valorEstimado
  });

  it('serializa itens como JSON com valorUnitarioEstimado', async () => {
    const db = criarDb([]);
    const repo = new PostgresEditalRepository(db);

    await repo.upsertPorNumeroControle(editalBase(), signal);

    const itensJson = JSON.parse(db.chamadas[0]!.params[19] as string);
    expect(itensJson[0].numeroItem).toBe(1);
    expect(itensJson[0].descricao).toBe('Notebook');
    expect(itensJson[0].quantidade).toBe(10);
    expect(itensJson[0].valorUnitarioEstimado).toBeDefined();
  });

  it('propaga AbortSignal ao db.query', async () => {
    const ac = new AbortController();
    const capturedOpts: unknown[] = [];
    const db = {
      async query<R extends object>(_sql: string, _params: unknown[], opts?: unknown): Promise<{ rows: R[] }> {
        capturedOpts.push(opts);
        return { rows: [] as R[] };
      },
    };
    const repo = new PostgresEditalRepository(db);

    await repo.upsertPorNumeroControle(editalBase(), ac.signal);

    expect(capturedOpts[0]).toEqual({ signal: ac.signal });
  });
});

describe('PostgresEditalRepository.listarPorJanelaPublicacao', () => {
  it('retorna imediatamente sem yieldar quando a primeira página está vazia', async () => {
    const db = criarDb([]);
    const repo = new PostgresEditalRepository(db);
    const janela = { inicio: new Date('2024-01-01'), fim: new Date('2024-01-31') };

    const paginas: Edital[][] = [];
    for await (const pg of repo.listarPorJanelaPublicacao(janela, signal)) {
      paginas.push(pg);
    }

    expect(paginas).toHaveLength(0);
    expect(db.chamadas[0]!.params[0]).toBe(janela.inicio.toISOString());
    expect(db.chamadas[0]!.params[1]).toBe(janela.fim.toISOString());
    expect(db.chamadas[0]!.params[2]).toBe('');  // cursor começa vazio
  });

  it('a primeira página com menos de 100 itens termina a paginação (uma única query)', async () => {
    const rows = [rowBase(), rowBase({ id: 'edital-2', numero_controle_pncp: '00394502000167-1-000002/2024' })];
    const db = criarDb(rows);
    const repo = new PostgresEditalRepository(db);

    const paginas: Edital[][] = [];
    for await (const pg of repo.listarPorJanelaPublicacao({ inicio: new Date(), fim: new Date() }, signal)) {
      paginas.push(pg);
    }

    expect(paginas).toHaveLength(1);
    expect(paginas[0]).toHaveLength(2);
    expect(db.chamadas).toHaveLength(1);
  });

  it('avança o cursor para o id do último item da página', async () => {
    // Simula exatamente 100 items na 1ª página, 0 na 2ª → 2 queries
    const PAGE = 100;
    const rows100 = Array.from({ length: PAGE }, (_, i) =>
      rowBase({ id: `edital-${String(i + 1).padStart(3, '0')}`, numero_controle_pncp: `00394502000167-1-${String(i + 1).padStart(6, '0')}/2024` }),
    );
    let call = 0;
    const db = {
      chamadas: [] as { sql: string; params: unknown[] }[],
      async query<R extends object>(sql: string, params: unknown[]): Promise<{ rows: R[] }> {
        db.chamadas.push({ sql, params });
        call++;
        return { rows: (call === 1 ? rows100 : []) as unknown as R[] };
      },
    };
    const repo = new PostgresEditalRepository(db);

    const paginas: Edital[][] = [];
    for await (const pg of repo.listarPorJanelaPublicacao({ inicio: new Date(), fim: new Date() }, signal)) {
      paginas.push(pg);
    }

    expect(paginas).toHaveLength(1);  // segunda chamada retorna vazio, sem yield
    expect(db.chamadas).toHaveLength(2);
    expect(db.chamadas[1]!.params[2]).toBe('edital-100');  // cursor = último id
  });
});
