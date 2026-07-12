import { AcessoNegadoError, DomainError } from '@radar/kernel';
import type { ClienteFinalId, EditalId, PerfilId, TenantId } from '@radar/kernel';
import {
  ConfiancaInsuficienteError,
  EntradaExcedeTetoDeAdmissaoError,
  ExtracaoRecusadaError,
  OcrFalhouError,
  OrcamentoDeCustoExcedidoError,
  PerfilNaoEncontradoError,
  SaidaLlmInvalidaError,
} from '../../domain/errors/index.js';
import type { PerfilHabilitacao } from '../../domain/perfil-habilitacao.js';
import { RegistroUsoLlm } from '../../domain/registro-uso-llm.js';
import { Triagem } from '../../domain/triagem.js';
import { triagemParaDTO } from '../dtos.js';
import type { EntradaExtracaoDTO, TriagemDTO } from '../dtos.js';
import { LIMIAR_CONFIANCA_PADRAO } from '../politica-confianca.js';
import { TriagemConcluida, TriagemFalhou } from '../events.js';
import { calcularCustoUsd } from '../precificacao-llm.js';
import {
  excedeOrcamento,
  excedeTetoDeAdmissao,
  inicioDaJanela,
  MAX_INPUT_TOKENS_ADMISSAO,
  POLITICA_ORCAMENTO_PADRAO,
} from '../politica-orcamento.js';
import type { PoliticaOrcamento } from '../politica-orcamento.js';
import type {
  EventPublisher,
  ExtracaoRepository,
  LlmGateway,
  PerfilGateway,
  TriagemRepository,
  UsoLlm,
  UsoLlmLedger,
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
 * em profundidade contra IDOR/BOLA, além da checagem de `SolicitarTriagem`. Todo caminho de erro
 * (incluindo cancelamento via `signal`) publica `triagem.falhou` — RAD-255, P-107 (c): a reserva
 * de cota feita por `SolicitarTriagemUseCase` só é liberada por Cobrança se este evento chegar.
 */
export class TriarEditalUseCase {
  constructor(
    private readonly extracoes: ExtracaoRepository,
    private readonly perfis: PerfilGateway,
    private readonly llm: LlmGateway,
    private readonly triagens: TriagemRepository,
    private readonly eventos: EventPublisher,
    private readonly usoLedger: UsoLlmLedger,
    private readonly orcamento: PoliticaOrcamento = POLITICA_ORCAMENTO_PADRAO,
  ) {}

  async executar(input: TriarEditalInput, signal: AbortSignal): Promise<TriagemDTO> {
    try {
      return await this.executarOuLancar(input, signal);
    } catch (err) {
      // RAD-255 (P-107 (c)): todo caminho de falha/timeout/cancelamento publica `triagem.falhou`
      // para que Cobrança libere a reserva de cota — sem isto a cota vaza (docs/13 §3). `motivo`
      // é o `code` estável de `DomainError`; nunca a mensagem/stack (pode carregar detalhe interno).
      // Publica com um AbortSignal PRÓPRIO, nunca o `signal` recebido: cancelamento é um dos
      // próprios gatilhos deste catch, então `signal` pode já estar abortado aqui — reusá-lo faria
      // a publicação de compensação falhar exatamente no caminho que ela existe para cobrir.
      await this.eventos.publicar(
        new TriagemFalhou({
          tenantId: input.tenantId,
          clienteFinalId: input.clienteFinalId,
          editalId: input.editalId,
          perfilId: input.perfilId,
          motivo: err instanceof DomainError ? err.code : 'erro_inesperado',
        }),
        new AbortController().signal,
      );
      throw err;
    }
  }

  private async executarOuLancar(input: TriarEditalInput, signal: AbortSignal): Promise<TriagemDTO> {
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
      // Admission control + orçamento (RAD-243, P-20/P-38) — ANTES da chamada paga. Único caller
      // com tenant conhecido aqui: checa orçamento GLOBAL sempre e POR TENANT quando configurado
      // (`orcamentoPorTenantUsd`) — a pré-extração global (ExtrairEditalUseCase) só tem o global.
      const estimativa = await this.llm.estimarCusto(input.conteudo, signal);
      if (excedeTetoDeAdmissao(estimativa.inputTokens)) {
        throw new EntradaExcedeTetoDeAdmissaoError(estimativa.inputTokens, MAX_INPUT_TOKENS_ADMISSAO);
      }
      const desde = inicioDaJanela(new Date(), this.orcamento);
      const gastoGlobal = await this.usoLedger.gastoUsdNaJanela({ tenantId: null }, desde, signal);
      if (excedeOrcamento(estimativa.custoEstimadoUsd, gastoGlobal, this.orcamento.orcamentoGlobalUsd)) {
        throw new OrcamentoDeCustoExcedidoError('global');
      }
      if (this.orcamento.orcamentoPorTenantUsd !== null) {
        const gastoTenant = await this.usoLedger.gastoUsdNaJanela({ tenantId: input.tenantId }, desde, signal);
        if (excedeOrcamento(estimativa.custoEstimadoUsd, gastoTenant, this.orcamento.orcamentoPorTenantUsd)) {
          throw new OrcamentoDeCustoExcedidoError('tenant');
        }
      }

      // OCR falhou ou modelo recusou → persiste estado degradado antes de re-lançar (RAD-79).
      try {
        const resultado = await this.llm.extrair(input.conteudo, signal);
        extracao = resultado.extracao;
        // ÚNICO caller com tenant conhecido no momento da chamada (cache-miss dentro de uma triagem
        // solicitada por um cliente) — `ExtrairEditalUseCase`/`ExtrairEditaisEmLoteUseCase` são
        // pré-extração GLOBAL (P-45), sem tenant a atribuir (docs/98 P-20 veredicto RAD-227).
        await this.registrarUso(input, perfil, resultado.uso, signal);
      } catch (err) {
        // GAP fechado (RAD-243): recusa/truncamento gastam tokens antes de lançar — registra o
        // custo real a partir do `usoParcial` anexado ao erro, além do estado degradado abaixo.
        if ((err instanceof ExtracaoRecusadaError || err instanceof SaidaLlmInvalidaError) && err.usoParcial) {
          await this.registrarUso(input, perfil, err.usoParcial, signal);
        }
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

  private async registrarUso(
    input: TriarEditalInput,
    perfil: PerfilHabilitacao,
    uso: UsoLlm,
    signal: AbortSignal,
  ): Promise<void> {
    await this.usoLedger.registrar(
      RegistroUsoLlm.criar({
        editalId: input.editalId,
        tenantId: input.tenantId,
        clienteFinalId: perfil.clienteFinalId,
        perfilId: input.perfilId,
        modelo: uso.modelo,
        inputTokens: uso.inputTokens,
        outputTokens: uso.outputTokens,
        cacheReadInputTokens: uso.cacheReadInputTokens,
        cacheCreationInputTokens: uso.cacheCreationInputTokens,
        custoUsd: calcularCustoUsd(uso),
        ocorridoEm: new Date(),
      }),
      signal,
    );
  }
}
