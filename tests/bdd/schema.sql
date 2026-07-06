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
  aderencia        NUMERIC NOT NULL,
  recomendacao     TEXT    NOT NULL,
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

-- ---------------------------------------------------------------------------
-- Ingestão
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

CREATE TABLE IF NOT EXISTS proveniencias (
  edital_id   TEXT        PRIMARY KEY,
  fonte       TEXT        NOT NULL,
  base_legal  TEXT        NOT NULL,
  coletado_em TIMESTAMPTZ NOT NULL
);
