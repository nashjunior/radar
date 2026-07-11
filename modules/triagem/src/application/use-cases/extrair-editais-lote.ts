import type { EditalId } from '@radar/kernel';
import { avaliarElegibilidadeExtracao } from '../../domain/elegibilidade-extracao.js';
import { RegistroUsoLlm } from '../../domain/registro-uso-llm.js';
import type { EntradaExtracaoDTO } from '../dtos.js';
import { calcularCustoUsd } from '../precificacao-llm.js';
import type { ExtracaoRepository, LlmLoteGateway, ObjectStorage, UsoLlmLedger } from '../ports.js';
import { prepararEntradaExtracao } from '../preparar-entrada-extracao.js';

/**
 * Um edital a extrair no lote — já HIDRATADO (texto/anexos/páginas). A hidratação a partir de
 * `edital.ingerido` (que só carrega `editalId`/`numeroControlePncp` — A17 §8) e a acumulação/flush do
 * lote são responsabilidade do worker/composition root; aqui o caso de uso recebe os itens prontos,
 * espelhando o `ExtrairEditalInput` do caminho síncrono.
 */
export interface ExtrairEditalLoteItem {
  editalId: EditalId;
  texto: string;
  temTextoSelecionavel: boolean;
  anexosRefs: string[];
  paginas: number;
}

/** Desfecho agregado do lote (contadores) — 1 edital pode cair sem derrubar os demais. */
export interface ResultadoExtracaoLoteDTO {
  /** Extrações novas persistidas. */
  extraidos: number;
  /** Já existiam no catálogo global — LLM não foi chamado (guardrail de custo, P-45). */
  cacheHits: number;
  /** Sem texto após OCR → leitura manual (docs/10 §6); não foram ao lote. */
  ignorados: number;
  /** Confiança agregada 0 → leitura assistida (docs/10 §6); não persistidos. */
  insuficientes: number;
  /** Provedor não entregou (errored/expired) ou saída fora do schema (camada 3). */
  falhas: number;
}

/**
 * Pré-extração em LOTE disparada por `edital.ingerido` (RAD-54 · Lever 1 de RAD-53). Mesma política do
 * `ExtrairEditalUseCase` síncrono — cache por edital (P-45), piso de OCR e piso de confiança (docs/10
 * §6) — mas plural e sobre o transporte em batch (−50% de custo). Aquece o catálogo global ANTES de o
 * usuário pedir triagem; a aderência por perfil (latency-sensitive) então já encontra a extração pronta.
 */
export class ExtrairEditaisEmLoteUseCase {
  constructor(
    private readonly llmLote: LlmLoteGateway,
    private readonly extracoes: ExtracaoRepository,
    private readonly storage: ObjectStorage,
    private readonly usoLedger: UsoLlmLedger,
  ) {}

  async executar(
    itens: readonly ExtrairEditalLoteItem[],
    signal: AbortSignal,
  ): Promise<ResultadoExtracaoLoteDTO> {
    let cacheHits = 0;
    let ignorados = 0;
    const entradas: EntradaExtracaoDTO[] = [];

    for (const item of itens) {
      // Idempotente sob reprocesso de `edital.ingerido` (P-45).
      const existente = await this.extracoes.porEdital(item.editalId, signal);
      const elegibilidade = avaliarElegibilidadeExtracao(
        existente,
        item.texto,
        item.temTextoSelecionavel,
      );
      if (elegibilidade.tipo === 'cache_hit') {
        cacheHits++;
        continue;
      }
      if (elegibilidade.tipo === 'sem_texto') {
        ignorados++; // leitura manual (docs/10 §6): fora do lote, sem gastar tokens
        continue;
      }
      entradas.push(await prepararEntradaExtracao(item, this.storage, signal));
    }

    if (entradas.length === 0) {
      return { extraidos: 0, cacheHits, ignorados, insuficientes: 0, falhas: 0 };
    }

    const resultados = await this.llmLote.extrairLote(entradas, signal);

    let extraidos = 0;
    let insuficientes = 0;
    let falhas = 0;
    for (const resultado of resultados) {
      if (!resultado.ok) {
        falhas++; // sem `uso` (RAD-230 GAP: item errored/expired/schema-inválido não mede tokens)
        continue;
      }

      // Grava o CUSTO real independente do piso de confiança abaixo — pré-extração GLOBAL (P-45),
      // sem tenant a atribuir (docs/98 P-20 veredicto RAD-227).
      await this.usoLedger.registrar(
        RegistroUsoLlm.criar({
          editalId: resultado.editalId,
          tenantId: null,
          clienteFinalId: null,
          perfilId: null,
          modelo: resultado.uso.modelo,
          inputTokens: resultado.uso.inputTokens,
          outputTokens: resultado.uso.outputTokens,
          cacheReadInputTokens: resultado.uso.cacheReadInputTokens,
          cacheCreationInputTokens: resultado.uso.cacheCreationInputTokens,
          custoUsd: calcularCustoUsd(resultado.uso),
          ocorridoEm: new Date(),
        }),
        signal,
      );

      // Piso de confiança: nenhum campo crítico com citação utilizável → leitura assistida (docs/10 §6).
      if (resultado.extracao.confiancaGlobal().valor === 0) {
        insuficientes++;
        continue;
      }
      await this.extracoes.salvar(resultado.extracao, signal); // campos fracos ficam "verificar"
      extraidos++;
    }

    return { extraidos, cacheHits, ignorados, insuficientes, falhas };
  }
}
