-- Projeção de alertas devidos (P-114, A18 §5.2) — a obrigação que o Matching assume ao
-- casar um edital com um critério ativo. Alimenta o CoberturaPrazoCriticoRepository
-- (reconciliador de prazo crítico, RAD-314) só com fatos locais deste schema — o
-- precedente de leitura cross-schema (PostgresEditalMatchingView) foi revogado por
-- P-97/RAD-95. `notificado_em` fica NULL até o assinante local de notificacao.enviada
-- marcá-lo (perna irmã desta issue).

CREATE TABLE IF NOT EXISTS alerta_devido (
  alerta_id       TEXT        PRIMARY KEY,
  edital_id       TEXT        NOT NULL,
  criterio_id     TEXT        NOT NULL,
  tenant_id       TEXT        NOT NULL,
  prazo_proposta  TIMESTAMPTZ NOT NULL,
  devido_em       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notificado_em   TIMESTAMPTZ
);

-- Janela de prazo crítico é o filtro do reconciliador (A18 §5.1/§5.2).
CREATE INDEX IF NOT EXISTS idx_alerta_devido_prazo_proposta ON alerta_devido (prazo_proposta);
