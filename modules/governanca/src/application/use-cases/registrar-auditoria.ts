import type { ClienteFinalId, TenantId } from '@radar/kernel';
import { RegistroAuditoria } from '../../domain/entities/registro-auditoria.js';
import { AuditoriaIndisponivelError } from '../../domain/errors/index.js';
import type { AuditLogIdProvider, AuditLogRepository, Clock } from '../ports.js';

export interface RegistrarAuditoriaInput {
  readonly usuarioId: string;
  readonly recurso: string;
  readonly acao: string;
  readonly baseLegal: string;
  readonly escopo: {
    readonly tenantId: TenantId;
    readonly clienteFinalId?: ClienteFinalId;
  };
}

/**
 * Registra evento auditável de acesso/tratamento de dado pessoal ou classe crítica
 * (docs/14 §5, P-61, AB13). Fail-closed: relança como AuditoriaIndisponivelError se
 * o repositório não conseguir gravar — a operação sensível deve ser interrompida.
 */
export class RegistrarAuditoriaUseCase {
  constructor(
    private readonly auditLog: AuditLogRepository,
    private readonly idProvider: AuditLogIdProvider,
    private readonly clock: Clock,
  ) {}

  async executar(input: RegistrarAuditoriaInput, signal: AbortSignal): Promise<void> {
    const registro = RegistroAuditoria.criar({
      id: this.idProvider.gerar(),
      usuarioId: input.usuarioId,
      recurso: input.recurso,
      acao: input.acao,
      baseLegal: input.baseLegal,
      escopo: input.escopo,
      ocorridoEm: this.clock.agora(),
    });

    try {
      await this.auditLog.registrar(registro, signal);
    } catch {
      // Fail-closed: infraestrutura de auditoria indisponível bloqueia a operação (AB13/P-61)
      throw new AuditoriaIndisponivelError();
    }
  }
}
