/** Stub de sessão para dev local e testes. */
import type { SessaoGateway } from '@/application/ports';
import type { SessaoUsuario } from '@/domain/sessao';

export class SessaoStubGateway implements SessaoGateway {
  constructor(private readonly fixture: SessaoUsuario = {
    usuarioId: 'dev-user-1',
    tenantId: 'tenant-dev',
    papel: 'OPERADOR',
    clienteFinalIds: ['cf-1'],
  }) {}

  async obter(_signal: AbortSignal): Promise<SessaoUsuario> {
    return this.fixture;
  }
}
