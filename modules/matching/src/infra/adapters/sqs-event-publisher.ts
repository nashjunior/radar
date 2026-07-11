/**
 * `QueueClient`/`SqsEventPublisher` (genérico, propaga `AbortSignal` até o último hop — P-78,
 * arq/10 §10) vivem em `@radar/kernel` (RAD-194); mesma implementação usada por
 * notificação/triagem. Re-exportado deste caminho para não mudar os call sites existentes
 * (`composicao.ts`, testes).
 */
export { SqsEventPublisher } from '@radar/kernel';
export type { QueueClient } from '@radar/kernel';
