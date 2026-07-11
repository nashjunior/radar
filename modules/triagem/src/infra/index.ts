export {
  AnthropicLlmGateway,
  CATEGORIAS,
  FERRAMENTA_EXTRACAO,
  INSTRUCAO_EXTRACAO,
  SEVERIDADES,
  interpretarSaidaExtracao,
  montarRequisicaoExtracao,
} from './adapters/anthropic-llm-gateway.js';
export type { LlmClient, LlmExtracaoRequest } from './adapters/anthropic-llm-gateway.js';
export {
  FERRAMENTA_SCHEMA,
  MAX_TOKENS_EXTRACAO,
  extrairToolInput,
  paramsExtracao,
} from './adapters/anthropic-extracao-schema.js';
export type {
  ExtracaoMessageParams,
  MensagemComConteudo,
} from './adapters/anthropic-extracao-schema.js';
export { AnthropicSdkClient, thinkingExtracao } from './adapters/anthropic-sdk-client.js';
export type {
  AnthropicSdkClientOpts,
  ExtracaoStreamParams,
  LlmClientLogger,
  MensagemFinal,
  MessagesClient,
  ThinkingConfig,
} from './adapters/anthropic-sdk-client.js';
export {
  RecordReplayLlmClient,
  FixtureDeGoldSetAusenteError,
  chavePorConteudo,
} from './adapters/record-replay-llm-client.js';
export type { ChaveCaso, RecordReplayLlmClientOpts } from './adapters/record-replay-llm-client.js';
export { AnthropicBatchLlmGateway } from './adapters/anthropic-batch-llm-gateway.js';
export type {
  AnthropicBatchLlmGatewayOpts,
  BatchHandle,
  BatchRequestItem,
  BatchResultItem,
  MessageBatchesClient,
} from './adapters/anthropic-batch-llm-gateway.js';
export { paraHttpStatus } from './adapters/error-mapping.js';
export { PerfilHabilitacaoAdapter } from './adapters/perfil-habilitacao-adapter.js';
export type { PerfilSource, PerfilSourceData } from './adapters/perfil-habilitacao-adapter.js';
export { PostgresExtracaoRepository } from './adapters/postgres-extracao-repository.js';
export { PostgresTriagemRepository } from './adapters/postgres-triagem-repository.js';
export { S3ObjectStorage } from './adapters/s3-object-storage.js';
export { SqsEventPublisher } from './adapters/sqs-event-publisher.js';
export { TriagemBatchWorker } from './queue/triagem-batch-worker.js';
export type {
  EditalIngeridoMsg as TriagemEditalIngeridoMsg,
  TriagemBatchWorkerOpts,
} from './queue/triagem-batch-worker.js';
// Red-team de injeção de prompt (P-72 / A11 §4). Corpus + harness reusados pelo runner de eval
// `tests/eval` (@radar/eval, P-85/RAD-157) — mesmo caminho boundary-clean do RecordReplayLlmClient.
export {
  CORPUS_ADVERSARIAL,
  CANARIO_CLASSE_CRITICA,
  INVARIANTES_RED_TEAM,
  avaliarCasoAdversarial,
  avaliarCorpus,
} from './red-team/corpus-injecao.js';
export type {
  CampoCritico,
  CasoAdversarial,
  CategoriaInjecao,
  DefesaEsperada,
  VeredictoRedTeam,
} from './red-team/corpus-injecao.js';
