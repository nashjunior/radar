import { describe, expect, it } from 'vitest';
import { ItemEdital } from '../../domain/entities/item-edital.js';

const baseProps = {
  numeroItem: 1,
  descricao: 'Serviços de TI',
  quantidade: 12,
};

describe('ItemEdital', () => {
  describe('criar', () => {
    it('cria item sem valor unitário (null)', () => {
      const item = ItemEdital.criar(baseProps);
      expect(item.numeroItem).toBe(1);
      expect(item.descricao).toBe('Serviços de TI');
      expect(item.quantidade).toBe(12);
      expect(item.valorUnitarioEstimado).toBeNull();
    });

    it('cria item com valor unitário numérico', () => {
      const item = ItemEdital.criar({ ...baseProps, valorUnitarioEstimado: 500.0 });
      expect(item.valorUnitarioEstimado?.valor).toBe(500);
    });

    it('cria item com valor unitário como string (vindo do PostgreSQL)', () => {
      const item = ItemEdital.criar({ ...baseProps, valorUnitarioEstimado: '1234.50' });
      expect(item.valorUnitarioEstimado?.representacaoDecimal).toBe('1234.50');
    });

    it('trata valorUnitarioEstimado null como ausente', () => {
      const item = ItemEdital.criar({ ...baseProps, valorUnitarioEstimado: null });
      expect(item.valorUnitarioEstimado).toBeNull();
    });

    it('trata valorUnitarioEstimado undefined como ausente', () => {
      const item = ItemEdital.criar({ ...baseProps });
      expect(item.valorUnitarioEstimado).toBeNull();
    });
  });
});
