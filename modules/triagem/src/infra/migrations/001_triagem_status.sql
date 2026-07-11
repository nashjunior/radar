-- Criada por: RAD-79 (envelope de ciclo de vida — processando/incompleta/falha_ocr/recusada).
-- Adiciona coluna `status` e permite `aderencia`/`recomendacao` NULL para estados não-concluídos.

ALTER TABLE triagem
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'concluida',
  ALTER COLUMN aderencia    DROP NOT NULL,
  ALTER COLUMN recomendacao DROP NOT NULL;

-- Linhas existentes já têm status correto via DEFAULT 'concluida'.
