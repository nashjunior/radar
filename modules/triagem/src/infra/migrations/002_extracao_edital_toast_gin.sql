-- TOAST + GIN full-text em EXTRACAO_EDITAL (P-41/RAD-165, arquitetura/05 §3/§6, 06 §3,
-- docs/11 §5). Criado por: RAD-191.
--
-- EXTRACAO_EDITAL não é particionada (P-39: point-lookup 1:1 por edital_id, arquitetura/05
-- §3) — ALTER/CREATE INDEX direto na tabela, sem a complexidade de partição das migrações
-- irmãs em ingestão/matching.

-- toast_tuple_target=128 (mínimo permitido): a tabela é lida em ponto (1 lookup por
-- edital_id, cache da triagem, DB3) mas guarda JSON grande (`requisitos`, `riscos_brutos`
-- — arrays de citação por página). Baixar o limiar força o Postgres a mover essas colunas
-- para o TOAST mais cedo, mantendo a tupla principal pequena — o que sustenta o cache hit
-- ratio do lookup (arquitetura/05 §4) às custas de mais fetches de TOAST quando o JSON
-- grande é de fato lido.
ALTER TABLE extracao_edital SET (toast_tuple_target = 128);

-- GIN/tsvector para o full-text do objeto (documento 11 §5, camada semântica do matching:
-- "palavras-chave + objeto"; arquitetura/05 §3 aponta este índice explicitamente em
-- EXTRACAO_EDITAL, não em EDITAL — é o campo já normalizado/extraído, não o texto bruto do
-- PNCP). `objeto` é JSONB no formato `{valor, confianca, citacao, critico}` (CampoExtraido)
-- — o texto buscável é `objeto->>'valor'`.
--
-- fastupdate=on (default) mantém o throughput de escrita da extração (1 upsert por edital,
-- não é rajada). gin_pending_list_limit reduzido de 4096kB (default) para 2048kB: como o
-- matching lê essa tabela logo após a extração escrever (fan-out de critérios, DB2), uma
-- pending list maior atrasaria a leitura seguinte (toda query no índice varre a pending
-- list além da estrutura GIN principal) — o corte força flush mais cedo, priorizando a
-- leitura que serve o alerta sobre o throughput da escrita (arquitetura/05 §7: nunca
-- sacrificar o alerta crítico).
CREATE INDEX IF NOT EXISTS idx_extracao_edital_objeto_fts
  ON extracao_edital
  USING GIN (to_tsvector('portuguese', objeto ->> 'valor'))
  WITH (fastupdate = on, gin_pending_list_limit = 2048);
