import { describe, expect, it } from 'vitest';
import { EditalId } from '@radar/kernel';
import { ExtracaoEdital } from '../../domain/extracao-edital.js';
import { CampoExtraido } from '../../domain/value-objects/campo-extraido.js';
import { Citacao } from '../../domain/value-objects/citacao.js';
import { Confianca } from '../../domain/value-objects/confianca.js';

const EDITAL = EditalId('edital-001');

function campo<T>(valor: T, confianca: number, critico: boolean): CampoExtraido<T> {
  return CampoExtraido.criar({
    valor,
    confianca: Confianca.criar(confianca),
    citacao: Citacao.criar(1, 'trecho'),
    critico,
  });
}

function montar(objetoConf: number, valorConf: number, dataConf: number, dataCritico = true): ExtracaoEdital {
  return ExtracaoEdital.montar({
    editalId: EDITAL,
    objeto: campo('objeto', objetoConf, true),
    valorEstimado: campo<number | null>(100, valorConf, true),
    dataAberturaPropostas: campo<Date | null>(new Date('2024-03-15'), dataConf, dataCritico),
    requisitos: [],
    riscosBrutos: [],
    paginas: 10,
  });
}

describe('ExtracaoEdital.confiancaGlobal', () => {
  it('é a MENOR confiança entre os campos críticos (docs/10 §4)', () => {
    expect(montar(0.9, 0.6, 0.8).confiancaGlobal().valor).toBe(0.6);
  });

  it('ignora campos não-críticos ao agregar', () => {
    // data com confiança 0.1 mas NÃO-crítica → não derruba a extração
    expect(montar(0.9, 0.7, 0.1, false).confiancaGlobal().valor).toBe(0.7);
  });

  it('suficiente() respeita o limiar', () => {
    const e = montar(0.9, 0.6, 0.8);
    expect(e.suficiente(0.5)).toBe(true);
    expect(e.suficiente(0.7)).toBe(false);
  });
});

describe('Citacao.toString — fonte renderizada (A17 §4.3)', () => {
  it('inclui página e seção quando há seção', () => {
    expect(Citacao.criar(12, 'trecho', '5.1').toString()).toBe('p. 12, seção 5.1');
  });

  it('só a página quando não há seção', () => {
    expect(Citacao.criar(12, 'trecho').toString()).toBe('p. 12');
  });
});
