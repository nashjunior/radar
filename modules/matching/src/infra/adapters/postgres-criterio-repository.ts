import { ClienteFinalId, CriterioId, TenantId } from '@radar/kernel';
import type { DbClient } from '@radar/kernel';
import {
  CriterioDeMonitoramento,
} from '../../domain/entities/criterio-de-monitoramento.js';
import { FaixaValor } from '../../domain/value-objects/faixa-valor.js';
import { PalavrasChave } from '../../domain/value-objects/palavras-chave.js';
import type { CriterioRepository, FieldCryptoProvider } from '../../application/ports.js';

/** Implementação PostgreSQL do CriterioRepository. */
export class PostgresCriterioRepository implements CriterioRepository {
  constructor(
    private readonly db: DbClient,
    private readonly crypto: FieldCryptoProvider,
  ) {}

  async salvar(
    criterio: CriterioDeMonitoramento,
    signal: AbortSignal,
  ): Promise<void> {
    const campos = await cifrarCampos(criterio, this.crypto, signal);
    await this.db.query(
      `INSERT INTO criterio_monitoramento
         (id, tenant_id, cliente_final_id, regiao_uf,
          faixa_valor_min, faixa_valor_max, faixa_valor_min_cripto, faixa_valor_max_cripto,
          palavras_chave, ativo)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (id) DO UPDATE SET
         regiao_uf      = EXCLUDED.regiao_uf,
         faixa_valor_min = EXCLUDED.faixa_valor_min,
         faixa_valor_max = EXCLUDED.faixa_valor_max,
         faixa_valor_min_cripto = EXCLUDED.faixa_valor_min_cripto,
         faixa_valor_max_cripto = EXCLUDED.faixa_valor_max_cripto,
         palavras_chave = EXCLUDED.palavras_chave,
         ativo          = EXCLUDED.ativo`,
      [
        criterio.id,
        criterio.tenantId,
        criterio.clienteFinalId,
        campos.regiaoUf,
        null,
        null,
        campos.faixaValorMin,
        campos.faixaValorMax,
        campos.palavrasChave,
        criterio.ativo,
      ],
      { signal },
    );
  }

  async porId(
    id: CriterioId,
    signal: AbortSignal,
  ): Promise<CriterioDeMonitoramento | null> {
    const { rows } = await this.db.query<Row>(
      `SELECT * FROM criterio_monitoramento WHERE id = $1`,
      [id],
      { signal },
    );
    return rows[0] ? rowToCriterio(rows[0], this.crypto, signal) : null;
  }

  async listarAtivos(signal: AbortSignal): Promise<CriterioDeMonitoramento[]> {
    const { rows } = await this.db.query<Row>(
      `SELECT * FROM criterio_monitoramento WHERE ativo = true`,
      [],
      { signal },
    );
    return Promise.all(rows.map(row => rowToCriterio(row, this.crypto, signal)));
  }

  async listarPorTenant(tenantId: TenantId, signal: AbortSignal): Promise<CriterioDeMonitoramento[]> {
    const { rows } = await this.db.query<Row>(
      `SELECT * FROM criterio_monitoramento WHERE tenant_id = $1 AND ativo = true`,
      [tenantId],
      { signal },
    );
    return Promise.all(rows.map(row => rowToCriterio(row, this.crypto, signal)));
  }

}

interface Row {
  id: string;
  tenant_id: string;
  cliente_final_id: string;
  regiao_uf: string | null;
  faixa_valor_min: number | null;
  faixa_valor_max: number | null;
  faixa_valor_min_cripto?: string | null;
  faixa_valor_max_cripto?: string | null;
  palavras_chave: string[] | null;
  ativo: boolean;
}

async function rowToCriterio(
  row: Row,
  crypto: FieldCryptoProvider,
  signal: AbortSignal,
): Promise<CriterioDeMonitoramento> {
  const regiaoUf = row.regiao_uf
    ? await crypto.decifrarTexto(row.regiao_uf, contexto(row, 'regiao_uf'), signal)
    : undefined;
  const palavrasChave = row.palavras_chave?.length
    ? await Promise.all(
        row.palavras_chave.map((termo, i) =>
          crypto.decifrarTexto(termo, contexto(row, `palavras_chave:${i}`), signal),
        ),
      )
    : undefined;
  const faixaValorMin = await decifrarNumero(
    row.faixa_valor_min_cripto,
    row.faixa_valor_min,
    row,
    'faixa_valor_min',
    crypto,
    signal,
  );
  const faixaValorMax = await decifrarNumero(
    row.faixa_valor_max_cripto,
    row.faixa_valor_max,
    row,
    'faixa_valor_max',
    crypto,
    signal,
  );

  return CriterioDeMonitoramento.reconstituir({
    id: CriterioId(row.id),
    tenantId: TenantId(row.tenant_id),
    clienteFinalId: ClienteFinalId(row.cliente_final_id),
    regiaoUf,
    faixaValor:
      faixaValorMin !== null || faixaValorMax !== null
        ? FaixaValor.criar(faixaValorMin, faixaValorMax)
        : undefined,
    palavrasChave: palavrasChave?.length ? PalavrasChave.criar(palavrasChave) : undefined,
    ativo: row.ativo,
  });
}

async function cifrarCampos(
  criterio: CriterioDeMonitoramento,
  crypto: FieldCryptoProvider,
  signal: AbortSignal,
): Promise<{
  regiaoUf: string | null;
  faixaValorMin: string | null;
  faixaValorMax: string | null;
  palavrasChave: string[];
}> {
  const row = {
    id: criterio.id,
    tenant_id: criterio.tenantId,
    cliente_final_id: criterio.clienteFinalId,
  };
  return {
    regiaoUf: criterio.regiaoUf
      ? await crypto.cifrarTexto(criterio.regiaoUf, contexto(row, 'regiao_uf'), signal)
      : null,
    faixaValorMin: criterio.faixaValor?.min !== null && criterio.faixaValor?.min !== undefined
      ? await crypto.cifrarTexto(String(criterio.faixaValor.min), contexto(row, 'faixa_valor_min'), signal)
      : null,
    faixaValorMax: criterio.faixaValor?.max !== null && criterio.faixaValor?.max !== undefined
      ? await crypto.cifrarTexto(String(criterio.faixaValor.max), contexto(row, 'faixa_valor_max'), signal)
      : null,
    palavrasChave: await Promise.all(
      (criterio.palavrasChave?.termos ?? []).map((termo, i) =>
        crypto.cifrarTexto(termo, contexto(row, `palavras_chave:${i}`), signal),
      ),
    ),
  };
}

async function decifrarNumero(
  cifrado: string | null | undefined,
  legado: number | null,
  row: Row,
  campo: string,
  crypto: FieldCryptoProvider,
  signal: AbortSignal,
): Promise<number | null> {
  if (!cifrado) return legado;
  const texto = await crypto.decifrarTexto(cifrado, contexto(row, campo), signal);
  const numero = Number(texto);
  if (!Number.isFinite(numero)) throw new Error(`${campo} cifrado inválido`);
  return numero;
}

function contexto(
  row: Pick<Row, 'id' | 'tenant_id' | 'cliente_final_id'>,
  campo: string,
): string {
  return `matching.criterio_monitoramento:${row.tenant_id}:${row.cliente_final_id}:${row.id}:${campo}`;
}
