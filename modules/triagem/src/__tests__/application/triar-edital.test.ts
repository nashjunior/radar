import { describe, expect, it, vi } from 'vitest';
import { AcessoNegadoError, ClienteFinalId, EditalId, PerfilId, TenantId } from '@radar/kernel';
import { TriarEditalUseCase } from '../../application/use-cases/triar-edital.js';
import type { TriarEditalInput } from '../../application/use-cases/triar-edital.js';
import type { EntradaExtracaoDTO } from '../../application/dtos.js';
import { PerfilHabilitacao } from '../../domain/perfil-habilitacao.js';
import type {
  EventPublisher,
  ExtracaoRepository,
  LlmGateway,
  PerfilGateway,
  TriagemRepository,
} from '../../application/ports.js';
import { ConfiancaInsuficienteError, PerfilNaoEncontradoError } from '../../domain/errors/index.js';
import { ExtracaoEdital } from '../../domain/extracao-edital.js';
import { CampoExtraido } from '../../domain/value-objects/campo-extraido.js';
import { Citacao } from '../../domain/value-objects/citacao.js';
import { Confianca } from '../../domain/value-objects/confianca.js';
import { Requisito } from '../../domain/value-objects/requisito.js';

const noop = new AbortController().signal;
const EDITAL = EditalId('edital-1');
const PERFIL = PerfilId('perfil-1');
const CLIENTE = ClienteFinalId('cliente-1');
const TENANT = TenantId('global');

function extracao(confObjeto = 0.9): ExtracaoEdital {
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
    requisitos: [
      Requisito.criar('fiscal', 'Certidão CND', null), // atendido pelo perfil
      Requisito.criar('tecnica', 'Registro CREA', null), // lacuna → risco
    ],
    riscosBrutos: [],
    paginas: 5,
  });
}

const CONTEUDO: EntradaExtracaoDTO = {
  editalId: EDITAL,
  texto: 'edital',
  temTextoSelecionavel: true,
  anexos: [],
  paginas: 5,
};

const INPUT: TriarEditalInput = {
  editalId: EDITAL,
  perfilId: PERFIL,
  clienteFinalId: CLIENTE,
  tenantId: TENANT,
  conteudo: CONTEUDO,
  limiarConfianca: 0.5,
};

const PERFIL_HAB = PerfilHabilitacao.de({
  id: PERFIL,
  clienteFinalId: CLIENTE,
  habJuridica: [],
  habFiscal: ['CND'],
  habTecnica: [],
  habEconomica: [],
});

function deps(opts: {
  existente?: ExtracaoEdital | null;
  extraida?: ExtracaoEdital;
  perfil?: PerfilHabilitacao | null;
}) {
  const porEdital = vi.fn().mockResolvedValue(opts.existente ?? null);
  const salvarExtracao = vi.fn().mockResolvedValue(undefined);
  const extrair = vi.fn().mockResolvedValue(opts.extraida ?? extracao());
  const porId = vi.fn().mockResolvedValue(opts.perfil === undefined ? PERFIL_HAB : opts.perfil);
  const salvarTriagem = vi.fn().mockResolvedValue(undefined);
  const publicar = vi.fn().mockResolvedValue(undefined);

  const extracoes: ExtracaoRepository = { porEdital, salvar: salvarExtracao };
  const perfis: PerfilGateway = { porId };
  const llm: LlmGateway = { extrair };
  const triagens: TriagemRepository = { salvar: salvarTriagem, porEditalEPerfil: vi.fn() };
  const eventos: EventPublisher = { publicar };

  const uc = new TriarEditalUseCase(extracoes, perfis, llm, triagens, eventos);
  return { uc, porEdital, salvarExtracao, extrair, porId, salvarTriagem, publicar };
}

describe('TriarEditalUseCase', () => {
  it('cache-miss: chama o LLM, salva a extração e conclui a triagem (publica triagem.concluida)', async () => {
    const { uc, extrair, salvarExtracao, salvarTriagem, publicar } = deps({ existente: null });
    const dto = await uc.executar(INPUT, noop);

    expect(extrair).toHaveBeenCalledWith(CONTEUDO, noop);
    expect(salvarExtracao).toHaveBeenCalledTimes(1);
    expect(salvarTriagem).toHaveBeenCalledTimes(1);
    expect(dto.aderencia).toBeCloseTo(0.5);
    expect(dto.recomendacao).toBe('no-go');
    expect(dto.riscos.map((r) => r.descricao)).toEqual(['não atende: Registro CREA']);

    const [evento] = publicar.mock.calls[0]!;
    expect(evento.type).toBe('triagem.concluida');
    expect(evento.payload.riscos).toEqual(['não atende: Registro CREA']); // string[] no evento
    expect(evento.payload.clienteFinalId).toBe(CLIENTE);
  });

  it('cache-hit por edital (P-45): NÃO chama o LLM', async () => {
    const { uc, extrair, salvarExtracao } = deps({ existente: extracao() });
    await uc.executar(INPUT, noop);
    expect(extrair).not.toHaveBeenCalled();
    expect(salvarExtracao).not.toHaveBeenCalled();
  });

  it('gate de confiança: abaixo do limiar → ConfiancaInsuficienteError (não tria nem publica)', async () => {
    const { uc, porId, salvarTriagem, publicar } = deps({ existente: extracao(0.4) });
    await expect(uc.executar({ ...INPUT, limiarConfianca: 0.7 }, noop)).rejects.toThrow(
      ConfiancaInsuficienteError,
    );
    expect(porId).not.toHaveBeenCalled(); // nem chega a resolver o perfil
    expect(salvarTriagem).not.toHaveBeenCalled();
    expect(publicar).not.toHaveBeenCalled();
  });

  it('perfil inexistente → PerfilNaoEncontradoError (erro de orquestração, 404)', async () => {
    const { uc, salvarTriagem } = deps({ existente: extracao(), perfil: null });
    await expect(uc.executar(INPUT, noop)).rejects.toThrow(PerfilNaoEncontradoError);
    expect(salvarTriagem).not.toHaveBeenCalled();
  });

  it('perfil de OUTRO cliente → AcessoNegadoError (authz por objeto, defesa em profundidade)', async () => {
    const { uc, salvarTriagem, publicar } = deps({
      existente: extracao(),
      perfil: PerfilHabilitacao.de({
        id: PERFIL,
        clienteFinalId: ClienteFinalId('cliente-999'),
        habJuridica: [],
        habFiscal: ['CND'],
        habTecnica: [],
        habEconomica: [],
      }),
    });
    await expect(uc.executar(INPUT, noop)).rejects.toThrow(AcessoNegadoError);
    expect(salvarTriagem).not.toHaveBeenCalled();
    expect(publicar).not.toHaveBeenCalled();
  });
});
