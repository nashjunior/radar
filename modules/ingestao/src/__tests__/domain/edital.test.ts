import { describe, expect, it } from 'vitest';
import { EditalId } from '@radar/kernel';
import { Edital } from '../../domain/entities/edital.js';

const CNPJ_VALIDO = '11222333000181';

const baseProps = {
  id: EditalId('edital-001'),
  numeroControlePncp: '00394502000167-1-000001/2024',
  modalidadeCodigo: 6,
  modalidadeNome: 'Concorrência',
  faseAtual: 'Publicado',
  objeto: 'Aquisição de equipamentos de TI',
  valorEstimado: 500000,
  prazoProposta: new Date('2024-03-15T23:59:00Z'),
  dataPublicacao: new Date('2024-01-10T10:00:00Z'),
  dataAtualizacao: new Date('2024-01-10T10:00:00Z'),
  orgao: {
    cnpj: CNPJ_VALIDO,
    nome: 'Prefeitura de São Paulo',
    uf: 'SP',
    municipio: 'São Paulo',
  },
  proveniencia: {
    fonte: 'PNCP',
    baseLegal: 'Lei 14.133/2021, art. 174',
    coletadoEm: new Date('2024-01-10T11:00:00Z'),
  },
  itens: [
    { numeroItem: 1, descricao: 'Notebook', quantidade: 10, valorUnitarioEstimado: 5000 },
  ],
};

describe('Edital', () => {
  describe('criar', () => {
    it('cria edital com todos os campos obrigatórios', () => {
      const e = Edital.criar(baseProps);
      expect(e.id).toBe(baseProps.id);
      expect(e.faseAtual).toBe('Publicado');
      expect(e.objeto).toBe('Aquisição de equipamentos de TI');
    });

    it('valida e converte o CNPJ do órgão para VO', () => {
      const e = Edital.criar(baseProps);
      expect(e.orgao.cnpj.valor).toBe(CNPJ_VALIDO);
    });

    it('converte numeroControlePncp para VO', () => {
      const e = Edital.criar(baseProps);
      expect(e.numeroControlePncp.valor).toBe(baseProps.numeroControlePncp);
    });

    it('converte valorEstimado numérico para ValorMonetario', () => {
      const e = Edital.criar(baseProps);
      expect(e.valorEstimado?.valor).toBe(500000);
    });

    it('aceita valorEstimado null', () => {
      const e = Edital.criar({ ...baseProps, valorEstimado: null });
      expect(e.valorEstimado).toBeNull();
    });

    it('aceita valorEstimado como string do PostgreSQL', () => {
      const e = Edital.criar({ ...baseProps, valorEstimado: '500000.00' });
      expect(e.valorEstimado?.representacaoDecimal).toBe('500000.00');
    });

    it('cria itens como ItemEdital[]', () => {
      const e = Edital.criar(baseProps);
      expect(e.itens).toHaveLength(1);
      expect(e.itens[0]!.descricao).toBe('Notebook');
    });

    it('cria edital sem itens', () => {
      const e = Edital.criar({ ...baseProps, itens: [] });
      expect(e.itens).toHaveLength(0);
    });

    it('lança ao receber CNPJ inválido', () => {
      expect(() =>
        Edital.criar({ ...baseProps, orgao: { ...baseProps.orgao, cnpj: '00000000000000' } }),
      ).toThrow();
    });

    it('lança ao receber modalidadeCodigo inválido (0)', () => {
      expect(() =>
        Edital.criar({ ...baseProps, modalidadeCodigo: 0 }),
      ).toThrow();
    });
  });

  describe('atualizarFase', () => {
    it('retorna nova instância com a nova fase — imutável', () => {
      const e = Edital.criar(baseProps);
      const novaData = new Date('2024-02-01T00:00:00Z');
      const atualizado = e.atualizarFase('Homologado', novaData);

      expect(e.faseAtual).toBe('Publicado');
      expect(atualizado.faseAtual).toBe('Homologado');
      expect(atualizado.id).toBe(e.id);
    });

    it('atualiza dataAtualizacao na nova instância', () => {
      const e = Edital.criar(baseProps);
      const novaData = new Date('2024-02-01T00:00:00Z');
      const atualizado = e.atualizarFase('Homologado', novaData);
      expect(atualizado.dataAtualizacao).toBe(novaData);
    });

    it('preserva todos os demais campos na nova instância', () => {
      const e = Edital.criar(baseProps);
      const atualizado = e.atualizarFase('Cancelado', new Date());
      expect(atualizado.objeto).toBe(e.objeto);
      expect(atualizado.orgao).toBe(e.orgao);
      expect(atualizado.itens).toBe(e.itens);
    });
  });
});
