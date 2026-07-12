import { describe, expect, it } from 'vitest';
import { EditalId } from '@radar/kernel';
import { OBJETO_MAX_CHARS, paraEventoEditalIngerido, truncarObjetoParaFila } from '../../application/mappers.js';
import { Edital } from '../../domain/entities/edital.js';

const CNPJ_VALIDO = '11222333000181';
const NUMERO_CONTROLE = '00394502000167-1-000001/2024';

function criarEdital(objeto: string): Edital {
  return Edital.criar({
    id: EditalId('edital-001'),
    numeroControlePncp: NUMERO_CONTROLE,
    anoCompra: 2024,
    sequencialCompra: 1,
    modalidadeCodigo: 6,
    modalidadeNome: 'Concorrência',
    faseAtual: 'Publicado',
    objeto,
    valorEstimado: 100000,
    prazoProposta: null,
    dataPublicacao: new Date('2024-01-10T10:00:00Z'),
    dataAtualizacao: new Date('2024-01-10T10:00:00Z'),
    orgao: { cnpj: CNPJ_VALIDO, nome: 'Prefeitura SP', uf: 'SP', municipio: 'São Paulo' },
    proveniencia: { fonte: 'PNCP', baseLegal: 'Lei 14.133/2021, art. 174', coletadoEm: new Date() },
    itens: [],
  });
}

describe('truncarObjetoParaFila (RAD-310)', () => {
  it('não mexe em objeto dentro do limite', () => {
    expect(truncarObjetoParaFila('Serviços de TI')).toBe('Serviços de TI');
  });

  it('trunca objeto acima do limite, com marcador explícito e tamanho final == OBJETO_MAX_CHARS', () => {
    const objetoPatologico = 'x'.repeat(OBJETO_MAX_CHARS * 10);

    const truncado = truncarObjetoParaFila(objetoPatologico);

    expect(truncado.length).toBe(OBJETO_MAX_CHARS);
    expect(truncado.endsWith('…[truncado]')).toBe(true);
  });
});

describe('paraEventoEditalIngerido — objeto truncado na fronteira de publicação (RAD-310)', () => {
  it('edital.objeto pathológico (10x o limite) não vaza para o payload do evento sem corte', () => {
    const edital = criarEdital('x'.repeat(OBJETO_MAX_CHARS * 10));

    const evento = paraEventoEditalIngerido(edital);

    expect(evento.payload.objeto.length).toBe(OBJETO_MAX_CHARS);
    // Agregado no DB da Ingestão continua com o valor íntegro — só o payload de fila é limitado.
    expect(edital.objeto.length).toBe(OBJETO_MAX_CHARS * 10);
  });
});
