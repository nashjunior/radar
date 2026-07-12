-- Adiciona prazo_critico à tabela alerta (P-81, A18 §5.1, RAD-303) — decisão de
-- imediaticidade passa a ser aderência alta OU prazo crítico, não só aderência.
-- DEFAULT FALSE para linhas existentes: sem dado real em produção ainda (P-106).

ALTER TABLE alerta
  ADD COLUMN IF NOT EXISTS prazo_critico BOOLEAN NOT NULL DEFAULT FALSE;
