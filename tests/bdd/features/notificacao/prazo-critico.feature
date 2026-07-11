# Comportamento: Entrega imediata de alertas com prazo crítico ou alta aderência
# UsoCaso: NotificarAlertaUseCase (arquitetura/14, A04 §6)
# Invariante: zero alerta de prazo crítico perdido — regra dura (docs/07 §6, A04 §6)
# Criticidade: urgente quando diasAtePrazo ≤ 3 OU aderência ≥ 0,8 (P-81, docs/11 §4)

Feature: Notificação imediata de alerta com prazo crítico

  Um alerta é CRÍTICO quando o prazo da proposta está em até 3 dias corridos
  OU quando a aderência ao critério do cliente é ≥ 0,8.
  Alertas críticos são sempre entregues imediatamente — nunca aguardam o
  ciclo de digest — independentemente da preferência de frequência do usuário.

  Regra dura (docs/07 §6 / A04 §6): zero alerta de prazo crítico perdido.

  Scenario: Prazo em 3 dias entrega imediatamente mesmo com preferência DIÁRIA
    Given um usuário "usuario-prazo-01" com preferência "DIARIA"
    And um alerta com diasAtePrazo 3 e aderência 0.6
    When o sistema processa a notificação do alerta
    Then uma notificação deve ter sido enviada imediatamente
    And o evento "notificacao.enviada" deve ter sido publicado

  Scenario: Prazo em 1 dia entrega imediatamente mesmo sem preferência cadastrada
    Given um usuário "usuario-prazo-02" sem preferência cadastrada
    And um alerta com diasAtePrazo 1 e aderência 0.5
    When o sistema processa a notificação do alerta
    Then uma notificação deve ter sido enviada imediatamente

  Scenario: Alta aderência com prazo distante também entrega imediatamente
    Given um usuário "usuario-prazo-03" com preferência "DIARIA"
    And um alerta com diasAtePrazo 30 e aderência 0.9
    When o sistema processa a notificação do alerta
    Then uma notificação deve ter sido enviada imediatamente

  Scenario: Alerta normal aguarda digest — prazo distante e aderência baixa
    Given um usuário "usuario-prazo-04" com preferência "DIARIA"
    And um alerta com diasAtePrazo 10 e aderência 0.5
    When o sistema processa a notificação do alerta
    Then nenhuma notificação deve ter sido enviada neste ciclo
