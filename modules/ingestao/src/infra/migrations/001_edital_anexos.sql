-- Tabela de metadados de anexos materializados por edital.
-- Criada por: RAD-94 (DocumentosDoEditalPort — Open-Host Service da Ingestão).
-- Chave primária composta garante upsert idempotente por (edital_id, nome).

CREATE TABLE IF NOT EXISTS edital_anexos (
  edital_id     TEXT        NOT NULL REFERENCES editais(id) ON DELETE CASCADE,
  nome          TEXT        NOT NULL,
  storage_key   TEXT        NOT NULL,
  tipo_mime     TEXT        NOT NULL,
  tamanho_bytes BIGINT      NOT NULL,
  criado_em     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (edital_id, nome)
);

CREATE INDEX IF NOT EXISTS edital_anexos_edital_id_idx ON edital_anexos (edital_id);
