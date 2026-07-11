# Comportamento: Roteamento de notificação por preferência de frequência
# UsoCaso: NotificarAlertaUseCase + EnviarDigestUseCase (arquitetura/14 §§2-3)
# Regra: preferência IMEDIATA → entrega individual; DIÁRIA/SEMANAL/null → digest
# Anti-fadiga: digest não re-notifica alertas críticos já entregues (P-81, docs/11 §4)

Feature: Roteamento de notificação por preferência de frequência

  A preferência de frequência do usuário determina como alertas não-críticos
  são entregues. Usuários IMEDIATA recebem cada alerta individualmente no ato.
  Usuários DIÁRIA, SEMANAL ou sem preferência recebem um digest consolidado.
  O digest exclui automaticamente alertas já entregues (críticos ou não).

  Scenario: Preferência IMEDIATA entrega alerta individual mesmo sem urgência
    Given um usuário "usuario-freq-01" com preferência "IMEDIATA"
    And um alerta com diasAtePrazo 30 e aderência 0.5
    When o sistema processa a notificação do alerta
    Then uma notificação deve ter sido enviada imediatamente

  Scenario: Preferência DIÁRIA não entrega alerta individual não-crítico
    Given um usuário "usuario-freq-02" com preferência "DIARIA"
    And um alerta com diasAtePrazo 30 e aderência 0.5
    When o sistema processa a notificação do alerta
    Then nenhuma notificação deve ter sido enviada neste ciclo

  Scenario: Digest agrupa alertas pendentes para usuário com preferência DIÁRIA
    Given um usuário "usuario-freq-03" com preferência "DIARIA"
    And 2 alertas pendentes para o usuário
    When o scheduler dispara o envio do digest
    Then o digest deve ter sido enviado com 2 alertas
    And o evento "notificacao.enviada" deve ter sido publicado

  Scenario: Digest não processa usuário com preferência IMEDIATA
    Given um usuário "usuario-freq-04" com preferência "IMEDIATA"
    And 2 alertas pendentes para o usuário
    When o scheduler dispara o envio do digest
    Then nenhuma notificação deve ter sido enviada neste ciclo
