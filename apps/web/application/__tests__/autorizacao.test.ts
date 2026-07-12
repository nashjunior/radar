import { describe, it, expect } from 'vitest';
import { podeExecutar } from '../autorizacao';

describe('podeExecutar — RBAC matrix (docs/05 §4)', () => {
  describe('ADMIN_CONSULTORIA', () => {
    it('pode ler e editar critérios', () => {
      expect(podeExecutar('ADMIN_CONSULTORIA', 'CRITERIO_MONITORAMENTO', 'ler')).toBe(true);
      expect(podeExecutar('ADMIN_CONSULTORIA', 'CRITERIO_MONITORAMENTO', 'editar')).toBe(true);
    });
    it('pode decidir triagem', () => {
      expect(podeExecutar('ADMIN_CONSULTORIA', 'TRIAGEM', 'editar')).toBe(true);
    });
    it('pode gerenciar usuários/papéis', () => {
      expect(podeExecutar('ADMIN_CONSULTORIA', 'USUARIO_PAPEL', 'editar')).toBe(true);
    });
  });

  describe('OPERADOR', () => {
    it('pode criar critérios e registrar decisão', () => {
      expect(podeExecutar('OPERADOR', 'CRITERIO_MONITORAMENTO', 'editar')).toBe(true);
      expect(podeExecutar('OPERADOR', 'TRIAGEM', 'editar')).toBe(true);
    });
    it('não pode gerenciar usuários/papéis', () => {
      expect(podeExecutar('OPERADOR', 'USUARIO_PAPEL', 'editar')).toBe(false);
      expect(podeExecutar('OPERADOR', 'USUARIO_PAPEL', 'ler')).toBe(false);
    });
  });

  describe('CLIENTE_FINAL_READONLY', () => {
    it('pode ler alertas, triagem, critérios e perfil', () => {
      expect(podeExecutar('CLIENTE_FINAL_READONLY', 'ALERTA', 'ler')).toBe(true);
      expect(podeExecutar('CLIENTE_FINAL_READONLY', 'TRIAGEM', 'ler')).toBe(true);
      expect(podeExecutar('CLIENTE_FINAL_READONLY', 'CRITERIO_MONITORAMENTO', 'ler')).toBe(true);
      expect(podeExecutar('CLIENTE_FINAL_READONLY', 'PERFIL_HABILITACAO', 'ler')).toBe(true);
    });

    it('não pode editar critérios', () => {
      expect(podeExecutar('CLIENTE_FINAL_READONLY', 'CRITERIO_MONITORAMENTO', 'editar')).toBe(false);
    });

    it('não pode registrar decisão de triagem (editar)', () => {
      expect(podeExecutar('CLIENTE_FINAL_READONLY', 'TRIAGEM', 'editar')).toBe(false);
    });

    it('não pode editar perfil de habilitação (CLIENTE_READONLY)', () => {
      expect(podeExecutar('CLIENTE_FINAL_READONLY', 'PERFIL_HABILITACAO', 'editar')).toBe(false);
    });

    it('pode editar preferências de notificação próprias', () => {
      expect(podeExecutar('CLIENTE_FINAL_READONLY', 'PREFERENCIA_NOTIFICACAO', 'editar')).toBe(true);
    });

    it('não pode registrar feedback em alertas', () => {
      expect(podeExecutar('CLIENTE_FINAL_READONLY', 'ALERTA', 'editar')).toBe(false);
    });
  });

  describe('DPO_COMPLIANCE', () => {
    it('não pode ler/editar critérios, alertas, triagem ou perfil', () => {
      expect(podeExecutar('DPO_COMPLIANCE', 'CRITERIO_MONITORAMENTO', 'ler')).toBe(false);
      expect(podeExecutar('DPO_COMPLIANCE', 'ALERTA', 'ler')).toBe(false);
      expect(podeExecutar('DPO_COMPLIANCE', 'TRIAGEM', 'editar')).toBe(false);
      expect(podeExecutar('DPO_COMPLIANCE', 'PERFIL_HABILITACAO', 'editar')).toBe(false);
    });
  });

  describe('papel desconhecido / fail-closed', () => {
    it('nega acesso por padrão (fail-closed)', () => {
      expect(podeExecutar('DESCONHECIDO' as never, 'TRIAGEM', 'editar')).toBe(false);
    });
  });
});
