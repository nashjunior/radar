import type { ClienteFinalId, TenantId } from '@radar/kernel';
import { DomainError } from '@radar/kernel';

declare const __brand: unique symbol;
export type SolicitacaoId = string & { readonly [__brand]: 'SolicitacaoId' };
export const SolicitacaoId = (raw: string): SolicitacaoId => raw as SolicitacaoId;

export type TipoSolicitacao = 'acesso' | 'correcao' | 'eliminacao';

/**
 * Estados do ciclo de vida de uma solicitação de titular (RAD-97/RAD-98/docs/05 §5).
 * Transições válidas:
 * recebida → pendente_verificacao → identidade_verificada → em_analise → atendida | recusada | parcialmente_atendida → encerrada
 * recebida → pendente_verificacao → recusada → encerrada (se verificação falha)
 */
export type EstadoSolicitacao =
  | 'recebida'
  | 'pendente_verificacao'
  | 'identidade_verificada'
  | 'em_analise'
  | 'atendida'
  | 'recusada'
  | 'parcialmente_atendida'
  | 'encerrada';

/** Razão de recusa que pode ser registrada sem confirmar existência de dados ao titular. */
export type MotivoRecusa = 'IDENTIDADE_NAO_VERIFICADA' | 'SEM_DADOS_NO_ESCOPO' | 'OBRIGACAO_LEGAL';

export interface CriarSolicitacaoProps {
  readonly id: SolicitacaoId;
  readonly tipo: TipoSolicitacao;
  readonly tenantId: TenantId;
  readonly clienteFinalId?: ClienteFinalId;
  /** Referência opaca ao titular declarado — nunca armazenar documento bruto aqui. */
  readonly titularRef: string;
  readonly criadaEm: Date;
}

export class IdentidadeNaoVerificadaError extends DomainError {
  readonly code = 'IDENTIDADE_NAO_VERIFICADA' as const;
  constructor() {
    super('identidade do titular não verificada — solicitação não pode ser atendida (AB10/P-57)');
  }
}

/**
 * Aggregate de solicitação LGPD do titular (docs/13 §3, docs/14 §5, P-57, AB10).
 *
 * Invariante AB10/P-57: nenhum dado é retornado, corrigido ou eliminado
 * antes de identidade_verificada. Qualquer tentativa de avançar para em_analise
 * sem verificação lança IdentidadeNaoVerificadaError.
 *
 * Imutável após criação — transições retornam nova instância.
 */
export class SolicitacaoTitular {
  private constructor(
    readonly id: SolicitacaoId,
    readonly tipo: TipoSolicitacao,
    readonly tenantId: TenantId,
    readonly clienteFinalId: ClienteFinalId | undefined,
    readonly titularRef: string,
    readonly estado: EstadoSolicitacao,
    readonly motivoRecusa: MotivoRecusa | undefined,
    readonly criadaEm: Date,
    readonly atualizadaEm: Date,
  ) {}

  static criar(props: CriarSolicitacaoProps): SolicitacaoTitular {
    return new SolicitacaoTitular(
      props.id,
      props.tipo,
      props.tenantId,
      props.clienteFinalId,
      props.titularRef,
      'recebida',
      undefined,
      props.criadaEm,
      props.criadaEm,
    );
  }

  iniciarVerificacao(agora: Date): SolicitacaoTitular {
    return new SolicitacaoTitular(
      this.id, this.tipo, this.tenantId, this.clienteFinalId, this.titularRef,
      'pendente_verificacao', undefined, this.criadaEm, agora,
    );
  }

  confirmarIdentidade(agora: Date): SolicitacaoTitular {
    if (this.estado !== 'pendente_verificacao') {
      throw new IdentidadeNaoVerificadaError();
    }
    return new SolicitacaoTitular(
      this.id, this.tipo, this.tenantId, this.clienteFinalId, this.titularRef,
      'identidade_verificada', undefined, this.criadaEm, agora,
    );
  }

  iniciarAnalise(agora: Date): SolicitacaoTitular {
    if (this.estado !== 'identidade_verificada') {
      throw new IdentidadeNaoVerificadaError();
    }
    return new SolicitacaoTitular(
      this.id, this.tipo, this.tenantId, this.clienteFinalId, this.titularRef,
      'em_analise', undefined, this.criadaEm, agora,
    );
  }

  atender(agora: Date): SolicitacaoTitular {
    return new SolicitacaoTitular(
      this.id, this.tipo, this.tenantId, this.clienteFinalId, this.titularRef,
      'atendida', undefined, this.criadaEm, agora,
    );
  }

  atenderParcialmente(agora: Date): SolicitacaoTitular {
    return new SolicitacaoTitular(
      this.id, this.tipo, this.tenantId, this.clienteFinalId, this.titularRef,
      'parcialmente_atendida', undefined, this.criadaEm, agora,
    );
  }

  recusar(motivo: MotivoRecusa, agora: Date): SolicitacaoTitular {
    return new SolicitacaoTitular(
      this.id, this.tipo, this.tenantId, this.clienteFinalId, this.titularRef,
      'recusada', motivo, this.criadaEm, agora,
    );
  }

  encerrar(agora: Date): SolicitacaoTitular {
    return new SolicitacaoTitular(
      this.id, this.tipo, this.tenantId, this.clienteFinalId, this.titularRef,
      'encerrada', this.motivoRecusa, this.criadaEm, agora,
    );
  }
}
