# Comportamento: Gate de entitlement — reserva síncrona atômica de cota (P-107 (3))
# UsoCaso: ReservarCotaUseCase, LiberarReservaUseCase (RAD-246)
#
# A reserva é o GATE, `triagem.concluida` é a FATURA — o evento chega
# segundos-a-minutos depois (worker assíncrono), então o gate não pode esperar
# por ele. O enforcement é um único UPDATE atômico no PostgreSQL real (sem
# read-modify-write); os cenários abaixo rodam contra Postgres via Testcontainers
# para provar a atomicidade sob concorrência, não só a orquestração em memória.

Feature: Gate de entitlement de Cobrança & Assinatura

  Background:
    Given um repositório de assinaturas no PostgreSQL

  Scenario: Reserva concedida quando a cota comporta
    Given uma assinatura ativa do tenant "tenant-cota-livre" com cota 5 e uso reservado 0
    When o sistema reserva a cota do tenant "tenant-cota-livre"
    Then a reserva deve ser concedida
    And o uso reservado do tenant "tenant-cota-livre" deve ser 1

  Scenario: Cota esgotada — reserva lança CotaExcedidaError (402 na borda)
    Given uma assinatura ativa do tenant "tenant-cota-esgotada" com cota 1 e uso reservado 1
    When o sistema tenta reservar a cota do tenant "tenant-cota-esgotada"
    Then a operação deve lançar CotaExcedidaError com cota 1 e usado 1

  Scenario: Assinatura suspensa — reserva lança AssinaturaInativaError (403 na borda)
    Given uma assinatura suspensa do tenant "tenant-suspenso" com cota 5 e uso reservado 0
    When o sistema tenta reservar a cota do tenant "tenant-suspenso"
    Then a operação deve lançar AssinaturaInativaError

  Scenario: Assinatura inexistente — reserva lança AssinaturaNaoEncontradaError (403 na borda)
    When o sistema tenta reservar a cota do tenant "tenant-nao-cadastrado"
    Then a operação deve lançar AssinaturaNaoEncontradaError

  Scenario: Liberação de reserva nunca deixa o uso reservado negativo
    Given uma assinatura ativa do tenant "tenant-liberar" com cota 5 e uso reservado 0
    When o sistema libera a reserva do tenant "tenant-liberar"
    Then o uso reservado do tenant "tenant-liberar" deve ser 0

  Scenario: Concorrência real no Postgres — N requisições paralelas com cota 1 concedem exatamente 1
    Given uma assinatura ativa do tenant "tenant-concorrencia-pg" com cota 1 e uso reservado 0
    When 20 requisições paralelas tentam reservar a cota do tenant "tenant-concorrencia-pg"
    Then exatamente 1 requisição deve ter sido concedida
    And exatamente 19 requisições devem ter recebido CotaExcedidaError
    And o uso reservado do tenant "tenant-concorrencia-pg" deve ser 1
