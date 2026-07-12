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
    it('cria critério com UF como filtro efetivo', () => {
      const c = CriterioDeMonitoramento.criar({ ...base, regiaoUf: 'SP' });
      expect(c.regiaoUf).toBe('SP');
      expect(c.ativo).toBe(true);
    });

    it('cria critério com palavras-chave', () => {
      const pc = PalavrasChave.criar(['software', 'ti']);
      const c = CriterioDeMonitoramento.criar({ ...base, palavrasChave: pc });
      expect(c.palavrasChave).toBe(pc);
    });

    it('lança CriterioInvalidoError sem palavras-chave, UF ou faixa de valor', () => {
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
      const c = CriterioDeMonitoramento.criar({ ...base, palavrasChave: PalavrasChave.criar(['ti']) });
      expect(c.tenantId).toBe(base.tenantId);
      expect(c.clienteFinalId).toBe(base.clienteFinalId);
    });

    it('campos opcionais ausentes ficam null', () => {
      const c = CriterioDeMonitoramento.criar({ ...base, palavrasChave: PalavrasChave.criar(['ti']) });
      expect(c.regiaoUf).toBeNull();
      expect(c.faixaValor).toBeNull();
      expect(c.ramoCnae).toBeNull();
    });

    it('critério novo começa ativo', () => {
      const c = CriterioDeMonitoramento.criar({ ...base, palavrasChave: PalavrasChave.criar(['ti']) });
      expect(c.ativo).toBe(true);
    });
  });

  describe('reconstituir', () => {
    it('permite reconstituir CNAE legado com ativo = false (estado de persistência)', () => {
      const c = CriterioDeMonitoramento.reconstituir({ ...base, ramoCnae: '62.01', ativo: false });
      expect(c.ativo).toBe(false);
      expect(c.ramoCnae).toBe('62.01');
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

    it('retorna score proporcional quando parte das palavras-chave casa', () => {
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
        objetoDescricao: 'Serviços de limpeza predial',
        uf: null,
        cnae: null,
        valorEstimado: null,
      });

      expect(aderencia).not.toBeNull();
      expect(aderencia!.valor).toBe(0);
      expect(aderencia!.superaLimiar).toBe(false);
    });

    it('retorna score 0.8 e alta aderência quando 4 de 5 termos casam', () => {
      const criterio = CriterioDeMonitoramento.criar({
        ...base,
        palavrasChave: PalavrasChave.criar(['software', 'nuvem', 'erp', 'gestão', 'hospital']),
      });

      const aderencia = criterio.casaCom({
        objetoDescricao: 'Contratação de software ERP em nuvem para gestão pública',
        uf: null,
        cnae: null,
        valorEstimado: null,
      });

      expect(aderencia).not.toBeNull();
      expect(aderencia!.valor).toBe(0.8);
      expect(aderencia!.ehAlta).toBe(true);
    });

    it('casa palavra-chave acentuada com objeto sem acento', () => {
      const criterio = CriterioDeMonitoramento.criar({
        ...base,
        palavrasChave: PalavrasChave.criar(['gestão']),
      });

      const aderencia = criterio.casaCom({
        objetoDescricao: 'Contratacao de sistema para gestao publica',
        uf: null,
        cnae: null,
        valorEstimado: null,
      });

      expect(aderencia).not.toBeNull();
      expect(aderencia!.valor).toBe(1);
      expect(aderencia!.superaLimiar).toBe(true);
    });

    it('casa keyword sem acento com objeto COM acento — direção real do bug RAD-306', () => {
      // Bug original: objeto.toLowerCase() não strip diacríticos → 'gestão' ≠ 'gestao'
      // Fix: normalizarTextoParaCasamento strip NFD de ambos os lados
      const criterio = CriterioDeMonitoramento.criar({
        ...base,
        palavrasChave: PalavrasChave.criar(['gestao']),
      });

      const aderencia = criterio.casaCom({
        objetoDescricao: 'Contratação de sistema para gestão pública',
        uf: null,
        cnae: null,
        valorEstimado: null,
      });

      expect(aderencia).not.toBeNull();
      expect(aderencia!.valor).toBe(1);
      expect(aderencia!.superaLimiar).toBe(true);
    });

    it('casa keywords brasileiras com acentos variados — ç ã ê ó î ü — em objeto acentuado (RAD-306)', () => {
      const criterio = CriterioDeMonitoramento.criar({
        ...base,
        palavrasChave: PalavrasChave.criar(['construção', 'manutenção', 'aquisição']),
      });

      const aderencia = criterio.casaCom({
        objetoDescricao:
          'Contratação de serviços de construção e manutenção predial e aquisição de materiais',
        uf: null,
        cnae: null,
        valorEstimado: null,
      });

      expect(aderencia).not.toBeNull();
      expect(aderencia!.valor).toBe(1);
    });

    it('1 de 4 keywords casa: score 0.25 — abaixo do superaLimiar 0.3 → sem alerta', () => {
      // Boundary: proporção < 0.3 = recall-alto limiar (docs/11 §2)
      // Antes do RAD-306: binário — partial match = 0; agora proporcional mas abaixo do limiar
      const criterio = CriterioDeMonitoramento.criar({
        ...base,
        palavrasChave: PalavrasChave.criar(['software', 'erp', 'nuvem', 'hospital']),
      });

      const aderencia = criterio.casaCom({
        objetoDescricao: 'Contratação de sistema hospitalar',
        uf: null,
        cnae: null,
        valorEstimado: null,
      });

      expect(aderencia).not.toBeNull();
      expect(aderencia!.valor).toBeCloseTo(0.25, 10);
      expect(aderencia!.superaLimiar).toBe(false);
    });

    it('1 de 3 keywords casa: score 0.333 — exatamente acima do limiar 0.3 → gera alerta', () => {
      // Boundary: 1/3 ≈ 0.333 > 0.3 → superaLimiar true (alerta gerado)
      const criterio = CriterioDeMonitoramento.criar({
        ...base,
        palavrasChave: PalavrasChave.criar(['software', 'erp', 'hospitalar']),
      });

      const aderencia = criterio.casaCom({
        objetoDescricao: 'Contratação de sistema hospitalar',
        uf: null,
        cnae: null,
        valorEstimado: null,
      });

      expect(aderencia).not.toBeNull();
      expect(aderencia!.valor).toBeCloseTo(1 / 3, 10);
      expect(aderencia!.superaLimiar).toBe(true);
    });

    it('ignora CNAE legado no casamento porque PNCP não informa CNAE da contratação', () => {
      const criterio = CriterioDeMonitoramento.reconstituir({
        ...base,
        ramoCnae: '62.01',
        palavrasChave: PalavrasChave.criar(['software']),
        ativo: true,
      });

      const aderencia = criterio.casaCom({
        objetoDescricao: 'Serviços de software',
        uf: 'SP',
        cnae: null,
        valorEstimado: 120_000,
      });

      expect(aderencia).not.toBeNull();
      expect(aderencia!.valor).toBe(1);
    });

    it('critério legado só-CNAE deixa de ficar mudo e casa com score neutro', () => {
      const criterio = CriterioDeMonitoramento.reconstituir({
        ...base,
        ramoCnae: '62.01',
        ativo: true,
      });

      const aderencia = criterio.casaCom({
        objetoDescricao: 'Serviços de limpeza predial',
        uf: null,
        cnae: null,
        valorEstimado: null,
      });

      expect(aderencia).not.toBeNull();
      expect(aderencia!.valor).toBe(0.5);
      expect(aderencia!.superaLimiar).toBe(true);
    });

    it('retorna null quando UF não casa', () => {
      const criterio = CriterioDeMonitoramento.criar({
        ...base,
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
