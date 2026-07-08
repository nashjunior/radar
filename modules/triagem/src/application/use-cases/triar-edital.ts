import { AcessoNegadoError } from '@radar/kernel';
import type { ClienteFinalId, EditalId, PerfilId, TenantId } from '@radar/kernel';
import {
  ConfiancaInsuficienteError,
  ExtracaoRecusadaError,
  OcrFalhouError,
  PerfilNaoEncontradoError,
} from '../../domain/errors/index.js';
import { Triagem } from '../../domain/triagem.js';
import { triagemParaDTO } from '../dtos.js';
import type { EntradaExtracaoDTO, TriagemDTO } from '../dtos.js';
import { LIMIAR_CONFIANCA_PADRAO } from '../politica-confianca.js';
import { TriagemConcluida } from '../events.js';
import type {
  EventPublisher,
  ExtracaoRepository,
  LlmGateway,
  PerfilGateway,
  TriagemRepository,
} from '../ports.js';

export interface TriarEditalInput {
  editalId: EditalId;
  perfilId: PerfilId;
  clienteFinalId: ClienteFinalId;
  tenantId: TenantId; // resolvido na borda / payload de `triagem.solicitada` (P-25: `global` no MVP)
  conteudo: EntradaExtracaoDTO; // hidratado pelo worker a partir do Catálogo/ObjectStorage
  limiarConfianca?: number; // política de confiança (docs/10 §4, P-19); default LIMIAR_CONFIANCA_PADRAO
}

/**
 * Entrypoint: worker que consome `triagem.solicitada` (A03 §3). Extração é cacheada por edital
 * (P-45); a aderência é por perfil (não cacheável). Autorização por objeto reforçada aqui — defesa
 * em profundidade contra IDOR/BOLA, além da checagem de `SolicitarTriagem`.
 */
export class TriarEditalUseCase {
  constructor(
    private readonly extracoes: ExtracaoRepository,
    private readonly perfis: PerfilGateway,
    private readonly llm: LlmGateway,
    private readonly triagens: TriagemRepository,
    private readonly eventos: EventPublisher,
  ) {}

  async executar(input: TriarEditalInput, signal: AbortSignal): Promise<TriagemDTO> {
    // 1. Autorização POR OBJETO (P-51 / AB1) ANTES da extração paga: o perfil deve pertencer ao
    //    clienteFinal solicitante. O perfil não é insumo da extração — checá-lo primeiro fecha a
    //    chamada PAGA de LLM (passo 2) atrás do authz, protegendo contra fila envenenada (defesa em
    //    profundidade, além da checagem de `SolicitarTriagem`). Perfil inexistente é erro de
    //    orquestração (404); perfil de OUTRO cliente é IDOR (403).
    const perfil = await this.perfis.porId(input.perfilId, signal);
    if (perfil === null) throw new PerfilNaoEncontradoError(input.perfilId);
    if (perfil.clienteFinalId !== input.clienteFinalId) throw new AcessoNegadoError();

    // 2. Extração CACHEADA por edital (P-45). Cache-miss → 1 chamada de LLM (A10 §4.5).
    let extracao = await this.extracoes.porEdital(input.editalId, signal);
    if (extracao === null) {
      // OCR falhou ou modelo recusou → persiste estado degradado antes de re-lançar (RAD-79).
      try {
        extracao = await this.llm.extrair(input.conteudo, signal);
      } catch (err) {
        let degradada: Triagem;
        if (err instanceof OcrFalhouError) {
          degradada = Triagem.falhaOcr(input.editalId, input.perfilId, input.tenantId, perfil.clienteFinalId);
        } else if (err instanceof ExtracaoRecusadaError) {
          degradada = Triagem.recusada(input.editalId, input.perfilId, input.tenantId, perfil.clienteFinalId);
        } else {
          throw err;
        }
        await this.triagens.salvar(degradada, signal);
        throw err;
      }
      await this.extracoes.salvar(extracao, signal);
    }

    // 3. Gate de confiança (docs/10 §4). Abaixo do limiar → leitura assistida (docs/10 §6):
    //    nunca apresentar palpite como certeza. Limiar vem da política por campo (P-19); sem
    //    valor explícito da composição-root, aplica o default de lançamento (fonte única).
    const limiar = input.limiarConfianca ?? LIMIAR_CONFIANCA_PADRAO;
    if (!extracao.suficiente(limiar)) {
      await this.triagens.salvar(
        Triagem.incompleta(input.editalId, input.perfilId, input.tenantId, perfil.clienteFinalId),
        signal,
      );
      throw new ConfiancaInsuficienteError();
    }

    // 4. Aderência POR PERFIL (não cacheável) — regra de domínio pura.
    const triagem = Triagem.avaliar(extracao, perfil, input.tenantId);
    await this.triagens.salvar(triagem, signal);

    // 5. triagem.concluida → API/front (A03 §3). Payload leva citações + confiança + riscos.
    await this.eventos.publicar(
      new TriagemConcluida({
        tenantId: triagem.tenantId,
        clienteFinalId: triagem.clienteFinalId,
        editalId: triagem.editalId,
        perfilId: triagem.perfilId,
        confianca: extracao.confiancaGlobal().valor,
        aderencia: triagem.aderencia!.valor,
        recomendacao: triagem.recomendacao!,
        riscos: triagem.riscos.map((r) => r.descricao),
      }),
      signal,
    );

    return triagemParaDTO(triagem); // a UI exibe com citação em um clique; usuário decide (HITL)
  }
}
