/**
 * Stress tests — domain VOs da ingestão (adversarial / boundary)
 *
 * Eixo 1 — regras de negócio: invariantes dos VOs sob entradas adversariais que o adaptador
 * da API PNCP pode produzir: strings vazias, datas inválidas, valores fora de faixa.
 *
 * Eixo 2 — critério de corte: limiares e regras de validação dos VOs de domínio.
 */
import { describe, expect, it } from 'vitest';
import { EditalId } from '@radar/kernel';
import { Proveniencia } from '../../domain/value-objects/proveniencia.js';
import { ValorMonetario } from '../../domain/value-objects/valor-monetario.js';
import { NumeroControlePncp } from '../../domain/value-objects/numero-controle-pncp.js';
import { Modalidade } from '../../domain/value-objects/modalidade.js';
import { Cnpj } from '../../domain/value-objects/cnpj.js';
import { Edital } from '../../domain/entities/edital.js';
import { ProvenienciaInvalidaError } from '../../domain/errors/index.js';

// ─── Proveniencia ─────────────────────────────────────────────────────────────

describe('Proveniencia — validação de invariantes (docs/02 §4, docs/05 §5)', () => {
  const DATA_VALIDA = new Date('2024-01-10T11:00:00Z');

  it('aceita fonte, baseLegal e coletadoEm válidos', () => {
    expect(() =>
      Proveniencia.criar({ fonte: 'PNCP', baseLegal: 'Lei 14.133/2021', coletadoEm: DATA_VALIDA }),
    ).not.toThrow();
  });

  it('rejeita fonte vazia — proveniência sem rastreabilidade viola docs/02 §4', () => {
    expect(() =>
      Proveniencia.criar({ fonte: '', baseLegal: 'Lei 14.133/2021', coletadoEm: DATA_VALIDA }),
    ).toThrow(ProvenienciaInvalidaError);
  });

  it('rejeita fonte só de espaços', () => {
    expect(() =>
      Proveniencia.criar({ fonte: '   ', baseLegal: 'Lei 14.133/2021', coletadoEm: DATA_VALIDA }),
    ).toThrow(ProvenienciaInvalidaError);
  });

  it('rejeita baseLegal vazia — ausência de base legal impossibilita auditoria LGPD (docs/05 §5)', () => {
    expect(() =>
      Proveniencia.criar({ fonte: 'PNCP', baseLegal: '', coletadoEm: DATA_VALIDA }),
    ).toThrow(ProvenienciaInvalidaError);
  });

  it('rejeita baseLegal só de espaços', () => {
    expect(() =>
      Proveniencia.criar({ fonte: 'PNCP', baseLegal: '\t  \n', coletadoEm: DATA_VALIDA }),
    ).toThrow(ProvenienciaInvalidaError);
  });

  it('rejeita coletadoEm Invalid Date — new Date("invalid")', () => {
    expect(() =>
      Proveniencia.criar({ fonte: 'PNCP', baseLegal: 'Lei 14.133/2021', coletadoEm: new Date('invalid') }),
    ).toThrow(ProvenienciaInvalidaError);
  });

  it('rejeita coletadoEm new Date(NaN)', () => {
    expect(() =>
      Proveniencia.criar({ fonte: 'PNCP', baseLegal: 'Lei 14.133/2021', coletadoEm: new Date(NaN) }),
    ).toThrow(ProvenienciaInvalidaError);
  });

  it('rejeita coletadoEm new Date(Infinity)', () => {
    expect(() =>
      Proveniencia.criar({ fonte: 'PNCP', baseLegal: 'Lei 14.133/2021', coletadoEm: new Date(Infinity) }),
    ).toThrow(ProvenienciaInvalidaError);
  });

  it('trim de fonte e baseLegal antes de armazenar', () => {
    const p = Proveniencia.criar({
      fonte: '  PNCP  ',
      baseLegal: '  Lei 14.133/2021  ',
      coletadoEm: DATA_VALIDA,
    });
    expect(p.fonte).toBe('PNCP');
    expect(p.baseLegal).toBe('Lei 14.133/2021');
  });

  it('erro tem code PROVENIENCIA_INVALIDA', () => {
    try {
      Proveniencia.criar({ fonte: '', baseLegal: 'ok', coletadoEm: DATA_VALIDA });
    } catch (e: any) {
      expect(e.code).toBe('PROVENIENCIA_INVALIDA');
    }
  });
});

// ─── ValorMonetario — confirmação de guards existentes ───────────────────────

describe('ValorMonetario — confirmação de guards (já testados no test principal)', () => {
  it('NaN → rejeita', () => {
    expect(() => ValorMonetario.criar(NaN)).toThrow();
  });

  it('+Infinity → rejeita', () => {
    expect(() => ValorMonetario.criar(Infinity)).toThrow();
  });

  it('-Infinity → rejeita', () => {
    expect(() => ValorMonetario.criar(-Infinity)).toThrow();
  });

  it('valor muito grande em notação científica (string "1e308") → rejeita (regex rejeita "e")', () => {
    expect(() => ValorMonetario.criar('1e308')).toThrow();
  });

  it('string com vírgula decimal (BR) → rejeita', () => {
    expect(() => ValorMonetario.criar('1.234,56')).toThrow();
  });

  it('"00001" com zeros à esquerda → aceita (valor 1, repr preservada)', () => {
    const vm = ValorMonetario.criar('00001');
    expect(vm.valor).toBe(1);
    expect(vm.representacaoDecimal).toBe('00001');
  });

  it('-0 como number → aceita (string "-0" não é gerada por String(-0))', () => {
    // String(-0) === "0" → regex ^\d+$ → válido
    expect(() => ValorMonetario.criar(-0)).not.toThrow();
    expect(ValorMonetario.criar(-0).valor).toBe(0);
  });
});

