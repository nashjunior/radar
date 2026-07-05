import { describe, expect, it, vi } from 'vitest';
import {
  ClienteFinalId,
  EditalId,
  PerfilId,
  TenantId,
  AcessoNegadoError,
} from '@radar/kernel';
import { ConsultarTriagemUseCase } from '../../application/use-cases/consultar-triagem.js';
import type {
  ConsultarTriagemInput,
} from '../../application/use-cases/consultar-triagem.js';
import type { ExtracaoRepository, TriagemRepository } from '../../application/ports.js';
import { ExtracaoEdital } from '../../domain/extracao-edital.js';
import { Triagem } from '../../domain/triagem.js';
import { Aderencia } from '../../domain/value-objects/aderencia.js';
import { CampoExtraido } from '../../domain/value-objects/campo-extraido.js';
import { Citacao } from '../../domain/value-objects/citacao.js';
import { Confianca } from '../../domain/value-objects/confianca.js';
import { Requisito } from '../../domain/value-objects/requisito.js';
import { Risco } from '../../domain/value-objects/risco.js';

const noop = new AbortController().signal;

const EDITAL = EditalId('edital-001');
const PERFIL = PerfilId('perfil-001');
const TENANT = TenantId('global');
const CLIENTE = ClienteFinalId('cliente-001');

const INPUT: ConsultarTriagemInput = {
  tenantId: TENANT,
  editalId: EDITAL,
  perfilId: PERFIL,
  clienteFinalId: CLIENTE,
};

/** Requisitos do edital: 2 atendidos, 1 lacuna (viram a base do checklist). */
const REQ_CND = Requisito.criar('fiscal', 'Certidão CND', Citacao.criar(4, 'CND exigida', '7.1'));
const REQ_ACERVO = Requisito.criar('tecnica', 'Atestado de acervo técnico', null);
const REQ_BALANCO = Requisito.criar('economica', 'Balanço patrimonial', null);

function extracaoBase(overrides?: Partial<Parameters<typeof ExtracaoEdital.montar>[0]>): ExtracaoEdital {
  return ExtracaoEdital.montar({
    editalId: EDITAL,
    objeto: CampoExtraido.criar({
      valor: 'Aquisição de notebooks',
      confianca: Confianca.criar(0.9),
      citacao: Citacao.criar(1, 'objeto do certame', '1.1'),
      critico: true,
    }),
    valorEstimado: CampoExtraido.criar({
      valor: 250000,
      confianca: Confianca.criar(0.8),
      citacao: Citacao.criar(2, 'valor estimado da contratação', '2.3'),
      critico: true,
    }),
    dataAberturaPropostas: CampoExtraido.criar<Date | null>({
      valor: null,
      confianca: Confianca.criar(0.5),
      citacao: null, // sem citação → "verificar"
      critico: true,
    }),
    requisitos: [REQ_CND, REQ_ACERVO, REQ_BALANCO],
    riscosBrutos: [],
    paginas: 42,
    ...overrides,
  });
}

/** Triagem persistida: aderência 1/3, 2 lacunas (acervo + balanço). */
function triagemBase(overrides?: Partial<Parameters<typeof Triagem.reconstituir>[0]>): Triagem {
  return Triagem.reconstituir({
    editalId: EDITAL,
    perfilId: PERFIL,
    tenantId: TENANT,
    clienteFinalId: CLIENTE,
    aderencia: Aderencia.criar(1 / 3),
    recomendacao: 'no-go',
    riscos: [
      Risco.criar('não atende: Atestado de acervo técnico', 'alta', null),
      Risco.criar('não atende: Balanço patrimonial', 'media', null),
    ],
    ...overrides,
  });
}

function repos(triagem: Triagem | null, extracao: ExtracaoEdital | null): {
  triagens: TriagemRepository;
  extracoes: ExtracaoRepository;
} {
  return {
    triagens: {
      porEditalEPerfil: vi.fn().mockResolvedValue(triagem),
      salvar: vi.fn(),
    },
    extracoes: {
      porEdital: vi.fn().mockResolvedValue(extracao),
      salvar: vi.fn(),
    },
  };
}

