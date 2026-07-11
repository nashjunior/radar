-- Schema efêmero para testes BDD (Testcontainers).
-- Cobre: matching, triagem e ingestão.
-- REGRA: nunca tocar a fonte real do PNCP nem o LLM real aqui (A04 §4).

-- ---------------------------------------------------------------------------
-- Matching
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

-- ---------------------------------------------------------------------------
-- Triagem
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS triagem (
  id               BIGSERIAL PRIMARY KEY,
  tenant_id        TEXT    NOT NULL,
  cliente_final_id TEXT    NOT NULL,
  edital_id        TEXT    NOT NULL,
  perfil_id        TEXT    NOT NULL,
  status           TEXT    NOT NULL DEFAULT 'concluida',
  aderencia        NUMERIC,
  recomendacao     TEXT,
  riscos           JSONB   NOT NULL DEFAULT '[]',
  UNIQUE (tenant_id, edital_id, perfil_id)
);

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

-- Ledger append-only de uso de LLM (RAD-230, P-20/P-38) — modules/triagem/src/infra/migrations/003_registro_uso_llm.sql
CREATE TABLE IF NOT EXISTS registro_uso_llm (
  id                          BIGSERIAL PRIMARY KEY,
  edital_id                   TEXT        NOT NULL,
  tenant_id                   TEXT,
  cliente_final_id            TEXT,
  perfil_id                   TEXT,
  modelo                      TEXT        NOT NULL,
  input_tokens                BIGINT      NOT NULL,
  output_tokens               BIGINT      NOT NULL,
  cache_read_input_tokens     BIGINT      NOT NULL DEFAULT 0,
  cache_creation_input_tokens BIGINT      NOT NULL DEFAULT 0,
  custo_usd                   NUMERIC     NOT NULL,
  ocorrido_em                 TIMESTAMPTZ NOT NULL
);

-- ---------------------------------------------------------------------------
-- Ingestão
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS editais (
  id                   TEXT        PRIMARY KEY,
  numero_controle_pncp TEXT        NOT NULL UNIQUE,
  ano_compra           INT         NOT NULL DEFAULT 0,
  sequencial_compra    INT         NOT NULL DEFAULT 0,
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

CREATE TABLE IF NOT EXISTS proveniencias (
  edital_id   TEXT        PRIMARY KEY,
  fonte       TEXT        NOT NULL,
  base_legal  TEXT        NOT NULL,
  coletado_em TIMESTAMPTZ NOT NULL
);
