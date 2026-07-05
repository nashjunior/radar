import { describe, expect, it } from 'vitest';
import { AlertaId, TenantId } from '@radar/kernel';
import {
  Notificacao,
  NotificacaoId,
  UsuarioId,
} from '../../domain/entities/notificacao.js';
import { Canal } from '../../domain/value-objects/canal.js';

const base = {
  id: NotificacaoId('notif-001'),
  tenantId: TenantId('tenant-a'),
  usuarioId: UsuarioId('usuario-001'),
  alertaId: AlertaId('alerta-001'),
  canal: Canal.criar('EMAIL'),
};

describe('Notificacao', () => {
  describe('criar', () => {
    it('inicia com status PENDENTE', () => {
      const n = Notificacao.criar(base);
      expect(n.status).toBe('PENDENTE');
    });

    it('enviadaEm é undefined ao criar', () => {
      const n = Notificacao.criar(base);
      expect(n.enviadaEm).toBeUndefined();
    });

    it('preserva todos os campos de identidade', () => {
      const n = Notificacao.criar(base);
      expect(n.id).toBe(base.id);
      expect(n.tenantId).toBe(base.tenantId);
      expect(n.usuarioId).toBe(base.usuarioId);
      expect(n.alertaId).toBe(base.alertaId);
      expect(n.canal.tipo).toBe('EMAIL');
    });
  });

  describe('marcarEnviada', () => {
    it('retorna nova instância com status ENVIADA', () => {
      const n = Notificacao.criar(base);
      const enviada = n.marcarEnviada();
      expect(n.status).toBe('PENDENTE');
      expect(enviada.status).toBe('ENVIADA');
    });

    it('define enviadaEm como uma data válida na nova instância', () => {
      const enviada = Notificacao.criar(base).marcarEnviada();
      expect(enviada.enviadaEm).toBeInstanceOf(Date);
    });
  });

  describe('marcarFalhou', () => {
    it('retorna nova instância com status FALHOU', () => {
      const n = Notificacao.criar(base);
      const falhou = n.marcarFalhou();
      expect(n.status).toBe('PENDENTE');
      expect(falhou.status).toBe('FALHOU');
    });

    it('enviadaEm permanece undefined após falha', () => {
      const falhou = Notificacao.criar(base).marcarFalhou();
      expect(falhou.enviadaEm).toBeUndefined();
    });
  });
});
