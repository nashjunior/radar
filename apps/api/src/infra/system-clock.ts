/**
 * Relógio do sistema — implementação compartilhada de `ClockProvider`/`agora(): Date`
 * (contrato idêntico em `@radar/matching` e `@radar/cobranca`). Injetável nos use
 * cases só para testabilidade; nenhum use case chama `new Date()` diretamente.
 */
export const systemClock = { agora: () => new Date() };
