-- Trust-gating de anexos (P-104, AB14): adiciona estado de confiança à tabela.
-- Valores: pendente (quarentena) | limpo (aprovado) | rejeitado (isolado).
-- Default 'pendente' para registros existentes que aguardam retroescaneamento.
-- Criado por: RAD-126.

ALTER TABLE edital_anexos
  ADD COLUMN IF NOT EXISTS estado_confianca TEXT NOT NULL DEFAULT 'pendente'
    CHECK (estado_confianca IN ('pendente', 'limpo', 'rejeitado'));

CREATE INDEX IF NOT EXISTS edital_anexos_estado_idx
  ON edital_anexos (edital_id, estado_confianca);
