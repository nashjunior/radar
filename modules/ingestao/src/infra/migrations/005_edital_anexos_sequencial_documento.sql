-- Identidade do catálogo de anexos deixa de ser `nome` (texto livre do órgão,
-- não confiável — RAD-291) e passa a ser `sequencial_documento`, a chave
-- natural do documento na compra no PNCP.
-- Tabela sem dado real em produção ainda (P-106): sem necessidade de backfill.
-- Criado por: RAD-291.

ALTER TABLE edital_anexos
  ADD COLUMN sequencial_documento INTEGER NOT NULL;

ALTER TABLE edital_anexos
  DROP CONSTRAINT edital_anexos_pkey,
  ADD PRIMARY KEY (edital_id, sequencial_documento);