describe('ConsultarTriagemUseCase', () => {
  describe('read path feliz — TriagemLeituraDTO (A17 §4.2)', () => {
    it('projeta aderência, recomendação, confiancaIA e paginasEdital do domínio', async () => {
      const { triagens, extracoes } = repos(triagemBase(), extracaoBase());
      const uc = new ConsultarTriagemUseCase(triagens, extracoes);

      const dto = await uc.executar(INPUT, noop);

      expect(dto).not.toBeNull();
      expect(dto!.editalId).toBe(EDITAL);
      expect(dto!.perfilId).toBe(PERFIL);
      expect(dto!.aderencia).toBeCloseTo(1 / 3);
      expect(dto!.recomendacao).toBe('no-go');
      expect(dto!.confiancaIA).toBe(0.5); // menor dos 3 críticos (0.9, 0.8, 0.5) — citação null não afeta a confiança
      expect(dto!.paginasEdital).toBe(42);
    });

    it('NÃO expõe riscos[] — o DTO não tem o campo', async () => {
      const { triagens, extracoes } = repos(triagemBase(), extracaoBase());
      const uc = new ConsultarTriagemUseCase(triagens, extracoes);

      const dto = await uc.executar(INPUT, noop);

      expect(dto).not.toHaveProperty('riscos');
    });

    it('converte riscos[] do domínio em checklist.ok:false (lacunas) e mantém atendidos em ok:true', async () => {
      const { triagens, extracoes } = repos(triagemBase(), extracaoBase());
      const uc = new ConsultarTriagemUseCase(triagens, extracoes);

      const dto = await uc.executar(INPUT, noop);

      // 1 item por Requisito, na ordem da extração
      expect(dto!.checklist).toEqual([
        { ok: true, texto: 'Certidão CND' }, // atendido — não está nos riscos
        { ok: false, texto: 'Atestado de acervo técnico' }, // lacuna
        { ok: false, texto: 'Balanço patrimonial' }, // lacuna
      ]);
    });

    it('projeta camposAnalise com fonte renderizada e "verificar" quando sem citação', async () => {
      const { triagens, extracoes } = repos(triagemBase(), extracaoBase());
      const uc = new ConsultarTriagemUseCase(triagens, extracoes);

      const dto = await uc.executar(INPUT, noop);
      const porTitulo = Object.fromEntries(dto!.camposAnalise.map((c) => [c.titulo, c]));

      expect(porTitulo['Objeto']).toEqual({
        titulo: 'Objeto',
        conteudo: 'Aquisição de notebooks',
        fonte: 'p. 1, seção 1.1',
      });
      expect(porTitulo['Valor estimado']!.fonte).toBe('p. 2, seção 2.3');
      expect(porTitulo['Valor estimado']!.conteudo).toContain('R$');
      // dataAberturaPropostas veio sem citação → "verificar", fonte vazia
      expect(porTitulo['Abertura das propostas']).toEqual({
        titulo: 'Abertura das propostas',
        conteudo: 'verificar',
        fonte: '',
      });
    });
  });

  describe('autorização por objeto (P-51 / A17 §5.3)', () => {
    it('lança AcessoNegadoError quando o tenant diverge', async () => {
      const outraTenant = triagemBase({ tenantId: TenantId('outra-empresa') });
      const { triagens, extracoes } = repos(outraTenant, extracaoBase());
      const uc = new ConsultarTriagemUseCase(triagens, extracoes);

      await expect(uc.executar(INPUT, noop)).rejects.toThrow(AcessoNegadoError);
      // não vaza a extração — nem chega a consultá-la
      expect(extracoes.porEdital).not.toHaveBeenCalled();
    });

    it('lança AcessoNegadoError quando o clienteFinal diverge', async () => {
      const outroCliente = triagemBase({ clienteFinalId: ClienteFinalId('cliente-999') });
      const { triagens, extracoes } = repos(outroCliente, extracaoBase());
      const uc = new ConsultarTriagemUseCase(triagens, extracoes);

      await expect(uc.executar(INPUT, noop)).rejects.toThrow(AcessoNegadoError);
    });
  });

  describe('ausências → null (BFF 404 → SPA null)', () => {
    it('retorna null quando não há triagem', async () => {
      const { triagens, extracoes } = repos(null, extracaoBase());
      const uc = new ConsultarTriagemUseCase(triagens, extracoes);

      expect(await uc.executar(INPUT, noop)).toBeNull();
      expect(extracoes.porEdital).not.toHaveBeenCalled();
    });

    it('retorna null quando a triagem existe mas a extração não (estado inconsistente)', async () => {
      const { triagens, extracoes } = repos(triagemBase(), null);
      const uc = new ConsultarTriagemUseCase(triagens, extracoes);

      expect(await uc.executar(INPUT, noop)).toBeNull();
    });
  });

  describe('propagação de AbortSignal (P-78)', () => {
    it('repassa o signal aos dois repositórios', async () => {
      const { triagens, extracoes } = repos(triagemBase(), extracaoBase());
      const uc = new ConsultarTriagemUseCase(triagens, extracoes);

      await uc.executar(INPUT, noop);

      expect(triagens.porEditalEPerfil).toHaveBeenCalledWith(EDITAL, PERFIL, noop);
      expect(extracoes.porEdital).toHaveBeenCalledWith(EDITAL, noop);
    });
  });
});
