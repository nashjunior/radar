-- Dedupe do webhook do gateway de pagamento (P-107 (5), RAD-250).
--
-- WEBHOOK_EVENTO_PROCESSADO é o anti-replay/anti-reentrega: o webhook do provedor é
-- at-least-once (reentrega em timeout/5xx), e o UNIQUE (provedor, evento_externo_id)
-- é o que torna `INSERT ... ON CONFLICT DO NOTHING` retornar 0 linhas na segunda
-- entrega do mesmo evento — o use case trata isso como no-op, nunca reprocessa.
CREATE TABLE IF NOT EXISTS webhook_evento_processado (
  id                 BIGSERIAL   PRIMARY KEY,
  provedor           TEXT        NOT NULL,
  evento_externo_id  TEXT        NOT NULL,
  processado_em      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT webhook_evento_processado_chave_natural
    UNIQUE (provedor, evento_externo_id)
);

-- Mapeamento assinatura_externa_id -> tenant_id (P-107 (5)) — a ÚNICA fonte confiável
-- de tenant no caminho do webhook; o payload do provedor nunca deriva tenant. Índice
-- parcial porque a coluna é NULL até o primeiro checkout completar.
CREATE INDEX IF NOT EXISTS idx_assinatura_externa_id
  ON assinatura (assinatura_externa_id)
  WHERE assinatura_externa_id IS NOT NULL;
