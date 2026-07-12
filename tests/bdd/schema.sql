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
  prazo_critico    BOOLEAN     NOT NULL DEFAULT FALSE,
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
-- coorte_trial: bulkhead trial (RAD-271, P-109 L1) — migration 005_registro_uso_llm_coorte_trial.sql
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
  ocorrido_em                 TIMESTAMPTZ NOT NULL,
  coorte_trial                BOOLEAN     NOT NULL DEFAULT false
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

-- Metadados de anexos materializados por edital (P-104/AB14 trust-gating; P-110/RAD-280
-- contrato Ingestão↔Triagem) — consolida modules/ingestao/src/infra/migrations
-- 001_edital_anexos + 002_add_estado_confianca_anexo + 005_edital_anexos_sequencial_documento
-- + 006_edital_anexos_tipo_texto_paginas. Chave natural é sequencial_documento (RAD-291), não nome.
CREATE TABLE IF NOT EXISTS edital_anexos (
  edital_id            TEXT        NOT NULL REFERENCES editais(id) ON DELETE CASCADE,
  sequencial_documento INTEGER     NOT NULL,
  nome                 TEXT        NOT NULL,
  storage_key          TEXT        NOT NULL,
  tipo_mime            TEXT        NOT NULL,
  tamanho_bytes        BIGINT      NOT NULL,
  tipo_documento_id    INTEGER     NOT NULL,
  tipo_documento_nome  TEXT        NOT NULL,
  texto_key            TEXT        NOT NULL,
  paginas              INTEGER     NOT NULL,
  estado_confianca     TEXT        NOT NULL DEFAULT 'pendente'
    CHECK (estado_confianca IN ('pendente', 'limpo', 'rejeitado')),
  criado_em            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (edital_id, sequencial_documento)
);

CREATE INDEX IF NOT EXISTS edital_anexos_estado_idx ON edital_anexos (edital_id, estado_confianca);

-- ---------------------------------------------------------------------------
-- Cobrança & Assinatura (P-107) — modules/cobranca/src/infra/migrations/001_assinatura_registro_uso.sql
-- ---------------------------------------------------------------------------

-- uso_reservado é o GATE (UPDATE atômico na borda, P-107 (3)); uso_confirmado é a
-- FATURA (RAD-247). Os dois vivem na mesma linha por design — espalhar cota e uso
-- por tabelas diferentes reintroduz a race que a reserva existe para fechar.
CREATE TABLE IF NOT EXISTS assinatura (
  tenant_id             TEXT        PRIMARY KEY,
  status                TEXT        NOT NULL,
  plano_codigo          TEXT        NOT NULL,
  cota_triagens_mes     INTEGER     NOT NULL,
  preco_centavos        INTEGER     NOT NULL,
  uso_reservado         INTEGER     NOT NULL DEFAULT 0,
  uso_confirmado        INTEGER     NOT NULL DEFAULT 0,
  periodo_inicio        DATE        NOT NULL,
  periodo_fim           DATE        NOT NULL,
  assinatura_externa_id TEXT,
  CONSTRAINT assinatura_uso_reservado_nao_negativo CHECK (uso_reservado >= 0),
  CONSTRAINT assinatura_uso_confirmado_nao_negativo CHECK (uso_confirmado >= 0),
  CONSTRAINT assinatura_uso_reservado_cabe_na_cota CHECK (uso_reservado <= cota_triagens_mes)
);

CREATE TABLE IF NOT EXISTS registro_uso (
  id                BIGSERIAL   PRIMARY KEY,
  tenant_id         TEXT        NOT NULL,
  cliente_final_id  TEXT        NOT NULL,
  edital_id         TEXT        NOT NULL,
  perfil_id         TEXT        NOT NULL,
  periodo           TEXT        NOT NULL,
  confirmado_em     TIMESTAMPTZ NOT NULL,
  CONSTRAINT registro_uso_chave_natural
    UNIQUE (tenant_id, cliente_final_id, edital_id, perfil_id, periodo)
);
