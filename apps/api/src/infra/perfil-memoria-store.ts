/**
 * Persistência em memória do Perfil de Habilitação (demo local).
 * Substitui perfilRepositoryStub no composition root.
 */

import { ClienteFinalId, PerfilId, TenantId } from '@radar/kernel';
import { PerfilHabilitacao } from '@radar/identidade';
import type { PerfilRepository } from '@radar/identidade';

function chave(tenantId: string, clienteFinalId: string): string {
  return `${tenantId}::${clienteFinalId}`;
}

const TENANT = 'tenant-local-dev';
const CLIENTE = '11111111-1111-4111-8111-111111111111';
const PERFIL = '22222222-2222-4222-8222-222222222222';

/** Seed alinhado ao TENANT_SEED — checklist de habilitação + competitividade. */
function seedInicial(): PerfilHabilitacao {
  return PerfilHabilitacao.criar({
    id: PerfilId(PERFIL),
    tenantId: TenantId(TENANT),
    clienteFinalId: ClienteFinalId(CLIENTE),
    habJuridica: [
      'Tipo: Sociedade Limitada (Ltda)',
      'Contrato social atualizado com objeto compatível com TI / software',
      'Sem falência/recuperação judicial',
    ],
    habFiscal: [
      'CND Federal (RFB/PGFN): regular',
      'CRF FGTS: regular',
      'CNDT (Justiça do Trabalho): regular',
      'Certidões estadual e municipal: regular',
    ],
    habTecnica: [
      'CNAE principal: 6201-5/01 — Desenvolvimento de programas de computador sob encomenda',
      'CNAEs secundários: 6202-3/00, 6209-1/00',
      'Porte: EPP',
      'Atestados de capacidade técnica em desenvolvimento e sustentação de software',
      'Equipe apta a demandas remotas; deslocamento sob demanda',
    ],
    habEconomica: [
      'Regime tributário: Simples Nacional',
      'Capital social: R$ 100.000,00',
      'Balanço patrimonial do último exercício disponível',
      'Índices de liquidez compatíveis com contratos de médio porte',
    ],
  });
}

export function criarPerfilMemoriaStore(): PerfilRepository {
  const map = new Map<string, PerfilHabilitacao>();
  const inicial = seedInicial();
  map.set(chave(inicial.tenantId, inicial.clienteFinalId), inicial);

  return {
    async porClienteFinal(tenantId, clienteFinalId, signal) {
      signal.throwIfAborted();
      return map.get(chave(tenantId, clienteFinalId)) ?? null;
    },
    async salvar(perfil, signal) {
      signal.throwIfAborted();
      map.set(chave(perfil.tenantId, perfil.clienteFinalId), perfil);
    },
  };
}

/** Texto concatenado das 4 dims — usado no chat demo como perfil da empresa. */
export function perfilParaTextoChat(perfil: PerfilHabilitacao): string {
  const blocos = [
    ['Habilitação jurídica', perfil.habJuridica],
    ['Habilitação fiscal/trabalhista', perfil.habFiscal],
    ['Qualificação técnica', perfil.habTecnica],
    ['Qualificação econômico-financeira', perfil.habEconomica],
  ] as const;
  return blocos
    .map(([titulo, itens]) => `${titulo}:\n${itens.map((i) => `- ${i}`).join('\n')}`)
    .join('\n\n');
}
