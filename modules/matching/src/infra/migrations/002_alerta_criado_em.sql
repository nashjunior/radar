-- Adiciona criado_em à tabela alerta para suportar a janela de ativação (docs/08 §3, P-15).
-- DEFAULT NOW() cobre linhas existentes sem downtime.

ALTER TABLE alerta
  ADD COLUMN IF NOT EXISTS criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_alerta_tenant_criado_em
  ON alerta (tenant_id, criado_em);
