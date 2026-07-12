import { DomainError } from '@radar/kernel';

/**
 * Catálogo de erros do contexto Análise & Triagem (A17 §3.2).
 * Todo `code` é estável e mapeado para HTTP/gRPC na borda (A17 §5.3, A10 §6).
 * `AcessoNegadoError` (IDOR/cross-tenant) vem do Shared Kernel `@radar/kernel` (P-51).
 */

export class ConfiancaInvalidaError extends DomainError {
  readonly code = 'CONFIANCA_INVALIDA' as const;
  constructor(valor: number) {
    super(`confiança fora de [0,1]: ${valor}`);
  }
}

/** Extração abaixo do limiar → degradar para leitura assistida (docs/10 §6). Borda: 422. */
export class ConfiancaInsuficienteError extends DomainError {
  readonly code = 'CONFIANCA_INSUFICIENTE' as const;
  constructor() {
    super('extração abaixo do limiar de confiança — degradar para leitura assistida');
  }
}

export class AderenciaInvalidaError extends DomainError {
  readonly code = 'ADERENCIA_INVALIDA' as const;
  constructor(valor: number) {
    super(`aderência fora de [0,1]: ${valor}`);
  }
}

export class CitacaoInvalidaError extends DomainError {
  readonly code = 'CITACAO_INVALIDA' as const;
  constructor() {
    super('citação requer página válida e trecho não-vazio');
  }
}

export class RequisitoInvalidoError extends DomainError {
  readonly code = 'REQUISITO_INVALIDO' as const;
  constructor() {
    super('requisito requer descrição não-vazia');
  }
}

/** OCR falhou / PDF-imagem ilegível (docs/10 §6). Não inventar conteúdo. Borda: 422. */
export class OcrFalhouError extends DomainError {
  readonly code = 'OCR_FALHOU' as const;
  constructor() {
    super('OCR falhou — marcar "requer leitura manual"');
  }
}

/**
 * O anexo do edital ainda não saiu da quarentena (P-104/AB14) — distinto de `OcrFalhouError`: aqui
 * não houve extração real ainda, então NÃO é falha de OCR (P-110/RAD-281). Lançado só dentro de
 * `TriarEditalUseCase`, que trata este erro como "aguardar", não como falha terminal: nunca publica
 * `triagem.falhou` (a reserva de cota de P-107 (c) continua ativa) e a `Triagem` permanece
 * `processando` — `ReenfileirarTriagensPendentesUseCase` reenfileira quando a Ingestão liberar o
 * anexo (evento `anexo.aprovado`) ou falha explicitamente se nenhum anexo puder ficar limpo (evento
 * `anexo.rejeitado` com `restamPendentes: false`). Nunca alcança a borda HTTP (engolido pelo worker
 * de `triagem.solicitada`), mas mantém `code` estável pela mesma convenção do catálogo.
 */
export class AguardandoAnexoError extends DomainError {
  readonly code = 'TRIAGEM_AGUARDANDO_ANEXO' as const;
  constructor() {
    super('anexo do edital ainda em quarentena — aguardando disponibilidade, não é falha de OCR');
  }
}

/**
 * Saída do LLM não bate no schema (A11 §2, camada 3) — cobre também o truncamento por `max_tokens`
 * (RAD-243): tool_use incompleto não é confiável, nunca "consertado". `usoParcial` (RAD-243 GAP)
 * é preenchido só no caminho de truncamento — ali os tokens já foram gastos antes do lançamento;
 * as demais rejeições de schema (camada 3, após retorno bem-sucedido do client) não o preenchem —
 * fora do escopo desta issue (não citado no GAP original), registrado como lacuna conhecida.
 * A saída do modelo é NÃO-confiável. Borda: 502.
 */
export class SaidaLlmInvalidaError extends DomainError {
  readonly code = 'SAIDA_LLM_INVALIDA' as const;
  constructor(
    motivo: string,
    readonly usoParcial?: UsoParcialLlm,
  ) {
    super(`saída do LLM rejeitada pelo schema: ${motivo}`);
  }
}

/**
 * Consumo de tokens JÁ GASTO no momento em que um erro de extração é lançado (RAD-243, GAP de
 * RAD-230/P-20/P-38): recusa e truncamento lançam de dentro de `AnthropicSdkClient` ANTES de
 * devolver `uso` ao caller normalmente — sem isto o custo real desses dois caminhos não entra no
 * ledger. Forma estrutural idêntica a `UsoLlm` (`application/ports.ts`) — sem import cross-layer:
 * o domínio não depende da application (A10 §8).
 */
export interface UsoParcialLlm {
  readonly modelo: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadInputTokens: number;
  readonly cacheCreationInputTokens: number;
}

