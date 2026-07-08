import type { ClienteFinalId, TenantId } from '@radar/kernel';
import { RegistroAuditoria } from '../../domain/entities/registro-auditoria.js';
import {
  IdentidadeNaoVerificadaError,
  SolicitacaoTitular,
} from '../../domain/entities/solicitacao-titular.js';
import { AuditoriaIndisponivelError } from '../../domain/errors/index.js';
import type {
  AuditLogIdProvider,
  AuditLogRepository,
  Clock,
  IdentidadeGateway,
  SolicitacaoDTO,
  SolicitacaoIdProvider,
  SolicitacaoTitularRepository,
} from '../ports.js';

export interface AtenderSolicitacaoTitularInput {
  readonly tipo: 'acesso' | 'correcao' | 'eliminacao';
  readonly tenantId: TenantId;
  readonly clienteFinalId?: ClienteFinalId;
  /**
   * Referência opaca ao titular declarado.
   * NUNCA deve conter documento de identidade bruto — apenas referência/hash.
   */
  readonly titularRef: string;
  /** Operador/usuário autenticado que registra a solicitação (para auditoria). */
  readonly operadorId: string;
}

/**
 * Atende solicitação LGPD de titular (US-12 / docs/14 §5 / P-57 / AB10 / RAD-98).
 *
 * Invariantes de segurança:
 * - AB10/P-57: identidade é verificada ANTES de qualquer retorno/alteração de dado.
 *   Falha de verificação recusa sem confirmar existência de dados.
 * - P-51: tenantId vem sempre do token autenticado — nunca de input de cliente.
 * - AB13/P-61: cada transição de estado é auditada de forma append-only; falha
 *   na auditoria encerra a operação (fail-closed).
 * - Não vaza dados de outro tenant/clienteFinal.
 * - Não envia dados do titular para LLM ou logs.
 */
export class AtenderSolicitacaoTitularUseCase {
  constructor(
    private readonly solicitacoes: SolicitacaoTitularRepository,
    private readonly identidadeGateway: IdentidadeGateway,
    private readonly auditLog: AuditLogRepository,
    private readonly solicitacaoIdProvider: SolicitacaoIdProvider,
    private readonly auditLogIdProvider: AuditLogIdProvider,
    private readonly clock: Clock,
  ) {}

  async executar(
    input: AtenderSolicitacaoTitularInput,
    signal: AbortSignal,
  ): Promise<SolicitacaoDTO> {
    const agora = this.clock.agora();

    // Passo 1: criar solicitação em estado recebida
    let solicitacao = SolicitacaoTitular.criar({
      id: this.solicitacaoIdProvider.gerar(),
      tipo: input.tipo,
      tenantId: input.tenantId,
      clienteFinalId: input.clienteFinalId,
      titularRef: input.titularRef,
      criadaEm: agora,
    });
    await this.persistirComAuditoria(solicitacao, 'CRIAR', input.operadorId, signal);

    // Passo 2: iniciar verificação de identidade
    solicitacao = solicitacao.iniciarVerificacao(this.clock.agora());
    await this.persistirComAuditoria(solicitacao, 'INICIAR_VERIFICACAO', input.operadorId, signal);

    // Passo 3: verificar identidade via gateway (AB10/P-57)
    const resultadoVerificacao = await this.identidadeGateway.verificarTitular(
      input.titularRef,
      input.tenantId,
      signal,
    );

    if (!resultadoVerificacao.verificada) {
      // Falha: recusar sem confirmar existência de dados (AB10/P-57)
      solicitacao = solicitacao.recusar('IDENTIDADE_NAO_VERIFICADA', this.clock.agora());
      await this.persistirComAuditoria(solicitacao, 'RECUSAR_IDENTIDADE', input.operadorId, signal);

      solicitacao = solicitacao.encerrar(this.clock.agora());
      // AB13/P-61: encerramento auditado; falha → fail-closed antes de lançar o erro de identidade
      await this.persistirComAuditoria(solicitacao, 'ENCERRAR', input.operadorId, signal);

      throw new IdentidadeNaoVerificadaError();
    }

    // Passo 4: identidade confirmada — avançar para análise
    solicitacao = solicitacao.confirmarIdentidade(this.clock.agora());
    solicitacao = solicitacao.iniciarAnalise(this.clock.agora());
    await this.persistirComAuditoria(solicitacao, 'INICIAR_ANALISE', input.operadorId, signal);

    // Passo 5: processar conforme tipo
    const dto = await this.processarTipo(input, solicitacao, signal);

    // Passo 6: atender e encerrar (fusão intencional — sem persistência intermediária de 'atendida')
    solicitacao = solicitacao.atender(this.clock.agora()).encerrar(this.clock.agora());
    await this.persistirComAuditoria(solicitacao, 'ATENDER_E_ENCERRAR', input.operadorId, signal);

    return dto;
  }

