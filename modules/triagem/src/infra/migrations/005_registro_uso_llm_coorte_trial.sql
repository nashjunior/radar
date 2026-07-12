-- Bulkhead de orçamento do coorte trial (RAD-271, P-109 L1) — dimensão nova na consulta que já
-- existe (UsoLlmLedger.gastoUsdNaJanela), não teto novo por tenant: um Sybil com N contas trial que
-- escolha editais frios não pode estourar o orçamento GLOBAL e derrubar a IA dos clientes pagantes
-- (A04 §6, bulkhead P-41).
--
-- `coorte_trial` é gravado no INSERT (RegistroUsoLlm.criar, TriarEditalUseCase.registrarUso) a
-- partir do estado da assinatura NO MOMENTO da solicitação (resolvido no BFF, RAD-271) — a Triagem
-- nunca lê a tabela `assinatura` da Cobrança por JOIN cross-contexto (P-96, ACL). Sempre `false` na
-- pré-extração global (ExtrairEditalUseCase/ExtrairEditaisEmLoteUseCase, P-45): sem tenant não há
-- coorte a classificar.

ALTER TABLE registro_uso_llm
  ADD COLUMN IF NOT EXISTS coorte_trial BOOLEAN NOT NULL DEFAULT false;

-- Orçamento acumulado do COORTE TRIAL por janela (RAD-271) — parcial (WHERE coorte_trial) porque a
-- maioria das linhas não é do trial; mesmo padrão de idx_registro_uso_llm_tenant_janela (migração 003).
CREATE INDEX IF NOT EXISTS idx_registro_uso_llm_coorte_trial_janela
  ON registro_uso_llm (ocorrido_em)
  WHERE coorte_trial = true;
