-- Autovacuum agressivo + fillfactor em EDITAL (P-41/RAD-165, arquitetura/05 §6, 06 §3).
-- Tabela de escrita em rajada (upsert por numero_controle_pncp, S1) + leitura pesada de
-- matching (DB2): sem isto, os dead tuples do upsert só acionam o autovacuum default
-- (scale_factor=0.2 => só dispara com 20% de bloat) e o matching degrada por bloat de
-- índice/heap conforme o volume cresce (DB5/DB6, arquitetura/06 §5).
-- Criado por: RAD-191.

-- fillfactor=90: reserva ~10% de cada página para HOT update (UPDATE que não toca coluna
-- indexada evita reescrever entradas de índice) — casa com a reingestão (mesmo
-- numero_controle_pncp; fase_atual/data_atualizacao mudam sem tocar as colunas de
-- matching indexadas: data_publicacao, modalidade_codigo, orgao_uf, valor_estimado).

-- autovacuum_vacuum_cost_limit maior: o scale_factor baixo torna o autovacuum mais
-- frequente; sem mais orçamento de I/O por ciclo ele arrisca não acompanhar o volume.

-- editais pode já estar particionada por RANGE(data_publicacao) (P-39/RAD-165). Postgres
-- recusa storage parameters no pai particionado ("cannot specify storage parameters for
-- a partitioned table" — verificado em Postgres 16) — é preciso aplicar em cada partição
-- folha. O bloco abaixo detecta o caso e funciona também na forma não-particionada.
--
-- Pegadinha operacional: quando o job de pré-criação da partição do próximo mês existir
-- (arquitetura/05 §3, ainda não implementado em código), ele precisa repetir este ALTER na
-- partição nova — não há herança retroativa nem automática de storage parameters a partir
-- do pai particionado.

DO $$
DECLARE
  tabela_particionada BOOLEAN;
  particao RECORD;
BEGIN
  SELECT EXISTS (
    SELECT 1
      FROM pg_partitioned_table pt
      JOIN pg_class c ON c.oid = pt.partrelid
     WHERE c.relname = 'editais'
  ) INTO tabela_particionada;

  IF tabela_particionada THEN
    FOR particao IN
      SELECT child.relname AS nome
        FROM pg_inherits i
        JOIN pg_class parent ON parent.oid = i.inhparent
        JOIN pg_class child  ON child.oid = i.inhrelid
       WHERE parent.relname = 'editais'
    LOOP
      EXECUTE format(
        'ALTER TABLE %I SET (
           fillfactor = 90,
           autovacuum_vacuum_scale_factor = 0.02,
           autovacuum_analyze_scale_factor = 0.02,
           autovacuum_vacuum_cost_limit = 400
         )',
        particao.nome
      );
    END LOOP;
  ELSE
    ALTER TABLE editais SET (
      fillfactor = 90,
      autovacuum_vacuum_scale_factor = 0.02,
      autovacuum_analyze_scale_factor = 0.02,
      autovacuum_vacuum_cost_limit = 400
    );
  END IF;
END $$;
