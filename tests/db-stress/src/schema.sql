-- Schema executável para testes de estresse do banco (A05 §3, A06 §3).
-- Cobre as 5 tabelas quentes: EDITAL, ALERTA, CRITERIO_MONITORAMENTO,
-- EXTRACAO_EDITAL, TRIAGEM — com índices documentados em A05/A06.
--
-- REGRA DURA: nunca contra o PNCP real nem LLM real (A04 §4).
-- Colunas e upserts derivados dos adapters Postgres em modules/*/src/infra/adapters/.

-- ---------------------------------------------------------------------------
-- EDITAL — escrita em rajada (DB1) + leitura pesada de matching (DB2)
-- Volume: ~5.900 novos/dia útil + ~15.000 atualizações (docs/12 §3, P-31)
-- Gargalo: upsert sob lock; sequential scan no matching; tamanho de índice (A06)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS editais (
  id                   TEXT        PRIMARY KEY,
  numero_controle_pncp TEXT        NOT NULL UNIQUE,
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
  itens                JSONB       NOT NULL DEFAULT '[]'
);

-- Índices de matching (A05 §3): data, modalidade, UF, valor — queries do casarComEdital
CREATE INDEX IF NOT EXISTS idx_editais_data_pub   ON editais (data_publicacao);
CREATE INDEX IF NOT EXISTS idx_editais_modalidade ON editais (modalidade_codigo);
CREATE INDEX IF NOT EXISTS idx_editais_uf         ON editais (orgao_uf);
CREATE INDEX IF NOT EXISTS idx_editais_valor      ON editais (valor_estimado);

-- ---------------------------------------------------------------------------
-- CRITERIO_MONITORAMENTO — lido a cada edital ingerido (fan-out alvo, DB2)
-- Gargalo: sequential scan se mal indexado; volume cresce com clientes (A06)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS criterio_monitoramento (
  id               TEXT    PRIMARY KEY,
  tenant_id        TEXT    NOT NULL,
  cliente_final_id TEXT    NOT NULL,
  ramo_cnae        TEXT,
  regiao_uf        TEXT,
  faixa_valor_min  NUMERIC,
  faixa_valor_max  NUMERIC,
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
-- Gargalo: write amplification; bloat de índice; inserção em lote (A06)
-- Isolamento estrutural: tenant_id + cliente_final_id obrigatórios (docs/05 §3)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS alerta (
  id               TEXT        PRIMARY KEY,
  tenant_id        TEXT        NOT NULL,
  cliente_final_id TEXT        NOT NULL,
  criterio_id      TEXT        NOT NULL,
  edital_id        TEXT        NOT NULL,
  aderencia        NUMERIC     NOT NULL,
  relevante        BOOLEAN,
  criado_em        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índice composto de tenant para isolamento (A05 §3) + lookup por edital + recência
CREATE INDEX IF NOT EXISTS idx_alerta_tenant ON alerta (tenant_id, cliente_final_id);
CREATE INDEX IF NOT EXISTS idx_alerta_edital ON alerta (edital_id);
CREATE INDEX IF NOT EXISTS idx_alerta_criado ON alerta (criado_em DESC);

-- ---------------------------------------------------------------------------
-- EXTRACAO_EDITAL — cache 1:1 com edital, leitura quente (DB3)
-- Gargalo: JSON grande (requisitos, citações) — TOAST cuida automaticamente.
-- Catálogo global sem tenant_id (docs/12 §2): 1 extração por edital, cacheável.
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

-- ---------------------------------------------------------------------------
-- TRIAGEM — escrita por perfil; 1 por (tenant, edital, perfil) (DB3)
-- Gargalo: contenção de pool; volume = editais × empresas (A06)
-- Escopo de tenant obrigatório nas colunas (docs/05 §3, P-49)
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
