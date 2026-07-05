import type { EditalId } from '@radar/kernel';
import { ConfiancaInsuficienteError, OcrFalhouError } from '../../domain/errors/index.js';
import { extracaoParaDTO } from '../dtos.js';
import type { EntradaExtracaoDTO, ExtracaoEditalDTO } from '../dtos.js';
import type { ExtracaoRepository, LlmGateway, ObjectStorage } from '../ports.js';

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
    // Cache-hit: extração já existe → não re-chama o LLM (guardrail de custo, docs/10 §7 / P-20).
    const existente = await this.extracoes.porEdital(input.editalId, signal);
    if (existente !== null) return extracaoParaDTO(existente);

    if (!input.temTextoSelecionavel && input.texto.trim().length === 0) {
      throw new OcrFalhouError(); // sem texto após OCR → leitura manual (docs/10 §6)
    }

    // Resolve o texto dos anexos (baixados pela Ingestão) e monta o contexto MÍNIMO (P-54):
    // só o edital e anexos — nunca a classe crítica / estratégia comercial.
    const anexos = await Promise.all(
      input.anexosRefs.map((ref) => this.storage.obterTextoAnexo(ref, signal)),
    );
    const entrada: EntradaExtracaoDTO = {
      editalId: input.editalId,
      texto: input.texto,
      temTextoSelecionavel: input.temTextoSelecionavel,
      anexos,
      paginas: input.paginas,
    };

    // O adapter aplica a defesa de injeção (A11 §2) e valida a saída por schema (camada 3).
    const extracao = await this.llm.extrair(entrada, signal);

    // Piso de confiança: se nenhum campo crítico saiu com citação utilizável, é leitura assistida
    // (docs/10 §6) — nunca apresentar palpite como certeza.
    if (extracao.confiancaGlobal().valor === 0) throw new ConfiancaInsuficienteError();

    await this.extracoes.salvar(extracao, signal); // campos fracos ficam marcados "verificar"
    return extracaoParaDTO(extracao);
  }
}
