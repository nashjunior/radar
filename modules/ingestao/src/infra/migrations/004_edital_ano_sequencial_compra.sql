-- Adiciona ano_compra/sequencial_compra a EDITAL — chave (com orgao_cnpj) dos endpoints de
-- detalhe/arquivos do PNCP (GET /v1/orgaos/{cnpj}/compras/{ano}/{sequencial}[/arquivos]).
-- Contrato confirmado contra o OpenAPI oficial (2026-07-11): ambos os campos são retornados
-- pelas listagens (/publicacao, /atualizacao) como inteiros de topo, junto de
-- numeroControlePNCP. NÃO derivar de numeroControlePNCP em runtime — formato irregular
-- (ex.: "80881915000192-1-000044/2026", com o segundo segmento sendo
-- tipoInstrumentoConvocatorioCodigo, não o sequencial).
-- Criado por: RAD-198.
--
-- NULLABLE nesta migração (não NOT NULL): tabela pode já ter linhas de antes deste contrato
-- corrigido, sem esses campos preenchidos. O domínio (Edital.criar) trata os dois como
-- obrigatórios para toda escrita NOVA (ingestão/reconciliação sempre os carrega da API); uma
-- migração futura de NOT NULL faz sentido só depois que uma reconciliação completa os
-- backfilar. Hoje não há Postgres de ingestão provisionado em produção (P-106,
-- arquitetura/10 §1) — sem dado legado real a proteger ainda.

ALTER TABLE editais
  ADD COLUMN IF NOT EXISTS ano_compra INT,
  ADD COLUMN IF NOT EXISTS sequencial_compra INT;