// ─── Modalidade — NaN e Infinity já bloqueados por Number.isInteger ──────────

describe('Modalidade — confirmação de guards com Number.isInteger', () => {
  it('NaN → rejeita (Number.isInteger(NaN) = false)', () => {
    expect(() => Modalidade.criar(NaN, 'Pregão')).toThrow();
  });

  it('+Infinity → rejeita', () => {
    expect(() => Modalidade.criar(Infinity, 'Pregão')).toThrow();
  });

  it('decimal 1.5 → rejeita', () => {
    expect(() => Modalidade.criar(1.5, 'Pregão')).toThrow();
  });

  it('nome com apenas espaços → nome trimado é ""', () => {
    // trim() resulta em string vazia; sem validação de nome não-vazio na Modalidade
    // Documentado: Modalidade aceita nome vazio (nome é de display, não chave de negócio)
    const m = Modalidade.criar(1, '   ');
    expect(m.nome).toBe('');
  });
});

// ─── NumeroControlePncp — robustez ───────────────────────────────────────────

describe('NumeroControlePncp — entradas adversariais', () => {
  it('rejeita null implícito via cast JS (valor?.trim() = undefined → falsy)', () => {
    // TypeScript previne, mas testa o guard de runtime
    expect(() => NumeroControlePncp.criar(null as unknown as string)).toThrow();
  });

  it('rejeita undefined implícito', () => {
    expect(() => NumeroControlePncp.criar(undefined as unknown as string)).toThrow();
  });

  it('string muito longa é aceita (sem max-length na domain)', () => {
    const longo = 'A'.repeat(500);
    expect(() => NumeroControlePncp.criar(longo)).not.toThrow();
  });
});

// ─── Cnpj — entradas adversariais ─────────────────────────────────────────────

describe('Cnpj — entradas adversariais', () => {
  const VALIDO_RAW = '11222333000181';

  it('SQL injection com dígitos válidos embutidos → aceita (injeção tratada na camada de infra)', () => {
    // replace(/\D/g, '') extrai apenas os dígitos → se os 14 dígitos formam um CNPJ válido,
    // o VO aceita. Prevenção de SQL injection é responsabilidade do ORM/queries parametrizadas.
    expect(() => Cnpj.criar("11.222.333/0001-81'; DROP TABLE editais; --")).not.toThrow();
  });

  it('rejeita CNPJ com caracteres unicode — strip resulta em string curta', () => {
    expect(() => Cnpj.criar('🎉'.repeat(14))).toThrow();
  });

  it('rejeita CNPJ com 15 dígitos (um a mais)', () => {
    expect(() => Cnpj.criar(VALIDO_RAW + '5')).toThrow();
  });

  it('aceita CNPJ formatado com espaços de cada lado (via replace(/\\D/g))', () => {
    // Espaços são stripped junto com os não-dígitos → 14 dígitos iguais ao raw
    const c = Cnpj.criar(' ' + '11.222.333/0001-81' + ' ');
    expect(c.valor).toBe(VALIDO_RAW);
  });
});

// ─── Edital.criar — campos de string sem VO que passam sem validação ─────────

describe('Edital.criar — campos de string direta (documentação de gaps conhecidos)', () => {
  const baseProps = {
    id: EditalId('edital-001'),
    numeroControlePncp: '00394502000167-1-000001/2024',
    anoCompra: 2024,
    sequencialCompra: 1,
    modalidadeCodigo: 6,
    modalidadeNome: 'Concorrência',
    faseAtual: 'Publicado',
    objeto: 'Aquisição de equipamentos',
    valorEstimado: 500000,
    prazoProposta: null,
    dataPublicacao: new Date('2024-01-10'),
    dataAtualizacao: new Date('2024-01-10'),
    orgao: { cnpj: '11222333000181', nome: 'Órgão Teste', uf: 'SP', municipio: 'SP' },
    proveniencia: { fonte: 'PNCP', baseLegal: 'Lei 14.133/2021', coletadoEm: new Date('2024-01-10') },
    itens: [],
  };

  it('objeto vazio é aceito (campo passthrough — validado no adaptador de ingestão)', () => {
    // Gap conhecido: Edital não valida objeto não-vazio no domínio.
    // Defesa está no adaptador PNCP (schema validation).
    expect(() => Edital.criar({ ...baseProps, objeto: '' })).not.toThrow();
  });

  it('faseAtual vazia é aceita (campo passthrough)', () => {
    expect(() => Edital.criar({ ...baseProps, faseAtual: '' })).not.toThrow();
  });

  it('rejeita CNPJ do órgão inválido — VO Cnpj valida no criar()', () => {
    expect(() =>
      Edital.criar({ ...baseProps, orgao: { ...baseProps.orgao, cnpj: '00000000000000' } }),
    ).toThrow();
  });

  it('rejeita proveniência com fonte vazia — fix de Proveniencia.criar() (bug corrigido)', () => {
    expect(() =>
      Edital.criar({ ...baseProps, proveniencia: { ...baseProps.proveniencia, fonte: '' } }),
    ).toThrow(ProvenienciaInvalidaError);
  });

  it('rejeita proveniência com data inválida — fix de Proveniencia.criar() (bug corrigido)', () => {
    expect(() =>
      Edital.criar({ ...baseProps, proveniencia: { ...baseProps.proveniencia, coletadoEm: new Date('invalid') } }),
    ).toThrow(ProvenienciaInvalidaError);
  });
});
