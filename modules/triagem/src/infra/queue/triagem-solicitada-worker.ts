import { ClienteFinalId, DomainError, EditalId, PerfilId, TenantId } from '@radar/kernel';
import type { DocumentosEditalGateway, EventPublisher, ObjectStorage } from '../../application/ports.js';
import type { EntradaExtracaoDTO } from '../../application/dtos.js';
import type { TriarEditalUseCase } from '../../application/use-cases/triar-edital.js';
import { TriagemFalhou } from '../../application/events.js';

/** Contrato canônico de `triagem.solicitada` (A03 §3) — mesmo payload de `TriagemSolicitada`. */
export interface TriagemSolicitadaMsg {
  tenantId: string;
  usuarioId: string; // = clienteFinalId (nomeação de SolicitarTriagemUseCase/TriagemSolicitada)
  editalId: string;
  perfilId: string;
}

interface DlqClient {
  encaminhar(msg: TriagemSolicitadaMsg, err: unknown): Promise<void>;
}

/**
 * Consumidor de `triagem.solicitada` → `TriarEditalUseCase` (RAD-259, A03 §3, fecha o
 * pré-requisito de RAD-257). Hidrata `conteudo` a partir do Catálogo/ObjectStorage (fora do
 * `try/catch` do use case: falha aqui é INFRA, não regra de negócio) e delega ao use case, que
 * já publica `triagem.falhou` para todo erro capturado DENTRO de `executar()` (RAD-255) — por
 * isso `processar` apenas engole essa exceção (mensagem tratada, sem retry: republicar não
 * ajudaria uma falha de autorização/orçamento/confiança já compensada).
 */
export class TriagemSolicitadaWorker {
  constructor(
    private readonly triarEditalUC: TriarEditalUseCase,
    private readonly documentosGateway: DocumentosEditalGateway,
    private readonly storage: ObjectStorage,
    private readonly eventos: EventPublisher,
    private readonly dlq: DlqClient,
  ) {}

  /**
   * Erro na hidratação (INFRA — ex. ObjectStorage/gateway indisponível) propaga para o transporte
   * (NACK) — o retry de infra é responsabilidade do transporte (SQS); ao esgotar, o transporte
   * deve chamar `processarDlq` com a MESMA `msg`. Erro dentro de `executar()` é engolido: o use
   * case já publicou `triagem.falhou` (RAD-255), então a mensagem está tratada.
   */
  async processar(msg: TriagemSolicitadaMsg, signal: AbortSignal): Promise<void> {
    const conteudo = await this.hidratar(msg, signal);

    try {
      await this.triarEditalUC.executar(
        {
          tenantId: TenantId(msg.tenantId),
          clienteFinalId: ClienteFinalId(msg.usuarioId),
          perfilId: PerfilId(msg.perfilId),
          editalId: EditalId(msg.editalId),
          conteudo,
        },
        signal,
      );
    } catch {
      // Já compensado dentro de TriarEditalUseCase.executar (RAD-255) — nada a fazer aqui.
    }
  }

  /**
   * Handler de DLQ DEDICADO (RAD-259, fecha P-107 (c) ponta a ponta): acionado quando o
   * transporte esgota os retries de INFRA de `processar` (crash antes de `executar()` rodar —
   * ex. falha persistente na hidratação) — `TriarEditalUseCase` nunca chega a rodar, então seu
   * catch-all (RAD-255) nunca publica `triagem.falhou`, e a reserva de cota de
   * `SolicitarTriagemUseCase` fica presa (P-107 (c)). Publica com a CHAVE NATURAL da mensagem
   * original ANTES de descartá-la (`dlq.encaminhar`) — mesma ordem de `TriarEditalUseCase`.
   */
  async processarDlq(msg: TriagemSolicitadaMsg, err: unknown, signal: AbortSignal): Promise<void> {
    await this.eventos.publicar(
      new TriagemFalhou({
        tenantId: TenantId(msg.tenantId),
        clienteFinalId: ClienteFinalId(msg.usuarioId),
        editalId: EditalId(msg.editalId),
        perfilId: PerfilId(msg.perfilId),
        motivo: err instanceof DomainError ? err.code : 'erro_inesperado',
      }),
      signal,
    );
    await this.dlq.encaminhar(msg, err);
  }

  private async hidratar(msg: TriagemSolicitadaMsg, signal: AbortSignal): Promise<EntradaExtracaoDTO> {
    const editalId = EditalId(msg.editalId);
    const docs = await this.documentosGateway.obterRefs(editalId, signal);
    const [principal, ...demais] = docs.arquivos;

    const textoPrincipal = principal ? await this.storage.obterTextoAnexo(principal.storageKey, signal) : '';
    const anexos: string[] = [];
    for (const arquivo of demais) {
      anexos.push(await this.storage.obterTextoAnexo(arquivo.storageKey, signal));
    }

    return {
      editalId: msg.editalId,
      texto: textoPrincipal,
      temTextoSelecionavel: textoPrincipal.trim().length > 0,
      anexos,
      paginas: 1, // nº de páginas desconhecido no MVP; piso de 1 (mesmo padrão de TriagemBatchWorker)
    };
  }
}
