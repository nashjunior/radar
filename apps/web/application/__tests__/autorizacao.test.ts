import { describe, it, expect } from 'vitest';
import { podeExecutar } from '../autorizacao';

describe('podeExecutar — RBAC matrix (docs/05 §4)', () => {
  describe('ADMIN_CONSULTORIA', () => {
    it('pode ler e escrever critérios', () => {
      expect(podeExecutar('ADMIN_CONSULTORIA', 'CRITERIO_MONITORAMENTO', 'ler')).toBe(true);
      expect(podeExecutar('ADMIN_CONSULTORIA', 'CRITERIO_MONITORAMENTO', 'escrever')).toBe(true);
    });
    it('pode decidir triagem', () => {
      expect(podeExecutar('ADMIN_CONSULTORIA', 'TRIAGEM', 'escrever')).toBe(true);
    });
    it('pode gerenciar usuários/papéis', () => {
      expect(podeExecutar('ADMIN_CONSULTORIA', 'USUARIO_PAPEL', 'escrever')).toBe(true);
    });
  });

  describe('OPERADOR', () => {
    it('pode criar critérios e registrar decisão', () => {
      expect(podeExecutar('OPERADOR', 'CRITERIO_MONITORAMENTO', 'escrever')).toBe(true);
      expect(podeExecutar('OPERADOR', 'TRIAGEM', 'escrever')).toBe(true);
    });
    it('não pode gerenciar usuários/papéis', () => {
      expect(podeExecutar('OPERADOR', 'USUARIO_PAPEL', 'escrever')).toBe(false);
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

    it('não pode escrever critérios', () => {
      expect(podeExecutar('CLIENTE_FINAL_READONLY', 'CRITERIO_MONITORAMENTO', 'escrever')).toBe(false);
    });

    it('não pode registrar decisão de triagem', () => {
      expect(podeExecutar('CLIENTE_FINAL_READONLY', 'TRIAGEM', 'escrever')).toBe(false);
    });

    it('não pode editar perfil de habilitação', () => {
      expect(podeExecutar('CLIENTE_FINAL_READONLY', 'PERFIL_HABILITACAO', 'escrever')).toBe(false);
    });

    it('pode editar preferências de notificação próprias', () => {
      expect(podeExecutar('CLIENTE_FINAL_READONLY', 'PREFERENCIA_NOTIFICACAO', 'escrever')).toBe(true);
    });

    it('não pode registrar feedback em alertas', () => {
      expect(podeExecutar('CLIENTE_FINAL_READONLY', 'ALERTA', 'escrever')).toBe(false);
    });
  });

  describe('DPO_COMPLIANCE', () => {
    it('não pode ler/escrever critérios, alertas, triagem ou perfil', () => {
      expect(podeExecutar('DPO_COMPLIANCE', 'CRITERIO_MONITORAMENTO', 'ler')).toBe(false);
      expect(podeExecutar('DPO_COMPLIANCE', 'ALERTA', 'ler')).toBe(false);
      expect(podeExecutar('DPO_COMPLIANCE', 'TRIAGEM', 'escrever')).toBe(false);
      expect(podeExecutar('DPO_COMPLIANCE', 'PERFIL_HABILITACAO', 'escrever')).toBe(false);
    });
  });

  describe('papel desconhecido / fail-closed', () => {
    it('nega acesso por padrão', () => {
      expect(podeExecutar('DESCONHECIDO' as never, 'TRIAGEM', 'escrever')).toBe(false);
    });
  });
});
