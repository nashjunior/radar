-- Criptografia de campo para classe crítica em criterio_monitoramento (docs/05 §9, P-59).
-- Auto-suficiente para ambientes que aplicam esta migration sem schema efêmero:
-- cria a tabela base antes de garantir as colunas *_cripto.
-- Mantém colunas NUMERIC antigas como legado de leitura; novas escritas usam apenas *_cripto.

CREATE TABLE IF NOT EXISTS criterio_monitoramento (
  id               TEXT    PRIMARY KEY,
  tenant_id        TEXT    NOT NULL,
  cliente_final_id TEXT    NOT NULL,
  ramo_cnae        TEXT,
  regiao_uf        TEXT,
  faixa_valor_min  NUMERIC,
  faixa_valor_max  NUMERIC,
  palavras_chave   TEXT[]  NOT NULL DEFAULT '{}',
  ativo            BOOLEAN NOT NULL DEFAULT true
);

ALTER TABLE criterio_monitoramento
  ADD COLUMN IF NOT EXISTS faixa_valor_min_cripto TEXT,
  ADD COLUMN IF NOT EXISTS faixa_valor_max_cripto TEXT;

CREATE INDEX IF NOT EXISTS idx_criterio_tenant
  ON criterio_monitoramento (tenant_id, cliente_final_id);

CREATE INDEX IF NOT EXISTS idx_criterio_ativo
  ON criterio_monitoramento (id)
  WHERE ativo = true;

CREATE INDEX IF NOT EXISTS idx_criterio_cnae
  ON criterio_monitoramento (ramo_cnae)
  WHERE ramo_cnae IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_criterio_uf
  ON criterio_monitoramento (regiao_uf)
  WHERE regiao_uf IS NOT NULL;
