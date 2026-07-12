import type { EditalId } from '@radar/kernel';
import { avaliarElegibilidadeExtracao } from '../../domain/elegibilidade-extracao.js';
import {
  ConfiancaInsuficienteError,
  EntradaExcedeTetoDeAdmissaoError,
  ExtracaoRecusadaError,
  OcrFalhouError,
  OrcamentoDeCustoExcedidoError,
  SaidaLlmInvalidaError,
} from '../../domain/errors/index.js';
import { RegistroUsoLlm } from '../../domain/registro-uso-llm.js';
import { extracaoParaDTO } from '../dtos.js';
import type { ExtracaoEditalDTO } from '../dtos.js';
import { calcularCustoUsd } from '../precificacao-llm.js';
import {
  excedeOrcamento,
  excedeTetoDeAdmissao,
  inicioDaJanela,
  MAX_INPUT_TOKENS_ADMISSAO,
  POLITICA_ORCAMENTO_PADRAO,
} from '../politica-orcamento.js';
import type { PoliticaOrcamento } from '../politica-orcamento.js';
import type { ExtracaoRepository, LlmGateway, ObjectStorage, UsoLlm, UsoLlmLedger } from '../ports.js';
import { prepararEntradaExtracao } from '../preparar-entrada-extracao.js';

export interface ExtrairEditalInput {
  editalId: EditalId;
  texto: string;
  temTextoSelecionavel: boolean;
  anexosRefs: string[];
  /**
   * nº de páginas medido ao hidratar (A17 §4.2 `EntradaExtracaoDTO.paginas`). Explícito no input —
   * A17 §4.3 o omite no exemplo ilustrativo, mas `ExtracaoEdital.paginas` é obrigatório para o read
   * path (`paginasEdital`).
   */
  paginas: number;
}

/**
 * Trigger: interno na 1ª triagem, ou evento `edital.ingerido` (pré-extração na ingestão — docs/10
 * §7). Cacheia por edital (P-45): chama o LLM UMA vez por edital, independente de quantos perfis
 * triam. É o guardrail de custo da esteira (docs/10 §7 / P-20).
 */
export class ExtrairEditalUseCase {
  constructor(
    private readonly llm: LlmGateway,
    private readonly extracoes: ExtracaoRepository,
    private readonly storage: ObjectStorage,
    private readonly usoLedger: UsoLlmLedger,
    private readonly orcamento: PoliticaOrcamento = POLITICA_ORCAMENTO_PADRAO,
  ) {}

  async executar(input: ExtrairEditalInput, signal: AbortSignal): Promise<ExtracaoEditalDTO> {
    const existente = await this.extracoes.porEdital(input.editalId, signal);
    const elegibilidade = avaliarElegibilidadeExtracao(
      existente,
      input.texto,
      input.temTextoSelecionavel,
    );
    if (elegibilidade.tipo === 'cache_hit') return extracaoParaDTO(elegibilidade.extracao);
    if (elegibilidade.tipo === 'sem_texto') {
      throw new OcrFalhouError(); // sem texto após OCR → leitura manual (docs/10 §6)
    }

    const entrada = await prepararEntradaExtracao(input, this.storage, signal);

    // Admission control + orçamento (RAD-243, P-20/P-38) — ANTES da chamada paga. Sem tenant: a
    // pré-extração é catálogo GLOBAL (P-45), não há orçamento por tenant a checar aqui.
    const estimativa = await this.llm.estimarCusto(entrada, signal);
    if (excedeTetoDeAdmissao(estimativa.inputTokens)) {
      throw new EntradaExcedeTetoDeAdmissaoError(estimativa.inputTokens, MAX_INPUT_TOKENS_ADMISSAO);
    }
    const desde = inicioDaJanela(new Date(), this.orcamento);
    const gastoGlobal = await this.usoLedger.gastoUsdNaJanela({ tenantId: null }, desde, signal);
    if (excedeOrcamento(estimativa.custoEstimadoUsd, gastoGlobal, this.orcamento.orcamentoGlobalUsd)) {
      throw new OrcamentoDeCustoExcedidoError('global');
    }

    try {
      // O adapter aplica a defesa de injeção (A11 §2) e valida a saída por schema (camada 3).
      const { extracao, uso } = await this.llm.extrair(entrada, signal);

      // Grava o CUSTO real assim que a chamada volta — mesmo que o gate de confiança abaixo rejeite
      // a extração, os tokens já foram gastos (RAD-230, P-20/P-38). Sem tenant: pré-extração GLOBAL (P-45).
      await this.registrarUso(input.editalId, uso, signal);

      // Piso de confiança: se nenhum campo crítico saiu com citação utilizável, é leitura assistida
      // (docs/10 §6) — nunca apresentar palpite como certeza.
      if (extracao.confiancaGlobal().valor === 0) throw new ConfiancaInsuficienteError();

      await this.extracoes.salvar(extracao, signal); // campos fracos ficam marcados "verificar"
      return extracaoParaDTO(extracao);
    } catch (err) {
      // GAP fechado (RAD-243): recusa/truncamento gastam tokens antes de lançar — registra o custo
      // real a partir do `usoParcial` anexado ao erro, mesmo sem uma extração para salvar. Não
      // re-registra em ConfiancaInsuficienteError (já registrado acima, antes deste throw).
      if ((err instanceof ExtracaoRecusadaError || err instanceof SaidaLlmInvalidaError) && err.usoParcial) {
        await this.registrarUso(input.editalId, err.usoParcial, signal);
      }
      throw err;
    }
  }

  private async registrarUso(editalId: EditalId, uso: UsoLlm, signal: AbortSignal): Promise<void> {
    await this.usoLedger.registrar(
      RegistroUsoLlm.criar({
        editalId,
        tenantId: null,
        clienteFinalId: null,
        perfilId: null,
        modelo: uso.modelo,
        inputTokens: uso.inputTokens,
        outputTokens: uso.outputTokens,
        cacheReadInputTokens: uso.cacheReadInputTokens,
        cacheCreationInputTokens: uso.cacheCreationInputTokens,
        coorteTrial: false, // pré-extração GLOBAL (P-45): sem tenant, nunca é coorte trial
        custoUsd: calcularCustoUsd(uso),
        ocorridoEm: new Date(),
      }),
      signal,
    );
  }
}
