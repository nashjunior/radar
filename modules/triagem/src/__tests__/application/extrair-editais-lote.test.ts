import { describe, expect, it, vi } from 'vitest';
import { EditalId } from '@radar/kernel';
import { ExtrairEditaisEmLoteUseCase } from '../../application/use-cases/extrair-editais-lote.js';
import type { ExtrairEditalLoteItem } from '../../application/use-cases/extrair-editais-lote.js';
import type {
  ExtracaoRepository,
  LlmLoteGateway,
  ObjectStorage,
  ResultadoLote,
  UsoLlm,
  UsoLlmLedger,
} from '../../application/ports.js';
import { ExtracaoEdital } from '../../domain/extracao-edital.js';
import { CampoExtraido } from '../../domain/value-objects/campo-extraido.js';
import { Citacao } from '../../domain/value-objects/citacao.js';
import { Confianca } from '../../domain/value-objects/confianca.js';

const noop = new AbortController().signal;

const USO_FAKE: UsoLlm = {
  modelo: 'claude-sonnet-5',
  inputTokens: 1000,
  outputTokens: 200,
  cacheReadInputTokens: 0,
  cacheCreationInputTokens: 0,
};

function extracao(id: string, confObjeto: number): ExtracaoEdital {
  return ExtracaoEdital.montar({
    editalId: EditalId(id),
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

function item(id: string, over: Partial<ExtrairEditalLoteItem> = {}): ExtrairEditalLoteItem {
  return {
    editalId: EditalId(id),
    texto: 'Objeto: aquisição de notebooks.',
    temTextoSelecionavel: true,
    anexosRefs: [],
    paginas: 5,
    ...over,
  };
}

function deps(resultados: ResultadoLote[], existentePorId: Record<string, ExtracaoEdital> = {}) {
  const porEdital = vi.fn(async (id: EditalId) => existentePorId[String(id)] ?? null);
  const salvar = vi.fn().mockResolvedValue(undefined);
  const obterTextoAnexo = vi.fn().mockResolvedValue('texto do anexo');
  const extrairLote = vi.fn().mockResolvedValue(resultados);
  const registrar = vi.fn().mockResolvedValue(undefined);
  const extracoes: ExtracaoRepository = { porEdital, salvar };
  const storage: ObjectStorage = { obterTextoAnexo };
  const llmLote: LlmLoteGateway = { extrairLote };
  const usoLedger: UsoLlmLedger = { registrar };
  return { extracoes, storage, llmLote, usoLedger, porEdital, salvar, obterTextoAnexo, extrairLote, registrar };
}

describe('ExtrairEditaisEmLoteUseCase', () => {
  it('cache-hit por edital (P-45): não vai ao lote, conta cacheHits', async () => {
    const d = deps([], { A: extracao('A', 0.9) });
    const res = await new ExtrairEditaisEmLoteUseCase(d.llmLote, d.extracoes, d.storage, d.usoLedger).executar(
      [item('A')],
      noop,
    );
    expect(res.cacheHits).toBe(1);
    expect(d.extrairLote).not.toHaveBeenCalled();
  });

  it('sem texto após OCR → ignorado (docs/10 §6), não entra no lote', async () => {
    const d = deps([]);
    const res = await new ExtrairEditaisEmLoteUseCase(d.llmLote, d.extracoes, d.storage, d.usoLedger).executar(
      [item('A', { temTextoSelecionavel: false, texto: '   ' })],
      noop,
    );
    expect(res.ignorados).toBe(1);
    expect(d.extrairLote).not.toHaveBeenCalled();
  });

  it('resolve anexos, extrai em lote e salva as extrações suficientes; propaga o signal (P-78)', async () => {
    const d = deps([{ editalId: EditalId('A'), ok: true, uso: USO_FAKE, extracao: extracao('A', 0.9) }]);
    const res = await new ExtrairEditaisEmLoteUseCase(d.llmLote, d.extracoes, d.storage, d.usoLedger).executar(
      [item('A', { anexosRefs: ['anexo-1'] })],
      noop,
    );

    expect(d.obterTextoAnexo).toHaveBeenCalledWith('anexo-1', noop);
    const [entradas, signal] = d.extrairLote.mock.calls[0]!;
    expect(entradas[0]).toMatchObject({ editalId: EditalId('A'), anexos: ['texto do anexo'], paginas: 5 });
    expect(signal).toBe(noop);
    expect(d.salvar).toHaveBeenCalledTimes(1);
    expect(res.extraidos).toBe(1);
  });

  it('confiança agregada 0 → insuficiente (leitura assistida, docs/10 §6), NÃO salva', async () => {
    const d = deps([{ editalId: EditalId('A'), ok: true, uso: USO_FAKE, extracao: extracao('A', 0) }]);
    const res = await new ExtrairEditaisEmLoteUseCase(d.llmLote, d.extracoes, d.storage, d.usoLedger).executar(
      [item('A')],
      noop,
    );
    expect(res.insuficientes).toBe(1);
    expect(res.extraidos).toBe(0);
    expect(d.salvar).not.toHaveBeenCalled();
  });

  it('item ok:false do lote conta como falha e não derruba os demais', async () => {
    const d = deps([
      { editalId: EditalId('A'), ok: true, uso: USO_FAKE, extracao: extracao('A', 0.9) },
      { editalId: EditalId('B'), ok: false, motivo: 'lote: expired' },
    ]);
    const res = await new ExtrairEditaisEmLoteUseCase(d.llmLote, d.extracoes, d.storage, d.usoLedger).executar(
      [item('A'), item('B')],
      noop,
    );
    expect(res.extraidos).toBe(1);
    expect(res.falhas).toBe(1);
    expect(d.salvar).toHaveBeenCalledTimes(1);
  });

  it('lista vazia → retorna zeros sem chamar o LLM', async () => {
    const d = deps([]);
    const res = await new ExtrairEditaisEmLoteUseCase(d.llmLote, d.extracoes, d.storage, d.usoLedger).executar([], noop);
    expect(res).toEqual({ extraidos: 0, cacheHits: 0, ignorados: 0, insuficientes: 0, falhas: 0 });
    expect(d.extrairLote).not.toHaveBeenCalled();
  });

  it('temTextoSelecionavel:true + texto vazio → vai ao LLM (OCR pode encontrar texto nos anexos)', async () => {
    // Documenta comportamento intencional: o guard `!temTextoSelecionavel && texto.trim() === ''` usa AND,
    // então um item com temTextoSelecionavel=true e texto vazio passa para o lote mesmo sem texto.
    const d = deps([{ editalId: EditalId('A'), ok: true, uso: USO_FAKE, extracao: extracao('A', 0.9) }]);
    const res = await new ExtrairEditaisEmLoteUseCase(d.llmLote, d.extracoes, d.storage, d.usoLedger).executar(
      [item('A', { temTextoSelecionavel: true, texto: '' })],
      noop,
    );
    expect(d.extrairLote).toHaveBeenCalledOnce();
    expect(res.extraidos).toBe(1);
    expect(res.ignorados).toBe(0);
  });

  it('lote com todos os quatro desfechos — contadores corretos', async () => {
    // cache-hit(C), ignorado(D), ok(A), insuficiente(B), falha(E)
    const d = deps(
      [
        { editalId: EditalId('A'), ok: true, uso: USO_FAKE, extracao: extracao('A', 0.9) },
        { editalId: EditalId('B'), ok: true, uso: USO_FAKE, extracao: extracao('B', 0) },
        { editalId: EditalId('E'), ok: false, motivo: 'timeout' },
      ],
      { C: extracao('C', 0.8) },
    );
    const res = await new ExtrairEditaisEmLoteUseCase(d.llmLote, d.extracoes, d.storage, d.usoLedger).executar(
      [
        item('A'),
        item('B'),
        item('C'),
        item('D', { temTextoSelecionavel: false, texto: '' }),
        item('E'),
      ],
      noop,
    );
    expect(res.extraidos).toBe(1);
    expect(res.cacheHits).toBe(1);
    expect(res.ignorados).toBe(1);
    expect(res.insuficientes).toBe(1);
    expect(res.falhas).toBe(1);
  });
});
