# Comportamento: Idempotência da Ingestão por numeroControlePNCP
# UsoCaso: IngerirEditaisUseCase (docs/14 §1)
# Invariante: upsert idempotente por numeroControlePNCP — retry seguro (A02, §3)
# Lei 14.133/2021, art. 174

Feature: Idempotência da ingestão de editais do PNCP

  A ingestão do PNCP deve ser **idempotente** por `numeroControlePNCP`.
  Reingerir o mesmo edital (retry, reprocessamento ou reconciliação) deve
  atualizar o registro existente — nunca criar uma duplicata.
  O edital é identificado unicamente pelo seu `numeroControlePNCP`.

  Background:
    Given um gateway PNCP configurado com dados sintéticos
    And um repositório de editais no PostgreSQL
    And um publicador de eventos em memória

  Scenario: Ingerir edital pela primeira vez
    Given o gateway retorna um edital com numeroControlePNCP "00394502000167-1-000001/2024"
    And o repositório não possui edital com esse número de controle
    When o sistema executa a ingestão para a modalidade 6 na janela de 2024-01-01 a 2024-01-31
    Then o repositório deve conter 1 edital persistido
    And o evento "edital.ingerido" deve ter sido publicado 1 vez
    And o resumo de ingestão deve reportar 1 edital ingerido e 0 atualizados

  Scenario: Reingerir o mesmo edital (idempotência)
    Given o gateway retorna um edital com numeroControlePNCP "00394502000167-1-000001/2024"
    And o repositório já possui um edital com esse número de controle
    When o sistema executa a ingestão para a modalidade 6 na janela de 2024-01-01 a 2024-01-31
    Then o repositório deve ter recebido 1 chamada de upsert (não duplicação)
    And o evento "edital.ingerido" deve ter sido publicado 1 vez
    And o resumo de ingestão deve reportar 0 editais ingeridos e 1 atualizado

  Scenario: Ingerir múltiplos editais em lote
    Given o gateway retorna 2 editais com números de controle distintos
    And o repositório não possui nenhum desses editais
    When o sistema executa a ingestão para a modalidade 6 na janela de 2024-01-01 a 2024-01-31
    Then o repositório deve conter 2 editais persistidos
    And o evento "edital.ingerido" deve ter sido publicado 2 vezes
    And o resumo de ingestão deve reportar 2 editais ingeridos e 0 atualizados

  Scenario: Erro não-fatal não interrompe o lote
    Given o gateway retorna 2 editais
    And o repositório falha temporariamente no primeiro edital
    When o sistema executa a ingestão para a modalidade 6 na janela de 2024-01-01 a 2024-01-31
    Then o resumo de ingestão deve reportar 1 erro e 1 edital ingerido

  Scenario: AbortSignal cancela a ingestão antes de processar
    Given o gateway retorna um edital com numeroControlePNCP "00394502000167-1-000001/2024"
    And o repositório não possui edital com esse número de controle
    When o sistema executa a ingestão com um AbortSignal já cancelado
    Then nenhum edital deve ter sido persistido
