import { describe, expect, it } from 'vitest';
import { PostgresFaixaValorReferencia } from '../../infra/adapters/postgres-faixa-valor-referencia.js';

const signal = new AbortController().signal;

type FaixaRow = { codigo: string; min: string | null; max: string | null; vigente_de: Date; vigente_ate: Date | null };

function criarDb(rows: FaixaRow[]) {
  const chamadas: { sql: string; params: unknown[]; opts?: unknown }[] = [];
  return {
    chamadas,
    async query<R extends object>(_sql: string, _params: unknown[], opts?: unknown): Promise<{ rows: R[] }> {
      chamadas.push({ sql: _sql, params: _params, opts });
      return { rows: rows as unknown as R[] };
    },
  };
}

describe('PostgresFaixaValorReferencia.faixasVigentes', () => {
  it('filtra pela data: vigente_de <= $1 E (vigente_ate IS NULL OR vigente_ate > $1)', async () => {
    const db = criarDb([]);
    const repo = new PostgresFaixaValorReferencia(db);
    const data = new Date('2026-07-12T00:00:00Z');

    await repo.faixasVigentes(data, signal);

    const { sql, params } = db.chamadas[0]!;
    expect(sql).toMatch(/vigente_de\s*<=\s*\$1/);
    expect(sql).toMatch(/vigente_ate IS NULL OR vigente_ate > \$1/);
    expect(params[0]).toBe(data.toISOString());
  });

  it('mapeia min/max numérico de string e datas da row', async () => {
    const vigenteDe = new Date('2026-01-01T00:00:00Z');
    const vigenteAte = new Date('2026-12-31T00:00:00Z');
    const db = criarDb([{ codigo: 'pequeno', min: '0', max: '100000', vigente_de: vigenteDe, vigente_ate: vigenteAte }]);
    const repo = new PostgresFaixaValorReferencia(db);

    const resultado = await repo.faixasVigentes(new Date(), signal);

    expect(resultado).toHaveLength(1);
    expect(resultado[0]).toMatchObject({
      codigo: 'pequeno',
      min: 0,
      max: 100000,
      vigenteDe,
      vigenteAte,
    });
  });

  it('mapeia min=null e max=null (faixa aberta em ambos os extremos) corretamente', async () => {
    const db = criarDb([{ codigo: 'ilimitado', min: null, max: null, vigente_de: new Date(), vigente_ate: null }]);
    const repo = new PostgresFaixaValorReferencia(db);

    const resultado = await repo.faixasVigentes(new Date(), signal);

    expect(resultado[0]).toMatchObject({ codigo: 'ilimitado', min: null, max: null, vigenteAte: null });
  });

  it('vigente_ate=null → vigenteAte null no DTO (vigência sem prazo de encerramento)', async () => {
    const db = criarDb([{ codigo: 'permanente', min: '0', max: null, vigente_de: new Date(), vigente_ate: null }]);
    const repo = new PostgresFaixaValorReferencia(db);

    const resultado = await repo.faixasVigentes(new Date(), signal);

    expect(resultado[0]!.vigenteAte).toBeNull();
  });

  it('resultado vazio → array vazio sem lançar', async () => {
    const db = criarDb([]);
    const repo = new PostgresFaixaValorReferencia(db);

    const resultado = await repo.faixasVigentes(new Date(), signal);

    expect(resultado).toEqual([]);
  });

  it('múltiplas faixas → todas mapeadas na ordem retornada pelo DB', async () => {
    const db = criarDb([
      { codigo: 'pequeno', min: '0', max: '100000', vigente_de: new Date(), vigente_ate: null },
      { codigo: 'medio', min: '100000', max: '500000', vigente_de: new Date(), vigente_ate: null },
      { codigo: 'grande', min: '500000', max: null, vigente_de: new Date(), vigente_ate: null },
    ]);
    const repo = new PostgresFaixaValorReferencia(db);

    const resultado = await repo.faixasVigentes(new Date(), signal);

    expect(resultado.map((r) => r.codigo)).toEqual(['pequeno', 'medio', 'grande']);
    expect(resultado[2]!.min).toBe(500000);
    expect(resultado[2]!.max).toBeNull();
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
    const repo = new PostgresFaixaValorReferencia(db);

    await repo.faixasVigentes(new Date(), ac.signal);

    expect(capturedOpts[0]).toEqual({ signal: ac.signal });
  });
});
