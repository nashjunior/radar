# Comportamento: Decisão de Triagem — go/no-go, confiança insuficiente, IDOR
# UsoCaso: TriarEditalUseCase, ConsultarTriagemUseCase (docs/14 §3)

Feature: Decisão de triagem de editais (go/no-go)

  A triagem avalia aderência e risco de um edital para o perfil do cliente,
  sugerindo go/no-go. A **decisão final é sempre do usuário** (docs/14 §3).
  Quando a confiança da IA está abaixo do limiar, o sistema encaminha para
  **leitura assistida** em vez de decidir automaticamente (docs/10 §6).
  Autorização por objeto (IDOR): somente o dono do perfil acessa a triagem.

  Background:
    Given um repositório de triagens em memória
    And um gateway de LLM configurado com stub sintético
    And um repositório de extração de edital em memória

  Scenario: Triagem com confiança da IA suficiente — retorna recomendação go/no-go
    Given um edital com objeto "Aquisição de software de TI" disponível para triagem
    And um perfil de habilitação do cliente "cliente-A" com CNAE "62.01"
    And o LLM retorna confiança 0.92 com recomendação "go"
    When o sistema executa a triagem do edital para o perfil do cliente "cliente-A"
    Then a triagem deve retornar recomendação "go"
    And a confiança deve ser igual a 0.92
    And o evento "triagem.concluida" deve ter sido publicado

  Scenario: Triagem com confiança insuficiente — encaminha para leitura assistida
    Given um edital com objeto "Obras de pavimentação" disponível para triagem
    And um perfil de habilitação do cliente "cliente-A" com CNAE "62.01"
    And o LLM retorna confiança 0.45 abaixo do limiar configurado
    When o sistema executa a triagem do edital para o perfil do cliente "cliente-A"
    Then a triagem deve lançar ConfiancaInsuficienteError
    And o resultado não deve conter recomendação definitiva

  Scenario: Autorização por objeto (IDOR) — cliente não pode acessar triagem de outro cliente
    Given uma triagem existente pertencente ao cliente "cliente-A"
    And uma solicitação de triagem feita pelo cliente "cliente-B"
    When o sistema tenta retornar a triagem para o cliente "cliente-B"
    Then a operação deve lançar AcessoNegadoError
    And nenhuma informação do cliente "cliente-A" deve ser exposta

  Scenario: Extração do edital é cacheada — segunda triagem reutiliza a extração
    Given um edital já triado uma vez para o perfil "perfil-001"
    When uma segunda triagem é solicitada para o mesmo edital e mesmo perfil
    Then o gateway LLM não deve ser chamado novamente para extração
    And a triagem deve retornar em menos tempo que a primeira chamada
