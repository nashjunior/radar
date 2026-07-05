-- Schema efêmero para testes E2E (Testcontainers).
-- Derivado dos adapters postgres de matching e notificacao.
-- REGRA: nunca tocar a fonte real do PNCP nem LLM aqui (A04 §4).

CREATE TABLE IF NOT EXISTS criterio_monitoramento (
  id             TEXT    PRIMARY KEY,
  tenant_id      TEXT    NOT NULL,
  cliente_final_id TEXT  NOT NULL,
  ramo_cnae      TEXT,
  regiao_uf      TEXT,
  faixa_valor_min NUMERIC,
  faixa_valor_max NUMERIC,
  palavras_chave TEXT[]  NOT NULL DEFAULT '{}',
  ativo          BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS alerta (
  id               TEXT    PRIMARY KEY,
  tenant_id        TEXT    NOT NULL,
  cliente_final_id TEXT    NOT NULL,
  criterio_id      TEXT    NOT NULL,
  edital_id        TEXT    NOT NULL,
  aderencia        NUMERIC NOT NULL,
  relevante        BOOLEAN
);

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

CREATE TABLE IF NOT EXISTS usuario_preferencia (
  usuario_id    TEXT        PRIMARY KEY,
  canais        TEXT[]      NOT NULL DEFAULT '{}',
  frequencia    TEXT        NOT NULL,
  atualizada_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
