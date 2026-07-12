-- Núcleo do contexto Cobrança & Assinatura (P-107, docs/13 §§2/3/4; docs/12 ERD).
-- Criado por: RAD-245.
--
-- ASSINATURA é o agregado raiz, chaveado por tenant_id (um plano por Tenant no MVP,
-- P-25 é Next) — uso_reservado é o *gate* (UPDATE atômico na borda antes de publicar
-- triagem.solicitada, P-107 (3)) e uso_confirmado é a *fatura* (RAD-247, consumidor de
-- triagem.concluida). Os dois vivem na MESMA linha por design: espalhar cota e uso por
-- tabelas diferentes reintroduz a race que a reserva existe para fechar.
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

-- REGISTRO_USO só nasce CONFIRMADO (nunca representa a reserva). UNIQUE pela chave
-- natural + período é o índice que impede double-billing (P-107 (4)): o consumidor de
-- triagem.concluida faz INSERT ... ON CONFLICT (essa constraint) DO NOTHING, e 0 linhas
-- inseridas encerra com sucesso sem mexer no agregado.
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

-- Consulta por tenant/período (fatura, relatório de uso do ciclo).
CREATE INDEX IF NOT EXISTS idx_registro_uso_tenant_periodo
  ON registro_uso (tenant_id, periodo);
