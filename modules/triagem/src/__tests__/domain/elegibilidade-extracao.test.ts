import { describe, expect, it } from 'vitest';
import { EditalId } from '@radar/kernel';
import { avaliarElegibilidadeExtracao } from '../../domain/elegibilidade-extracao.js';
import { ExtracaoEdital } from '../../domain/extracao-edital.js';
import { CampoExtraido } from '../../domain/value-objects/campo-extraido.js';
import { Citacao } from '../../domain/value-objects/citacao.js';
import { Confianca } from '../../domain/value-objects/confianca.js';

function fakeExtracao(): ExtracaoEdital {
  return ExtracaoEdital.montar({
    editalId: EditalId('edital-1'),
    objeto: CampoExtraido.criar({
      valor: 'objeto',
      confianca: Confianca.criar(0.9),
      citacao: Citacao.criar(1, 'trecho'),
      critico: true,
    }),
    valorEstimado: CampoExtraido.criar<number | null>({
      valor: null,
      confianca: Confianca.criar(0.9),
      citacao: null,
      critico: false,
    }),
    dataAberturaPropostas: CampoExtraido.criar<Date | null>({
      valor: null,
      confianca: Confianca.criar(0.9),
      citacao: null,
      critico: false,
    }),
    requisitos: [],
    riscosBrutos: [],
    paginas: 1,
  });
}

describe('avaliarElegibilidadeExtracao (RAD-186)', () => {
  it('existente não-null → cache_hit, carregando a extração', () => {
    const existente = fakeExtracao();
    const r = avaliarElegibilidadeExtracao(existente, 'qualquer texto', true);
    expect(r).toEqual({ tipo: 'cache_hit', extracao: existente });
  });

  it('sem cache, sem texto selecionável e texto vazio (trim) → sem_texto', () => {
    expect(avaliarElegibilidadeExtracao(null, '   ', false)).toEqual({ tipo: 'sem_texto' });
  });

  it('temTextoSelecionavel:true + texto vazio → elegivel (OCR pode achar texto nos anexos)', () => {
    expect(avaliarElegibilidadeExtracao(null, '', true)).toEqual({ tipo: 'elegivel' });
  });

  it('texto não-vazio → elegivel, mesmo sem texto selecionável', () => {
    expect(avaliarElegibilidadeExtracao(null, 'saída do OCR', false)).toEqual({ tipo: 'elegivel' });
  });
});
