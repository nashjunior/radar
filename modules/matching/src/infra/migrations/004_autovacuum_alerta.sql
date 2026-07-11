-- Autovacuum agressivo em ALERTA (P-41/RAD-165, arquitetura/05 §6, 06 §3).
-- Escrita explosiva por fan-out (DB2: 1 edital × N mil critérios) — write amplification e
-- bloat de índice concentrados na partição corrente (append-only). Sem scale_factor baixo,
-- o autovacuum default só dispara com 20% de bloat, e nesta tabela isso é um volume grande
-- de dead tuples antes de acionar. Sem fillfactor: ALERTA é insert-only (sem UPDATE de
-- churn como EDITAL), então reservar espaço de página para HOT update não se aplica aqui.
-- Criado por: RAD-191.

-- alerta pode já estar particionada por RANGE(criado_em) (P-39/RAD-165). Postgres recusa
-- storage parameters no pai particionado ("cannot specify storage parameters for a
-- partitioned table" — verificado em Postgres 16) — aplica-se em cada partição folha. O
-- bloco abaixo detecta o caso e funciona também na forma não-particionada.
--
-- Mesma pegadinha operacional da migração irmã em ingestão (003_autovacuum_edital.sql):
-- o job de pré-criação de partição do próximo mês (quando existir) precisa repetir este
-- ALTER na partição nova.

DO $$
DECLARE
  tabela_particionada BOOLEAN;
  particao RECORD;
BEGIN
  SELECT EXISTS (
    SELECT 1
      FROM pg_partitioned_table pt
      JOIN pg_class c ON c.oid = pt.partrelid
     WHERE c.relname = 'alerta'
  ) INTO tabela_particionada;

  IF tabela_particionada THEN
    FOR particao IN
      SELECT child.relname AS nome
        FROM pg_inherits i
        JOIN pg_class parent ON parent.oid = i.inhparent
        JOIN pg_class child  ON child.oid = i.inhrelid
       WHERE parent.relname = 'alerta'
    LOOP
      EXECUTE format(
        'ALTER TABLE %I SET (
           autovacuum_vacuum_scale_factor = 0.02,
           autovacuum_analyze_scale_factor = 0.02,
           autovacuum_vacuum_cost_limit = 400
         )',
        particao.nome
      );
    END LOOP;
  ELSE
    ALTER TABLE alerta SET (
      autovacuum_vacuum_scale_factor = 0.02,
      autovacuum_analyze_scale_factor = 0.02,
      autovacuum_vacuum_cost_limit = 400
    );
  END IF;
END $$;
