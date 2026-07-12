import { Tenant } from '../../domain/tenant.js';
import { Cnpj } from '../../domain/value-objects/cnpj.js';
import { AtribuicaoPapel, UsuarioId } from '../../domain/atribuicao-papel.js';
import { OrganizacaoJaExisteError, UsuarioJaVinculadoError } from '../../domain/errors.js';
import { organizacaoParaDTO } from '../dtos.js';
import type { OrganizacaoDTO } from '../dtos.js';
import { OrganizacaoProvisionada } from '../events.js';
import type { EventPublisher, PermissaoRepository, TenantIdProvider, TenantRepository } from '../ports.js';

export interface ProvisionarOrganizacaoInput {
  readonly sub: string;
  readonly email: string;
  readonly cnpj: string;
  readonly razaoSocial: string;
}

/**
 * Provisiona a organização de um usuário recém-cadastrado no IdP (onboarding
 * pós-login do self-signup, P-109 L3 / RAD-283, docs/14 §6). Papel `ADMIN_CONSULTORIA`
 * para o primeiro usuário do Tenant — administração de usuários/papéis é escopo
 * posterior (fechamento de docs/14 §6). `email` chega verificado do token
 * (nunca persistido aqui — só o CNPJ/razão social do próprio Tenant, LGPD art. 7º V,
 * parecer RAD-272).
 *
 * Idempotência dupla (docs/14 §6): checagem otimista ANTES de escrever (fast path)
 * e captura das constraints UNIQUE na escrita (race path) — duas requisições
 * concorrentes do mesmo `sub` nunca duplicam Tenant nem AtribuicaoPapel.
 */
export class ProvisionarOrganizacaoUseCase {
  constructor(
    private readonly tenants: TenantRepository,
    private readonly permissoes: PermissaoRepository,
    private readonly tenantIds: TenantIdProvider,
    private readonly eventos: EventPublisher,
  ) {}

  async executar(input: ProvisionarOrganizacaoInput, signal: AbortSignal): Promise<OrganizacaoDTO> {
    const usuarioId = UsuarioId(input.sub);
    const cnpj = Cnpj.criar(input.cnpj);

    const organizacaoExistente = await this.organizacaoDoUsuario(usuarioId, signal);
    if (organizacaoExistente) return organizacaoExistente;

    const tenantPorCnpj = await this.tenants.porCnpj(cnpj, signal);
    if (tenantPorCnpj) throw new OrganizacaoJaExisteError();

    const tenant = Tenant.criar({ id: this.tenantIds.gerar(), cnpj, razaoSocial: input.razaoSocial });

    // Constraint UNIQUE(cnpj) é a defesa de última linha (race entre a checagem
    // acima e este INSERT) — o adapter lança OrganizacaoJaExisteError, que sobe intacta.
    await this.tenants.salvar(tenant, signal);

    const atribuicao = AtribuicaoPapel.criar({
      usuarioId,
      tenantId: tenant.id,
      papel: 'ADMIN_CONSULTORIA',
      clienteFinalIds: [],
    });

    try {
      await this.permissoes.criar(atribuicao, signal);
    } catch (err) {
      if (err instanceof UsuarioJaVinculadoError) {
        const existente = await this.organizacaoDoUsuario(usuarioId, signal);
        if (existente) return existente;
      }
      throw err;
    }

    await this.eventos.publicar(new OrganizacaoProvisionada({ tenantId: tenant.id, sub: input.sub }), signal);

    return organizacaoParaDTO(tenant, atribuicao.papel);
  }

  private async organizacaoDoUsuario(usuarioId: UsuarioId, signal: AbortSignal): Promise<OrganizacaoDTO | null> {
    const atribuicao = await this.permissoes.buscarPorUsuario(usuarioId, { signal });
    if (!atribuicao) return null;

    const tenant = await this.tenants.porId(atribuicao.tenantId, signal);
    if (!tenant) return null;

    return organizacaoParaDTO(tenant, atribuicao.papel);
  }
}
