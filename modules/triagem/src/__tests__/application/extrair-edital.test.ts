import { describe, expect, it, vi } from 'vitest';
import { EditalId } from '@radar/kernel';
import { ExtrairEditalUseCase } from '../../application/use-cases/extrair-edital.js';
import type { ExtrairEditalInput } from '../../application/use-cases/extrair-edital.js';
import type { ExtracaoRepository, LlmGateway, ObjectStorage, UsoLlm, UsoLlmLedger } from '../../application/ports.js';
import { ConfiancaInsuficienteError, OcrFalhouError } from '../../domain/errors/index.js';
import { ExtracaoEdital } from '../../domain/extracao-edital.js';
import { CampoExtraido } from '../../domain/value-objects/campo-extraido.js';
import { Citacao } from '../../domain/value-objects/citacao.js';
import { Confianca } from '../../domain/value-objects/confianca.js';

const USO_FAKE: UsoLlm = {
  modelo: 'claude-sonnet-5',
  inputTokens: 1000,
  outputTokens: 200,
  cacheReadInputTokens: 0,
  cacheCreationInputTokens: 0,
};

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
  const extrair = vi.fn().mockResolvedValue({ extracao: extraida, uso: USO_FAKE });
  const obterTextoAnexo = vi.fn().mockResolvedValue('texto do anexo');
  const registrar = vi.fn().mockResolvedValue(undefined);
  const extracoes: ExtracaoRepository = { porEdital, salvar };
  const llm: LlmGateway = { extrair };
  const storage: ObjectStorage = { obterTextoAnexo };
  const usoLedger: UsoLlmLedger = { registrar };
  return { extracoes, llm, storage, usoLedger, porEdital, salvar, extrair, obterTextoAnexo, registrar };
}

describe('ExtrairEditalUseCase', () => {
  it('cache-hit por edital (P-45): não chama o LLM nem o storage', async () => {
    const { extracoes, llm, storage, usoLedger, extrair, obterTextoAnexo, registrar } = deps(
      fakeExtracao(0.9),
      fakeExtracao(0.9),
    );
    const dto = await new ExtrairEditalUseCase(llm, extracoes, storage, usoLedger).executar(INPUT, noop);

    expect(dto.editalId).toBe(EDITAL);
    expect(dto.confianca).toBe(0.9);
    expect(extrair).not.toHaveBeenCalled();
    expect(obterTextoAnexo).not.toHaveBeenCalled();
    expect(registrar).not.toHaveBeenCalled(); // sem chamada ao LLM, sem custo a registrar
  });

  it('OCR falhou (sem texto selecionável e texto vazio) → OcrFalhouError, sem chamar o LLM', async () => {
    const { extracoes, llm, storage, usoLedger, extrair } = deps(null, fakeExtracao(0.9));
    await expect(
      new ExtrairEditalUseCase(llm, extracoes, storage, usoLedger).executar(
        { ...INPUT, temTextoSelecionavel: false, texto: '   ' },
        noop,
      ),
    ).rejects.toThrow(OcrFalhouError);
    expect(extrair).not.toHaveBeenCalled();
  });

  it('confiança agregada 0 → ConfiancaInsuficienteError, mas o USO já foi registrado (custo real, P-20/P-38)', async () => {
    const { extracoes, llm, storage, usoLedger, salvar, registrar } = deps(null, fakeExtracao(0));
    await expect(
      new ExtrairEditalUseCase(llm, extracoes, storage, usoLedger).executar(INPUT, noop),
    ).rejects.toThrow(ConfiancaInsuficienteError);
    expect(salvar).not.toHaveBeenCalled();
    expect(registrar).toHaveBeenCalledTimes(1);
  });

  it('cache-miss: resolve anexos, chama o LLM, salva, registra o uso e propaga o signal (P-78)', async () => {
    const { extracoes, llm, storage, usoLedger, porEdital, salvar, extrair, obterTextoAnexo, registrar } = deps(
      null,
      fakeExtracao(0.9),
    );
    const dto = await new ExtrairEditalUseCase(llm, extracoes, storage, usoLedger).executar(INPUT, noop);

    expect(obterTextoAnexo).toHaveBeenCalledWith('anexo-1', noop);
    expect(porEdital).toHaveBeenCalledWith(EDITAL, noop);
    const [entrada, signal] = extrair.mock.calls[0]!;
    expect(entrada).toMatchObject({ editalId: EDITAL, anexos: ['texto do anexo'], paginas: 5 });
    expect(signal).toBe(noop);
    expect(salvar).toHaveBeenCalledTimes(1);
    expect(dto.confianca).toBe(0.9);

    expect(registrar).toHaveBeenCalledTimes(1);
    const [registro] = registrar.mock.calls[0]!;
    expect(registro).toMatchObject({
      editalId: EDITAL,
      tenantId: null,
      clienteFinalId: null,
      perfilId: null,
      modelo: USO_FAKE.modelo,
      inputTokens: USO_FAKE.inputTokens,
      outputTokens: USO_FAKE.outputTokens,
    });
  });
});
