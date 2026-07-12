import { describe, expect, it } from 'vitest';
import { ClienteFinalId, CriterioId, TenantId } from '@radar/kernel';
import { CriterioDeMonitoramento } from '../../domain/entities/criterio-de-monitoramento.js';
import { FaixaValor } from '../../domain/value-objects/faixa-valor.js';
import { PalavrasChave } from '../../domain/value-objects/palavras-chave.js';
import { CriterioInvalidoError } from '../../domain/errors/index.js';

const base = {
  id: CriterioId('crit-001'),
  tenantId: TenantId('tenant-a'),
  clienteFinalId: ClienteFinalId('cliente-001'),
};

describe('CriterioDeMonitoramento', () => {
  describe('criar', () => {
    it('cria critério com ramo CNAE', () => {
      const c = CriterioDeMonitoramento.criar({ ...base, ramoCnae: '62.01' });
      expect(c.ramoCnae).toBe('62.01');
      expect(c.ativo).toBe(true);
    });

    it('cria critério com palavras-chave', () => {
      const pc = PalavrasChave.criar(['software', 'ti']);
      const c = CriterioDeMonitoramento.criar({ ...base, palavrasChave: pc });
      expect(c.palavrasChave).toBe(pc);
    });

    it('cria critério com ambos (ramo + palavras-chave)', () => {
      const pc = PalavrasChave.criar(['cloud']);
      const c = CriterioDeMonitoramento.criar({ ...base, ramoCnae: '62.01', palavrasChave: pc });
      expect(c.ramoCnae).toBe('62.01');
      expect(c.palavrasChave).toBe(pc);
    });

    it('lança CriterioInvalidoError sem ramo nem palavras-chave', () => {
      expect(() => CriterioDeMonitoramento.criar({ ...base })).toThrow(CriterioInvalidoError);
    });

    it('o erro tem code CRITERIO_INVALIDO', () => {
      try {
        CriterioDeMonitoramento.criar({ ...base });
      } catch (e) {
        expect((e as CriterioInvalidoError).code).toBe('CRITERIO_INVALIDO');
      }
    });

    it('preserva tenantId e clienteFinalId', () => {
      const c = CriterioDeMonitoramento.criar({ ...base, ramoCnae: '62.01' });
      expect(c.tenantId).toBe(base.tenantId);
      expect(c.clienteFinalId).toBe(base.clienteFinalId);
    });

    it('campos opcionais ausentes ficam null', () => {
      const c = CriterioDeMonitoramento.criar({ ...base, ramoCnae: '62.01' });
      expect(c.regiaoUf).toBeNull();
      expect(c.faixaValor).toBeNull();
      expect(c.palavrasChave).toBeNull();
    });

    it('critério novo começa ativo', () => {
      const c = CriterioDeMonitoramento.criar({ ...base, ramoCnae: '62.01' });
      expect(c.ativo).toBe(true);
    });
  });

  describe('reconstituir', () => {
    it('permite reconstituir com ativo = false (estado de persistência)', () => {
      const c = CriterioDeMonitoramento.reconstituir({ ...base, ramoCnae: '62.01', ativo: false });
      expect(c.ativo).toBe(false);
    });

    it('não valida invariantes de criação — aceita critério sem ramo nem palavras-chave', () => {
      expect(() =>
        CriterioDeMonitoramento.reconstituir({ ...base, ativo: true }),
      ).not.toThrow();
    });
  });

  describe('casaCom', () => {
    it('retorna AderenciaMatching quando todos os filtros e palavras-chave casam', () => {
      const criterio = CriterioDeMonitoramento.criar({
        ...base,
        ramoCnae: '62.01',
        regiaoUf: 'SP',
        faixaValor: FaixaValor.criar(10_000, 500_000),
        palavrasChave: PalavrasChave.criar(['cloud', 'erp']),
      });

      const aderencia = criterio.casaCom({
        objetoDescricao: 'Contratação de ERP em cloud para gestão pública',
        uf: 'SP',
        cnae: '62.01',
        valorEstimado: 120_000,
      });

      expect(aderencia).not.toBeNull();
      expect(aderencia!.valor).toBe(1);
    });

    it('retorna score parcial (recall) quando só parte das palavras-chave casa', () => {
      const criterio = CriterioDeMonitoramento.criar({
        ...base,
        palavrasChave: PalavrasChave.criar(['cloud', 'erp']),
      });

      const aderencia = criterio.casaCom({
        objetoDescricao: 'Contratação de ERP para gestão pública',
        uf: null,
        cnae: null,
        valorEstimado: null,
      });

      expect(aderencia).not.toBeNull();
      expect(aderencia!.valor).toBe(0.5);
      expect(aderencia!.superaLimiar).toBe(true);
    });

    it('retorna AderenciaMatching(0) quando nenhuma palavra-chave casa', () => {
      const criterio = CriterioDeMonitoramento.criar({
        ...base,
        palavrasChave: PalavrasChave.criar(['cloud', 'erp']),
      });

      const aderencia = criterio.casaCom({
        objetoDescricao: 'Aquisição de material de limpeza',
        uf: null,
        cnae: null,
        valorEstimado: null,
      });

      expect(aderencia).not.toBeNull();
      expect(aderencia!.valor).toBe(0);
      expect(aderencia!.superaLimiar).toBe(false);
    });

    it('retorna null quando CNAE não casa', () => {
      const criterio = CriterioDeMonitoramento.criar({
        ...base,
        ramoCnae: '62.01',
        regiaoUf: 'SP',
        faixaValor: FaixaValor.criar(10_000, 500_000),
      });

      expect(
        criterio.casaCom({
          objetoDescricao: 'Serviços de software',
          uf: 'SP',
          cnae: '47.51',
          valorEstimado: 120_000,
        }),
      ).toBeNull();
    });

    it('retorna null quando UF não casa', () => {
      const criterio = CriterioDeMonitoramento.criar({
        ...base,
        ramoCnae: '62.01',
        regiaoUf: 'SP',
        faixaValor: FaixaValor.criar(10_000, 500_000),
      });

      expect(
        criterio.casaCom({
          objetoDescricao: 'Serviços de software',
          uf: 'RJ',
          cnae: '62.01',
          valorEstimado: 120_000,
        }),
      ).toBeNull();
    });

    it('retorna null quando valor estimado está fora da faixa', () => {
      const criterio = CriterioDeMonitoramento.criar({
        ...base,
        ramoCnae: '62.01',
        regiaoUf: 'SP',
        faixaValor: FaixaValor.criar(10_000, 500_000),
      });

      expect(
        criterio.casaCom({
          objetoDescricao: 'Serviços de software',
          uf: 'SP',
          cnae: '62.01',
          valorEstimado: 1_000_000,
        }),
      ).toBeNull();
    });

    it('retorna null quando critério exige faixa mas edital não informa valor estimado', () => {
      const criterio = CriterioDeMonitoramento.criar({
        ...base,
        ramoCnae: '62.01',
        faixaValor: FaixaValor.criar(10_000, null),
      });

      expect(
        criterio.casaCom({
          objetoDescricao: 'Serviços de software',
          uf: 'SP',
          cnae: '62.01',
          valorEstimado: null,
        }),
      ).toBeNull();
    });
  });
});