/**
 * O modelo RECUSOU a extração (`stop_reason: "refusal"` — classificador de segurança ou recusa do
 * próprio modelo). Em recusa o `content` vem vazio/parcial: NUNCA fabricar extração — degradar para
 * leitura manual, como no OCR que falha (docs/10 §6). Distinto de `SaidaLlmInvalidaError` (schema
 * inválido = falha do provedor, 502): a recusa não é lixo, é o modelo declinando. Borda: 422.
 */
export class ExtracaoRecusadaError extends DomainError {
  readonly code = 'EXTRACAO_RECUSADA' as const;
  constructor(readonly usoParcial?: UsoParcialLlm) {
    super('modelo recusou a extração — marcar "requer leitura manual"');
  }
}

/**
 * Transporte de extração em LOTE indisponível (A17 §7, RAD-54): o poll do batch não concluiu no teto
 * de verificações, ou a operação foi abortada (P-78). Falha de transporte, não de conteúdo — o lote é
 * assíncrono e retryável (P-45). Borda: 503.
 */
export class LoteExtracaoIndisponivelError extends DomainError {
  readonly code = 'LOTE_EXTRACAO_INDISPONIVEL' as const;
  constructor(motivo: string) {
    super(`extração em lote indisponível: ${motivo}`);
  }
}

/** Perfil de habilitação não encontrado (erro de orquestração — A10 §6). Borda: 404. */
export class PerfilNaoEncontradoError extends DomainError {
  readonly code = 'PERFIL_NAO_ENCONTRADO' as const;
  constructor(id: string) {
    super(`perfil de habilitação não encontrado: ${id}`);
  }
}

/** Triagem não encontrada para o par edital+perfil — feedback solicitado antes da triagem existir. Borda: 404. */
export class TriagemNaoEncontradaError extends DomainError {
  readonly code = 'TRIAGEM_NAO_ENCONTRADA' as const;
  constructor(editalId: string, perfilId: string) {
    super(`Triagem não encontrada: editalId=${editalId}, perfilId=${perfilId}`);
  }
}

/** Registro de uso de LLM com campo negativo/ausente (RAD-230, P-20/P-38) — bug de contabilização, nunca condição esperada. */
export class UsoLlmInvalidoError extends DomainError {
  readonly code = 'USO_LLM_INVALIDO' as const;
  constructor(motivo: string) {
    super(`registro de uso de LLM inválido: ${motivo}`);
  }
}

/**
 * Admission control (RAD-243, P-20/P-38): a entrada mede, via `count_tokens` (grátis, RPM próprio —
 * sem custo de billing), mais tokens que o teto de sanidade contra outliers (OCR corrompido, texto
 * degenerado) — ANTES de chamar o modelo, zero custo gasto. Não é o orçamento de negócio (esse é
 * `OrcamentoDeCustoExcedidoError`): este teto é técnico, não financeiro. Borda: 422 (mesma família
 * de "não processar", como `OcrFalhouError`).
 */
export class EntradaExcedeTetoDeAdmissaoError extends DomainError {
  readonly code = 'ENTRADA_EXCEDE_TETO_DE_ADMISSAO' as const;
  constructor(
    readonly inputTokens: number,
    readonly teto: number,
  ) {
    super(`entrada com ${inputTokens} tokens de input excede o teto de admissão (${teto}) — provável outlier`);
  }
}

/**
 * Kill-switch de orçamento acumulado por janela (RAD-243, P-20/P-38, veredicto RAD-227): o gasto
 * já realizado na janela + o custo ESTIMADO desta chamada (pior caso de output) excederia o teto
 * (global, por tenant, ou do coorte trial — RAD-271, P-109 L1). Lançado ANTES de chamar o modelo —
 * zero custo adicional gasto. O NÚMERO do orçamento é `[A VALIDAR]` (Negócio+Eng, docs/98 P-20); o
 * mecanismo não espera por ele (`PoliticaOrcamento` injetável, default sem teto —
 * `politica-orcamento.ts`). Borda: 429 (mesma semântica de "tente depois" do rate-limit — não é
 * erro do chamador). `escopo: 'trial'` barra SÓ tenants em trial — o pagante nunca é barrado por
 * consumo do coorte trial (bulkhead, A04 §6).
 */
export class OrcamentoDeCustoExcedidoError extends DomainError {
  readonly code = 'ORCAMENTO_DE_CUSTO_EXCEDIDO' as const;
  constructor(readonly escopo: 'global' | 'tenant' | 'trial') {
    super(`orçamento de custo de IA excedido (${escopo}) — kill-switch acionado (P-20/P-38)`);
  }
}
