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
          regiao_uf: params[3],
          faixa_valor_min: params[4],
          faixa_valor_max: params[5],
          faixa_valor_min_cripto: params[6],
          faixa_valor_max_cripto: params[7],
          palavras_chave: params[8],
          ativo: params[9],
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
      regiaoUf: 'SP',
      faixaValor: FaixaValor.criar(10_000, 500_000),
      palavrasChave: PalavrasChave.criar(['Cloud', 'ERP']),
    });

    await repo.salvar(criterio, signal);

    const row = db.rows[0] as {
      ramo_cnae?: string;
      regiao_uf: string;
      faixa_valor_min: number | null;
      faixa_valor_max: number | null;
      faixa_valor_min_cripto: string;
      faixa_valor_max_cripto: string;
      palavras_chave: string[];
    };
    expect(row.ramo_cnae).toBeUndefined();
    expect(row.regiao_uf).not.toBe('SP');
    expect(row.faixa_valor_min).toBeNull();
    expect(row.faixa_valor_max).toBeNull();
    expect(row.faixa_valor_min_cripto).not.toContain('10000');
    expect(row.faixa_valor_max_cripto).not.toContain('500000');
    expect(row.palavras_chave.join(',')).not.toContain('cloud');

    const ativos = await repo.listarAtivos(signal);
    expect(ativos[0]?.ramoCnae).toBeNull();
    expect(ativos[0]?.regiaoUf).toBe('SP');
    expect(ativos[0]?.faixaValor?.min).toBe(10_000);
    expect(ativos[0]?.faixaValor?.max).toBe(500_000);
    expect(ativos[0]?.palavrasChave?.termos).toEqual(['cloud', 'erp']);
  });

  it('ignora ramo_cnae legado ao reconstituir e não silencia critério antigo só-CNAE', async () => {
    const db = criarDb();
    const crypto = AesGcmFieldCryptoProvider.fromBase64Key(Buffer.alloc(32, 7).toString('base64'));
    const repo = new PostgresCriterioRepository(db, crypto);
    db.rows[0] = {
      id: 'criterio-legado',
      tenant_id: 'tenant-a',
      cliente_final_id: 'cliente-a',
      ramo_cnae: '62.01',
      regiao_uf: null,
      faixa_valor_min: null,
      faixa_valor_max: null,
      faixa_valor_min_cripto: null,
      faixa_valor_max_cripto: null,
      palavras_chave: [],
      ativo: true,
    };

    const [criterio] = await repo.listarAtivos(signal);
    const aderencia = criterio?.casaCom({
      objetoDescricao: 'Serviços de limpeza',
      uf: null,
      cnae: null,
      valorEstimado: null,
    });

    expect(criterio?.ramoCnae).toBeNull();
    expect(aderencia?.valor).toBe(0.5);
    expect(aderencia?.superaLimiar).toBe(true);
  });
});
