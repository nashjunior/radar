/**
 * Stress tests — RegistroAuditoria domain entity (AB13/P-61/docs/14 §5).
 * Testa invariantes sob condições adversariais: valores-limite, unicode, entradas malformadas.
 * Não usa infraestrutura real — apenas domínio.
 */
import { describe, expect, it } from 'vitest';
import { ClienteFinalId, TenantId } from '@radar/kernel';
import { AuditLogId, RegistroAuditoria } from '../../domain/entities/registro-auditoria.js';
import { AuditoriaBaseLegalInvalidaError } from '../../domain/errors/index.js';

const TENANT = TenantId('tenant-stress');
const CLIENTE = ClienteFinalId('cliente-stress');
const BASE_ID = AuditLogId('id-stress');
const AGORA = new Date('2026-07-06T00:00:00Z');

function criarBase(overrides?: Partial<Parameters<typeof RegistroAuditoria.criar>[0]>) {
  return RegistroAuditoria.criar({
    id: BASE_ID,
    usuarioId: 'user-1',
    recurso: 'triagem:edital-xyz',
    acao: 'LER',
    baseLegal: 'LGPD art. 7 II',
    escopo: { tenantId: TENANT, clienteFinalId: CLIENTE },
    ocorridoEm: AGORA,
    ...overrides,
  });
}

describe('RegistroAuditoria.criar — invariante baseLegal (não-vazia após trim)', () => {
  // Whitespace exótico — o trim() padrão captura todos estes
  it.each([
    ['string vazia', ''],
    ['só espaços', '   '],
    ['só tab', '\t'],
    ['só newline', '\n'],
    ['só carriage-return', '\r'],
    ['mix whitespace', ' \t\n\r '],
    ['zero-width space (U+200B)', '​'],
    ['non-breaking space (U+00A0)', ' '],
  ])('rejeita baseLegal = %s', (_label, baseLegal) => {
    expect(() => criarBase({ baseLegal })).toThrow(AuditoriaBaseLegalInvalidaError);
  });

  it.each([
    'LGPD art. 7 II',
    'Lei 14.133/2021 art. 12',
    'LAI 12.527/2011',
    'Decreto 12.343/2024',
    ' LGPD art. 7 II ', // espaços nas bordas — válido pois conteúdo não é vazio
  ])('aceita baseLegal válida: "%s"', (baseLegal) => {
    expect(() => criarBase({ baseLegal })).not.toThrow();
  });

  it('aceita baseLegal extremamente longa (4096 chars)', () => {
    const baseLegal = 'LGPD art. 7 II '.repeat(300).slice(0, 4096);
    expect(() => criarBase({ baseLegal })).not.toThrow();
  });
});

describe('RegistroAuditoria.criar — imutabilidade do registro', () => {
  it('cria instâncias distintas com o mesmo id (não são a mesma referência)', () => {
    const r1 = criarBase();
    const r2 = criarBase();
    expect(r1).not.toBe(r2);
    expect(r1.id).toBe(r2.id);
  });

  it('campos são readonly — TypeScript impede mutação em compile-time', () => {
    const r = criarBase();
    // O TS garante em compile-time; verifica que os valores esperados estão corretos
    expect(r.usuarioId).toBe('user-1');
    expect(r.recurso).toBe('triagem:edital-xyz');
    expect(r.acao).toBe('LER');
    expect(r.baseLegal).toBe('LGPD art. 7 II');
    expect(r.ocorridoEm).toBe(AGORA);
  });

  it('escopo sem clienteFinalId — campo é undefined', () => {
    const r = criarBase({ escopo: { tenantId: TENANT } });
    expect(r.escopo.clienteFinalId).toBeUndefined();
    expect(r.escopo.tenantId).toBe(TENANT);
  });
});

describe('RegistroAuditoria.criar — campos de string (sem validação de domínio no código atual)', () => {
  // Documenta o comportamento ATUAL: o domínio não valida estes campos.
  // Se regras forem adicionadas no futuro, estes testes devem ser atualizados.
  it('aceita usuarioId vazio (sem validação hoje)', () => {
    expect(() => criarBase({ usuarioId: '' })).not.toThrow();
  });

  it('aceita acao vazia (sem validação hoje)', () => {
    expect(() => criarBase({ acao: '' })).not.toThrow();
  });

  it('aceita recurso vazio (sem validação hoje)', () => {
    expect(() => criarBase({ recurso: '' })).not.toThrow();
  });

  it('aceita usuarioId com caracteres unicode', () => {
    const r = criarBase({ usuarioId: 'usuário-测试-🔒' });
    expect(r.usuarioId).toBe('usuário-测试-🔒');
  });

  it('aceita recurso com separadores típicos (path/colon)', () => {
    const r = criarBase({ recurso: 'triagem:edital-abc/anexo/001' });
    expect(r.recurso).toBe('triagem:edital-abc/anexo/001');
  });
});

describe('RegistroAuditoria.criar — isolamento de tenant (escopo nunca vaza cross-tenant)', () => {
  it('dois registros com tenants distintos têm escopos isolados', () => {
    const t1 = TenantId('tenant-A');
    const t2 = TenantId('tenant-B');
    const r1 = criarBase({ escopo: { tenantId: t1 } });
    const r2 = criarBase({ escopo: { tenantId: t2 } });
    expect(r1.escopo.tenantId).toBe(t1);
    expect(r2.escopo.tenantId).toBe(t2);
    expect(r1.escopo.tenantId).not.toBe(r2.escopo.tenantId);
  });

  it('dois registros com clienteFinalId distintos têm escopos isolados', () => {
    const c1 = ClienteFinalId('cliente-A');
    const c2 = ClienteFinalId('cliente-B');
    const r1 = criarBase({ escopo: { tenantId: TENANT, clienteFinalId: c1 } });
    const r2 = criarBase({ escopo: { tenantId: TENANT, clienteFinalId: c2 } });
    expect(r1.escopo.clienteFinalId).toBe(c1);
    expect(r2.escopo.clienteFinalId).toBe(c2);
    expect(r1.escopo.clienteFinalId).not.toBe(r2.escopo.clienteFinalId);
  });
});

describe('RegistroAuditoria.criar — estabilidade sob carga (100 registros simultâneos)', () => {
  it('cria 100 registros válidos consecutivos sem erro', () => {
    for (let i = 0; i < 100; i++) {
      const r = RegistroAuditoria.criar({
        id: AuditLogId(`id-${i}`),
        usuarioId: `user-${i}`,
        recurso: `recurso:${i}`,
        acao: i % 2 === 0 ? 'LER' : 'ESCREVER',
        baseLegal: `LGPD art. 7 ${i % 5 === 0 ? 'I' : 'II'}`,
        escopo: { tenantId: TenantId(`t-${i % 3}`), clienteFinalId: ClienteFinalId(`c-${i}`) },
        ocorridoEm: new Date(AGORA.getTime() + i * 1000),
      });
      expect(r.id).toBe(`id-${i}`);
    }
  });

  it('rejeita consistentemente baseLegal inválida nos 100 registros', () => {
    for (let i = 0; i < 100; i++) {
      expect(() =>
        RegistroAuditoria.criar({
          id: AuditLogId(`id-${i}`),
          usuarioId: `user-${i}`,
          recurso: `recurso:${i}`,
          acao: 'LER',
          baseLegal: '',
          escopo: { tenantId: TENANT },
          ocorridoEm: AGORA,
        }),
      ).toThrow(AuditoriaBaseLegalInvalidaError);
    }
  });
});