  private async processarTipo(
    input: AtenderSolicitacaoTitularInput,
    solicitacao: SolicitacaoTitular,
    signal: AbortSignal,
  ): Promise<SolicitacaoDTO> {
    switch (input.tipo) {
      case 'acesso':
        return this.processarAcesso(input, solicitacao, signal);
      case 'correcao':
        return this.processarCorrecao(input, solicitacao, signal);
      case 'eliminacao':
        return this.processarEliminacao(input, solicitacao, signal);
    }
  }

  private async processarAcesso(
    input: AtenderSolicitacaoTitularInput,
    solicitacao: SolicitacaoTitular,
    signal: AbortSignal,
  ): Promise<SolicitacaoDTO> {
    // Para MVP: retorna sumário de categorias — NUNCA dados estratégicos de cliente
    // nem dados de outro tenant. A infra (repositório) filtra por tenantId/clienteFinalId.
    // Auditoria da consulta
    await this.registrarAuditoria(
      input.operadorId,
      `solicitacao-titular:${solicitacao.id}:acesso`,
      'CONSULTAR',
      'LGPD art. 18 I acesso a dados pessoais',
      input.tenantId,
      signal,
    );

    return {
      solicitacaoId: solicitacao.id,
      tipo: 'acesso',
      estado: 'atendida',
      observacao:
        'Solicitação de acesso registrada. O DPO encaminhará o sumário de dados dentro do prazo legal (LGPD art. 19 — até 15 dias).',
    };
  }

  private async processarCorrecao(
    input: AtenderSolicitacaoTitularInput,
    solicitacao: SolicitacaoTitular,
    signal: AbortSignal,
  ): Promise<SolicitacaoDTO> {
    // Correção: registra a solicitação para análise do DPO.
    // Dados de fonte oficial (PNCP/edital) não são reescritos — orientar correção na fonte.
    await this.registrarAuditoria(
      input.operadorId,
      `solicitacao-titular:${solicitacao.id}:correcao`,
      'SOLICITAR_CORRECAO',
      'LGPD art. 18 III retificação de dados',
      input.tenantId,
      signal,
    );

    return {
      solicitacaoId: solicitacao.id,
      tipo: 'correcao',
      estado: 'atendida',
      observacao:
        'Solicitação de correção registrada para análise do DPO. Dados de fonte oficial (PNCP) requerem correção na origem.',
    };
  }

  private async processarEliminacao(
    input: AtenderSolicitacaoTitularInput,
    solicitacao: SolicitacaoTitular,
    signal: AbortSignal,
  ): Promise<SolicitacaoDTO> {
    // Eliminação: registra para análise — NUNCA elimina AUDIT_LOG nem dado
    // coberto por obrigação legal/auditoria/defesa de direitos sem revisão.
    await this.registrarAuditoria(
      input.operadorId,
      `solicitacao-titular:${solicitacao.id}:eliminacao`,
      'SOLICITAR_ELIMINACAO',
      'LGPD art. 18 VI eliminação de dados desnecessários',
      input.tenantId,
      signal,
    );

    return {
      solicitacaoId: solicitacao.id,
      tipo: 'eliminacao',
      estado: 'atendida',
      observacao:
        'Solicitação de eliminação registrada. A eliminação efetiva respeita obrigações legais, auditoria e defesa de direitos. O DPO informará o resultado.',
    };
  }

  private async persistirComAuditoria(
    solicitacao: SolicitacaoTitular,
    acao: string,
    operadorId: string,
    signal: AbortSignal,
  ): Promise<void> {
    await this.solicitacoes.salvar(solicitacao, signal);
    await this.registrarAuditoria(
      operadorId,
      `solicitacao-titular:${solicitacao.id}`,
      acao,
      'LGPD art. 18 direitos do titular',
      solicitacao.tenantId,
      signal,
    );
  }

  private async registrarAuditoria(
    operadorId: string,
    recurso: string,
    acao: string,
    baseLegal: string,
    tenantId: TenantId,
    signal: AbortSignal,
  ): Promise<void> {
    const registro = RegistroAuditoria.criar({
      id: this.auditLogIdProvider.gerar(),
      usuarioId: operadorId,
      recurso,
      acao,
      baseLegal,
      escopo: { tenantId },
      ocorridoEm: this.clock.agora(),
    });

    try {
      await this.auditLog.registrar(registro, signal);
    } catch {
      // Fail-closed: se auditoria falhar, a operação para (AB13/P-61).
      throw new AuditoriaIndisponivelError();
    }
  }
}

