-- Tabela parametrizável e datada de faixas de valor de referência (docs/02 §2; docs/04 §4).
-- Nunca usar enum ou constante no código — configuração de negócio.

CREATE TABLE IF NOT EXISTS faixa_valor_referencia (
  codigo      TEXT        PRIMARY KEY,
  min         NUMERIC,
  max         NUMERIC,
  vigente_de  TIMESTAMPTZ NOT NULL,
  vigente_ate TIMESTAMPTZ,
  CONSTRAINT faixa_valor_referencia_vigencia_check CHECK (vigente_ate IS NULL OR vigente_ate > vigente_de)
);

-- Seed inicial conforme categorias da Lei 14.133/2021 (valores em R$).
-- Fonte: limites de modalidade definidos nos arts. 75 e 76 da Lei 14.133/2021.
INSERT INTO faixa_valor_referencia (codigo, min, max, vigente_de) VALUES
  ('MICRO_COMPRA',         NULL,           100000.00, '2021-04-01T00:00:00Z'),
  ('DISPENSA_OBRAS',       100000.00,      500000.00, '2021-04-01T00:00:00Z'),
  ('DISPENSA_SERVICOS',    NULL,            50000.00, '2021-04-01T00:00:00Z'),
  ('CONVITE',              50000.00,       250000.00, '2021-04-01T00:00:00Z'),
  ('TOMADA_PRECOS_OBRAS',  500000.00,     3300000.00, '2021-04-01T00:00:00Z'),
  ('TOMADA_PRECOS_SERV',   250000.00,     1430000.00, '2021-04-01T00:00:00Z'),
  ('CONCORRENCIA_OBRAS',  3300000.00,          NULL, '2021-04-01T00:00:00Z'),
  ('CONCORRENCIA_SERV',   1430000.00,          NULL, '2021-04-01T00:00:00Z')
ON CONFLICT (codigo) DO NOTHING;
