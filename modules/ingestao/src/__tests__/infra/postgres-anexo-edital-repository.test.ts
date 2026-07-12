import { describe, expect, it } from 'vitest';
import { EditalId } from '@radar/kernel';
import { PostgresAnexoEditalRepository } from '../../infra/adapters/postgres-anexo-edital-repository.js';
import type { AnexoMetadados } from '../../application/ports.js';

const signal = new AbortController().signal;

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

const anexoBase: AnexoMetadados = {
  sequencialDocumento: 1,
  nome: 'edital.pdf',
  storageKey: 's3://bucket/edital.pdf',
  tipoMime: 'application/pdf',
  tamanhoBytes: 204800,
  tipoDocumentoId: 2,
  tipoDocumentoNome: 'Edital',
  textoKey: 's3://bucket/edital.txt',
  paginas: 30,
  estadoConfianca: 'limpo',
};

const rowBase = {
  sequencial_documento: 1,
  nome: 'edital.pdf',
  storage_key: 's3://bucket/edital.pdf',
  tipo_mime: 'application/pdf',
  tamanho_bytes: '204800',  // pg returns bigint as string
  tipo_documento_id: 2,
  tipo_documento_nome: 'Edital',
  texto_key: 's3://bucket/edital.txt',
  paginas: 30,
  estado_confianca: 'limpo',
};

describe('PostgresAnexoEditalRepository.listarPorEdital', () => {
  it('filtra pela edital_id e ordena por sequencial_documento', async () => {
    const db = criarDb([]);
    const repo = new PostgresAnexoEditalRepository(db);

    await repo.listarPorEdital(EditalId('edital-x'), signal);

    const { sql, params } = db.chamadas[0]!;
    expect(sql).toMatch(/FROM edital_anexos/);
    expect(sql).toMatch(/WHERE edital_id = \$1/);
    expect(sql).toMatch(/ORDER BY sequencial_documento/);
    expect(params[0]).toBe('edital-x');
  });

  it('mapeia tamanho_bytes (string do pg) para número', async () => {
    const db = criarDb([rowBase]);
    const repo = new PostgresAnexoEditalRepository(db);

    const resultado = await repo.listarPorEdital(EditalId('edital-1'), signal);

    expect(resultado[0]!.tamanhoBytes).toBe(204800);
    expect(typeof resultado[0]!.tamanhoBytes).toBe('number');
  });

  it('mapeia todos os campos do row para AnexoMetadados', async () => {
    const db = criarDb([rowBase]);
    const repo = new PostgresAnexoEditalRepository(db);

    const resultado = await repo.listarPorEdital(EditalId('edital-1'), signal);

    expect(resultado[0]).toMatchObject({
      sequencialDocumento: 1,
      nome: 'edital.pdf',
      storageKey: 's3://bucket/edital.pdf',
      tipoMime: 'application/pdf',
      tamanhoBytes: 204800,
      tipoDocumentoId: 2,
      tipoDocumentoNome: 'Edital',
      textoKey: 's3://bucket/edital.txt',
      paginas: 30,
      estadoConfianca: 'limpo',
    });
  });

  it('resultado vazio → array vazio', async () => {
    const db = criarDb([]);
    const repo = new PostgresAnexoEditalRepository(db);

    const resultado = await repo.listarPorEdital(EditalId('edital-1'), signal);

    expect(resultado).toEqual([]);
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
    const repo = new PostgresAnexoEditalRepository(db);

    await repo.listarPorEdital(EditalId('edital-1'), ac.signal);

    expect(capturedOpts[0]).toEqual({ signal: ac.signal });
  });
});

describe('PostgresAnexoEditalRepository.salvar', () => {
  it('chama db.query para cada arquivo (upsert iterativo)', async () => {
    const db = criarDb([]);
    const repo = new PostgresAnexoEditalRepository(db);
    const arquivos = [anexoBase, { ...anexoBase, sequencialDocumento: 2, nome: 'minuta.pdf' }];

    await repo.salvar(EditalId('edital-1'), arquivos, signal);

    expect(db.chamadas).toHaveLength(2);
  });

  it('usa ON CONFLICT (edital_id, sequencial_documento)', async () => {
    const db = criarDb([]);
    const repo = new PostgresAnexoEditalRepository(db);

    await repo.salvar(EditalId('edital-1'), [anexoBase], signal);

    const { sql, params } = db.chamadas[0]!;
    expect(sql).toMatch(/ON CONFLICT \(edital_id, sequencial_documento\) DO UPDATE/);
    expect(params[0]).toBe('edital-1');
    expect(params[1]).toBe(1);         // sequencialDocumento
    expect(params[10]).toBe('limpo'); // estado_confianca
  });

  it('lista vazia → nenhuma chamada ao db', async () => {
    const db = criarDb([]);
    const repo = new PostgresAnexoEditalRepository(db);

    await repo.salvar(EditalId('edital-1'), [], signal);

    expect(db.chamadas).toHaveLength(0);
  });
});

describe('PostgresAnexoEditalRepository.atualizarEstado', () => {
  it('executa UPDATE com edital_id, sequencial_documento e novo estado', async () => {
    const db = criarDb([]);
    const repo = new PostgresAnexoEditalRepository(db);

    await repo.atualizarEstado(EditalId('edital-1'), 2, 'rejeitado', signal);

    const { sql, params } = db.chamadas[0]!;
    expect(sql).toMatch(/UPDATE edital_anexos/);
    expect(sql).toMatch(/SET estado_confianca = \$3/);
    expect(params[0]).toBe('edital-1');
    expect(params[1]).toBe(2);
    expect(params[2]).toBe('rejeitado');
  });

  it('propaga AbortSignal', async () => {
    const ac = new AbortController();
    const capturedOpts: unknown[] = [];
    const db = {
      async query<R extends object>(_sql: string, _params: unknown[], opts?: unknown): Promise<{ rows: R[] }> {
        capturedOpts.push(opts);
        return { rows: [] as R[] };
      },
    };
    const repo = new PostgresAnexoEditalRepository(db);

    await repo.atualizarEstado(EditalId('e'), 1, 'limpo', ac.signal);

    expect(capturedOpts[0]).toEqual({ signal: ac.signal });
  });
});

describe('PostgresAnexoEditalRepository.atualizarTexto', () => {
  it('executa UPDATE com texto_key e paginas', async () => {
    const db = criarDb([]);
    const repo = new PostgresAnexoEditalRepository(db);

    await repo.atualizarTexto(EditalId('edital-1'), 3, 's3://bucket/novo.txt', 42, signal);

    const { sql, params } = db.chamadas[0]!;
    expect(sql).toMatch(/SET texto_key = \$3/);
    expect(sql).toMatch(/paginas\s*=\s*\$4/);
    expect(params[0]).toBe('edital-1');
    expect(params[1]).toBe(3);
    expect(params[2]).toBe('s3://bucket/novo.txt');
    expect(params[3]).toBe(42);
  });
});
