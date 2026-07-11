import { describe, expect, it } from 'vitest';
import { ClienteFinalId, CriterioId, TenantId } from '@radar/kernel';
import { CriterioDeMonitoramento } from '../../domain/entities/criterio-de-monitoramento.js';
import { FaixaValor } from '../../domain/value-objects/faixa-valor.js';
import { PalavrasChave } from '../../domain/value-objects/palavras-chave.js';
import { PostgresCriterioRepository } from '../../infra/adapters/postgres-criterio-repository.js';
import { AesGcmFieldCryptoProvider } from '../../infra/adapters/aes-gcm-field-crypto-provider.js';

const signal = new AbortController().signal;

function criarDb() {
  const rows: object[] = [];
  return {
    rows,
    async query<R extends object>(sql: string, params: unknown[]): Promise<{ rows: R[] }> {
      if (sql.startsWith('INSERT')) {
        rows[0] = {
          id: params[0],
          tenant_id: params[1],
          cliente_final_id: params[2],
          ramo_cnae: params[3],
          regiao_uf: params[4],
          faixa_valor_min: params[5],
          faixa_valor_max: params[6],
          faixa_valor_min_cripto: params[7],
          faixa_valor_max_cripto: params[8],
          palavras_chave: params[9],
          ativo: params[10],
        };
        return { rows: [] as R[] };
      }
      return { rows: rows as R[] };
    },
  };
}

describe('PostgresCriterioRepository', () => {
  it('cifra classe crítica antes de persistir e decifra ao listar', async () => {
    const db = criarDb();
    const crypto = AesGcmFieldCryptoProvider.fromBase64Key(Buffer.alloc(32, 7).toString('base64'));
    const repo = new PostgresCriterioRepository(db, crypto);
    const criterio = CriterioDeMonitoramento.criar({
      id: CriterioId('criterio-001'),
      tenantId: TenantId('tenant-a'),
      clienteFinalId: ClienteFinalId('cliente-a'),
      ramoCnae: '62.01',
      regiaoUf: 'SP',
      faixaValor: FaixaValor.criar(10_000, 500_000),
      palavrasChave: PalavrasChave.criar(['Cloud', 'ERP']),
    });

    await repo.salvar(criterio, signal);

    const row = db.rows[0] as {
      ramo_cnae: string;
      regiao_uf: string;
      faixa_valor_min: number | null;
      faixa_valor_max: number | null;
      faixa_valor_min_cripto: string;
      faixa_valor_max_cripto: string;
      palavras_chave: string[];
    };
    expect(row.ramo_cnae).not.toBe('62.01');
    expect(row.regiao_uf).not.toBe('SP');
    expect(row.faixa_valor_min).toBeNull();
    expect(row.faixa_valor_max).toBeNull();
    expect(row.faixa_valor_min_cripto).not.toContain('10000');
    expect(row.faixa_valor_max_cripto).not.toContain('500000');
    expect(row.palavras_chave.join(',')).not.toContain('cloud');

    const ativos = await repo.listarAtivos(signal);
    expect(ativos[0]?.ramoCnae).toBe('62.01');
    expect(ativos[0]?.regiaoUf).toBe('SP');
    expect(ativos[0]?.faixaValor?.min).toBe(10_000);
    expect(ativos[0]?.faixaValor?.max).toBe(500_000);
    expect(ativos[0]?.palavrasChave?.termos).toEqual(['cloud', 'erp']);
  });
});
