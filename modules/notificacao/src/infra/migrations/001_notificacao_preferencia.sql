-- Núcleo do contexto Notificação (docs/13 §3; RAD-314). Schema já implícito nos adapters
-- (postgres-notificacao-repository.ts, postgres-preferencia-repository.ts) e no dublê de
-- teste E2E (tests/e2e/src/schema.sql) — esta migration só formaliza o contrato que faltava.
--
-- NOTIFICACAO é o agregado raiz (modules/notificacao/src/domain/entities/notificacao.ts):
-- 1 linha por envio a um usuário/canal, upsert idempotente por id (reprocesso de fila é
-- seguro). `status` e `canal.tipo` não levam CHECK — são validados no domínio (VOs
-- StatusNotificacao/Canal), mesmo padrão de `triagem.status` (001_triagem_status.sql).
CREATE TABLE IF NOT EXISTS notificacao (
  id         TEXT        PRIMARY KEY,
  tenant_id  TEXT        NOT NULL,
  usuario_id TEXT        NOT NULL,
  alerta_id  TEXT        NOT NULL,
  canal      TEXT        NOT NULL,
  status     TEXT        NOT NULL,
  criada_em  TIMESTAMPTZ NOT NULL,
  enviada_em TIMESTAMPTZ
);

-- Suporta `jaNotificado(alertaId, usuarioId)` (dedupe de envio por canal/usuário).
CREATE INDEX IF NOT EXISTS idx_notificacao_alerta_usuario
  ON notificacao (alerta_id, usuario_id);

-- USUARIO_PREFERENCIA: 1 linha por usuário, upsert por usuario_id.
CREATE TABLE IF NOT EXISTS usuario_preferencia (
  usuario_id    TEXT        PRIMARY KEY,
  canais        TEXT[]      NOT NULL DEFAULT '{}',
  frequencia    TEXT        NOT NULL,
  atualizada_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
