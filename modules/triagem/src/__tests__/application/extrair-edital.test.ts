import { describe, expect, it, vi } from 'vitest';
import { EditalId } from '@radar/kernel';
import { ExtrairEditalUseCase } from '../../application/use-cases/extrair-edital.js';
import type { ExtrairEditalInput } from '../../application/use-cases/extrair-edital.js';
import type { ExtracaoRepository, LlmGateway, ObjectStorage } from '../../application/ports.js';
import { ConfiancaInsuficienteError, OcrFalhouError } from '../../domain/errors/index.js';
import { ExtracaoEdital } from '../../domain/extracao-edital.js';
import { CampoExtraido } from '../../domain/value-objects/campo-extraido.js';
import { Citacao } from '../../domain/value-objects/citacao.js';
import { Confianca } from '../../domain/value-objects/confianca.js';

const noop = new AbortController().signal;
const EDITAL = EditalId('edital-1');

function fakeExtracao(confObjeto: number): ExtracaoEdital {
  return ExtracaoEdital.montar({
    editalId: EDITAL,
    objeto: CampoExtraido.criar({
      valor: 'Aquisição de notebooks',
      confianca: Confianca.criar(confObjeto),
      citacao: Citacao.criar(1, 'objeto'),
      critico: true,
    }),
    valorEstimado: CampoExtraido.criar<number | null>({
      valor: 250000,
      confianca: Confianca.criar(0.9),
      citacao: Citacao.criar(2, 'valor'),
      critico: true,
    }),
    dataAberturaPropostas: CampoExtraido.criar<Date | null>({
      valor: null,
      confianca: Confianca.criar(0.5),
      citacao: null,
      critico: false,
    }),
    requisitos: [],
    riscosBrutos: [],
    paginas: 5,
  });
}

const INPUT: ExtrairEditalInput = {
  editalId: EDITAL,
  texto: 'Objeto: aquisição de notebooks.',
  temTextoSelecionavel: true,
  anexosRefs: ['anexo-1'],
  paginas: 5,
};

function deps(existente: ExtracaoEdital | null, extraida: ExtracaoEdital) {
  const porEdital = vi.fn().mockResolvedValue(existente);
  const salvar = vi.fn().mockResolvedValue(undefined);
  const extrair = vi.fn().mockResolvedValue(extraida);
  const obterTextoAnexo = vi.fn().mockResolvedValue('texto do anexo');
  const extracoes: ExtracaoRepository = { porEdital, salvar };
  const llm: LlmGateway = { extrair };
  const storage: ObjectStorage = { obterTextoAnexo };
  return { extracoes, llm, storage, porEdital, salvar, extrair, obterTextoAnexo };
}

describe('ExtrairEditalUseCase', () => {
  it('cache-hit por edital (P-45): não chama o LLM nem o storage', async () => {
    const { extracoes, llm, storage, extrair, obterTextoAnexo } = deps(fakeExtracao(0.9), fakeExtracao(0.9));
    const dto = await new ExtrairEditalUseCase(llm, extracoes, storage).executar(INPUT, noop);

    expect(dto.editalId).toBe(EDITAL);
    expect(dto.confianca).toBe(0.9);
    expect(extrair).not.toHaveBeenCalled();
    expect(obterTextoAnexo).not.toHaveBeenCalled();
  });

  it('OCR falhou (sem texto selecionável e texto vazio) → OcrFalhouError, sem chamar o LLM', async () => {
    const { extracoes, llm, storage, extrair } = deps(null, fakeExtracao(0.9));
    await expect(
      new ExtrairEditalUseCase(llm, extracoes, storage).executar(
        { ...INPUT, temTextoSelecionavel: false, texto: '   ' },
        noop,
      ),
    ).rejects.toThrow(OcrFalhouError);
    expect(extrair).not.toHaveBeenCalled();
  });

  it('confiança agregada 0 → ConfiancaInsuficienteError (leitura assistida — docs/10 §6)', async () => {
    const { extracoes, llm, storage, salvar } = deps(null, fakeExtracao(0));
    await expect(
      new ExtrairEditalUseCase(llm, extracoes, storage).executar(INPUT, noop),
    ).rejects.toThrow(ConfiancaInsuficienteError);
    expect(salvar).not.toHaveBeenCalled();
  });

  it('cache-miss: resolve anexos, chama o LLM, salva e propaga o signal (P-78)', async () => {
    const { extracoes, llm, storage, porEdital, salvar, extrair, obterTextoAnexo } = deps(
      null,
      fakeExtracao(0.9),
    );
    const dto = await new ExtrairEditalUseCase(llm, extracoes, storage).executar(INPUT, noop);

    expect(obterTextoAnexo).toHaveBeenCalledWith('anexo-1', noop);
    expect(porEdital).toHaveBeenCalledWith(EDITAL, noop);
    const [entrada, signal] = extrair.mock.calls[0]!;
    expect(entrada).toMatchObject({ editalId: EDITAL, anexos: ['texto do anexo'], paginas: 5 });
    expect(signal).toBe(noop);
    expect(salvar).toHaveBeenCalledTimes(1);
    expect(dto.confianca).toBe(0.9);
  });
});
