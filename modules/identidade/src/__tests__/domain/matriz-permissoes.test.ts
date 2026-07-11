import { describe, expect, it } from 'vitest';
import { podeExecutar } from '../../domain/matriz-permissoes.js';
import type { Acao, Recurso } from '../../domain/matriz-permissoes.js';
import type { Papel } from '../../domain/papel.js';

const PAPEIS: readonly Papel[] = ['ADMIN_CONSULTORIA', 'OPERADOR', 'CLIENTE_FINAL_READONLY', 'DPO_COMPLIANCE'];
const RECURSOS: readonly Recurso[] = [
  'USUARIO_PAPEL',
  'CRITERIO_MONITORAMENTO',
  'ALERTA',
  'TRIAGEM',
  'PERFIL_HABILITACAO',
  'PREFERENCIA_NOTIFICACAO',
  'AUDIT_LOG',
  'SOLICITACAO_TITULAR',
];
const ACOES: readonly Acao[] = ['ler', 'criar', 'editar', 'decidir', 'gerenciar'];

describe('podeExecutar (matriz docs/05 §4, P-52)', () => {
  it('deny by default: combinação ausente da matriz nega', () => {
    for (const papel of PAPEIS) {
      for (const recurso of RECURSOS) {
        for (const acao of ACOES) {
          expect(typeof podeExecutar(papel, recurso, acao)).toBe('boolean');
        }
      }
    }
    // amostra concreta de combinações nunca declaradas
    expect(podeExecutar('ADMIN_CONSULTORIA', 'SOLICITACAO_TITULAR', 'decidir')).toBe(false);
    expect(podeExecutar('OPERADOR', 'AUDIT_LOG', 'ler')).toBe(false);
  });

  it('operador não gerencia USUARIO_PAPEL (AB2)', () => {
    expect(podeExecutar('OPERADOR', 'USUARIO_PAPEL', 'gerenciar')).toBe(false);
    expect(podeExecutar('ADMIN_CONSULTORIA', 'USUARIO_PAPEL', 'gerenciar')).toBe(true);
  });

  it('cliente-final read-only não escreve domínio, exceto as próprias preferências (AB2)', () => {
    // única escrita permitida ao read-only: ajustar as próprias preferências de notificação (docs/05 §4)
    const RECURSOS_SOMENTE_LEITURA = RECURSOS.filter((r) => r !== 'PREFERENCIA_NOTIFICACAO');
    for (const recurso of RECURSOS_SOMENTE_LEITURA) {
      for (const acao of ['criar', 'editar', 'decidir', 'gerenciar'] as const) {
        expect(podeExecutar('CLIENTE_FINAL_READONLY', recurso, acao)).toBe(false);
      }
    }
    expect(podeExecutar('CLIENTE_FINAL_READONLY', 'ALERTA', 'ler')).toBe(true);
    expect(podeExecutar('CLIENTE_FINAL_READONLY', 'PREFERENCIA_NOTIFICACAO', 'editar')).toBe(true);
    expect(podeExecutar('CLIENTE_FINAL_READONLY', 'PREFERENCIA_NOTIFICACAO', 'criar')).toBe(false);
  });

  it('AUDIT_LOG e SOLICITACAO_TITULAR restritos a DPO/Admin (AB2)', () => {
    expect(podeExecutar('DPO_COMPLIANCE', 'AUDIT_LOG', 'ler')).toBe(true);
    expect(podeExecutar('ADMIN_CONSULTORIA', 'AUDIT_LOG', 'ler')).toBe(true);
    expect(podeExecutar('OPERADOR', 'AUDIT_LOG', 'ler')).toBe(false);
    expect(podeExecutar('CLIENTE_FINAL_READONLY', 'AUDIT_LOG', 'ler')).toBe(false);

    expect(podeExecutar('DPO_COMPLIANCE', 'SOLICITACAO_TITULAR', 'decidir')).toBe(true);
    expect(podeExecutar('OPERADOR', 'SOLICITACAO_TITULAR', 'decidir')).toBe(false);
    expect(podeExecutar('CLIENTE_FINAL_READONLY', 'SOLICITACAO_TITULAR', 'decidir')).toBe(false);
  });

  it('operador tem escopo operacional (critérios, alertas, triagem, perfil, preferências)', () => {
    expect(podeExecutar('OPERADOR', 'CRITERIO_MONITORAMENTO', 'criar')).toBe(true);
    expect(podeExecutar('OPERADOR', 'CRITERIO_MONITORAMENTO', 'editar')).toBe(true);
    expect(podeExecutar('OPERADOR', 'ALERTA', 'decidir')).toBe(true);
    expect(podeExecutar('OPERADOR', 'TRIAGEM', 'criar')).toBe(true);
    expect(podeExecutar('OPERADOR', 'TRIAGEM', 'decidir')).toBe(true);
    expect(podeExecutar('OPERADOR', 'PERFIL_HABILITACAO', 'editar')).toBe(true);
    expect(podeExecutar('OPERADOR', 'PREFERENCIA_NOTIFICACAO', 'editar')).toBe(true);
  });

  it('DPO/Compliance não acessa recursos operacionais fora de AUDIT_LOG/SOLICITACAO_TITULAR', () => {
    expect(podeExecutar('DPO_COMPLIANCE', 'CRITERIO_MONITORAMENTO', 'ler')).toBe(false);
    expect(podeExecutar('DPO_COMPLIANCE', 'ALERTA', 'ler')).toBe(false);
    expect(podeExecutar('DPO_COMPLIANCE', 'TRIAGEM', 'ler')).toBe(false);
    expect(podeExecutar('DPO_COMPLIANCE', 'PERFIL_HABILITACAO', 'ler')).toBe(false);
    expect(podeExecutar('DPO_COMPLIANCE', 'PREFERENCIA_NOTIFICACAO', 'editar')).toBe(false);
  });
});
