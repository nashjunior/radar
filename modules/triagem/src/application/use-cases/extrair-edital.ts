import type { EditalId } from '@radar/kernel';
import { avaliarElegibilidadeExtracao } from '../../domain/elegibilidade-extracao.js';
import { ConfiancaInsuficienteError, OcrFalhouError } from '../../domain/errors/index.js';
import { extracaoParaDTO } from '../dtos.js';
import type { ExtracaoEditalDTO } from '../dtos.js';
import type { ExtracaoRepository, LlmGateway, ObjectStorage } from '../ports.js';
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

    // O adapter aplica a defesa de injeção (A11 §2) e valida a saída por schema (camada 3).
    const extracao = await this.llm.extrair(entrada, signal);

    // Piso de confiança: se nenhum campo crítico saiu com citação utilizável, é leitura assistida
    // (docs/10 §6) — nunca apresentar palpite como certeza.
    if (extracao.confiancaGlobal().valor === 0) throw new ConfiancaInsuficienteError();

    await this.extracoes.salvar(extracao, signal); // campos fracos ficam marcados "verificar"
    return extracaoParaDTO(extracao);
  }
}
