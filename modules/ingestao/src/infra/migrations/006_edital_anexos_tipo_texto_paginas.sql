-- Contrato Ingestão↔Triagem (P-110/RAD-280): o tipo do documento (enum do PNCP) é o
-- único jeito confiável de saber qual anexo é o edital — nunca o `nome`/título livre.
-- `texto_key`/`paginas` vêm da extração (RAD-279), feita no download (antes do scan).
-- Tabela sem dado real em produção ainda (P-106): sem necessidade de backfill.
-- Criado por: RAD-280.

ALTER TABLE edital_anexos
  ADD COLUMN tipo_documento_id   INTEGER NOT NULL,
  ADD COLUMN tipo_documento_nome TEXT    NOT NULL,
  ADD COLUMN texto_key           TEXT    NOT NULL,
  ADD COLUMN paginas             INTEGER NOT NULL;
