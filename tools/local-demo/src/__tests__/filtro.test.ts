import { describe, expect, it } from 'vitest';
import type { ContratacaoData } from '@radar/ingestao';
import { filtrarContratacoes, lerFiltroDoEnv } from '../filtro.js';

function fake(over: Partial<ContratacaoData> = {}): ContratacaoData {
  return {
    numeroControlePncp: '00-1-000001/2026',
    modalidadeCodigo: 6,
    modalidadeNome: 'Pregão - Eletrônico',
    faseAtual: 'Recebimento de propostas',
    objeto: 'Contratação de serviços de tecnologia da informação',
    valorEstimado: 250_000,
    prazoProposta: null,
    dataPublicacao: new Date('2026-07-01'),
    dataAtualizacao: new Date('2026-07-01'),
    orgao: { cnpj: '00000000000191', nome: 'Órgão X', uf: 'SP', municipio: 'São Paulo' },
    itens: [],
    ...over,
  };
}

describe('filtrarContratacoes', () => {
  const base = [
    fake(),
    fake({
      numeroControlePncp: '00-1-000002/2026',
      objeto: 'Aquisição de material de limpeza',
      orgao: { cnpj: '1', nome: 'Y', uf: 'RJ', municipio: 'Rio' },
      valorEstimado: 50_000,
    }),
  ];

  it('filtra por palavra-chave (normalizada)', () => {
    const out = filtrarContratacoes(base, {
      palavrasChave: ['tecnologia'],
      uf: null,
      valorMax: null,
    });
    expect(out).toHaveLength(1);
    expect(out[0]!.objeto).toMatch(/tecnologia/i);
  });

  it('filtra por UF e valor máximo', () => {
    const out = filtrarContratacoes(base, {
      palavrasChave: [],
      uf: 'SP',
      valorMax: 300_000,
    });
    expect(out).toHaveLength(1);
    expect(out[0]!.orgao.uf).toBe('SP');
  });
});

describe('lerFiltroDoEnv', () => {
  it('parseia DEMO_*', () => {
    const f = lerFiltroDoEnv({
      DEMO_PALAVRAS_CHAVE: 'ti, software',
      DEMO_UF: 'sp',
      DEMO_VALOR_MAX: '100000',
    });
    expect(f.palavrasChave).toEqual(['ti', 'software']);
    expect(f.uf).toBe('sp');
    expect(f.valorMax).toBe(100_000);
  });
});
