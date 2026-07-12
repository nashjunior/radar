-- Núcleo do contexto Identidade & Organização (docs/13 §3; docs/14 §6; RAD-285).
-- Criado por: RAD-285.
--
-- TENANT é o agregado raiz do provisionamento self-signup (P-109 L3) — unicidade
-- 1 CNPJ = 1 tenant é higiene de cadastro, NÃO defesa anti-Sybil (P-109): barra o
-- CNPJ falso, não o múltiplo real. `id` é gerado pelo TenantIdProvider (UUID), nunca
-- pelo banco — mesmo padrão de PerfilId/CriterioId nos demais contextos.
CREATE TABLE IF NOT EXISTS tenant (
  id            TEXT        PRIMARY KEY,
  cnpj          TEXT        NOT NULL UNIQUE,
  razao_social  TEXT        NOT NULL,
  criado_em     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ATRIBUICAO_PAPEL é raiz própria (P-52, docs/13 §3) — identidade é o `sub`
-- verificado do IdP (Cognito), NUNCA gerado aqui. UNIQUE(sub) é o que torna
-- `ProvisionarOrganizacaoUseCase` idempotente sob concorrência: duas requisições
-- simultâneas do mesmo `sub` só uma insere, a outra recebe UsuarioJaVinculadoError
-- e recupera a organização já criada (ON CONFLICT DO NOTHING no adapter).
CREATE TABLE IF NOT EXISTS atribuicao_papel (
  sub                 TEXT        PRIMARY KEY,
  tenant_id           TEXT        NOT NULL REFERENCES tenant (id),
  papel               TEXT        NOT NULL,
  cliente_final_ids   TEXT[]      NOT NULL DEFAULT '{}',
  criado_em           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Resolução por tenant (RBAC/troca de papel em lote, consultas administrativas futuras).
CREATE INDEX IF NOT EXISTS idx_atribuicao_papel_tenant
  ON atribuicao_papel (tenant_id);
