-- Índice para orçamento acumulado GLOBAL por janela (RAD-243, P-20/P-38 admission control).
--
-- A migração 003 já cobre o caso POR TENANT (idx_registro_uso_llm_tenant_janela, parcial em
-- tenant_id IS NOT NULL). O caso GLOBAL soma TODAS as linhas (com ou sem tenant — a pré-extração
-- em lote, P-45/P-92, não tem tenant) num intervalo de tempo; sem este índice o SUM(custo_usd)
-- de UsoLlmLedger.gastoUsdNaJanela(tenantId: null, ...) faria sequential scan na tabela inteira.

CREATE INDEX IF NOT EXISTS idx_registro_uso_llm_global_janela
  ON registro_uso_llm (ocorrido_em);
