-- Ledger append-only de uso de LLM (RAD-230, P-20/P-38, docs/09 §6.1). Criado por: RAD-230.
--
-- Distinta de TRIAGEM: nunca há ON CONFLICT/UPDATE aqui — cada INSERT é 1 chamada real ao LLM.
-- É essa diferença que resolve a Lacuna 2 do P-38 (TRIAGEM tem UNIQUE(tenant_id, edital_id,
-- perfil_id) com upsert: COUNT(*) conta agregados distintos, não execuções — re-triar o mesmo
-- (edital, perfil) sobrescreve a linha e o custo "some" do faturamento).
--
-- tenant_id/cliente_final_id/perfil_id são NULLABLE por design: a extração (ExtrairEditalUseCase,
-- ExtrairEditaisEmLoteUseCase) é catálogo GLOBAL cacheável (P-45) e roda sem tenant conhecido —
-- inclusive a pré-extração em lote (P-92), que dispara em `edital.ingerido` ANTES de qualquer
-- usuário pedir triagem. Só a chamada de cache-miss dentro de TriarEditalUseCase tem os três
-- preenchidos (docs/98 P-20 veredicto RAD-227: a extração escala com o volume do PNCP ingerido,
-- não com a cota vendida — as duas unidades de custo "não se encontram").

CREATE TABLE IF NOT EXISTS registro_uso_llm (
  id                          BIGSERIAL PRIMARY KEY,
  edital_id                   TEXT        NOT NULL,
  tenant_id                   TEXT,
  cliente_final_id            TEXT,
  perfil_id                   TEXT,
  modelo                      TEXT        NOT NULL,
  input_tokens                BIGINT      NOT NULL,
  output_tokens               BIGINT      NOT NULL,
  cache_read_input_tokens     BIGINT      NOT NULL DEFAULT 0,
  cache_creation_input_tokens BIGINT      NOT NULL DEFAULT 0,
  custo_usd                   NUMERIC     NOT NULL,
  ocorrido_em                 TIMESTAMPTZ NOT NULL
);

-- Custo por edital (P-20, teto por item) — soma das execuções de UM edital.
CREATE INDEX IF NOT EXISTS idx_registro_uso_llm_edital
  ON registro_uso_llm (edital_id, ocorrido_em);

-- Orçamento acumulado por tenant e janela (P-38, admission control — ainda não implementado, RAD-230
-- follow-up); parcial (WHERE tenant_id IS NOT NULL) porque a maioria das linhas é pré-extração global,
-- fora desse cálculo.
CREATE INDEX IF NOT EXISTS idx_registro_uso_llm_tenant_janela
  ON registro_uso_llm (tenant_id, ocorrido_em)
  WHERE tenant_id IS NOT NULL;
