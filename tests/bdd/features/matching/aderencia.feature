# Comportamento: Aderência e Postura Recall-Alto do Matching
# UsoCaso: CasarEditalComCriteriosUseCase (docs/14 §2)
# Invariante: recall-alto — melhor um alerta a mais que perder edital relevante (docs/11 §2)
# Limiar de aderência: 0.3 (superaLimiar); alerta gerado para todo edital acima do limiar

Feature: Aderência e postura recall-alto no casamento de editais

  O motor de matching cruza editais × critérios com **postura recall-alto**:
  gera alerta para todo edital com aderência ≥ 0,3 ao critério do cliente.
  É preferível um alerta a mais a deixar passar um edital relevante.

  Background:
    Given um repositório de critérios no PostgreSQL
    And um repositório de alertas no PostgreSQL
    And um publicador de eventos em memória

  Scenario: Edital acima do limiar de aderência gera alerta
    Given um critério de monitoramento com palavras-chave "software ti"
    And um edital com objeto "Aquisição de software de gestão de TI"
    When o sistema executa o casamento do edital com os critérios
    Then um alerta deve ter sido gerado para o critério
    And o alerta deve ter sido persistido no repositório
    And o evento "alerta.gerado" deve ter sido publicado

  Scenario: Edital abaixo do limiar de aderência não gera alerta
    Given um critério de monitoramento com palavras-chave "software ti"
    And um edital com objeto "Construção de ponte sobre o rio Tietê"
    When o sistema executa o casamento do edital com os critérios
    Then nenhum alerta deve ter sido gerado
    And nenhum evento deve ter sido publicado

  Scenario: Múltiplos critérios — cada um avaliado independentemente
    Given dois critérios de monitoramento:
      | clienteFinalId | palavrasChave       |
      | cliente-A      | software ti         |
      | cliente-B      | construção obras    |
    And um edital com objeto "Aquisição de software de gestão de TI"
    When o sistema executa o casamento do edital com os critérios
    Then somente o critério do cliente-A deve ter gerado alerta

  Scenario: Isolamento multi-tenant — critérios de tenants diferentes não se misturam
    Given um critério do tenant "tenant-alpha" com palavras-chave "software ti"
    And um critério do tenant "tenant-beta" com palavras-chave "consultoria"
    And um edital com objeto "Serviços de consultoria empresarial"
    When o sistema executa o casamento do edital com os critérios
    Then somente o critério do tenant "tenant-beta" deve ter gerado alerta
    And o alerta do tenant "tenant-beta" não contém dados do tenant "tenant-alpha"
