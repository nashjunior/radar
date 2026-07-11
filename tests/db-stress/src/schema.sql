-- Schema executável para testes de estresse do banco (A05 §3, A06 §3).
-- Cobre as 5 tabelas quentes: EDITAL, ALERTA, CRITERIO_MONITORAMENTO,
-- EXTRACAO_EDITAL, TRIAGEM — com índices documentados em A05/A06.
-- P-39 (RAD-165, 2026-07-10): particionamento declarativo RANGE mensal em
-- EDITAL (data_publicacao), ALERTA (criado_em), PROVENIENCIA e AUDIT_LOG.
-- P-41 (RAD-165, 2026-07-10): pools bulkhead por workload — configurados em db.ts.
--
-- REGRA DURA: nunca contra o PNCP real nem LLM real (A04 §4).
-- Colunas e upserts derivados dos adapters Postgres em modules/*/src/infra/adapters/.

-- ---------------------------------------------------------------------------
-- EDITAL — escrita em rajada (DB1) + leitura pesada de matching (DB2)
-- P-39: RANGE mensal por data_publicacao (tabela parent).
-- PK inclui data_publicacao (restrição de particionamento declarativo Postgres).
-- UNIQUE (numero_controle_pncp, data_publicacao) — local por partição; sem
-- duplicate global: PNCP garante unicidade por data de publicação em prod.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS editais (
  id                   TEXT        NOT NULL,
  numero_controle_pncp TEXT        NOT NULL,
  modalidade_codigo    INT         NOT NULL,
  modalidade_nome      TEXT        NOT NULL,
  fase_atual           TEXT        NOT NULL,
  objeto               TEXT        NOT NULL,
  valor_estimado       NUMERIC,
  prazo_proposta       TIMESTAMPTZ,
  data_publicacao      TIMESTAMPTZ NOT NULL,
  data_atualizacao     TIMESTAMPTZ NOT NULL,
  orgao_cnpj           TEXT        NOT NULL,
  orgao_nome           TEXT        NOT NULL,
  orgao_uf             TEXT        NOT NULL,
  orgao_municipio      TEXT        NOT NULL,
  prov_fonte           TEXT        NOT NULL DEFAULT 'PNCP',
  prov_base_legal      TEXT        NOT NULL DEFAULT 'Lei 14.133/2021, art. 174',
  prov_coletado_em     TIMESTAMPTZ NOT NULL,
  itens                JSONB       NOT NULL DEFAULT '[]',
  PRIMARY KEY (id, data_publicacao),
  UNIQUE (numero_controle_pncp, data_publicacao)
) PARTITION BY RANGE (data_publicacao);

-- Partições mensais para cobertura dos testes (dados sintéticos de 2026)
CREATE TABLE IF NOT EXISTS editais_2026_05 PARTITION OF editais
  FOR VALUES FROM ('2026-05-01') TO ('2026-06-01');

CREATE TABLE IF NOT EXISTS editais_2026_06 PARTITION OF editais
  FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');

CREATE TABLE IF NOT EXISTS editais_2026_07 PARTITION OF editais
  FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');

-- Guarda: absorve dados fora das partições explícitas (tests DB6 etc.)
CREATE TABLE IF NOT EXISTS editais_default PARTITION OF editais DEFAULT;

-- Índices de matching (A05 §3): herdados pelas partições automaticamente
CREATE INDEX IF NOT EXISTS idx_editais_data_pub   ON editais (data_publicacao);
CREATE INDEX IF NOT EXISTS idx_editais_modalidade ON editais (modalidade_codigo);
CREATE INDEX IF NOT EXISTS idx_editais_uf         ON editais (orgao_uf);
CREATE INDEX IF NOT EXISTS idx_editais_valor      ON editais (valor_estimado);

-- Autovacuum agressivo + fillfactor (P-41/RAD-191, arquitetura/05 §6, 06 §3) — espelha
-- modules/ingestao/src/infra/migrations/003_autovacuum_edital.sql. Storage parameters não
-- podem ser setados no pai particionado (Postgres recusa) — uma linha por partição folha.
ALTER TABLE editais_2026_05 SET (fillfactor = 90, autovacuum_vacuum_scale_factor = 0.02, autovacuum_analyze_scale_factor = 0.02, autovacuum_vacuum_cost_limit = 400);
ALTER TABLE editais_2026_06 SET (fillfactor = 90, autovacuum_vacuum_scale_factor = 0.02, autovacuum_analyze_scale_factor = 0.02, autovacuum_vacuum_cost_limit = 400);
ALTER TABLE editais_2026_07 SET (fillfactor = 90, autovacuum_vacuum_scale_factor = 0.02, autovacuum_analyze_scale_factor = 0.02, autovacuum_vacuum_cost_limit = 400);
ALTER TABLE editais_default SET (fillfactor = 90, autovacuum_vacuum_scale_factor = 0.02, autovacuum_analyze_scale_factor = 0.02, autovacuum_vacuum_cost_limit = 400);

-- ---------------------------------------------------------------------------
-- CRITERIO_MONITORAMENTO — lido a cada edital ingerido (fan-out alvo, DB2)
-- P-39: NÃO particionado (point-lookup/tenant, sem crescimento ilimitado).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS criterio_monitoramento (
  id               TEXT    PRIMARY KEY,
  tenant_id        TEXT    NOT NULL,
  cliente_final_id TEXT    NOT NULL,
  ramo_cnae        TEXT,
  regiao_uf        TEXT,
  faixa_valor_min  NUMERIC,
  faixa_valor_max  NUMERIC,
  faixa_valor_min_cripto TEXT,
  faixa_valor_max_cripto TEXT,
  palavras_chave   TEXT[]  NOT NULL DEFAULT '{}',
  ativo            BOOLEAN NOT NULL DEFAULT true
);

-- Índices compostos para isolamento e filtros de fan-out (A05 §3, docs/05 §3)
CREATE INDEX IF NOT EXISTS idx_criterio_tenant ON criterio_monitoramento (tenant_id, cliente_final_id);
-- Índice parcial: só critérios ativos são lidos no fan-out (A06 §3)
CREATE INDEX IF NOT EXISTS idx_criterio_ativo  ON criterio_monitoramento (id) WHERE ativo = true;
CREATE INDEX IF NOT EXISTS idx_criterio_cnae   ON criterio_monitoramento (ramo_cnae) WHERE ramo_cnae IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_criterio_uf     ON criterio_monitoramento (regiao_uf)  WHERE regiao_uf IS NOT NULL;

-- ---------------------------------------------------------------------------
-- ALERTA — escrita explosiva por fan-out; 1 por (edital × critério) (DB2)
-- P-39: RANGE mensal por criado_em (append-only, bloat concentrado na partição corrente).
-- PK inclui criado_em (restrição de particionamento declarativo Postgres).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS alerta (
  id               TEXT        NOT NULL,
  tenant_id        TEXT        NOT NULL,
  cliente_final_id TEXT        NOT NULL,
  criterio_id      TEXT        NOT NULL,
  edital_id        TEXT        NOT NULL,
  aderencia        NUMERIC     NOT NULL,
  relevante        BOOLEAN,
  criado_em        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, criado_em)
) PARTITION BY RANGE (criado_em);

CREATE TABLE IF NOT EXISTS alerta_2026_05 PARTITION OF alerta
  FOR VALUES FROM ('2026-05-01') TO ('2026-06-01');

CREATE TABLE IF NOT EXISTS alerta_2026_06 PARTITION OF alerta
  FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');

CREATE TABLE IF NOT EXISTS alerta_2026_07 PARTITION OF alerta
  FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');

CREATE TABLE IF NOT EXISTS alerta_default PARTITION OF alerta DEFAULT;

-- Índice composto de tenant para isolamento (A05 §3) + lookup por edital + recência
CREATE INDEX IF NOT EXISTS idx_alerta_tenant ON alerta (tenant_id, cliente_final_id);
CREATE INDEX IF NOT EXISTS idx_alerta_edital ON alerta (edital_id);
CREATE INDEX IF NOT EXISTS idx_alerta_criado ON alerta (criado_em DESC);

-- Autovacuum agressivo (P-41/RAD-191, arquitetura/05 §6, 06 §3) — espelha
-- modules/matching/src/infra/migrations/004_autovacuum_alerta.sql. Sem fillfactor:
-- ALERTA é insert-only (fan-out), não tem churn de UPDATE como EDITAL.
ALTER TABLE alerta_2026_05 SET (autovacuum_vacuum_scale_factor = 0.02, autovacuum_analyze_scale_factor = 0.02, autovacuum_vacuum_cost_limit = 400);
ALTER TABLE alerta_2026_06 SET (autovacuum_vacuum_scale_factor = 0.02, autovacuum_analyze_scale_factor = 0.02, autovacuum_vacuum_cost_limit = 400);
ALTER TABLE alerta_2026_07 SET (autovacuum_vacuum_scale_factor = 0.02, autovacuum_analyze_scale_factor = 0.02, autovacuum_vacuum_cost_limit = 400);
ALTER TABLE alerta_default SET (autovacuum_vacuum_scale_factor = 0.02, autovacuum_analyze_scale_factor = 0.02, autovacuum_vacuum_cost_limit = 400);

-- ---------------------------------------------------------------------------
-- EXTRACAO_EDITAL — cache 1:1 com edital, leitura quente (DB3)
-- P-39: NÃO particionada (point-lookup 1:1 por edital_id; range não ajuda).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS extracao_edital (
  edital_id               TEXT    PRIMARY KEY,
  objeto                  JSONB   NOT NULL,
  valor_estimado          JSONB   NOT NULL,
  data_abertura_propostas JSONB   NOT NULL,
  requisitos              JSONB   NOT NULL DEFAULT '[]',
  riscos_brutos           JSONB   NOT NULL DEFAULT '[]',
  confianca               NUMERIC NOT NULL,
  paginas                 INT     NOT NULL
);

-- TOAST + GIN full-text (P-41/RAD-191, arquitetura/05 §3/§6, docs/11 §5) — espelha
-- modules/triagem/src/infra/migrations/002_extracao_edital_toast_gin.sql.
ALTER TABLE extracao_edital SET (toast_tuple_target = 128);

CREATE INDEX IF NOT EXISTS idx_extracao_edital_objeto_fts
  ON extracao_edital
  USING GIN (to_tsvector('portuguese', objeto ->> 'valor'))
  WITH (fastupdate = on, gin_pending_list_limit = 2048);

-- ---------------------------------------------------------------------------
-- TRIAGEM — escrita por perfil; 1 por (tenant, edital, perfil) (DB3)
-- P-39: NÃO particionada (sem crescimento ilimitado nem append-only).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS triagem (
  id               BIGSERIAL   PRIMARY KEY,
  tenant_id        TEXT        NOT NULL,
  cliente_final_id TEXT        NOT NULL,
  edital_id        TEXT        NOT NULL,
  perfil_id        TEXT        NOT NULL,
  status           TEXT        NOT NULL DEFAULT 'concluida',
  aderencia        NUMERIC,
  recomendacao     TEXT,
  riscos           JSONB       NOT NULL DEFAULT '[]',
  UNIQUE (tenant_id, edital_id, perfil_id)
);

-- Índices de isolamento e lookup (A05 §3)
CREATE INDEX IF NOT EXISTS idx_triagem_tenant ON triagem (tenant_id, cliente_final_id);
CREATE INDEX IF NOT EXISTS idx_triagem_edital ON triagem (edital_id);

-- ---------------------------------------------------------------------------
-- PROVENIENCIA — metadados de coleta; append-only (P-39: RANGE mensal)
-- Timestamp do evento como chave de partição.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS proveniencia (
  id          TEXT        NOT NULL,
  edital_id   TEXT        NOT NULL,
  fonte       TEXT        NOT NULL,
  base_legal  TEXT        NOT NULL,
  coletado_em TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (id, coletado_em)
) PARTITION BY RANGE (coletado_em);

CREATE TABLE IF NOT EXISTS proveniencia_2026_05 PARTITION OF proveniencia
  FOR VALUES FROM ('2026-05-01') TO ('2026-06-01');

CREATE TABLE IF NOT EXISTS proveniencia_2026_06 PARTITION OF proveniencia
  FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');

CREATE TABLE IF NOT EXISTS proveniencia_2026_07 PARTITION OF proveniencia
  FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');

CREATE TABLE IF NOT EXISTS proveniencia_default PARTITION OF proveniencia DEFAULT;

CREATE INDEX IF NOT EXISTS idx_proveniencia_edital     ON proveniencia (edital_id);
CREATE INDEX IF NOT EXISTS idx_proveniencia_coletado_em ON proveniencia (coletado_em DESC);

-- ---------------------------------------------------------------------------
-- AUDIT_LOG — append-only/fail-closed; hot 12 m + frio até 5 anos (P-39)
-- Timestamp do evento como chave de partição.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_log (
  id          BIGSERIAL   NOT NULL,
  evento      TEXT        NOT NULL,
  tenant_id   TEXT,
  ator_id     TEXT,
  payload     JSONB       NOT NULL DEFAULT '{}',
  ocorrido_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, ocorrido_em)
) PARTITION BY RANGE (ocorrido_em);

CREATE TABLE IF NOT EXISTS audit_log_2026_05 PARTITION OF audit_log
  FOR VALUES FROM ('2026-05-01') TO ('2026-06-01');

CREATE TABLE IF NOT EXISTS audit_log_2026_06 PARTITION OF audit_log
  FOR VALUES FROM ('2026-06-01') TO ('2026-07-01');

CREATE TABLE IF NOT EXISTS audit_log_2026_07 PARTITION OF audit_log
  FOR VALUES FROM ('2026-07-01') TO ('2026-08-01');

CREATE TABLE IF NOT EXISTS audit_log_default PARTITION OF audit_log DEFAULT;

CREATE INDEX IF NOT EXISTS idx_audit_log_tenant     ON audit_log (tenant_id) WHERE tenant_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_audit_log_ocorrido_em ON audit_log (ocorrido_em DESC);
